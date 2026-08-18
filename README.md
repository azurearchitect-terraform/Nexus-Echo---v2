# Nexus Echo AI v2.1.2

Nexus Echo is a private, local-first desktop assistant for meeting preparation, live notes, interview practice, and knowledge retrieval. It uses Tauri, Rust, React, and TypeScript, with local storage and OS-managed credentials.

## Features

- Live microphone and system-audio transcription with adaptive voice activity detection
- Noise filtering for short sounds, coughs, throat-clearing, chimes, and common STT artifacts
- Ask, Listen, and screen-context workflows from a compact overlay
- Configurable providers: Gemini, OpenAI, Azure OpenAI, Ollama, or offline-only routing
- Live latency mode: one provider, no speculative requests, concise responses, and lower usage
- Provider preflight check that measures connectivity without generating AI responses
- Local answer cache for repeated questions at zero API cost
- Job-description context, company preparation, interview coaching, story bank, and follow-up suggestions
- Local meeting transcripts, summaries, full-text search, and export
- Knowledge retrieval using local SQLite, BM25, and embeddings
- Optional local Ollama and Whisper workflows
- Typed IPC, OS keychain credential storage, and capability-scoped plugins

## Requirements

- Node.js 22 or later
- pnpm 9 or later
- Rust 1.77 or later
- Platform prerequisites from [Tauri](https://tauri.app/start/prerequisites/)

Optional:

- Ollama for local answer generation
- Gemini, OpenAI, or Azure OpenAI API keys for cloud providers
- A loopback audio device when system audio is needed

## Install And Run

```bash
pnpm install
pnpm app:dev
```

Create an installer for the current platform:

```bash
pnpm app:build
```

## Quick Start

1. Open the Dashboard from the tray icon.
2. In **Providers & routing**, add a provider key or configure Ollama.
3. Run **Pre-interview check** to verify configured providers without spending completion tokens.
4. Enable **Live latency mode** when response speed and cost control matter. It uses one provider and concise answers.
5. Add your role, company, job description, and stories in the preparation panels.
6. Start a session with `Ctrl/Cmd + Shift + L`, then use Listen mode for live transcription or Ask mode for manual questions.

## Provider And Cost Guidance

- `single`: one provider request per answer; predictable usage.
- `offline`: Ollama only; no network requests, but performance depends on local hardware.
- `hybrid-race`: fastest first response, but may start more than one provider request.
- `hybrid-tier`: uses a preferred answer provider and fallback.
- **Live latency mode** is the recommended setting for lower costs during a live session.

API keys are stored in the operating system keychain and are not written to the app database or settings file.

## Main Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + Shift + Space` | Toggle overlay |
| `Ctrl/Cmd + Shift + A` | Ask mode |
| `Ctrl/Cmd + Shift + L` | Start or stop listening |
| `Ctrl/Cmd + Shift + S` | Capture screen context |
| `Ctrl/Cmd + Shift + D` | Open dashboard |
| `Ctrl/Cmd + Shift + \` | Hide overlay |

## Privacy

- Transcripts, meetings, and retrieval data are stored locally in SQLite.
- Telemetry is disabled.
- Provider requests are sent only to the provider selected in Settings.
- Use the app only in situations where recording, transcription, and AI assistance are permitted.

## Development

```bash
pnpm typecheck
pnpm test
pnpm lint
```

## Release Notes: 2.1.2

- Added filtering for unbracketed cough and throat-clearing transcription artifacts.
- Added cost-aware Live latency mode and a non-generative provider preflight check.
- Removed the unused Rust `rubato` dependency and its transitive dependencies.
- Updated the desktop settings experience and release documentation.

## License

[MIT](LICENSE)