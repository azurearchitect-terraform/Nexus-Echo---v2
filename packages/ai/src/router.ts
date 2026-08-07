import type { ProviderId, RoutingPolicy, StreamEvent, Attachment } from "@nexus/core";
import { uid } from "@nexus/core";
import type { Provider, GenerateOptions } from "./types";

export interface RouterInput {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  attachments?: Attachment[];
  policy: RoutingPolicy;
  /** role -> model name, per provider */
  models: Record<ProviderId, { fast: string; deep: string; vision: string }>;
}

interface Health {
  ewmaFirstTokenMs: number;
  failures: number;
  lastFailureAt: number;
}

/**
 * The speed engine.
 *
 * hybrid-race: both providers are fired simultaneously on the same prompt. The
 * first one to emit a real token wins and streams straight to the UI; the loser is
 * aborted immediately so we never pay for two full completions — only for the few
 * tokens the loser produced before cancellation.
 *
 * hybrid-tier: the fast model answers immediately so the user has something to say
 * within ~300ms, while the deep model works in the background. If the deep answer
 * lands before the user has moved on, the UI swaps it in with a `swap` event.
 *
 * A rolling latency EWMA per provider decides who gets to start first on the next
 * turn, so the router adapts to whichever API is fast on this network today.
 */
export class HybridRouter {
  private providers = new Map<ProviderId, Provider>();
  private health = new Map<ProviderId, Health>();

  clear(): void {
    this.providers.clear();
    this.health.clear();
  }

  register(provider: Provider): void {
    this.providers.set(provider.id, provider);
    if (!this.health.has(provider.id)) {
      this.health.set(provider.id, { ewmaFirstTokenMs: 800, failures: 0, lastFailureAt: 0 });
    }
  }

  getHealth(id: ProviderId): Health | undefined {
    return this.health.get(id);
  }

  private note(id: ProviderId, firstTokenMs: number): void {
    const h = this.health.get(id);
    if (!h) return;
    h.ewmaFirstTokenMs = h.ewmaFirstTokenMs * 0.7 + firstTokenMs * 0.3;
    h.failures = 0;
  }

  private penalize(id: ProviderId): void {
    const h = this.health.get(id);
    if (!h) return;
    h.failures += 1;
    h.lastFailureAt = Date.now();
  }

  /** A provider that failed twice in the last 60s sits out until the window passes. */
  private isCircuitOpen(id: ProviderId): boolean {
    const h = this.health.get(id);
    if (!h) return true;
    return h.failures >= 2 && Date.now() - h.lastFailureAt < 60_000;
  }

  private candidates(policy: RoutingPolicy): ProviderId[] {
    if (policy.airgapped || policy.mode === "offline") return ["ollama"];
    if (policy.mode === "single") return [policy.primary];
    const pair = [policy.primary, policy.secondary].filter((id) => this.providers.has(id));
    const usable = pair.filter((id) => !this.isCircuitOpen(id));
    const pool = usable.length ? usable : pair;
    // Fastest-observed provider starts first; on a tie the configured primary wins.
    return pool.sort(
      (a, b) =>
        (this.health.get(a)?.ewmaFirstTokenMs ?? 9e9) - (this.health.get(b)?.ewmaFirstTokenMs ?? 9e9),
    );
  }

  async *run(input: RouterInput): AsyncGenerator<StreamEvent> {
    const requestId = uid("req");
    const started = performance.now();
    const ids = this.candidates(input.policy);

    if (!ids.length) {
      yield { type: "error", requestId, message: "No provider is configured or reachable.", recoverable: false };
      return;
    }

    if (input.policy.mode === "hybrid-tier" && ids.length > 1) {
      yield* this.runTiered(requestId, started, ids, input);
      return;
    }
    yield* this.runRace(requestId, started, ids, input);
  }

  private buildOptions(
    id: ProviderId,
    input: RouterInput,
    role: "fast" | "deep",
    signal: AbortSignal,
  ): GenerateOptions {
    const hasImage = (input.attachments ?? []).some(
      (a) => a.kind === "image" || a.kind === "screenshot",
    );
    const fallbackModels: Record<ProviderId, { fast: string; deep: string; vision: string }> = {
      gemini: { fast: "gemini-3.5-flash-lite", deep: "gemini-3.1-pro-preview", vision: "gemini-3.6-flash" },
      openai: { fast: "gpt-4o-mini", deep: "gpt-4o", vision: "gpt-4o" },
      ollama: { fast: "llama3.2:3b", deep: "llama3.1:8b", vision: "llama3.2-vision:11b" },
      "azure-openai": { fast: "gpt-4o-mini", deep: "gpt-4o", vision: "gpt-4o" },
      custom: { fast: "default", deep: "default", vision: "default" },
    };
    const set = input.models?.[id] ?? fallbackModels[id] ?? fallbackModels.gemini;
    const model = (hasImage ? set.vision : role === "deep" ? set.deep : set.fast) || fallbackModels[id]?.fast || "gemini-1.5-flash";
    return {
      system: input.system,
      messages: input.messages,
      attachments: input.attachments ?? [],
      model,
      signal,
      temperature: 0.4,
      maxTokens: 1200,
    };
  }

