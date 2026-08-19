---
name: nexus-echo-security-review
description: 'Audit, review, or verify Nexus Echo security and privacy across React, Tauri IPC, Rust commands, audio, screenshots, AI providers, exports, local storage, keychain credentials, URLs, plugins, and stealth claims. Use for security reviews, privacy checks, threat modeling, sensitive feature changes, vulnerability remediation, pull requests, and release readiness.'
argument-hint: 'Describe the feature, files, pull request, or security concern to review'
---

# Nexus Echo Security Review

Review Nexus Echo changes against its local-first privacy promise and actual Tauri trust boundaries. Produce evidence-based findings and verify fixes without turning the review into an unrelated refactor.

## 1. Set The Review Target

1. Identify the feature, changed files, diff, or reported concern.
2. State the user-visible behavior and assets that require protection.
3. Name one falsifiable risk hypothesis and the cheapest check that could disprove it.
4. Read only the owning implementation, its nearest caller, and its trust boundary first.
5. Treat `README.md` and `docs/ARCHITECTURE.md` as claimed behavior, then confirm those claims in current code.

If the starting file only forwards, registers, or renders behavior, move one hop to the code that validates, authorizes, sends, persists, logs, or deletes data.

## 2. Map Relevant Trust Boundaries

Select only the boundaries touched by the target:

| Boundary | Start Here | Review Focus |
| --- | --- | --- |
| Webview to native | `apps/desktop/src/lib/bridge.ts`, `packages/core/src/`, `apps/desktop/src-tauri/src/` | Command exposure, payload validation, response shape, event names, and command registration |
| Filesystem and exports | Rust commands, database, Tauri capabilities | User-controlled paths, overwrite behavior, archive contents, permissions, and sensitive metadata |
| Credentials | Rust secret module and provider settings | OS keychain use, redaction, deletion, hints, logs, exports, and UI state |
| External providers | `packages/ai/src/` | Selected-provider routing, context minimization, cancellation, timeouts, retries, and hidden cost |
| Network scraping | Rust scraper and callers | URL scheme, redirect destination, DNS/private-network access, response size, timeout, and parsed content |
| Audio and transcripts | Audio commands, events, database | Consent, source selection, lifecycle cleanup, local retention, speaker data, and accidental capture |
| Screenshots and stealth | Rust vision/stealth modules and overlay | Capture exclusion limits, focus behavior, overlay restoration, image lifetime, and truthful platform claims |
| Retrieval and deletion | `packages/rag/src/`, Rust database | Cross-document leakage, derived indexes, stale chunks, wipe completeness, and local-only behavior |
| Plugins | `packages/plugin-sdk/`, `plugins/`, capabilities | Least privilege, untrusted input, failure isolation, and data access scope |

For IPC changes, trace the complete path: component or store, bridge, shared contract, Rust payload and return type, registration, state or side effect, and emitted event. Verify casing, optional fields, units, nullability, and error semantics at both ends.

## 3. Test The Security Properties

Apply the checks relevant to the mapped boundaries.

### Input And Resource Safety

- Validate before filesystem, network, database, device, or process access.
- Constrain paths to an intended directory or use an OS file dialog; define overwrite behavior.
- Restrict URL schemes and redirect targets. Consider loopback, link-local, private, and metadata endpoints.
- Bound downloaded bodies, stream buffers, screenshots, transcript fields, retries, and background work.
- Reject invalid numeric ranges, empty identifiers, malformed serialized data, and impossible state combinations.
- Avoid panics, unchecked indexing, and unbounded loops on data or state influenced outside the module.

### Privacy And Data Lifecycle

- Send only necessary context to the provider explicitly selected in Settings.
- Keep credentials in the OS keychain; never persist them in settings, logs, exports, transcripts, or component state longer than needed.
- Inspect exports for settings, prompts, transcripts, screenshots, paths, provider metadata, and derived data that users may not expect.
- Verify deletion removes source records and derived chunks, vectors, caches, attachments, and indexes.
- Check logs and errors for transcript text, meeting IDs, filesystem paths, API responses, and credentials.
- Ensure health checks and offline mode do not silently generate or transmit content.

### Tauri And Platform Controls

- Confirm exposed commands are required and registered intentionally.
- Review Tauri capability and asset-protocol scopes for least privilege.
- Do not rely on frontend checks as the security boundary; enforce constraints in Rust.
- Preserve overlay focus, click-through, panic-hide, and capture-restore behavior.
- Match stealth wording to platform reality. Do not imply defense against managed-device monitoring, physical observation, external cameras, or unsupported Linux capture exclusion.

### Reliability, Cost, And Abuse Resistance

- Propagate cancellation through provider, audio, and capture workflows.
- Bound network waits and degrade explicitly when optional providers, loopback audio, embeddings, or platform APIs fail.
- Do not add speculative provider requests without an explicit routing-mode reason.
- Preserve abort behavior for losing requests and avoid completion calls in preflight checks.
- Check repeated hotkeys, concurrent commands, duplicate starts/stops, and partial failures for leaked work or inconsistent state.

## 4. Prove Each Finding

Report a finding only when current code or an executable check supports it.

For every finding include:

1. **Severity**: Critical, High, Medium, or Low.
2. **Location**: Clickable file and line reference.
3. **Security property**: What guarantee is violated.
4. **Trigger**: Concrete input, state, or call sequence.
5. **Impact**: What an attacker, malicious page, compromised webview, or accidental workflow can achieve.
6. **Evidence**: The controlling code path or focused reproduction.
7. **Remediation**: The smallest fix at the enforcing boundary.
8. **Verification**: A regression test or command that would fail before the fix and pass after it.

Do not report style preferences, hardcoded known-good regular expressions, or speculative dependency behavior as vulnerabilities without a realistic trigger. Distinguish a confirmed exploit path from defense in depth and missing hardening.

### Severity Guide

- **Critical**: Direct credential compromise, arbitrary code execution, or broad arbitrary file access with a realistic path.
- **High**: Sensitive transcript or screenshot disclosure, meaningful authentication bypass, destructive data loss, or reliable remote denial of service.
- **Medium**: Constrained data exposure, local privilege misuse, persistent privacy failure, or resource exhaustion requiring notable conditions.
- **Low**: Limited hardening gap with small impact or difficult prerequisites.

Raise severity only when both impact and exploitability justify it. State required assumptions explicitly.

## 5. Verify A Remediation

1. Add a focused regression test at the owning boundary before or with the fix.
2. Make the smallest change that enforces the missing property.
3. After the first substantive edit, run the focused test immediately.
4. If it fails, repair the same area and rerun it before expanding scope.
5. Test valid input, rejected input, boundary values, and partial failure cleanup.
6. Confirm the fix does not weaken local-first routing, native behavior, or user-visible error handling.

Run the narrowest applicable package test first, then the repository checks required by the changed languages:

```powershell
pnpm typecheck
pnpm lint
pnpm test
cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

Use `pnpm app:dev` for behavior that depends on native windows, audio devices, global shortcuts, screen capture, keychain access, filesystem dialogs, or platform-specific stealth behavior.

## 6. Finish The Review

Present findings first, ordered by severity. Then list open assumptions and test gaps, followed by a brief summary of reviewed boundaries and commands run.

A review is complete when:

- Each finding has a realistic trigger, impact, evidence, and verification path.
- Every relevant trust boundary was traced end to end.
- Confirmed vulnerabilities are separated from hardening suggestions and test gaps.
- Relevant privacy, input, lifecycle, cancellation, fallback, cost, and platform-claim checks were applied.
- Fixes pass focused regression tests and applicable repository checks.
- Any untested native or platform behavior is named as residual risk.