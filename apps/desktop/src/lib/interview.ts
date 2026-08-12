import type {
  CoverageChecklistItem,
  FollowUpPrediction,
  InterviewCoachInsight,
  InterviewDebrief,
  InterviewMode,
  StoryBankItem,
} from "@nexus/core";

const STORY_BANK_KEY = "nexus_story_bank";
const DEBRIEFS_KEY = "nexus_interview_debriefs";
const MODE_KEY = "nexus_interview_mode";

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((word) => word.length > 2);
}

export function similarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (!tokensA.size || !tokensB.size) return 0;
  let hit = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) hit++;
  }
  return hit / new Set([...tokensA, ...tokensB]).size;
}

export function loadStoryBank(): StoryBankItem[] {
  return safeJson<StoryBankItem[]>(localStorage.getItem(STORY_BANK_KEY), []);
}

export function saveStoryBank(stories: StoryBankItem[]): void {
  localStorage.setItem(STORY_BANK_KEY, JSON.stringify(stories));
}

export function loadInterviewDebriefs(): InterviewDebrief[] {
  return safeJson<InterviewDebrief[]>(localStorage.getItem(DEBRIEFS_KEY), []);
}

export function saveInterviewDebriefs(items: InterviewDebrief[]): void {
  localStorage.setItem(DEBRIEFS_KEY, JSON.stringify(items.slice(-50)));
}

export function loadInterviewMode(): InterviewMode {
  return safeJson<InterviewMode>(localStorage.getItem(MODE_KEY), "mixed" as InterviewMode);
}

export function saveInterviewMode(mode: InterviewMode): void {
  localStorage.setItem(MODE_KEY, mode);
}

