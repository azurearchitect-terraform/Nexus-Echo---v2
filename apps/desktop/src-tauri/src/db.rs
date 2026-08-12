//! Local SQLite store. Everything the user produces stays here, on their disk,
//! in one file they can delete. No sync, no telemetry, no remote copy.

use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub struct Db(pub Mutex<Connection>);

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT 'New chat',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  attachments     TEXT NOT NULL DEFAULT '[]',
  citations       TEXT NOT NULL DEFAULT '[]',
  provider        TEXT,
  model           TEXT,
  latency_ms      INTEGER,
  first_token_ms  INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS meetings (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ended_at     INTEGER,
  participants TEXT NOT NULL DEFAULT '[]',
  summary      TEXT,
  decisions    TEXT NOT NULL DEFAULT '[]',
  action_items TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id          TEXT PRIMARY KEY,
  meeting_id  TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker     TEXT NOT NULL,
  speaker_key TEXT,
  text        TEXT NOT NULL,
  start_ms    INTEGER NOT NULL,
  end_ms      INTEGER NOT NULL,
  source      TEXT NOT NULL,
  confidence  REAL
);
CREATE INDEX IF NOT EXISTS idx_segments_meeting ON transcript_segments(meeting_id, start_ms);

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  path        TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  indexed_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id      TEXT PRIMARY KEY,
  doc_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  title   TEXT NOT NULL,
  text    TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  vector  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);

CREATE TABLE IF NOT EXISTS prompts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_fts
  USING fts5(entity_id UNINDEXED, kind UNINDEXED, title, body);
"#;

