import {
  HybridRouter,
  createGeminiProvider,
  createOllamaProvider,
  createOpenAIProvider,
  askSystemPrompt,
  listenSystemPrompt,
  transcriptWindow,
  MEETING_SUMMARY_PROMPT,
  FOLLOWUP_PROMPT,
  detectPersona,
  isPersonalQuestion,
} from "@nexus/ai";
import { RagStore, packVector, unpackVector } from "@nexus/rag";
import type {
  AppSettings,
  ProviderId,
  RagHit,
  StreamEvent,
  TranscriptSegment,
  Attachment,
} from "@nexus/core";
import { bridge, type StoredChunk } from "./bridge";

/**
 * Default model assignments. `fast` is what wins races, `deep` is the quality
 * fallback, `vision` handles screenshots. These are overridable per provider in
 * Settings; the names here are the sensible defaults, not hard-coded requirements.
 */
export const DEFAULT_MODELS: Record<ProviderId, { fast: string; deep: string; vision: string }> = {
  gemini: { fast: "gemini-3.5-flash-lite", deep: "gemini-3.6-flash", vision: "gemini-3.6-flash" },
  openai: { fast: "gpt-4o-mini", deep: "gpt-4o", vision: "gpt-4o" },
  ollama: { fast: "llama3.2:3b", deep: "llama3.1:8b", vision: "llama3.2-vision:11b" },
  "azure-openai": { fast: "gpt-4o-mini", deep: "gpt-4o", vision: "gpt-4o" },
  custom: { fast: "default", deep: "default", vision: "default" },
};

const EMBED_MODELS: Partial<Record<ProviderId, string>> = {
  openai: "text-embedding-3-small",
  gemini: "gemini-embedding-001",
  ollama: "nomic-embed-text",
};

export class Engine {
  readonly router = new HybridRouter();
  rag: RagStore | null = null;
  private settings: AppSettings | null = null;

  /** Rebuilds providers from settings + keychain. Called on boot and on every save. */
  async configure(settings: AppSettings): Promise<void> {
    this.settings = settings;
    this.router.clear();

    for (const provider of settings.providers) {
      if (!provider.enabled) continue;
      const apiKey = provider.keyRef ? ((await bridge.resolveProviderKey(provider.keyRef)) ?? "") : "";
      
      // Skip cloud providers that don't have an API key configured to avoid 401/403 errors
      if ((provider.id === "openai" || provider.id === "azure-openai" || provider.id === "gemini") && !apiKey) {
        continue;
      }

      const creds = { apiKey, ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}) };

