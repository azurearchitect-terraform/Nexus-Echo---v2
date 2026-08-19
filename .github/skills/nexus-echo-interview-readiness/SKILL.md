---
name: nexus-echo-interview-readiness
description: 'Prepare, test, troubleshoot, or verify Nexus Echo before a real interview. Use for pre-interview checks, interview dry runs, provider and model readiness, microphone or system-audio testing, overlay and hotkey verification, latency and cost setup, job-description context, story-bank preparation, fallback checks, and live-session release validation.'
argument-hint: 'Describe the interview, readiness concern, failed check, or changed live-session feature'
---

# Nexus Echo Interview Readiness

Verify the complete path from interview preparation to a usable live answer. Prioritize reliable behavior under time pressure, truthful readiness results, concise output, and a clear fallback when an optional capability fails.

## 1. Choose The Mode

Classify the request before running checks:

| Mode | Use When | Output |
| --- | --- | --- |
| Personal readiness | Preparing for a specific interview | A go/no-go checklist and fallback plan |
| Troubleshooting | A provider, audio source, overlay, shortcut, or answer flow fails | Root cause, focused fix, and repeated failed check |
| Change verification | Code affecting the live interview path changed | Focused tests, native smoke checks, and regression risks |

Ask for missing interview-specific information only when it changes the checks: interview time, remote platform, target role, interview type, allowed assistance, required audio sources, and cloud versus offline constraints.

## 2. Protect The Interview First

Before technical setup:

1. Confirm that recording, transcription, screen context, and AI assistance are permitted by the interviewer, employer, platform, and applicable rules.
2. Do not claim that stealth features bypass proctoring, managed-device monitoring, physical observation, external cameras, or unsupported platform limitations.
3. Decide whether interview content may be sent to a cloud provider. Use offline mode under a strict NDA or no-cloud requirement.
4. Avoid changing dependencies, models, operating-system audio configuration, or major settings immediately before the interview unless fixing a blocking failure.

If assistance is not permitted, stop the live-assistance checklist. The preparation and mock-interview features may still be used beforehand where allowed.

## 3. Verify In Dependency Order

Do not start with a full mock session. Check prerequisites from cheapest to most stateful so failures have a narrow cause.

### A. Candidate Context

- Confirm target role, experience, company, job description, and standing instructions are current.
- Select the correct interview mode: mixed, behavioral, technical, system design, HR, recruiter, or leadership.
- Prepare 5 to 10 story-bank entries with situation, task, personal action, result, tags, and measurable impact.
- Ensure stories do not contain secrets or information that cannot be shared with the configured provider.
- Test one representative question and confirm the answer is grounded in the candidate's actual experience rather than invented details.

### B. Provider And Cost Readiness

- Confirm at least one enabled answer provider is actually configured.
- Run the in-app **Pre-interview check** and record reachability and latency.
- Treat an empty provider result, unavailable primary provider, invalid model name, or failed offline endpoint as **no-go** until a fallback works.
- Prefer Live latency mode for a real session: single provider, no speculative requests, and concise output.
- Verify the selected speech-to-text engine has the credentials or local model it requires.
- Confirm preflight probes connectivity without generating a completion or consuming answer tokens.

### C. Native Audio Readiness

- Verify the intended microphone appears and produces transcript events.
- Test system audio separately when remote interviewer transcription is required.
- Confirm that missing loopback audio either has an understood fallback or is a no-go for the intended workflow.
- Start and stop listening twice to catch stale sessions, leaked capture, and duplicate events.
- Speak a normal sentence with a pause and verify voice activity detection neither clips the ending nor splits ordinary pauses excessively.
- Check behavior with silence and a short non-speech sound so noise filtering does not create misleading transcript text.

Audio, keychain, window, screenshot, and global-shortcut checks require the Tauri application; browser-only validation is insufficient.

### D. Overlay And Controls

- Verify overlay toggle, Ask mode, Listen mode, screen context, dashboard, and panic-hide shortcuts.
- Confirm the overlay remains readable at its compact size and does not steal focus during normal show/hide behavior.
- Verify click-through and resize modes can be entered and exited without trapping the user.
- Test panic hide before testing any optional screen-capture behavior.
- If screen context is allowed, confirm the overlay hides before capture and restores afterward, including the error path.

