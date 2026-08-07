import type { Provider, GenerateOptions, ProviderCredentials, TokenChunk } from "../types";
import { readNDJSON } from "../sse";

/** Fully local. Selected automatically whenever routing mode is `offline` or airgapped is on. */
export function createOllamaProvider(creds: ProviderCredentials): Provider {
  const base = creds.baseUrl ?? "http://127.0.0.1:11434";

  return {
    id: "ollama",

    async *stream(o: GenerateOptions): AsyncIterable<TokenChunk> {
      const images = (o.attachments ?? [])
        .filter((a) => a.kind === "image" || a.kind === "screenshot")
        .map((a) => a.path.split(",")[1] ?? "")
        .filter(Boolean);

      const messages = [
        { role: "system", content: o.system },
        ...o.messages.map((m, i) =>
          i === o.messages.length - 1 && images.length
            ? { role: m.role, content: m.content, images }
            : { role: m.role, content: m.content },
        ),
      ];

      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: o.signal,
        body: JSON.stringify({
          model: o.model,
          messages,
          stream: true,
          options: { temperature: o.temperature ?? 0.4, num_predict: o.maxTokens ?? 1200 },
        }),
      });

      for await (const frame of readNDJSON(res)) {
        const message = frame["message"] as { content?: string } | undefined;
        if (message?.content) yield { delta: message.content, done: false };
        if (frame["done"] === true) break;
      }
      yield { delta: "", done: true };
    },

    async embed(texts, model) {
      const out: number[][] = [];
      for (const text of texts) {
        const res = await fetch(`${base}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: text }),
        });
        if (!res.ok) throw new Error(`embedding failed: ${res.status}`);
        const json = (await res.json()) as { embedding: number[] };
        out.push(json.embedding);
      }
      return out;
    },

    async ping(signal) {
      try {
        const res = await fetch(`${base}/api/tags`, { signal });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
