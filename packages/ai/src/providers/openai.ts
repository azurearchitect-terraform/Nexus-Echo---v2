import type { Provider, GenerateOptions, ProviderCredentials, TokenChunk } from "../types";
import { readSSE } from "../sse";

export function createOpenAIProvider(creds: ProviderCredentials): Provider {
  const base = (creds.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const headers = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${creds.apiKey ?? ""}`,
  });

  return {
    id: "openai",

    async *stream(o: GenerateOptions): AsyncIterable<TokenChunk> {
      const content: Array<Record<string, unknown>> = [];
      for (const att of o.attachments ?? []) {
        if (att.kind === "image" || att.kind === "screenshot") {
          content.push({ type: "image_url", image_url: { url: att.path, detail: "high" } });
        } else if (att.extractedText) {
          content.push({ type: "text", text: `--- ${att.id} ---\n${att.extractedText}` });
        }
      }

      const messages = [
        { role: "system", content: o.system },
        ...o.messages.slice(0, -1),
        {
          role: "user",
          content: content.length
            ? [...content, { type: "text", text: o.messages.at(-1)?.content ?? "" }]
            : (o.messages.at(-1)?.content ?? ""),
        },
      ];

      const res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: headers(),
        signal: o.signal,
        body: JSON.stringify({
          model: o.model,
          messages,
          stream: true,
          temperature: o.temperature ?? 0.4,
          max_tokens: o.maxTokens ?? 1200,
        }),
      });

      if (!res.ok) {
        throw new Error(`OpenAI HTTP ${res.status}: ${res.statusText}`);
      }

      for await (const frame of readSSE(res)) {
        const choices = frame["choices"] as Array<{ delta?: { content?: string } }> | undefined;
        const delta = choices?.[0]?.delta?.content;
        if (delta) yield { delta, done: false };
      }
      yield { delta: "", done: true };
    },

    async embed(texts, model) {
      const res = await fetch(`${base}/embeddings`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) throw new Error(`embedding failed: ${res.status}`);
      const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
      return json.data.map((d) => d.embedding);
    },

    async ping(signal) {
      try {
        const res = await fetch(`${base}/models`, { headers: headers(), signal });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
