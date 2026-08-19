import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiProvider } from "./gemini";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gemini provider", () => {
  it("aborts model discovery with the generation request", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));

    const provider = createGeminiProvider({ apiKey: "test-key" });
    const controller = new AbortController();
    const stream = provider.stream({
      system: "system",
      messages: [{ role: "user", content: "question" }],
      model: "configured-model",
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    const pending = stream.next();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("retries discovery after an aborted request", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        models: [{ name: "models/configured-model", supportedGenerationMethods: ["generateContent"] }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response([
        'data: {"candidates":[{"content":{"parts":[{"text":"answer"}]}}]}',
        "",
        "",
      ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGeminiProvider({ apiKey: "test-key" });
    const firstController = new AbortController();
    const first = provider.stream({
      system: "system",
      messages: [{ role: "user", content: "first" }],
      model: "configured-model",
      signal: firstController.signal,
    })[Symbol.asyncIterator]();
    const firstPending = first.next();
    firstController.abort();
    await expect(firstPending).rejects.toMatchObject({ name: "AbortError" });

    const secondController = new AbortController();
    const second = provider.stream({
      system: "system",
      messages: [{ role: "user", content: "second" }],
      model: "configured-model",
      signal: secondController.signal,
    })[Symbol.asyncIterator]();

    await expect(second.next()).resolves.toMatchObject({ value: { delta: "answer", done: false } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects an unavailable configured model instead of silently substituting another", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      models: [{ name: "models/gemini-3.7-flash", supportedGenerationMethods: ["generateContent"] }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createGeminiProvider({ apiKey: "test-key" });
    const stream = provider.stream({
      system: "system",
      messages: [{ role: "user", content: "question" }],
      model: "gemini-model-from-settings",
      signal: new AbortController().signal,
    })[Symbol.asyncIterator]();

    await expect(stream.next()).rejects.toThrow('Configured Gemini model "gemini-model-from-settings" is unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});