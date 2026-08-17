import { describe, expect, it } from "vitest";
import type { RoutingPolicy } from "@nexus/core";
import { HybridRouter, type RouterInput } from "./router";
import type { GenerateOptions, Provider } from "./types";

const policy: RoutingPolicy = {
  mode: "hybrid-tier",
  primary: "gemini",
  secondary: "openai",
  raceCancelAfterTokens: 12,
  firstTokenTimeoutMs: 50,
  speculativePrefetch: false,
  speculativeWaitMs: 350,
  airgapped: false,
};

function waitingProvider(id: Provider["id"]): Provider {
  return {
    id,
    async *stream(options: GenerateOptions) {
      await new Promise<void>((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
          once: true,
        });
      });
      yield { delta: "", done: true };
    },
    async ping() {
      return true;
    },
  };
}

function respondingProvider(id: Provider["id"], response: string, fail = false): Provider {
  return {
    id,
    async *stream() {
      if (fail) throw new Error(`${id} failed`);
      yield { delta: response, done: false };
      yield { delta: "", done: true };
    },
    async ping() {
      return true;
    },
  };
}

function input(signal?: AbortSignal): RouterInput {
  return {
    system: "system",
    messages: [{ role: "user", content: "question" }],
    policy,
    models: {
      gemini: { fast: "fast", deep: "deep", vision: "vision" },
      openai: { fast: "fast", deep: "deep", vision: "vision" },
      ollama: { fast: "fast", deep: "deep", vision: "vision" },
      "azure-openai": { fast: "fast", deep: "deep", vision: "vision" },
      custom: { fast: "fast", deep: "deep", vision: "vision" },
    },
    ...(signal ? { signal } : {}),
  };
}

describe("HybridRouter hybrid-tier", () => {
  it("always uses the configured secondary for answers despite latency history", async () => {
    const router = new HybridRouter();
    router.register(respondingProvider("gemini", "gemini answer"));
    router.register(respondingProvider("openai", "openai answer"));

    for (let run = 0; run < 2; run++) {
      const events = [];
      for await (const event of router.run(input())) events.push(event);
      expect(events).toContainEqual(expect.objectContaining({ type: "start", provider: "openai" }));
      expect(events).toContainEqual(expect.objectContaining({ type: "token", delta: "openai answer" }));
      expect(events).not.toContainEqual(expect.objectContaining({ type: "token", delta: "gemini answer" }));
    }
  });

  it("falls back to the configured primary when the secondary fails", async () => {
    const router = new HybridRouter();
    router.register(respondingProvider("gemini", "fallback answer"));
    router.register(respondingProvider("openai", "", true));
    const events = [];

    for await (const event of router.run(input())) events.push(event);

    expect(events.filter((event) => event.type === "start")).toEqual([
      expect.objectContaining({ provider: "openai" }),
      expect.objectContaining({ provider: "gemini" }),
    ]);
    expect(events).toContainEqual(expect.objectContaining({ type: "token", delta: "fallback answer" }));
  });

  it("cancels the provider when the caller aborts", async () => {
    const router = new HybridRouter();
    router.register(waitingProvider("gemini"));
    router.register(waitingProvider("openai"));
    const caller = new AbortController();
    const events = router.run(input(caller.signal));

    expect((await events.next()).value?.type).toBe("start");
    const pending = events.next();
    caller.abort();

    await expect(pending).resolves.toMatchObject({ done: true });
  });

  it("emits a recoverable error when no first token arrives", async () => {
    const router = new HybridRouter();
    router.register(waitingProvider("gemini"));
    router.register(waitingProvider("openai"));
    const events = [];

    for await (const event of router.run(input())) events.push(event);

    expect(events).toContainEqual(expect.objectContaining({
      type: "error",
      recoverable: true,
      message: expect.stringContaining("50ms"),
    }));
  });
});