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
- DIRECT ANSWERS ONLY: Never ask clarifying questions back to the user. Even if the question is open-ended, make reasonable architectural assumptions and provide a direct recommendation immediately.
- INTERVIEW MODE: If the question asks about personal experience (e.g., "tell me about yourself", "your experience with X"), use the RETRIEVED CONTEXT (like the user's Resume or CV) to write a first-person answer ("I have built...", "In my previous role...") that the user can read out loud directly. If a Job Description (JD) or requirement document is also present in the context, tailor the answer to highlight relevant skills and align closely with those requirements. If the retrieved context is empty or does not contain details about the specific technology or experience asked, do NOT ask the user for details or output questions. Instead, write a highly professional, standard first-person response based on industry best practices and a 16-year senior architect persona, as if you have successfully implemented the technology.
- QUESTIONS FOR THE INTERVIEWER: If the interviewer asks if the user has any questions (e.g., "Do you have any questions for us?"), use the RETRIEVED CONTEXT (like company notes or JD) and the conversation history to suggest 2-3 highly tailored, insightful, and strategic questions for the user to ask the interviewer. Focus on company culture, engineering practices, team structure, or topics discussed during the interview.
`.trim();

export function detectPersona(text: string): string {
  const lower = text.toLowerCase();
  if (/cost|budget|roi|sla|business|strategic|timeline|stakeholder|vendor|governance|finops|executive|director|board|strategy/.test(lower)) {
    return "Executive / Director (Business & FinOps)";
  }
  if (/azure|landing zone|vwan|vnet|expressroute|terraform|bicep|aks|sql|disaster recovery|site recovery|entra|iam|microservice|cluster|security|ha\/dr/.test(lower)) {
    return "Principal Azure Architect (Deep Tech)";
  }
  if (/react|css|html|frontend|component|state|tailwind|ui|ux/.test(lower)) {
    return "Frontend Architect";
  }
  if (/system design|scalability|kafka|redis|load balan|database|sql|nosql|sharding|cache|distributed/.test(lower)) {
    return "System Design Lead";
  }
  if (/team|conflict|manager|leadership|project|agile|scrum|challenge|failure|time when|tell me about|stakeholder|salary|fit|background|resume|cv/.test(lower)) {
    return "Recruiter / HR (Career & Leadership)";
  }
  return "Principal Azure Solution Architect";
}

/**
 * Detects whether a question is personal/behavioral and should trigger
 * RAG retrieval of the user's Resume, CV, or JD. This is deliberately
 * broad — a false positive just adds context, a false negative means
 * the user gets a generic answer when they needed a personalized one.
 */
export function isPersonalQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    // "tell me / introduce ... yourself" variations
    /\btell\s+me\s+(?:[a-z]+\s+){0,3}about\s+your\s*self\b/.test(lower) ||
    /\bintroduce\s+your\s*self\b/.test(lower) ||
    /\bwalk\s+me\s+through\b/.test(lower) ||
    /\bdescribe\s+your\s*self\b/.test(lower) ||
    // "about you / yourself / your background / resume"
    /\babout\s+your\s*self\b/.test(lower) ||
    /\babout\s+you\b/.test(lower) ||
    /\bwho\s+are\s+you\b/.test(lower) ||
    /\byour\s+(?:background|experience|resume|cv|profile|career|skills|expertise|qualifications|education|projects|contribution|salary|expectations|hobbies|interests|strengths|weaknesses|achievements|accomplishments)\b/.test(lower) ||
    /\byour\s+last\s+(?:role|company|org|job|position|employer|workplace|firm|organization)\b/.test(lower) ||
    // "previous / last / past / prior" roles & companies
    /\b(?:previous|last|past|prior)\s+(?:role|company|org|job|position|experience|employer|workplace|firm|organization)\b/.test(lower) ||
    // "what did you do" / "what you had done" / "what you did"
    /\bwhat\s+(?:did\s+you\s+do|you\s+(?:had\s+done|have\s+done|did|'ve\s+done))\b/.test(lower) ||
    /\bwhere\s+(?:did\s+you\s+work|have\s+you\s+worked)\b/.test(lower) ||
    /\bworked\s+on\b/.test(lower) ||
    // fit and motivation
    /\bwhy\s+(?:should\s+we\s+hire|are\s+you\s+a\s+good\s+fit|this\s+role|do\s+you\s+want|are\s+you\s+leaving|did\s+you\s+leave)\b/.test(lower) ||
    /\bwhat\s+makes\s+you\b/.test(lower) ||
    /\bfit\s+for\b/.test(lower) ||
    /\bsuitable\s+for\b/.test(lower) ||
    /\bmotivation\s+for\b/.test(lower) ||
    /\binterested\s+in\s+this\b/.test(lower) ||
    /\bwhat\s+do\s+you\s+bring\b/.test(lower) ||
    /\bwhat\s+are\s+you\s+looking\s+for\b/.test(lower) ||
    // company research, culture, and "questions for us"
    /\babout\s+(?:our|your|the|this)\s+(?:company|org|culture|product|mission|team|values|vision|technology|stack|service)\b/.test(lower) ||
    /\bwhat\s+do\s+you\s+know\s+about\s+(?:us|our|your|the|this|company)\b/.test(lower) ||
    /\bwhy\s+(?:do\s+you\s+want\s+to\s+work|are\s+you\s+interested\s+in)\s+(?:here|us|our|this|company|for\s+us)\b/.test(lower) ||
    /\b(?:do\s+you\s+have\s+)?any\s+questions\s+(?:for\s+us|for\s+me|about\s+(?:the|our|your|us))\b/.test(lower) ||
    /\bquestions\s+(?:for\s+us|for\s+me|you\s+have|to\s+ask)\b/.test(lower) ||
    /\bculture\b/.test(lower) ||
    // summaries
    /\b(?:professional|career|brief|summary|overview)\s+about\s+you\b/.test(lower) ||
    /\b(?:professional|career)\s+summary\b/.test(lower)
  );
}

export function askSystemPrompt(
  userSystemPrompt: string,
  hits: RagHit[],
  targetCompany?: string,
  targetJd?: string
): string {
  const knowledge = hits.length
    ? `\n\nRETRIEVED CONTEXT — cite by [title] when you use one of these; ignore any that are irrelevant rather than forcing them in:\n${hits
        .map((h, i) => `[${i + 1}] ${h.title} (relevance ${h.score.toFixed(2)})\n${h.text}`)
        .join("\n\n")}`
    : "";

  const companyInjection = (targetCompany || targetJd)
    ? `\n\nTARGET COMPANY & JOB DESCRIPTION INJECTION:
- Target Company: ${targetCompany || "Interview Partner"}
- Target Role / Job Description / Company Values: ${targetJd || "Target Position"}
- COMPANY VALUE & JD ALIGNMENT: Seamlessly weave the target company's mission, engineering culture, and specific JD requirements into your answer. Even for generic technical or behavioral questions, tailor your examples, architectural decisions, and terminology to demonstrate perfect alignment with ${targetCompany || "the target role"}.`
    : "";

  return `You are Nexus Echo, a private expert assistant rendered on a translucent overlay. Provide thorough, structured, and complete answers.

${ANSWER_SHAPE}${companyInjection}${knowledge}

${userSystemPrompt ? `\nUSER'S STANDING INSTRUCTIONS (these take priority over format rules where they conflict):\n${userSystemPrompt}` : ""}`;
}

