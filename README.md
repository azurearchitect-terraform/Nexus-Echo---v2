# Nexus Echo AI v2

A private, local-first AI assistant that lives on a translucent overlay above whatever you are doing. It listens to a meeting, watches your screen when you ask it to, and answers before the silence in the room gets awkward.

Built as a clean-room rebuild: Tauri v2 + Rust for the shell, React 18 + TypeScript for the surface, and a pnpm/Turborepo plugin monorepo underneath.

---

## Why this architecture

| Decision | Reason |
|---|---|
| **Tauri, not Electron** | ~10 MB installer against ~120 MB, launches in well under 100 ms, and — critically — gives direct access to the native window APIs that make capture-exclusion possible. Electron cannot reach `WDA_EXCLUDEFROMCAPTURE` or `NSWindowSharingNone` without a native addon. |
| **Monorepo with typed IPC** | Every value crossing the JS↔Rust boundary is validated against a Zod schema on the TS side and a serde struct on the Rust side. A renamed field is a compile error, not a runtime failure in front of a client. |
| **Hybrid racing router** | Gemini and OpenAI are fired at the same instant on the same prompt. The first to produce a real token wins and streams; the loser is aborted after a dozen tokens. You get the *lower* of two latencies on every single turn, for roughly the cost of one and a bit completions. |
| **Local SQLite + OS keychain** | Chats, meetings, transcripts, and embeddings live in one file on the user's disk. API keys live in Keychain / Credential Manager / Secret Service and are never written to the database or a settings file. |
| **Hybrid retrieval (vector + BM25 + RRF)** | Embeddings find meaning; BM25 finds exact strings like error codes and ticket numbers. Those are precisely the terms people ask about under pressure. Reciprocal Rank Fusion merges them without a hand-tuned weight that would be wrong on the next corpus. |

---

## The four speed modes

Set in **Dashboard → Providers & routing**.

**`hybrid-race`** — both providers fire simultaneously; first token wins, loser is cancelled. Fastest possible perceived latency.

**`hybrid-tier`** — the fast model answers in ~300 ms so you always have something to say; the deep model works in the background and silently replaces the answer when it lands. This is the default.

**`single`** — one provider, no fan-out. Predictable cost.

**`offline`** — Ollama only. Nothing leaves the machine. The only mode that is safe under a strict NDA.

A rolling latency EWMA per provider decides who starts first on the next turn, and a circuit breaker benches any provider that fails twice inside a minute.

---

## Stealth: what is actually true

| Platform | Excluded from screen capture | Mechanism |
|---|---|---|
| **Windows 10 2004+** | Yes | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` — visible locally, absent from the captured frame entirely |
| **macOS 11+** | Yes | `NSWindowSharingNone` + accessory activation policy |
| **Linux** | **No** | Neither X11 nor Wayland exposes a capture-exclusion API. The overlay **will** appear in a screen share. The app states this plainly in Settings rather than implying protection it cannot deliver. |

Three properties combine, and the second matters more than people expect:

1. **Capture exclusion** — the compositor omits the window.
2. **Never takes focus** — the app underneath stays active. A window visibly deactivating mid-sentence is what actually gives people away, not the overlay itself.
3. **Presence suppression** — no taskbar button, no Dock tile, no Alt-Tab entry.

**Panic key: `⌘/Ctrl + ⇧ + \`** blanks the overlay instantly from inside any application. Learn it before relying on any of the rest.

---

## Prerequisites

- **Node 22 LTS** and **pnpm ≥ 9**
- **Rust stable ≥ 1.77** (`rustup default stable`)
- Platform toolchain per [Tauri's prerequisites](https://tauri.app/start/prerequisites/)
- Optional: **Ollama** for offline mode, **whisper.cpp server** on `:8080` for offline transcription

**System audio capture** needs a loopback device:
- **Windows** — WASAPI loopback works out of the box
- **macOS** — install [BlackHole](https://github.com/ExistentialAudio/BlackHole) and route through a Multi-Output Device
- **Linux** — use the PulseAudio/PipeWire monitor source

If no loopback device is found the session degrades to microphone-only rather than failing.

---

## Getting started

```bash
pnpm install
pnpm app:dev          # Vite + Tauri, hot reload on both sides
pnpm app:build        # signed installers for the current platform
```

Then open the dashboard from the tray icon and paste a Gemini and/or OpenAI key. Keys go straight to the OS keychain.

---

## Hotkeys

| Keys | Action |
|---|---|
| `⌘/Ctrl ⇧ Space` | Show / hide the overlay |
| `⌘/Ctrl ⇧ A` | Ask mode, focus the input |
| `⌘/Ctrl ⇧ L` | Start / stop listening |
| `⌘/Ctrl ⇧ S` | Capture the screen into the next question |
| `⌘/Ctrl ⇧ ⌥ S` | Drag-select a region |
| `⌘/Ctrl ⇧ ↵` | Suggest a reply from the live transcript |
| `⌘/Ctrl ⇧ \` | **Panic** — blank the overlay |

---

## Layout

```
apps/desktop/
  src/                    React surface
    overlay/              the floating panel (Ask + Listen)
    dashboard/            meetings, knowledge, providers, stealth, plugins
    lib/                  typed bridge, engine, store, plugin host
  src-tauri/src/
    stealth.rs            capture exclusion, focus suppression, per-OS hooks
    audio.rs              dual-stream capture, adaptive VAD, WAV framing
    vision.rs             screenshots (hides the overlay from its own frame)
    db.rs                 SQLite schema, FTS5 search, vector storage
    secrets.rs            OS keychain
    commands.rs           the validated IPC surface
packages/
  core/                   Zod contracts — the single source of truth
  ai/                     providers + the hybrid racing router + prompts
  rag/                    chunking, BM25, RRF, hybrid retrieval
  plugin-sdk/             capability-scoped plugin API
plugins/
  meeting-intelligence/   reference plugin: live commitment detection
```

---

## Plugin model

Permissions are **capability grants, not labels**. The host builds each plugin a context object containing only the methods its manifest requested — a plugin without `network` does not receive a `fetch` at all, so there is no check to bypass.

```ts
import { definePlugin } from "@nexus/plugin-sdk";

export default definePlugin({
  manifest: {
    id: "my-plugin",
    name: "My plugin",
    version: "1.0.0",
    description: "What it does",
    permissions: ["transcript:read", "notify"],
    hooks: ["onTranscriptSegment"],
  },
  onTranscriptSegment(segment, ctx) {
    if (segment.text.includes("action item")) ctx.notify?.("Caught one", segment.text);
  },
});
```

A plugin that throws is logged and skipped — it never takes the assistant down mid-meeting.

---

## Privacy

- Everything is stored in one local SQLite file. **Dashboard → Diagnostics → Erase everything** deletes all of it.
- No telemetry. The setting is typed `z.literal(false)` so it cannot be turned on.
- The CSP allow-list names every reachable host explicitly. In `offline` mode nothing is contacted at all.
- Meeting audio contains people who never consented to it. Recording laws vary by jurisdiction and several require all-party consent — that is your responsibility, not the software's.

---

## Licence

MIT. This is an independent clean-room implementation; it contains no third-party application code.
