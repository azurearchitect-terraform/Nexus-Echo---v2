import type { Provider, GenerateOptions, ProviderCredentials, TokenChunk } from "../types";
import { readSSE } from "../sse";

/**
 * Gemini is the latency leader in the hybrid pair — it usually wins the race and
 * produces first token fastest, which is what makes the overlay feel instant.
 */
export function createGeminiProvider(creds: ProviderCredentials): Provider {
  const base = (creds.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
  let availableModels: Promise<string[]> | null = null;
  const authHeaders = (): Record<string, string> => ({ "x-goog-api-key": creds.apiKey ?? "" });

  const resolveModel = async (requestedModel: string, signal: AbortSignal): Promise<string> => {
    if (!availableModels) {
      availableModels = fetch(`${base}/models`, { headers: authHeaders(), signal })
        .then(async (response) => {
          if (!response.ok) {
            const detail = await response.text().catch(() => response.statusText);
            throw new Error(`Gemini model discovery failed (${response.status}): ${detail.slice(0, 240)}`);
          }
          const payload = (await response.json()) as {
            models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
          };
          return (payload.models ?? [])
            .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
            .map((model) => model.name?.replace(/^models\//, ""))
            .filter((model): model is string => Boolean(model));
        });
    }

    let models: string[];
    try {
      models = await availableModels;
    } catch (error) {
      availableModels = null;
      throw error;
    }
    if (!models.length) throw new Error("Gemini returned no models that support generateContent.");
    if (models.includes(requestedModel)) return requestedModel;
    throw new Error(`Configured Gemini model "${requestedModel}" is unavailable or does not support generateContent. Update it in Settings.`);
  };

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

      const model = await resolveModel(o.model, o.signal);
      const url = `${base}/models/${model}:streamGenerateContent?alt=sse`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        signal: o.signal,
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: o.system }] },
          generationConfig: {
            temperature: o.temperature ?? 0.4,
            maxOutputTokens: o.maxTokens ?? 1200,
            // Only enable JSON output mode for structured data calls (company intel, etc.)
            ...(o.jsonMode ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });

      if (!res.ok) {
        let errText = await res.text().catch(() => "Unknown error");
        try {
          const j = JSON.parse(errText);
          errText = j?.error?.message ?? JSON.stringify(j);
        } catch { /* ignore */ }
        throw new Error(`Gemini API error (${res.status} ${res.statusText}): ${errText}`);
      }

      let hadContent = false;
      let lastCandidate: any = null;
      for await (const frame of readSSE(res)) {
        const candidates = frame["candidates"] as
          | Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>
          | undefined;
        const candidate = candidates?.[0];
        if (candidate) lastCandidate = candidate;

        const promptFeedback = frame["promptFeedback"] as { blockReason?: string } | undefined;
        if (promptFeedback?.blockReason) {
          throw new Error(`Gemini blocked the prompt (${promptFeedback.blockReason}). Try rephrasing or using a different URL.`);
        }
        
        const finishReason = candidate?.finishReason;
        // Safety filter block — throw so the router can propagate this as an error event
        if (finishReason === "SAFETY" || finishReason === "RECITATION" || finishReason === "BLOCKED") {
          throw new Error(`Gemini blocked the response (${finishReason}). Try rephrasing or using a different URL.`);
        }
        const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        if (text) { hadContent = true; yield { delta: text, done: false }; }
      }
      if (!hadContent) {
        throw new Error(`Gemini returned an empty response. Last candidate: ${JSON.stringify(lastCandidate)}`);
      }
      yield { delta: "", done: true };
    },

    async embed(texts, model) {
      const url = `${base}/models/${model}:batchEmbedContents`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          requests: texts.map((t) => ({ model: `models/${model}`, content: { parts: [{ text: t }] } })),
        }),
      });
      if (!res.ok) {
        let detail = res.statusText;
        try { const j = await res.json(); detail = j?.error?.message ?? detail; } catch { /* ignore */ }
        throw new Error(`Gemini embedding failed (${res.status}): ${detail}`);
      }
      const json = (await res.json()) as { embeddings: Array<{ values: number[] }> };
      return json.embeddings.map((e) => e.values);
    },

    async ping(signal) {
      try {
        const res = await fetch(`${base}/models`, { headers: authHeaders(), signal });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}
