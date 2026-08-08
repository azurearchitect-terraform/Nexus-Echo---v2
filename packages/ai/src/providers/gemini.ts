import type { Provider, GenerateOptions, ProviderCredentials, TokenChunk } from "../types";
import { readSSE } from "../sse";

/**
 * Gemini is the latency leader in the hybrid pair — it usually wins the race and
 * produces first token fastest, which is what makes the overlay feel instant.
 */
export function createGeminiProvider(creds: ProviderCredentials): Provider {
  const base = (creds.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");

  return {
    id: "gemini",

    async *stream(o: GenerateOptions): AsyncIterable<TokenChunk> {
      const parts: Array<Record<string, unknown>> = [];
      for (const att of o.attachments ?? []) {
        if ((att.kind === "image" || att.kind === "screenshot") && att.path.startsWith("data:")) {
          const [meta, data] = att.path.split(",");
          parts.push({
            inline_data: { mime_type: meta?.slice(5).replace(";base64", "") ?? "image/png", data },
          });
        } else if (att.extractedText) {
          parts.push({ text: `--- ${att.id} ---\n${att.extractedText}` });
        }
      }
      parts.push({ text: o.messages.at(-1)?.content ?? "" });

      const contents = [
        ...o.messages.slice(0, -1).map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        { role: "user", parts },
      ];

      const url = `${base}/models/${o.model}:streamGenerateContent?alt=sse&key=${creds.apiKey ?? ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: o.signal,
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: o.system }] },
          generationConfig: {
            temperature: o.temperature ?? 0.4,
            maxOutputTokens: o.maxTokens ?? 1200,
          },
        }),
      });

      for await (const frame of readSSE(res)) {
        const candidates = frame["candidates"] as
          | Array<{ content?: { parts?: Array<{ text?: string }> } }>
          | undefined;
        const text = candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        if (text) yield { delta: text, done: false };
      }
      yield { delta: "", done: true };
    },

    async embed(texts, model) {
      const url = `${base}/models/${model}:batchEmbedContents?key=${creds.apiKey ?? ""}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: texts.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })),
        }),
      });
      if (!res.ok) throw new Error(`embedding failed: ${res.status}`);
      const json = (await res.json()) as { embeddings: Array<{ values: number[] }> };
      return json.embeddings.map((e) => e.values);
    },

    async ping(signal) {
      try {
        const res = await fetch(`${base}/models?key=${creds.apiKey ?? ""}`, { signal });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