      switch (provider.id) {
        case "openai":
        case "azure-openai":
          this.router.register(createOpenAIProvider(creds));
          break;
        case "gemini":
          this.router.register(createGeminiProvider(creds));
          break;
        case "ollama":
          this.router.register(createOllamaProvider(creds));
          break;
        default:
          break;
      }
    }

    if (settings.ragEnabled && !this.rag) {
      await this.initRag(settings);
    }
  }

  private async initRag(settings: AppSettings): Promise<void> {
    // Embeddings prefer a local model when one is available — indexing a document
    // library should not mean uploading the whole library to a vendor.
    const embedProvider: ProviderId = settings.routing.airgapped
      ? "ollama"
      : settings.routing.primary;

    const model = EMBED_MODELS[embedProvider] ?? "text-embedding-3-small";

    const embed = async (texts: string[]): Promise<number[][]> => {
      const provider =
        embedProvider === "gemini"
          ? createGeminiProvider({ apiKey: await this.keyFor("gemini") })
          : embedProvider === "ollama"
            ? createOllamaProvider({ baseUrl: this.baseUrlFor("ollama") })
            : createOpenAIProvider({ apiKey: await this.keyFor("openai") });
      if (!provider.embed) throw new Error("provider does not support embeddings");
      return provider.embed(texts, model);
    };

    this.rag = new RagStore(embed, {
      saveChunks: async (chunks) => {
        await bridge.saveChunks(
          chunks.map((c) => ({
            id: c.id,
            docId: c.docId,
            title: c.title,
            text: c.text,
            ordinal: c.ordinal,
            vector: packVector(c.vector),
          })),
        );
      },
      loadChunks: async () => {
        const rows = await bridge.loadChunks();
        return rows.map((r) => ({
          id: r.id,
          docId: r.docId,
          title: r.title,
          text: r.text,
          ordinal: r.ordinal,
          vector: unpackVector(r.vector),
        }));
      },
      deleteDocument: async (docId) => bridge.deleteDocument(docId),
    });
    await this.rag.init();

    // Check for embedding model mismatch (e.g. changing provider from OpenAI to Gemini)
    const currentModel = `${embedProvider}:${model}`;
    const previousModel = settings.ragEmbedModel;
    const chunkCount = this.rag.chunkCount;

    if (chunkCount > 0 && previousModel !== currentModel) {
      console.warn(`[RAG] Embedding model mismatch (loaded: ${previousModel}, active: ${currentModel}). Re-embedding database chunks...`);
      try {
        const loadedChunks = await bridge.loadChunks();
        const BATCH = 32;
        const updatedChunks: StoredChunk[] = [];

        for (let i = 0; i < loadedChunks.length; i += BATCH) {
          const batch = loadedChunks.slice(i, i + BATCH);
          const vectors = await embed(batch.map((c) => c.text));
          batch.forEach((chunk, j) => {
            if (vectors[j]) {
              updatedChunks.push({
                id: chunk.id,
                docId: chunk.docId,
                title: chunk.title,
                text: chunk.text,
                ordinal: chunk.ordinal,
                vector: packVector(vectors[j]),
              });
            }
          });
        }

        if (updatedChunks.length > 0) {
          await bridge.saveChunks(updatedChunks);
          // Re-initialize RAG store to load the newly saved chunks with correct vectors
          await this.rag.init();
          console.info(`[RAG] Re-embedding complete. Successfully migrated ${updatedChunks.length} chunks.`);
        }

        // Mutate the settings object so the React store gets the updated version
        settings.ragEmbedModel = currentModel;
        await bridge.saveSettings(JSON.stringify(settings));
        this.settings = settings;
      } catch (e) {
        console.error("[RAG] Failed to automatically migrate chunk embeddings to new model:", e);
      }
    } else if (chunkCount === 0 && previousModel !== currentModel) {
      try {
        settings.ragEmbedModel = currentModel;
        await bridge.saveSettings(JSON.stringify(settings));
        this.settings = settings;
      } catch (e) {
        console.error("[RAG] Failed to save updated ragEmbedModel setting:", e);
      }
    }
  }

  private async keyFor(id: ProviderId): Promise<string> {
    const provider = this.settings?.providers.find((p) => p.id === id);
    if (!provider?.keyRef) return "";
    return (await bridge.resolveProviderKey(provider.keyRef)) ?? "";
  }

  private baseUrlFor(id: ProviderId): string | undefined {
    return this.settings?.providers.find((p) => p.id === id)?.baseUrl;
  }

  private models(): Record<ProviderId, { fast: string; deep: string; vision: string }> {
    const merged = { ...DEFAULT_MODELS };
    for (const p of this.settings?.providers ?? []) {
      const base = merged[p.id];
      merged[p.id] = {
        fast: p.models.fast ?? base.fast,
        deep: p.models.deep ?? base.deep,
        vision: p.models.vision ?? base.vision,
      };
    }
    return merged;
  }

  async retrieve(query: string): Promise<RagHit[]> {
    if (!this.settings?.ragEnabled || !this.rag) {
      console.debug("[RAG] Skipped: ragEnabled=", this.settings?.ragEnabled, "rag=", !!this.rag);
      return [];
    }
    console.debug("[RAG] Searching for:", query, "| Total chunks loaded:", this.rag.chunkCount);
    try {
      const hits = await Promise.race([
        this.rag.search(query, 4),
        new Promise<RagHit[]>((resolve) => setTimeout(() => resolve([]), 2000)),
      ]);
      console.debug("[RAG] Hits found:", hits.length, hits.map(h => h.title + " score=" + h.score.toFixed(2)));
      return hits;
    } catch (e) {
      console.error("[RAG] Search failed:", e);
      return [];
    }
  }

  /** Ask mode: a direct question, optionally with screenshots or documents attached. */
  async *ask(
    prompt: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
    attachments: Attachment[],
    useRag: boolean,
  ): AsyncGenerator<StreamEvent> {
    if (!this.settings) throw new Error("engine is not configured");
    const isPersonal = isPersonalQuestion(prompt);
    console.debug("[RAG] isPersonalQuestion:", isPersonal, "| prompt:", prompt);
    const hits = (useRag && isPersonal) ? await this.retrieve(prompt) : [];

    for (const hit of hits) {
      yield { type: "citation", requestId: "pending", docId: hit.docId, title: hit.title, score: hit.score };
    }

    yield* this.router.run({
      system: askSystemPrompt(this.settings.systemPrompt, hits),
      messages: [...history, { role: "user", content: prompt }],
      attachments,
      policy: this.settings.routing,
      models: this.models(),
    });
  }

  /** Listen mode: generate what the user should say next, from the live transcript. */
  async *suggest(segments: TranscriptSegment[]): AsyncGenerator<StreamEvent> {
    if (!this.settings) throw new Error("engine is not configured");
    const window = segments.length ? transcriptWindow(segments) : "The user is in a live conversation and needs a quick, direct, and relevant response.";
    const lastQuestion = [...segments].reverse().find((s) => s.source === "system")?.text ?? window;
    const isPersonal = isPersonalQuestion(lastQuestion);
    const hits = (this.settings.ragEnabled && isPersonal) ? await this.retrieve(lastQuestion) : [];

    yield* this.router.run({
      system: listenSystemPrompt(this.settings.systemPrompt, hits),
      messages: [
        {
          role: "user",
          content: `Live transcript:\n${window}\n\nThe user needs to respond now. Give them the words.`,
        },
      ],
      policy: this.settings.routing,
      models: this.models(),
    });
  }

  private async collect(system: string, user: string): Promise<string> {
    if (!this.settings) return "";
    let out = "";
    for await (const event of this.router.run({
      system,
      messages: [{ role: "user", content: user }],
      policy: { ...this.settings.routing, mode: "single" },
      models: this.models(),
    })) {
      if (event.type === "token") out += event.delta;
    }
    return out;
  }

  async summarizeMeeting(segments: TranscriptSegment[]): Promise<MeetingSummary> {
    const raw = await this.collect(MEETING_SUMMARY_PROMPT, transcriptWindow(segments, 12000));
    return parseJson<MeetingSummary>(raw, {
      title: "Untitled meeting",
      summary: "",
      decisions: [],
      actionItems: [],
      openQuestions: [],
      participants: [],
    });
  }

  async followUps(segments: TranscriptSegment[]): Promise<string[]> {
    const raw = await this.collect(FOLLOWUP_PROMPT, transcriptWindow(segments, 3000));
    return parseJson<string[]>(raw, []).slice(0, 3);
  }
}

export interface MeetingSummary {
  title: string;
  summary: string;
  decisions: string[];
  actionItems: Array<{ text: string; owner: string | null; due: string | null }>;
  openQuestions: string[];
  participants: string[];
}

/** Models fence JSON in markdown often enough that stripping it is mandatory. */
function parseJson<T>(raw: string, fallback: T): T {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = cleaned.search(/[[{]/);
  if (start === -1) return fallback;
  try {
    return JSON.parse(cleaned.slice(start)) as T;
  } catch {
    return fallback;
  }
}

export const engine = new Engine();