  /** Fan out, first real token wins, everyone else is aborted. */
  private async *runRace(
    requestId: string,
    started: number,
    ids: ProviderId[],
    input: RouterInput,
  ): AsyncGenerator<StreamEvent> {
    const controllers = new Map<ProviderId, AbortController>();
    const queue: StreamEvent[] = [];
    let notify: (() => void) | null = null;
    let winner: ProviderId | null = null;
    let firstTokenMs = 0;
    let liveCount = ids.length;
    let emittedTokens = 0;

    const push = (e: StreamEvent) => {
      queue.push(e);
      notify?.();
    };

    const timeout = setTimeout(() => {
      if (!winner) {
        controllers.forEach((c) => c.abort());
        push({
          type: "error",
          requestId,
          message: `No provider returned a token within ${input.policy.firstTokenTimeoutMs}ms.`,
          recoverable: true,
        });
      }
    }, input.policy.firstTokenTimeoutMs);

    const runOne = async (id: ProviderId) => {
      const provider = this.providers.get(id);
      if (!provider) return;
      const controller = new AbortController();
      controllers.set(id, controller);
      const options = this.buildOptions(id, input, "fast", controller.signal);
      try {
        for await (const chunk of provider.stream(options)) {
          if (chunk.done) break;
          if (!chunk.delta) continue;

          if (!winner) {
            winner = id;
            firstTokenMs = performance.now() - started;
            clearTimeout(timeout);
            this.note(id, firstTokenMs);
            push({ type: "start", requestId, provider: id, model: options.model });
          }
          if (winner !== id) return; // a loser that slipped through — drop it

          emittedTokens += 1;
          push({ type: "token", requestId, delta: chunk.delta });

          // Once the winner is clearly producing, stop paying for the loser.
          if (emittedTokens === input.policy.raceCancelAfterTokens) {
            controllers.forEach((c, otherId) => otherId !== id && c.abort());
          }
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        this.penalize(id);
        if (!winner && liveCount <= 1) {
          push({
            type: "error",
            requestId,
            message: err instanceof Error ? err.message : String(err),
            recoverable: true,
          });
        }
      } finally {
        liveCount -= 1;
      }
    };

    const all = Promise.all(ids.map(runOne)).then(() => {
      clearTimeout(timeout);
      push({
        type: "done",
        requestId,
        latencyMs: performance.now() - started,
        firstTokenMs,
      });
      notify?.();
    });

    let finished = false;
    void all.finally(() => {
      finished = true;
      notify?.();
    });

    while (!finished || queue.length) {
      if (!queue.length) {
        await new Promise<void>((resolve) => {
          notify = () => {
            notify = null;
            resolve();
          };
        });
        continue;
      }
      const event = queue.shift();
      if (event) yield event;
      if (event?.type === "done") return;
    }
  }

  /** Fast answer now, deep answer swapped in when it is ready. */
  private async *runTiered(
    requestId: string,
    started: number,
    ids: ProviderId[],
    input: RouterInput,
  ): AsyncGenerator<StreamEvent> {
    const [fastId, deepId] = ids as [ProviderId, ProviderId];
    const fastProvider = this.providers.get(fastId);
    const deepProvider = this.providers.get(deepId);
    if (!fastProvider) return;

    const fastCtl = new AbortController();
    const deepCtl = new AbortController();
    const fastOpts = this.buildOptions(fastId, input, "fast", fastCtl.signal);
    const deepOpts = deepProvider ? this.buildOptions(deepId, input, "deep", deepCtl.signal) : null;

    // Deep pass runs in the background, buffered, ready to replace the fast answer.
    const deepPromise = (async () => {
      if (!deepProvider || !deepOpts) return null;
      let text = "";
      try {
        for await (const chunk of deepProvider.stream(deepOpts)) {
          if (chunk.done) break;
          text += chunk.delta;
        }
        return text;
      } catch {
        this.penalize(deepId);
        return null;
      }
    })();

    let firstTokenMs = 0;
    yield { type: "start", requestId, provider: fastId, model: fastOpts.model };
    try {
      for await (const chunk of fastProvider.stream(fastOpts)) {
        if (chunk.done) break;
        if (!chunk.delta) continue;
        if (!firstTokenMs) {
          firstTokenMs = performance.now() - started;
          this.note(fastId, firstTokenMs);
        }
        yield { type: "token", requestId, delta: chunk.delta };
      }
    } catch (err) {
      this.penalize(fastId);
      yield {
        type: "error",
        requestId,
        message: err instanceof Error ? err.message : String(err),
        recoverable: true,
      };
    }

    const deepText = await deepPromise;
    if (deepText && deepText.trim().length > 40 && deepOpts) {
      yield {
        type: "swap",
        requestId,
        provider: deepId,
        model: deepOpts.model,
        reason: "deeper model finished — replacing the instant answer",
      };
      yield { type: "token", requestId, delta: deepText };
    }

    yield { type: "done", requestId, latencyMs: performance.now() - started, firstTokenMs };
  }
}