### E. End-To-End Dry Run

1. Use the same headset, microphone, network, meeting application, display arrangement, and provider mode planned for the interview.
2. Start a session and ask one question from each expected interview category.
3. Confirm transcription identifies the useful question without excessive artifacts.
4. Measure whether the first useful answer appears within the user's acceptable delay.
5. Check that output is concise, truthful, aligned with the job description, and usable without reading a long paragraph.
6. Confirm coaching, likely follow-ups, and story matching reflect the answer actually given.
7. Stop the session and confirm capture ends, the active meeting clears, and the transcript remains available as expected.

## 4. Branch On Failures

Follow the narrow branch matching the first failed dependency:

- **No providers found**: verify enabled providers, keychain references, local endpoint, and engine configuration before testing prompts.
- **Provider unreachable**: retry once, then switch to a pre-verified provider or offline mode; do not repeatedly spend interview time changing model names.
- **Slow first token**: enable Live latency mode, use one reachable fast provider, disable speculative work, and reduce unnecessary context.
- **Microphone missing**: verify OS permission and selected device, then restart capture. Do not debug system audio at the same time.
- **System audio missing**: verify loopback support and device choice; decide explicitly whether mic-only behavior is acceptable.
- **Transcript is fragmented**: inspect voice activity threshold and silence hangover using a controlled sentence before changing provider routing.
- **Overlay or hotkey failure**: verify native app focus, shortcut registration, and conflicting OS shortcuts; keep the dashboard as the fallback control surface.
- **Screen capture failure**: restore overlay visibility first, then inspect permission and capture-region handling.
- **Generic or invented answer**: verify candidate context, story-bank match, retrieval readiness, and prompt construction before changing model/provider.

Change one variable at a time and repeat the failed check immediately. Do not proceed to the full dry run until the dependency passes or an explicit fallback is accepted.

## 5. Verify Code Changes

For implementation or regression work, trace the live path through its owning boundary:

| Behavior | Owning Areas |
| --- | --- |
| Provider preflight and routing | `apps/desktop/src/lib/engine.ts`, `packages/ai/src/router.ts`, provider modules |
| Interview context and coaching | `apps/desktop/src/lib/interview.ts`, store, prompts, Interview Lab |
| Settings and cost mode | Settings panel, shared settings contracts, engine configuration |
| Audio lifecycle and VAD | bridge, Rust listening commands, audio module, transcript events |
| Overlay and shortcuts | overlay UI, bridge, Rust window and hotkey handling |
| Screen context | vision command, capture workflow, overlay restore path |

State one falsifiable hypothesis, make the smallest edit at the controlling boundary, and run the cheapest focused test immediately afterward. For cross-boundary changes, verify command names, payload shapes, units, optional fields, return types, event names, and registration from React through Rust.

Run focused package tests first, then applicable repository checks:

```powershell
pnpm typecheck
pnpm lint
pnpm test
cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

Use `pnpm app:dev` for the native smoke checks. Do not report audio, keychain, shortcuts, focus, screen capture, or capture exclusion as verified from typechecks or unit tests alone.

## 6. Go Or No-Go Decision

Report each item as **Pass**, **Fallback**, **Fail**, or **Not tested**.

The live workflow is **go** only when:

- Assistance and data handling are permitted for the interview.
- Candidate context is current and one representative answer is factually grounded.
- At least one provider and the selected speech-to-text path are verified.
- Required audio sources work with the planned meeting setup.
- Start, stop, transcript, overlay, and emergency-hide behavior pass in the native app.
- First-answer latency is acceptable and output is concise enough for live use.
- Every optional failed feature has a tested fallback that preserves the required workflow.

Any unverified required audio source, unavailable sole provider, stale candidate context, invented answer, stuck capture session, or broken emergency hide is **no-go**.

Finish with the go/no-go result, failed checks, tested fallbacks, configuration used, and the exact native behaviors that remain unverified.