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
  companyIntelPrompt,
  endOfInterviewQuestionsPrompt,
  coachingTipPrompt,
  interviewAnalysisPrompt,
} from "@nexus/ai";
import { RagStore, packVector, unpackVector } from "@nexus/rag";
import type {
  AppSettings,
  InterviewMode,
  InterviewCoachInsight,
  InterviewDebrief,
  StoryBankItem,
  ProviderId,
  RagHit,
  StreamEvent,
  TranscriptSegment,
  Attachment,
} from "@nexus/core";
import { CompanyIntel } from "@nexus/core";
import { bridge, type StoredChunk } from "./bridge";

/**
 * Default model assignments. `fast` is what wins races, `deep` is the quality
 * fallback, `vision` handles screenshots. These are overridable per provider in
 * Settings; the names here are the sensible defaults, not hard-coded requirements.
 */
export const DEFAULT_MODELS: Record<ProviderId, { fast: string; deep: string; vision: string }> = {
  gemini: { fast: "gemini-3.5-flash", deep: "gemini-3.6-flash", vision: "gemini-3.6-flash" },
  openai: { fast: "gpt-4o-mini", deep: "gpt-4o-mini", vision: "gpt-4o" },
  ollama: { fast: "llama3.2:3b", deep: "llama3.1:8b", vision: "llama3.2-vision:11b" },
  "azure-openai": { fast: "gpt-4o-mini", deep: "gpt-4o-mini", vision: "gpt-4o" },
  custom: { fast: "default", deep: "default", vision: "default" },
};

const EMBED_MODELS: Partial<Record<ProviderId, string>> = {
  openai: "text-embedding-3-small",
  gemini: "gemini-embedding-001",
  ollama: "nomic-embed-text",
};

export interface QACacheEntry {
  id: string;
  question: string;
  answer: string;
  persona?: string;
  createdAt: number;
}

export function calculateTextSimilarity(a: string, b: string): number {
  const normalize = (str: string) =>
    str
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length > 2);

  const tokensA = new Set(normalize(a));
  const tokensB = new Set(normalize(b));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union;
}

