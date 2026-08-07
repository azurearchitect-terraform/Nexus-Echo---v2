# Architecture notes

## The racing router

The core latency trick lives in `packages/ai/src/router.ts`.

In `hybrid-race`, both providers are invoked simultaneously with the same prompt. The first to emit a non-empty token becomes the winner and streams straight to the UI. Every other candidate is aborted once the winner has produced `raceCancelAfterTokens` (default 12) tokens.

The cost profile is better than it looks. The loser is cancelled within a few hundred milliseconds of the winner's first token, so you pay for one full completion plus a fraction of a second one — while getting the *lower* of the two latencies on every turn rather than the average.

Two mechanisms keep it adaptive:

- **Latency EWMA** — each provider carries `ewmaFirstTokenMs`, updated `0.7 * old + 0.3 * new`. Candidates are ordered by it, so whichever API is fast on today's network starts first.
- **Circuit breaker** — two failures inside 60 seconds benches a provider until the window passes. This stops a dead key or a regional outage from adding the full timeout to every single turn.

`hybrid-tier` solves a different problem. Racing gives you the faster of two answers, but both are the *fast* model. Tiered mode streams the fast answer immediately so the user has something to say within ~300 ms, while the deep model generates in the background. If the deep answer arrives while the user is still reading, a `swap` event replaces it.

## Why VAD has a hangover window

`audio.rs` closes an utterance only after `vadSilenceMs` of continuous silence (default 700 ms). Without that hangover, every natural mid-sentence pause splits one utterance into two, and the transcript becomes a stream of fragments that no summarizer can reassemble.

The noise floor is also adaptive: while not speaking, the floor tracks ambient energy at `0.98 * old + 0.02 * new`, and the actual gate is `max(noiseFloor * 2.5, threshold)`. A fixed threshold that works in a quiet room reads a cafe as continuous speech.

## Why two audio streams instead of diarization

Microphone and system loopback are captured as separate streams. Knowing which *device* audio arrived on is a more reliable speaker signal than any clustering algorithm, and it is free. Diarization then only has to separate the remote speakers from each other, which is a far easier problem than separating everyone including the user.

## Why retrieval fuses two rankings

Dense vectors find semantic matches; BM25 finds exact strings. Under pressure people ask about error codes, ticket numbers, and unusual product names — exactly the tokens embeddings smooth away.

The two ranked lists are merged with Reciprocal Rank Fusion (`1 / (60 + rank)`) rather than a weighted score blend, because cosine similarity and BM25 scores live on incomparable scales. Any fixed weight ends up tuned to one corpus and wrong on the next; RRF only uses rank position, so it transfers.

## Why the overlay hides itself before a screenshot

`vision.rs` hides the overlay, sleeps 60 ms for the compositor to catch up, captures, then restores. Without this the model receives a screenshot containing its own previous answer and starts commenting on its own output.

## Threat model

The stealth features defend against **a viewer watching a shared screen**. They do not defend against:

- A managed device with monitoring agents or kernel-level proctoring software
- Someone physically looking at the screen
- An external camera pointed at the display

Linux offers no capture-exclusion API at all, and the app says so plainly in Settings instead of implying protection it cannot deliver.
