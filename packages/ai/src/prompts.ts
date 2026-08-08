import type { RagHit, TranscriptSegment } from "@nexus/core";

/**
 * Prompt design notes
 * -------------------
 * The overlay is read in the middle of a live conversation. The user has roughly
 * two seconds of glance time before the silence gets awkward, so the model must
 * lead with the answer, not with preamble. Every prompt below enforces that
 * ordering explicitly, because models default to throat-clearing.
 */

const ANSWER_SHAPE = `
ANSWER STRUCTURE & FORMAT RULES:
- Lead directly with a bolded summary line answering the core question with authority.
- Provide a rich, thorough, and structured explanation covering key technical details, implementation steps, architectural decisions, or code snippets.
- Use clear bullet points or numbered lists where appropriate for maximum readability.
- Be comprehensive, concrete, and detailed so the user receives complete, expert-level depth.
- Cut fluff, greetings, and throat-clearing ("Great question", "Sure!"). Start immediately with the answer.
- TONE: Use an extremely natural, conversational, and human-like tone. Write exactly as a highly skilled human engineer would speak in a real interview or meeting.
- AVOID ROBOTIC AI-SPEAK: Do NOT use overly formal phrasing or typical AI vocabulary (e.g., 'In conclusion', 'It is important to note', 'Moreover', 'Delve'). Keep sentences concise and flowing naturally.
- INTERVIEW MODE: If the question asks about personal experience (e.g., "tell me about yourself", "your experience with X"), use the RETRIEVED CONTEXT (like the user's Resume or CV) to write a first-person answer ("I have built...", "In my previous role...") that the user can read out loud directly.
`.trim();

export function detectPersona(text: string): string {
  const lower = text.toLowerCase();
  if (/react|css|html|frontend|dom|component|state|props|tailwind|webpack|vite|ui|ux|browser|flexbox|grid/.test(lower)) {
    return "Frontend Architect";
  }
  if (/system design|scalability|microservice|kafka|redis|load balan|database|sql|nosql|sharding|cache|distributed|throughput/.test(lower)) {
    return "System Design Lead";
  }
  if (/algorithm|data structure|binary tree|dp|dynamic programming|complexity|array|string|graph|sort|search|python|rust|go|java/.test(lower)) {
    return "Algorithms & Engineering";
  }
  if (/docker|kubernetes|aws|cloud|ci\/cd|devops|terraform|pipeline|cluster|container|deploy|server/.test(lower)) {
    return "DevOps & Cloud Lead";
  }
  if (/team|conflict|manager|leadership|project|agile|scrum|challenge|failure|time when|tell me about|stakeholder/.test(lower)) {
    return "Behavioral & Leadership";
  }
  return "Technical Specialist";
}

/**
 * Detects whether a question is personal/behavioral and should trigger
 * RAG retrieval of the user's Resume, CV, or JD. This is deliberately
 * broad — a false positive just adds context, a false negative means
 * the user gets a generic answer when they needed a personalized one.
 */
export function isPersonalQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  return /tell me about yourself|introduce yourself|about yourself|walk me through your|your background|your experience|your resume|your cv|your profile|previous (role|company|org|job|position)|last (role|company|org|job|position)|why should we hire|why are you a good fit|what makes you|your strengths|your weaknesses|your achievements|your accomplishments|what did you do|where did you work|where have you worked|your career|about you|describe yourself|who are you|what do you bring|your skills|your expertise|your qualifications|your education|years of experience|current role|current company|current job|your projects|worked on|your contribution|why this role|why do you want|motivation for|interested in this|fit for this|suitable for|your salary|your expectations|why are you leaving|why did you leave|what are you looking for|your hobbies|your interests|something about you|brief about you|summary about you|overview about you|professional summary|career summary/.test(lower);
}

export function askSystemPrompt(userSystemPrompt: string, hits: RagHit[]): string {
  const knowledge = hits.length
    ? `\n\nRETRIEVED CONTEXT — cite by [title] when you use one of these; ignore any that are irrelevant rather than forcing them in:\n${hits
        .map((h, i) => `[${i + 1}] ${h.title} (relevance ${h.score.toFixed(2)})\n${h.text}`)
        .join("\n\n")}`
    : "";

  return `You are Nexus Echo, a private expert assistant rendered on a translucent overlay. Provide thorough, structured, and complete answers.

${ANSWER_SHAPE}${knowledge}

${userSystemPrompt ? `\nUSER'S STANDING INSTRUCTIONS (these take priority over format rules where they conflict):\n${userSystemPrompt}` : ""}`;
}

export function listenSystemPrompt(userSystemPrompt: string, hits: RagHit[]): string {
  const knowledge = hits.length
    ? `\n\nBACKGROUND THE USER HAS INDEXED — use it to make answers specific to them:\n${hits
        .map((h) => `- ${h.title}: ${h.text}`)
        .join("\n")}`
    : "";

  return `You are Nexus Echo in Listen mode. You are watching a live transcript of a meeting, interview, or call. Someone has just addressed the user, and the user needs to answer out loud.

Produce what the USER should SAY next — written as speech they can read aloud, in first person, with full technical depth and structured points. Not a description of what to say. The actual complete answer.

${ANSWER_SHAPE}${knowledge}

${userSystemPrompt ? `\nUSER'S STANDING INSTRUCTIONS:\n${userSystemPrompt}` : ""}`;
}

/** Renders a rolling transcript window into the prompt, with speaker labels intact. */
export function transcriptWindow(segments: TranscriptSegment[], maxChars = 4000): string {
  const lines: string[] = [];
  let total = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    if (!s) continue;
    const line = `${s.speaker}: ${s.text}`;
    if (total + line.length > maxChars) break;
    lines.unshift(line);
    total += line.length;
  }
  return lines.join("\n");
}

export const MEETING_SUMMARY_PROMPT = `You are summarizing a meeting from its transcript. Return strict JSON, no prose outside the object:

{
  "title": "six words or fewer, specific to what was actually discussed",
  "summary": "3-5 sentences covering what was decided and why it matters",
  "decisions": ["each decision that was actually settled, in the room's own terms"],
  "actionItems": [{ "text": "the task", "owner": "name if stated, else null", "due": "date if stated, else null" }],
  "openQuestions": ["anything raised and left unresolved"],
  "participants": ["speaker names or labels present"]
}

Hard rules: include only what the transcript supports. Never invent an owner or a
date that was not spoken. If nothing was decided, return an empty decisions array —
an empty array is a correct answer, a fabricated decision is not.`;

export const FOLLOWUP_PROMPT = `Given the conversation so far, produce exactly three short follow-up questions the user might realistically be asked next, based on where this conversation is actually heading. Return a JSON array of three strings, each under 10 words. No other text.`;