export function getQACache(): QACacheEntry[] {
  try {
    const raw = localStorage.getItem("nexus_qa_cache");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveToQACache(entry: Omit<QACacheEntry, "id" | "createdAt">): void {
  try {
    const existing = getQACache();
    const isDuplicate = existing.some((item) => calculateTextSimilarity(item.question, entry.question) > 0.9);
    if (!isDuplicate) {
      const updated = [
        ...existing,
        { ...entry, id: `qa_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`, createdAt: Date.now() },
      ].slice(-500); // keep last 500 QA pairs
      localStorage.setItem("nexus_qa_cache", JSON.stringify(updated));
    }
  } catch (err) {
    console.error("failed to save QA cache", err);
  }
}

export function clearQACache(): void {
  try {
    localStorage.removeItem("nexus_qa_cache");
  } catch (err) {
    console.error("failed to clear QA cache", err);
  }
}

export function findCachedQA(question: string, minSimilarity = 0.82): QACacheEntry | null {
  const cache = getQACache();
  let bestMatch: QACacheEntry | null = null;
  let highestScore = 0;

  for (const item of cache) {
    const score = calculateTextSimilarity(question, item.question);
    if (score >= minSimilarity && score > highestScore) {
      highestScore = score;
      bestMatch = item;
    }
  }
  return bestMatch;
}

export class Engine {
  readonly router = new HybridRouter();
  rag: RagStore | null = null;
  private settings: AppSettings | null = null;
  private ragInitPromise: Promise<void> | null = null;

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

    if (settings.ragEnabled && !this.rag && !this.ragInitPromise) {
      this.ragInitPromise = this.initRag(settings).catch((e) => {
        console.error("[RAG] Background initialization failed:", e);
      }).finally(() => {
        this.ragInitPromise = null;
      });
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

  async resetRag(): Promise<void> {
    this.rag = null;
    if (this.settings) {
      await this.configure(this.settings);
    }
  }

  async retrieve(query: string): Promise<RagHit[]> {
    if (!this.settings?.ragEnabled || !this.rag) {
      console.debug("[RAG] Skipped: ragEnabled=", this.settings?.ragEnabled, "rag=", !!this.rag);
      return [];
    }

    // Enrich personal questions to ensure high BM25/Dense overlap with actual resume chunks
    // A question like "Tell me about yourself" has near zero semantic overlap with a resume.
    let searchQuery = query;
    if (isPersonalQuestion(query)) {
      searchQuery += " professional background career summary work experience skills role responsibilities achievements";
    }

    console.debug("[RAG] Searching for:", searchQuery, "| Total chunks loaded:", this.rag.chunkCount);
    try {
      const hits = await Promise.race([
        this.rag.search(searchQuery, 4),
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
    // 1. Check QA Cache for instant lookup (0 API Cost)
    const cached = findCachedQA(prompt);
    if (cached) {
      console.log("[QA Cache] Instant Hit for prompt:", prompt);
      yield { type: "token", requestId: "cache", delta: `[⚡ Cached Response - 0 API Cost]\n\n${cached.answer}` };
      yield { type: "done", requestId: "cache", text: cached.answer, isCached: true } as any;
      return;
    }

    const isPersonal = isPersonalQuestion(prompt);
    console.debug("[RAG] isPersonalQuestion:", isPersonal, "| prompt:", prompt);
    const hits = (useRag && isPersonal) ? await this.retrieve(prompt) : [];

    for (const hit of hits) {
      yield { type: "citation", requestId: "pending", docId: hit.docId, title: hit.title, score: hit.score };
    }

    let fullAnswer = "";
    for await (const event of this.router.run({
      system: askSystemPrompt(this.settings.systemPrompt, hits, this.settings.targetCompany, this.settings.targetJd),
      messages: [...history, { role: "user", content: prompt }],
      attachments,
      policy: this.settings.routing,
      models: this.models(),
    })) {
      if (event.type === "token") {
        fullAnswer += event.delta;
      }
      yield event;
    }

    if (fullAnswer.trim()) {
      saveToQACache({ question: prompt, answer: fullAnswer.trim(), persona: detectPersona(prompt) });
    }
  }

  /** Listen mode: generate what the user should say next, from the live transcript. */
  async *suggest(segments: TranscriptSegment[]): AsyncGenerator<StreamEvent> {
    if (!this.settings) throw new Error("engine is not configured");
    const window = segments.length ? transcriptWindow(segments) : "The user is in a live conversation and needs a quick, direct, and relevant response.";
    const lastQuestion = [...segments].reverse().find((s) => s.source === "system")?.text ?? window;

    // 1. Check QA Cache for instant lookup (0 API Cost)
    const cached = findCachedQA(lastQuestion);
    if (cached) {
      console.log("[QA Cache] Instant Hit for live question:", lastQuestion);
      yield { type: "token", requestId: "cache", delta: `[⚡ Cached Response - 0 API Cost]\n\n${cached.answer}` };
      yield { type: "done", requestId: "cache", text: cached.answer, isCached: true } as any;
      return;
    }

    const isPersonal = isPersonalQuestion(lastQuestion);
    const hits = (this.settings.ragEnabled && isPersonal) ? await this.retrieve(lastQuestion) : [];

    let fullAnswer = "";
    for await (const event of this.router.run({
      system: listenSystemPrompt(this.settings.systemPrompt, hits, this.settings.targetCompany, this.settings.targetJd),
      messages: [
        {
          role: "user",
          content: `Live transcript:\n${window}\n\nThe user needs to respond now. Give them the words.`,
        },
      ],
      policy: this.settings.routing,
      models: this.models(),
    })) {
      if (event.type === "token") {
        fullAnswer += event.delta;
      }
      yield event;
    }

    if (fullAnswer.trim()) {
      saveToQACache({ question: lastQuestion, answer: fullAnswer.trim(), persona: detectPersona(lastQuestion) });
    }
  }

  private async collect(system: string, user: string, maxTokens = 1200, jsonMode = false): Promise<string> {
    if (!this.settings) return "";
    let out = "";
    for await (const event of this.router.run({
      system,
      messages: [{ role: "user", content: user }],
      policy: { ...this.settings.routing, mode: "single", firstTokenTimeoutMs: 30000 },
      models: this.models(),
      maxTokens,
      jsonMode,
    })) {
      if (event.type === "token") {
        out += event.delta;
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }
    return out;
  }

  async summarizeMeeting(segments: TranscriptSegment[]): Promise<MeetingSummary> {
    const raw = await this.collect(MEETING_SUMMARY_PROMPT, transcriptWindow(segments, 12000));
    return parseStructuredJson<MeetingSummary>(raw, {
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
    return parseStructuredJson<string[]>(raw, []).slice(0, 3);
  }

  async generateEndInterviewQuestions(segments: TranscriptSegment[]): Promise<Array<{ question: string; context: string; followUpNote: string; expectedAnswer: string; professionalExample: string; category: "Technical" | "HR" }>> {
    if (!this.settings) return [];
    const window = segments.length ? transcriptWindow(segments, 8000) : "";
    const { system, user } = endOfInterviewQuestionsPrompt(window, this.settings.targetCompany, this.settings.targetJd);
    const raw = await this.collect(system, user, 3000, true);
    const parsed = parseStructuredJson<Array<{ question: string; context: string; followUpNote: string; expectedAnswer: string; professionalExample: string; category: "Technical" | "HR" }>>(raw, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  async *generateCoachingTip(segments: TranscriptSegment[]): AsyncGenerator<StreamEvent> {
    if (!this.settings) throw new Error("engine is not configured");
    const { system, user } = coachingTipPrompt(
      segments,
      this.settings.targetCompany,
      this.settings.targetJd
    );

    for await (const event of this.router.run({
      system,
      messages: [{ role: "user", content: user }],
      policy: this.settings.routing,
      models: this.models(),
      maxTokens: 100, // Short response
    })) {
      yield event;
    }
  }

  async analyzeInterviewTurn(options: {
    question: string;
    answer: string;
    mode: InterviewMode;
    transcript?: string;
    storyBank?: StoryBankItem[];
  }): Promise<InterviewCoachInsight> {
    if (!this.settings) {
      return {
        summary: "Interview coach unavailable.",
        overallScore: 0,
        structureScore: 0,
        clarityScore: 0,
        specificityScore: 0,
        confidenceScore: 0,
        strengths: [],
        gaps: [],
        coachingTip: "",
        nextBestMove: "",
        suggestedStoryTags: [],
        checklist: [],
        likelyFollowUps: [],
      };
    }

    const { system, user } = interviewAnalysisPrompt({
      question: options.question,
      answer: options.answer,
      mode: options.mode,
      targetCompany: this.settings.targetCompany,
      targetJd: this.settings.targetJd,
      ...(options.storyBank ? { storyBank: options.storyBank.slice(0, 6) } : {}),
      ...(options.transcript ? { transcript: options.transcript } : {}),
    });

    const raw = await this.collect(system, user, 1800, true);
    const parsed = parseCompanyIntelJson(raw);
    if (!parsed) {
      return {
        summary: "Could not parse coach output.",
        overallScore: 0,
        structureScore: 0,
        clarityScore: 0,
        specificityScore: 0,
        confidenceScore: 0,
        strengths: [],
        gaps: [],
        coachingTip: "",
        nextBestMove: "",
        suggestedStoryTags: [],
        checklist: [],
        likelyFollowUps: [],
      };
    }

    return {
      summary: String((parsed as any).summary ?? "Interview answer analyzed."),
      overallScore: Number((parsed as any).overallScore ?? 0),
      structureScore: Number((parsed as any).structureScore ?? 0),
      clarityScore: Number((parsed as any).clarityScore ?? 0),
      specificityScore: Number((parsed as any).specificityScore ?? 0),
      confidenceScore: Number((parsed as any).confidenceScore ?? 0),
      strengths: Array.isArray((parsed as any).strengths) ? (parsed as any).strengths.map(String).slice(0, 4) : [],
      gaps: Array.isArray((parsed as any).gaps) ? (parsed as any).gaps.map(String).slice(0, 4) : [],
      coachingTip: String((parsed as any).coachingTip ?? ""),
      nextBestMove: String((parsed as any).nextBestMove ?? ""),
      suggestedStoryTags: Array.isArray((parsed as any).suggestedStoryTags) ? (parsed as any).suggestedStoryTags.map(String).slice(0, 4) : [],
      checklist: Array.isArray((parsed as any).checklist)
        ? (parsed as any).checklist.slice(0, 6).map((item: any) => ({
            label: String(item.label ?? ""),
            covered: Boolean(item.covered),
            note: String(item.note ?? ""),
          }))
        : [],
      likelyFollowUps: Array.isArray((parsed as any).likelyFollowUps)
        ? (parsed as any).likelyFollowUps.slice(0, 3).map((item: any) => ({
            question: String(item.question ?? ""),
            reason: String(item.reason ?? ""),
            priority: item.priority === "high" || item.priority === "low" ? item.priority : "medium",
          }))
        : [],
      storyMatchHint: typeof (parsed as any).storyMatchHint === "string" ? (parsed as any).storyMatchHint : undefined,
    };
  }

  async analyzeCompany(url: string, jdText: string | null): Promise<CompanyIntel> {
    if (!this.settings) throw new Error("engine is not configured");

    // Clean URL: prepend https:// if missing
    let targetUrl = url.trim();
    if (!/^https?:\/\//i.test(targetUrl)) {
      targetUrl = "https://" + targetUrl;
    }

    // 1. Scrape URL via bridge
    let scrapedText = await bridge.scrapeCompany(targetUrl);
    console.debug("[CompanyIntel] Scraped text length (raw):", scrapedText.length);

    // Truncate to ~12 000 chars (~3 000 tokens) so we don't overflow the model context
    // and avoid triggering Gemini safety filters on noise-heavy raw web text
    if (scrapedText.length > 12000) {
      scrapedText = scrapedText.slice(0, 12000) + "\n\n[... content truncated for length ...]";
    }

    // If the scraper returned almost nothing, fall back to the URL / domain as context
    if (scrapedText.trim().length < 50) {
      const domain = new URL(targetUrl).hostname.replace(/^www\./, "");
      scrapedText = `Company domain: ${domain}. No page content could be scraped. Please infer company information from the domain name and any JD provided.`;
    }

    // 2. Format prompt
    const { system, user } = companyIntelPrompt(scrapedText, jdText);

    // 3. Collect completion from AI router — use a high token limit + JSON mode for the rich JSON profile
    const raw = await this.collect(system, user, 6000, true);

    // 4. Parse JSON and validate with Zod
    console.debug("[CompanyIntel] Raw AI response length:", raw.length, "| first 300 chars:", raw.slice(0, 300));
    const parsed = parseCompanyIntelJson(raw);
    if (!parsed) {
      throw new Error(
        `AI returned empty or unparseable response.\n\nRaw output (first 500 chars):\n${raw.slice(0, 500)}`
      );
    }
    let intel: CompanyIntel;
    try {
      intel = CompanyIntel.parse(parsed);
    } catch (zodErr: any) {
      throw new Error(
        `AI returned JSON but with wrong structure.\n\nZod error: ${zodErr.message}\n\nRaw JSON:\n${JSON.stringify(parsed, null, 2).slice(0, 800)}`
      );
    }

    // 5. Index the parsed profile into RAG so it is retrievable during the live interview!
    if (this.rag) {
      const docId = `company_intel_${Date.now()}`;
      const title = `Company Intel: ${intel.name}`;
      const content = `Company: ${intel.name}
Core Business & Revenue: ${intel.coreBusiness}
Technical Landscape & Culture: ${intel.technicalLandscape}
Recent News & Partnerships: ${intel.recentNews}
Why It Matters (Candidate Fit): ${intel.whyItMatters}
Elevator Pitch (Golden Formula): ${intel.goldenFormula}
Tech Stack: ${intel.techStack.join(", ")}

Strategic Prepared Questions:
${intel.questions
  .map(
    (q, idx) =>
      `Question ${idx + 1}: ${q.question}\nContext: ${q.context}\nSuggested Discussion Points:\n${q.suggestedPoints.map((p) => `- ${p}`).join("\n")}`
  )
  .join("\n\n")}`;

      // Index in background so we don't block returning the results to UI
      void this.rag.addDocument(docId, title, content).catch((err) => {
        console.error("[RAG] Failed to index company intelligence profile:", err);
      });
    }

    return intel;
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

function repairTruncatedJson(jsonStr: string): string {
  let str = jsonStr.trim();
  str = str.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  // Handle curly quotes
  str = str.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");

  const firstBrace = str.indexOf("{");
  const firstBracket = str.indexOf("[");
  let startIdx = 0;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
  }
  if (startIdx > 0) {
    str = str.slice(startIdx);
  }

  let inString = false;
  let escaped = false;
  const stack: string[] = [];

  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    }
  }

  // 1. If cut off inside a string, close the string
  if (inString) {
    str += '"';
  }

  // 2. Remove trailing comma or key colon if cut off
  str = str.replace(/,\s*$/, "");
  str = str.replace(/:\s*$/, ': ""');

  // 3. Close open arrays/objects
  while (stack.length > 0) {
    const open = stack.pop();
    if (open === "{") str += "}";
    if (open === "[") str += "]";
  }

  return str;
}

function parseCompanyIntelJson(raw: string): unknown | null {
  const candidate = extractJsonCandidate(raw) || raw;
  if (!candidate || !candidate.trim()) return null;

  const attempts = [
    candidate,
    candidate.replace(/,\s*([}\]])/g, "$1"),
    candidate.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'"),
    repairTruncatedJson(candidate),
    repairTruncatedJson(raw),
  ];

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      continue;
    }
  }

  return null;
}

function extractJsonCandidate(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  const unfenced = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const start = unfenced.search(/[\[{]/);
  if (start === -1) return null;

  const source = unfenced.slice(start);
  const open = source[0];
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = inString;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }

    if (ch === "}" || ch === "]") {
      const last = stack.pop();
      if (!last) continue;
      const expected = last === "{" ? "}" : "]";
      if (ch !== expected) continue;

      if (!stack.length) {
        return source.slice(0, i + 1);
      }
    }
  }

  // Return source even if truncated so repairTruncatedJson can auto-repair it
  return source;
}

function parseStructuredJson<T>(raw: string, fallback: T): T {
  const parsed = parseCompanyIntelJson(raw);
  if (!parsed) return fallback;
  return parsed as T;
}

export interface AzureFactVerification {
  isVerified: boolean;
  terms: string[];
}

export function verifyAzureSpecs(text: string): AzureFactVerification {
  if (!text || text.length < 20) {
    return { isVerified: false, terms: [] };
  }

  const terms: string[] = [];
  const lower = text.toLowerCase();

  // SLAs
  if (/99\.999%|99\.99%|99\.95%|99\.9%/.test(text)) {
    const match = text.match(/99\.\d+%/);
    if (match) terms.push(`SLA ${match[0]}`);
  }

  // Azure CLI
  if (/az\s+(group|aks|network|vm|sql|storage|webapp|policy|keyvault)/.test(lower)) {
    const match = text.match(/az\s+[a-z]+/i);
    if (match) terms.push(match[0].toLowerCase());
  }

  // Terraform azurerm resources
  if (/azurerm_[a-z0-9_]+/.test(lower)) {
    const match = text.match(/azurerm_[a-z0-9_]+/i);
    if (match) terms.push(match[0]);
  }

  // Core Azure Solutions & Architecture Specs
  if (lower.includes("landing zone")) terms.push("Azure Landing Zone");
  if (lower.includes("entra id") || lower.includes("azure ad")) terms.push("Entra ID");
  if (lower.includes("expressroute")) terms.push("ExpressRoute");
  if (lower.includes("virtual wan") || lower.includes("vwan")) terms.push("Virtual WAN");
  if (lower.includes("sql managed instance")) terms.push("SQL Managed Instance");
  if (lower.includes("front door")) terms.push("Azure Front Door");
  if (lower.includes("site recovery")) terms.push("Azure Site Recovery (ASR)");
  if (lower.includes("finops") || lower.includes("cost management")) terms.push("FinOps Framework");

  const uniqueTerms = Array.from(new Set(terms)).slice(0, 4);

  return {
    isVerified: uniqueTerms.length > 0,
    terms: uniqueTerms,
  };
}

export const engine = new Engine();