export function listenSystemPrompt(
  userSystemPrompt: string,
  hits: RagHit[],
  targetCompany?: string,
  targetJd?: string
): string {
  const knowledge = hits.length
    ? `\n\nBACKGROUND THE USER HAS INDEXED — use it to make answers specific to them:\n${hits
        .map((h) => `- ${h.title}: ${h.text}`)
        .join("\n")}`
    : "";

  const companyInjection = (targetCompany || targetJd)
    ? `\n\nTARGET COMPANY & JOB DESCRIPTION INJECTION:
- Target Company: ${targetCompany || "Interview Partner"}
- Target Role / Job Description / Company Values: ${targetJd || "Target Position"}
- COMPANY VALUE & JD ALIGNMENT: Seamlessly weave the target company's mission, engineering culture, and specific JD requirements into your answer. Even for generic technical or behavioral questions, tailor your examples, architectural decisions, and terminology to demonstrate perfect alignment with ${targetCompany || "the target role"}.`
    : "";

  return `You are Nexus Echo in Listen mode. You are watching a live transcript of a meeting, interview, or call. Someone has just addressed the user, and the user needs to answer out loud.

Produce what the USER should SAY next — written as speech they can read aloud, in first person, with full technical depth and structured points. Not a description of what to say. The actual complete answer.

AUDIENCE ROLE-ADAPTIVE TONE RULES:
- Executive / Director: Lead with business impact, ROI, FinOps cost optimization, SLAs, and risk governance. Keep high-level strategic focus.
- Technical Architect: Lead with production-grade Azure architecture, High Availability (HA/DR), Terraform IaC, Entra ID security, and vWAN/ExpressRoute networking.
- Recruiter / HR: Lead with career journey, team leadership, technical mentorship, and clear communication.

${ANSWER_SHAPE}${companyInjection}${knowledge}

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

export function companyIntelPrompt(scrapedText: string, jdText: string | null): { system: string; user: string } {
  return {
    system: `You are an expert technical interviewer and career coach.
Analyze the provided company website text and the optional Job Description (JD).
Generate a structured JSON object representing the Company Intelligence Profile.
Return ONLY valid JSON. No markdown formatting (like \`\`\`json), no preamble, no trailing text.

The JSON structure MUST match:
{
  "name": "Company Name",
  "coreBusiness": "Briefly summarize the core product or service, the target market, and the overarching mission.",
  "technicalLandscape": "Mention engineering blogs, open-source contributions, or known infrastructure strategies. Talk about scale. Treat them as a partner.",
  "recentNews": "Mention a recent major product launch, a strategic partnership, or an acquisition from the last 6 months.",
  "whyItMatters": "Connect a company challenge or goal to specific expertise in cloud infrastructure, system administration, or solution delivery.",
  "goldenFormula": "Combine the above into a concise 60-to-90-second response to 'what do you know about us'. Use the exact formula.",
  "techStack": ["Tag1", "Tag2", ...],
  "jdInterviewQuestions": [
    {
      "question": "High-probability interview question the interviewer is likely to ask YOU based on this JD & tech stack",
      "category": "Architecture / System Design / FinOps / Behavioral",
      "suggestedAnswer": "Comprehensive, expert-level answer key covering specific technical details, architectural choices, and Azure best practices"
    }
  ],
  "questions": [
    {
      "question": "Strategic question for YOU to ask the interviewer",
      "context": "Brief context explaining why this question is highly relevant based on their tech, product, or values.",
      "suggestedPoints": ["Talking point 1", "Talking point 2"]
    }
  ]
}

Hard rules for your analysis:
1. Provide 5-7 realistic, high-probability interview questions in 'jdInterviewQuestions' that the interviewer will ask the candidate based on the provided Job Description requirements and company tech stack. Include strong, concrete suggested answers for each.
2. Provide 4-6 strategic questions in the 'questions' array for the candidate to ask the interviewer.
3. At least two questions MUST be specifically tailored for a senior architect/engineer with 16 years of experience.
4. For the 'goldenFormula', use this exact structure:
   "I have. I know your core business focuses on [Core Product/Service] serving [Target Market]. Recently, I saw the news about your [Recent Launch/Partnership], which signals a strong push toward [Strategic Goal]. On the engineering side, I’ve been following your transition toward [Technical Detail]. Because my background is rooted heavily in architecting and delivering these exact types of scalable infrastructure solutions, I wanted to bring that expertise here to help drive that transition forward."
5. STRICT AVOIDANCE: Do NOT recite the "About" page verbatim. Do NOT bring up controversies or stock prices (focus on tech, product, culture). Do NOT just say "I haven't had time".`,
    user: `Company website content:\n${scrapedText}\n\nJob Description (JD):\n${jdText ?? "No JD provided. Analyze based on company website content alone."}`
  };
}