export function matchStoryBank(question: string, answer: string, stories: StoryBankItem[]): Array<StoryBankItem & { score: number; reason: string }> {
  const scored = stories
    .map((story) => {
      const haystack = [story.title, story.summary, story.situation, story.task, story.action, story.result, story.tags.join(" "), story.metrics.join(" ")].join(" ");
      const score = Math.max(similarity(question, haystack), similarity(answer, haystack));
      const reason = story.tags.length ? `Matches: ${story.tags.slice(0, 3).join(", ")}` : "Matches your example bank";
      return { ...story, score, reason };
    })
    .filter((story) => story.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return scored;
}

function hasAny(text: string, words: string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
}

export function buildCoverageChecklist(question: string, answer: string, mode: InterviewMode): CoverageChecklistItem[] {
  const normalized = `${question}\n${answer}`;
  const items: CoverageChecklistItem[] = [
    { label: "Answered the actual question", covered: similarity(question, answer) > 0.08, note: "Keep the answer anchored to the prompt." },
    { label: "Clear structure", covered: answer.trim().split(/\s+/).length >= 25, note: "Lead with the headline, then expand." },
    { label: "Situation or context", covered: hasAny(normalized, ["when ", "at ", "during ", "context", "situation", "project", "role"]), note: "Set the scene in one sentence." },
    { label: "Action you personally took", covered: hasAny(normalized, ["i led", "i owned", "i implemented", "i designed", "i built", "i drove", "i partnered", "i handled"]), note: "Use first-person ownership." },
    { label: "Outcome or impact", covered: hasAny(normalized, ["result", "impact", "improved", "reduced", "increased", "saved", "delivered", "launched", "%", "sla"]), note: "Close with measurable impact." },
    { label: "Tradeoffs or reasoning", covered: hasAny(normalized, ["tradeoff", "because", "so that", "therefore", "however", "risk", "constraint"]), note: "Show judgment, not just action." },
  ];

  if (mode === "technical" || mode === "system-design") {
    items.push({ label: "Architecture details", covered: hasAny(normalized, ["service", "api", "queue", "cache", "database", "network", "azure", "aws", "terraform", "security"]), note: "Add concrete technical detail." });
  }
  if (mode === "behavioral" || mode === "leadership" || mode === "recruiter") {
    items.push({ label: "Collaboration or leadership", covered: hasAny(normalized, ["team", "stakeholder", "manager", "mentor", "coach", "cross-functional", "aligned"]), note: "Include team context or leadership." });
  }
  if (mode === "hr" || mode === "recruiter") {
    items.push({ label: "Motivation / fit", covered: hasAny(normalized, ["why i want", "looking for", "fit", "excited", "interested", "culture"]), note: "Keep it human and clear." });
  }

  return items;
}

export function estimateScore(answer: string, checklist: CoverageChecklistItem[]): number {
  const lengthScore = Math.min(25, Math.max(0, Math.round((answer.trim().split(/\s+/).length / 18) * 10)));
  const coverageScore = Math.round((checklist.filter((item) => item.covered).length / Math.max(1, checklist.length)) * 75);
  return Math.min(100, lengthScore + coverageScore);
}

export function likelyFollowUps(question: string, answer: string, mode: InterviewMode): FollowUpPrediction[] {
  const normalized = `${question} ${answer}`.toLowerCase();
  const list: FollowUpPrediction[] = [];
  const push = (questionText: string, reason: string, priority: "high" | "medium" | "low" = "medium") => {
    list.push({ question: questionText, reason, priority });
  };

  if (hasAny(normalized, ["architecture", "design", "system", "scale", "distributed"])) {
    push("How did you handle the tradeoffs?", "Interviewer will likely ask about architecture decisions.", "high");
    push("What was the hardest constraint?", "They may test production realism.", "medium");
  }
  if (hasAny(normalized, ["conflict", "challenge", "failure", "mistake"])) {
    push("What did you learn from that?", "Classic behavioral follow-up.", "high");
    push("What would you do differently now?", "Shows reflection and growth.", "medium");
  }
  if (hasAny(normalized, ["finops", "cost", "budget", "roi", "savings"])) {
    push("What metrics did you use?", "Expect a measurement question.", "high");
    push("How did you get stakeholder buy-in?", "Cost work usually needs alignment.", "medium");
  }
  if (mode === "hr" || mode === "recruiter") {
    push("What kind of environment helps you do your best work?", "HR often explores fit and motivation.", "medium");
  }

  if (!list.length) {
    push("Can you walk me through one example?", "The interviewer may ask for a concrete example.", "high");
    push("What was the business impact?", "Impact is a common follow-up.", "medium");
  }

  return list.slice(0, 3);
}

export function buildInterviewCoachInsight(
  question: string,
  answer: string,
  mode: InterviewMode,
  stories: StoryBankItem[],
): InterviewCoachInsight {
  const checklist = buildCoverageChecklist(question, answer, mode);
  const score = estimateScore(answer, checklist);
  const matched = matchStoryBank(question, answer, stories);
  const storyMatchHint = matched[0]
    ? `${matched[0].title} (${Math.round(matched[0].score * 100)}% match)`
    : undefined;

  const strengths: string[] = [];
  const gaps: string[] = [];
  const pushStrength = (text: string) => strengths.push(text);
  const pushGap = (text: string) => gaps.push(text);

  if (checklist[0]?.covered) pushStrength("You answered the question directly.");
  else pushGap("Lead with the answer before adding detail.");
  if (checklist.some((item) => item.label === "Outcome or impact" && item.covered)) pushStrength("You included outcome or impact.");
  else pushGap("Add a result, metric, or concrete outcome.");
  if (checklist.some((item) => item.label === "Action you personally took" && item.covered)) pushStrength("Your personal ownership is clear.");
  else pushGap("Make your role and actions more explicit.");
  if (checklist.some((item) => item.label === "Tradeoffs or reasoning" && item.covered)) pushStrength("Your reasoning and tradeoffs are visible.");
  else pushGap("Explain why you chose that approach.");

  const coachingTip = gaps[0] || "Keep it concise and specific.";
  const nextBestMove = matched[0]
    ? `Anchor the next answer to ${matched[0].title}.`
    : "Use one specific example and end with impact.";

  return {
    summary: `Score ${score}/100. ${coachingTip}`,
    overallScore: score,
    structureScore: checklist[1]?.covered ? 80 : 55,
    clarityScore: checklist[0]?.covered ? 80 : 55,
    specificityScore: checklist.some((item) => item.label === "Outcome or impact" && item.covered) ? 80 : 50,
    confidenceScore: checklist.some((item) => item.label === "Clear structure" && item.covered) ? 75 : 50,
    strengths: strengths.slice(0, 4),
    gaps: gaps.slice(0, 4),
    coachingTip,
    nextBestMove,
    suggestedStoryTags: matched[0]?.tags.slice(0, 4) ?? [],
    checklist,
    likelyFollowUps: likelyFollowUps(question, answer, mode),
    storyMatchHint,
  };
}

export function buildDebriefFromInsight(
  question: string,
  answer: string,
  mode: InterviewMode,
  insight: InterviewCoachInsight,
  storyTitle?: string,
): InterviewDebrief {
  return {
    question,
    answer,
    mode,
    summary: insight.summary,
    strengths: insight.strengths.slice(0, 3),
    improvements: insight.gaps.slice(0, 3),
    followUps: insight.likelyFollowUps.map((item) => item.question).slice(0, 3),
    storyTitle,
    createdAt: Date.now(),
  };
}