impl Db {
    pub fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self(Mutex::new(conn)))
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO settings(key, value) VALUES(?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let conn = self.0.lock();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        Ok(rows.next()?.map(|r| r.get::<_, String>(0)).transpose()?)
    }

    pub fn upsert_conversation(&self, id: &str, title: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.0.lock().execute(
            "INSERT INTO conversations(id, title, created_at, updated_at) VALUES(?1, ?2, ?3, ?3)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = ?3",
            params![id, title, now],
        )?;
        Ok(())
    }

    pub fn insert_message(&self, m: &StoredMessage) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO messages(id, conversation_id, role, content, attachments, citations,
                                  provider, model, latency_ms, first_token_ms, created_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                m.id, m.conversation_id, m.role, m.content, m.attachments, m.citations,
                m.provider, m.model, m.latency_ms, m.first_token_ms, m.created_at
            ],
        )?;
        self.index_fts(&m.id, "message", "", &m.content)?;
        Ok(())
    }

    pub fn list_messages(&self, conversation_id: &str) -> Result<Vec<StoredMessage>> {
        let conn = self.0.lock();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, attachments, citations, provider, model,
                    latency_ms, first_token_ms, created_at
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![conversation_id], |r| {
            Ok(StoredMessage {
                id: r.get(0)?,
                conversation_id: r.get(1)?,
                role: r.get(2)?,
                content: r.get(3)?,
                attachments: r.get(4)?,
                citations: r.get(5)?,
                provider: r.get(6)?,
                model: r.get(7)?,
                latency_ms: r.get(8)?,
                first_token_ms: r.get(9)?,
                created_at: r.get(10)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn create_meeting(&self, id: &str, title: &str) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO meetings(id, title, started_at) VALUES(?1, ?2, ?3)",
            params![id, title, chrono::Utc::now().timestamp_millis()],
        )?;
        Ok(())
    }

    pub fn insert_segment(&self, s: &StoredSegment) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO transcript_segments(id, meeting_id, speaker, speaker_key, text, start_ms, end_ms, source, confidence)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![s.id, s.meeting_id, s.speaker, s.speaker_key, s.text, s.start_ms, s.end_ms, s.source, s.confidence],
        )?;
        self.index_fts(&s.id, "segment", &s.speaker, &s.text)?;
        Ok(())
    }

    pub fn finalize_meeting(
        &self,
        id: &str,
        summary: &str,
        decisions: &str,
        action_items: &str,
        participants: &str,
        title: &str,
    ) -> Result<()> {
        self.0.lock().execute(
            "UPDATE meetings SET ended_at = ?2, summary = ?3, decisions = ?4,
                                 action_items = ?5, participants = ?6, title = ?7
             WHERE id = ?1",
            params![
                id,
                chrono::Utc::now().timestamp_millis(),
                summary,
                decisions,
                action_items,
                participants,
                title
            ],
        )?;
        self.index_fts(id, "meeting", title, summary)?;
        Ok(())
    }

    fn index_fts(&self, entity_id: &str, kind: &str, title: &str, body: &str) -> Result<()> {
        self.0.lock().execute(
            "INSERT INTO search_fts(entity_id, kind, title, body) VALUES(?1,?2,?3,?4)",
            params![entity_id, kind, title, body],
        )?;
        Ok(())
    }

    pub fn search(&self, query: &str, limit: i64) -> Result<Vec<SearchHit>> {
        let conn = self.0.lock();
        let mut stmt = conn.prepare(
            "SELECT entity_id, kind, title, snippet(search_fts, 3, '[', ']', '…', 18)
             FROM search_fts WHERE search_fts MATCH ?1 ORDER BY rank LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![query, limit], |r| {
            Ok(SearchHit { entity_id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, snippet: r.get(3)? })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn save_chunks(&self, chunks: &[StoredChunk]) -> Result<()> {
        let mut conn = self.0.lock();
        let tx = conn.transaction()?;
        for c in chunks {
            tx.execute(
                "INSERT OR IGNORE INTO documents(id, title, path, mime_type, indexed_at) VALUES(?1, ?2, '', '', ?3)",
                params![c.doc_id, c.title, chrono::Utc::now().timestamp_millis()],
            )?;
            tx.execute(
                "INSERT INTO chunks(id, doc_id, title, text, ordinal, vector) VALUES(?1,?2,?3,?4,?5,?6)
                 ON CONFLICT(id) DO UPDATE SET text = excluded.text, vector = excluded.vector",
                params![c.id, c.doc_id, c.title, c.text, c.ordinal, c.vector],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn load_chunks(&self) -> Result<Vec<StoredChunk>> {
        let conn = self.0.lock();
        let mut stmt =
            conn.prepare("SELECT id, doc_id, title, text, ordinal, vector FROM chunks")?;
        let rows = stmt.query_map([], |r| {
            Ok(StoredChunk {
                id: r.get(0)?,
                doc_id: r.get(1)?,
                title: r.get(2)?,
                text: r.get(3)?,
                ordinal: r.get(4)?,
                vector: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn delete_document(&self, doc_id: &str) -> Result<()> {
        let conn = self.0.lock();
        conn.execute("DELETE FROM chunks WHERE doc_id = ?1", params![doc_id])?;
        conn.execute("DELETE FROM documents WHERE id = ?1", params![doc_id])?;
        Ok(())
    }

    /// Irreversible. Exposed in Settings as "Erase everything".
    pub fn wipe(&self) -> Result<()> {
        let conn = self.0.lock();
        conn.execute_batch(
            "DELETE FROM messages;
             DELETE FROM conversations;
             DELETE FROM transcript_segments;
             DELETE FROM meetings;
             DELETE FROM chunks;
             DELETE FROM documents;
             DELETE FROM search_fts;
             VACUUM;",
        ).map_err(|e| anyhow!("wipe failed: {e}"))?;
        Ok(())
    }

    pub fn get_all_settings(&self) -> Result<std::collections::HashMap<String, String>> {
        let conn = self.0.lock();
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.filter_map(Result::ok).collect())
    }

    pub fn get_all_conversations(&self) -> Result<Vec<StoredConversation>> {
        let conn = self.0.lock();
        let mut stmt = conn.prepare("SELECT id, title, created_at, updated_at FROM conversations")?;
        let rows = stmt.query_map([], |r| {
            Ok(StoredConversation {
                id: r.get(0)?,
                title: r.get(1)?,
                created_at: r.get(2)?,
                updated_at: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn get_all_messages(&self) -> Result<Vec<StoredMessage>> {
        let conn = self.0.lock();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, attachments, citations, provider, model,
                    latency_ms, first_token_ms, created_at
             FROM messages"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(StoredMessage {
                id: r.get(0)?,
                conversation_id: r.get(1)?,
                role: r.get(2)?,
                content: r.get(3)?,
                attachments: r.get(4)?,
                citations: r.get(5)?,
                provider: r.get(6)?,
                model: r.get(7)?,
                latency_ms: r.get(8)?,
                first_token_ms: r.get(9)?,
                created_at: r.get(10)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn get_all_meetings(&self) -> Result<Vec<StoredMeeting>> {
        let conn = self.0.lock();
        let mut stmt = conn.prepare(
            "SELECT id, title, started_at, ended_at, participants, summary, decisions, action_items FROM meetings"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(StoredMeeting {
                id: r.get(0)?,
                title: r.get(1)?,
                started_at: r.get(2)?,
                ended_at: r.get(3)?,
                participants: r.get(4)?,
                summary: r.get(5)?,
                decisions: r.get(6)?,
                action_items: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn get_all_segments(&self) -> Result<Vec<StoredSegment>> {
        let conn = self.0.lock();
        let mut stmt = conn.prepare(
            "SELECT id, meeting_id, speaker, speaker_key, text, start_ms, end_ms, source, confidence FROM transcript_segments"
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(StoredSegment {
                id: r.get(0)?,
                meeting_id: r.get(1)?,
                speaker: r.get(2)?,
                speaker_key: r.get(3)?,
                text: r.get(4)?,
                start_ms: r.get(5)?,
                end_ms: r.get(6)?,
                source: r.get(7)?,
                confidence: r.get(8)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
}

fn de_opt_i64_from_f64<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Deserialize;
    let v = Option::<serde_json::Value>::deserialize(deserializer)?;
    match v {
        Some(serde_json::Value::Number(n)) => {
            if let Some(i) = n.as_i64() {
                Ok(Some(i))
            } else if let Some(f) = n.as_f64() {
                Ok(Some(f.round() as i64))
            } else {
                Ok(None)
            }
        }
        _ => Ok(None),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredConversation {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMeeting {
    pub id: String,
    pub title: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub participants: String,
    pub summary: Option<String>,
    pub decisions: String,
    pub action_items: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub attachments: String,
    pub citations: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    #[serde(default, deserialize_with = "de_opt_i64_from_f64")]
    pub latency_ms: Option<i64>,
    #[serde(default, deserialize_with = "de_opt_i64_from_f64")]
    pub first_token_ms: Option<i64>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSegment {
    pub id: String,
    pub meeting_id: String,
    pub speaker: String,
    pub speaker_key: Option<String>,
    pub text: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub source: String,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredChunk {
    pub id: String,
    pub doc_id: String,
    pub title: String,
    pub text: String,
    pub ordinal: i64,
    pub vector: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub entity_id: String,
    pub kind: String,
    pub title: String,
    pub snippet: String,
}
