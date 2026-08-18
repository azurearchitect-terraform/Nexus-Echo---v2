export const uid = (prefix = "id"): string =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Naive but effective: does this utterance look like a question aimed at the user? */
const QUESTION_LEADS =
  /\b(what|why|how|when|where|who|which|can you|could you|would you|do you|did you|have you|tell me|walk me|explain|describe|talk about|your thoughts|any questions)\b/i;

export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  if (t.endsWith("?")) return true;
  return QUESTION_LEADS.test(t);
}

/** Runs promises concurrently, resolves with the first to satisfy `accept`, aborts the rest. */
export async function raceAccepted<T>(
  factories: Array<(signal: AbortSignal) => Promise<T>>,
  accept: (value: T) => boolean,
): Promise<T> {
  const controllers = factories.map(() => new AbortController());
  const errors: unknown[] = [];
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let pending = factories.length;
    factories.forEach((factory, i) => {
      const controller = controllers[i];
      if (!controller) return;
      factory(controller.signal)
        .then((value) => {
          if (settled || !accept(value)) return;
          settled = true;
          controllers.forEach((c, j) => j !== i && c.abort());
          resolve(value);
        })
        .catch((err) => errors.push(err))
        .finally(() => {
          pending -= 1;
          if (pending === 0 && !settled) reject(new AggregateError(errors, "all candidates failed"));
        });
    });
  });
}

export const SCENARIO_STARTERS = [
  "suppose", "consider", "imagine", "given", "let's say", "let us say",
  "scenario", "think about", "picture this", "say you have",
  "assume", "pretend", "take a case",
];

export const NON_QUESTION_PHRASES = new Set([
  "hello", "hi", "hey", "thank you", "thanks", "okay", "ok", "got it", "sure",
  "mhm", "yeah", "yes", "no", "cool", "alright", "right", "good morning",
  "good afternoon", "bye", "see you", "ding", "chime", "ping", "bell", "beep",
  "sound", "noise", "thank you very much", "thanks a lot", "sounds good",
  "makes sense", "i see", "understood", "great", "perfect", "awesome",
  "testing", "microphones", "check", "uh", "um", "ah", "hmm"
]);

const NON_SPEECH_TOKENS = new Set([
  "ahem", "beep", "bell", "chime", "cough", "coughing", "ding", "hem", "inaudible", "laugh",
  "laughing", "laughter", "music", "noise", "ping", "silence", "sneeze",
  "sneezing", "static",
]);

export function isLikelyNonSpeech(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;

  const lower = trimmed.toLowerCase();
  const normalized = lower.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return true;

  if (/^(clears?|clearing|cleared) (his |her |their )?throat$/.test(normalized)) return true;
  if (/^(his |her |their )?throat (clear|clearing)$/.test(normalized)) return true;
  if (/^(background |indistinct )?(sound|noise|voices?)$/.test(normalized)) return true;

  const words = normalized.split(" ");
  return words.length <= 4 && words.every((word) => NON_SPEECH_TOKENS.has(word));
}

export const QUESTION_INDICATORS = [
  // Interrogatives & Auxiliaries
  "what", "why", "how", "when", "where", "who", "which", "whose", "whom",
  "can", "could", "would", "should", "will", "shall", "may", "might",
  "do you", "did you", "does", "have you", "had you", "has", "are you", "were you", "is there", "are there",
  "what is", "what are", "what was", "what were", "whats", "how do", "how to", "how would", "how is", "how are",
  "why do", "why is", "why would", "why did", "can you", "could you", "would you",

  // Directive & Prompt phrases
  "tell me", "walk me", "talk about", "give me", "give an example", "describe", "explain",
  "elaborate", "discuss", "detail", "outline", "highlight", "break down", "take me through",
  "share a", "share an", "share your", "share with", "walk through", "talk through", "deep dive",

  // Comparison & Technical / Behavioral contexts
  "difference", "versus", "compare", "contrast", "tradeoff", "trade-off", "pros and cons",
  "architecture", "design", "implement", "experience with", "scenario", "suppose", "consider",
  "imagine", "given", "approach to", "strategy for", "thoughts on", "take on", "opinion on",
  "time when", "situation where", "project where", "challenge you", "conflict you", "failure you",
  "how you handle", "how you manage", "how you lead", "how you scale", "how you solve"
];

