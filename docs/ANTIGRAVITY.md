# Continuing this project in Gemini Antigravity

Paste the block below into Antigravity **after** opening this repository. It gives the agent the architecture, the invariants it must not break, and the work that remains.

---

## PASTE FROM HERE

You are working on **Nexus Echo AI v2**, an existing Tauri v2 + React 18 + TypeScript monorepo already present in this workspace. Read `README.md` and `packages/core/src/contracts.ts` first — the Zod contracts are the single source of truth for every value crossing the JS↔Rust boundary.

**Stack:** Tauri v2 (Rust) shell · React 18 + TypeScript + Tailwind · pnpm + Turborepo · SQLite (rusqlite) · OS keychain · Zod-validated IPC.

**Architecture:**
- `apps/desktop/src-tauri/src/` — `stealth.rs` (capture exclusion), `audio.rs` (dual-stream capture + VAD), `vision.rs` (screenshots), `db.rs` (SQLite + FTS5), `secrets.rs` (keychain), `commands.rs` (IPC surface), `lib.rs` (hotkeys, tray, setup).
- `packages/core` — Zod contracts, typed IPC helpers, utilities.
- `packages/ai` — provider adapters (OpenAI, Gemini, Ollama), the `HybridRouter`, prompts.
- `packages/rag` — chunking, BM25, cosine, Reciprocal Rank Fusion hybrid retrieval.
- `packages/plugin-sdk` + `plugins/meeting-intelligence` — capability-scoped plugin system.
- `apps/desktop/src/` — `overlay/` (Ask + Listen panel), `dashboard/` (six panels), `lib/` (bridge, engine, store, plugin host).

**Invariants — do not break these:**
1. Every IPC payload is validated against its Zod schema on the TS side and a serde struct on the Rust side. Never add an `invoke` call that bypasses `lib/bridge.ts`.
2. API keys live only in the OS keychain. They must never be written to SQLite, to a settings file, or returned to the frontend unmasked.
3. The overlay must never call `set_focus()`. Taking focus is what exposes it in a screen share.
4. Stealth is applied before the overlay is ever shown, so no unprotected frame can be captured.
5. `telemetry` is typed `z.literal(false)`. It stays that way.
6. In `offline` / `airgapped` mode no network call may be issued by any code path, including embeddings and transcription.
7. A failing plugin is logged and skipped — it must never crash the app mid-meeting.
8. Never widen the CSP allow-list in `tauri.conf.json` without naming the specific host.

**Remaining work, in priority order:**
1. **Region drag-select capture** — the `⌘⇧⌥S` hotkey and `CaptureRegion` plumbing exist but there is no selection overlay. Build a full-screen transparent selection window that returns `{x, y, width, height}`.
2. **OCR for attached documents** — `Attachment.extractedText` is defined and consumed but never populated. Add PDF and image text extraction on the Rust side.
3. **Speaker diarization** — `TranscriptSegment.speakerKey` exists but system-audio speakers are all labelled "Speaker". Add embedding-based clustering so remote participants are distinguished from each other.
4. **Streaming transcription** — transcription currently runs per closed utterance. Move to a streaming STT socket for partial results with `isFinal: false`.
5. **Meetings history UI** — `MeetingsPanel` searches but does not list past meetings with their summaries, decisions, and action items. Add `list_meetings` / `get_meeting` commands and the detail view.
6. **Plugin loading from disk** — `pluginHost` only registers the bundled plugin. Add manifest discovery from the app data directory with a permission-consent prompt on first enable.
7. **Tests** — Vitest for `HybridRouter` race/cancel/circuit-breaker behaviour, `chunkText` boundaries, and RRF fusion ordering. Rust unit tests for the VAD state machine.
8. **Icons and signing** — `src-tauri/icons/` is empty; generate the icon set and wire up notarization and Authenticode.

Work incrementally. After each change run `pnpm typecheck`, `pnpm lint`, and `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`. Do not restructure the monorepo or swap the framework.

## PASTE TO HERE