export const INCOMPLETE_TRAILING_WORDS = [
  "and", "or", "so", "but", "with", "that", "where", "if", "then", "to",
  "for", "about", "is", "are", "a", "an", "the", "suppose", "consider",
  "imagine", "given", "when", "as", "like", "because", "such as", "than"
];

export function isActionableQuestion(text: string, mode: "question-detected" | "every-pause" | "manual-only" = "question-detected"): boolean {
  const trimmed = text.trim();
  if (!trimmed || isLikelyNonSpeech(trimmed)) return false;

  const lower = trimmed.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  if (NON_QUESTION_PHRASES.has(lower)) return false;

  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;

  // In "every-pause" mode, any substantive statement that isn't filler should trigger
  if (mode === "every-pause") {
    return words.length >= 3;
  }

  // Any text ending with a question mark is an actionable question
  if (trimmed.endsWith("?")) return true;

  // Check directive starts (e.g., "tell me about...", "walk me through...", "explain...")
  const startsWithDirective = /^(tell|walk|talk|give|describe|explain|elaborate|discuss|share|outline|detail|how|what|why|can|could|would|do|did|have|are|were|should)\b/i.test(trimmed);
  if (startsWithDirective && words.length >= 3) return true;

  // Check for any question indicator match
  return QUESTION_INDICATORS.some((ind) => lower.includes(ind));
}

export function isIncompleteScenario(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return false;

  const lower = trimmed.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  const lastWord = words[words.length - 1];
  if (lastWord && INCOMPLETE_TRAILING_WORDS.includes(lastWord)) return true;

  const startsWithScenario = SCENARIO_STARTERS.some((s) => lower.startsWith(s));
  if (startsWithScenario && !lower.includes("what") && !lower.includes("how") && !lower.includes("why") && !lower.includes("explain") && !lower.includes("tell")) {
    return true;
  }

  return false;
}

export function analyzeQuestionCompleteness(text: string, sttConfidence?: number): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  const lower = trimmed.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  let score = 0.55; // Start slightly positive

  // ── Signal 1: Ends with question mark → definitive completion signal
  if (trimmed.endsWith("?")) {
    score += 0.35;
  }

  // ── Signal 2: Ends with period or exclamation → likely complete statement
  if (trimmed.endsWith(".") || trimmed.endsWith("!")) {
    score += 0.25;
  }

  // ── Signal 3: Ends with trailing connector → definitely incomplete
  const lastWord = words[words.length - 1];
  if (lastWord && INCOMPLETE_TRAILING_WORDS.includes(lastWord)) {
    score -= 0.45;
  }

  // ── Signal 4: Starts with scenario starter without question/directive word
  const startsWithScenario = SCENARIO_STARTERS.some((s) => lower.startsWith(s));
  const hasQuestionLead = /^(what|how|why|when|where|who|which|can|could|would|should|tell|walk|talk|give|describe|explain|elaborate|discuss|share)\b/i.test(trimmed);
  const hasQuestionWord = ["what", "how", "why", "explain", "describe", "tell me", "walk me", "can you", "could you", "would you", "give me"].some(
    (q) => lower.includes(q),
  );
  if (startsWithScenario && !hasQuestionWord) {
    score -= 0.30;
  }

  // ── Signal 5: Strong question or directive lead at the start of the sentence
  if (hasQuestionLead) {
    score += 0.20;
  } else if (hasQuestionWord) {
    score += 0.10;
  }

  // ── Signal 6: Very short transcript (< 4 words) without question mark
  if (words.length < 4 && !trimmed.endsWith("?")) {
    score -= 0.20;
  }

  // ── Signal 7: Substantial length (7+ words) with complete question structure
  if (words.length >= 7 && (hasQuestionLead || hasQuestionWord || trimmed.endsWith("?"))) {
    score += 0.15;
  }

  // ── Signal 8: STT confidence factor
  if (sttConfidence !== undefined && sttConfidence < 0.6) {
    score -= 0.15; // Low STT confidence → might be garbled mid-sentence
  }

  // ── Signal 9: Ends with an ellipsis-like pattern ("...")
  if (trimmed.endsWith("...") || trimmed.endsWith("…")) {
    score -= 0.35;
  }

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, score));
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
