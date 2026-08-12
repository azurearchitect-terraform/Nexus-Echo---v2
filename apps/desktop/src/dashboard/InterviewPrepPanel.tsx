import { useState, type FormEvent } from "react";
import { CheckCircle2, Plus, Trash2, Target, Sparkles, MessageSquareMore, BadgeInfo, BookOpen, ArrowRight } from "lucide-react";
import { useStore } from "@/lib/store";
import type { InterviewMode } from "@nexus/core";

const MODE_COPY: Array<{ id: InterviewMode; title: string; hint: string }> = [
  { id: "mixed", title: "Mixed", hint: "General interview flow" },
  { id: "behavioral", title: "Behavioral", hint: "STAR stories and leadership" },
  { id: "technical", title: "Technical", hint: "Implementation details and tradeoffs" },
  { id: "system-design", title: "System Design", hint: "Architecture and scalability" },
  { id: "hr", title: "HR", hint: "Culture, motivation, fit" },
  { id: "recruiter", title: "Recruiter", hint: "Career story and logistics" },
  { id: "leadership", title: "Leadership", hint: "Ownership, influence, execution" },
];

export function InterviewPrepPanel() {
  const {
    interviewMode,
    setInterviewMode,
    storyBank,
    addStory,
    deleteStory,
    coachInsight,
    coverageChecklist,
    nextQuestions,
    interviewDebriefs,
  } = useStore();

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [situation, setSituation] = useState("");
  const [task, setTask] = useState("");
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");
  const [tags, setTags] = useState("");
  const [metrics, setMetrics] = useState("");

  const clearForm = () => {
    setTitle("");
    setSummary("");
    setSituation("");
    setTask("");
    setAction("");
    setResult("");
    setTags("");
    setMetrics("");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !summary.trim()) return;
    addStory({
      title: title.trim() || summary.trim().slice(0, 36) || "Untitled story",
      summary: summary.trim() || [situation, task, action, result].filter(Boolean).join(" "),
      situation: situation.trim(),
      task: task.trim(),
      action: action.trim(),
      result: result.trim(),
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      metrics: metrics.split(",").map((metric) => metric.trim()).filter(Boolean),
      roleFocus: interviewMode,
    });
    clearForm();
  };

  return (
    <section className="space-y-6 animate-fadeIn">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-semibold">Interview Lab</h2>
        </div>
        <p className="text-[13px] text-white/40">
          Build story bank entries, review live coaching, and keep your answer structure tight during interviews.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {MODE_COPY.map((mode) => (
          <button
            key={mode.id}
            onClick={() => setInterviewMode(mode.id)}
            className={`rounded-xl border p-4 text-left transition-colors ${
              interviewMode === mode.id ? "border-accent/40 bg-accent/[0.08]" : "border-white/5 bg-white/[0.02] hover:border-white/10"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold">{mode.title}</span>
              {interviewMode === mode.id && <CheckCircle2 className="h-4 w-4 text-accent" />}
            </div>
            <p className="mt-1 text-[12px] text-white/45">{mode.hint}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <BadgeInfo className="h-4 w-4 text-accent" />
              <h3 className="text-[13px] font-semibold">Live coach</h3>
            </div>
            {coachInsight ? (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-accent/15 px-3 py-1 text-[11px] font-semibold text-accent">
                    Score {coachInsight.overallScore}/100
                  </span>
                  <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] text-white/60">
                    Structure {coachInsight.structureScore}/100
                  </span>
                  <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] text-white/60">
                    Clarity {coachInsight.clarityScore}/100
                  </span>
                  <span className="rounded-full bg-white/5 px-3 py-1 text-[11px] text-white/60">
                    Specificity {coachInsight.specificityScore}/100
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed text-white/80">{coachInsight.summary}</p>
                {coachInsight.storyMatchHint && (
                  <div className="rounded-lg border border-white/5 bg-black/25 p-3 text-[12.5px] text-white/65">
                    <span className="font-semibold text-accent">Story match: </span>
                    {coachInsight.storyMatchHint}
                  </div>
                )}
                {coachInsight.coachingTip && (
                  <div className="rounded-lg border border-accent/20 bg-accent/5 p-3 text-[12.5px] text-white/75">
                    <span className="font-semibold text-accent">Coach cue: </span>
                    {coachInsight.coachingTip}
                  </div>
                )}
                {coachInsight.nextBestMove && (
                  <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-[12.5px] text-white/65">
                    <span className="font-semibold text-white/85">Next best move: </span>
                    {coachInsight.nextBestMove}
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-3 text-[12.5px] text-white/40">
                Answer one question and the coach will score structure, clarity, and impact here.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-accent" />
              <h3 className="text-[13px] font-semibold">Coverage checklist</h3>
            </div>
            <div className="mt-3 space-y-2">
              {(coverageChecklist.length ? coverageChecklist : coachInsight?.checklist ?? []).map((item) => (
                <div key={item.label} className="flex items-start gap-2 rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                  <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${item.covered ? "text-emerald-400" : "text-white/20"}`} />
                  <div>
                    <p className="text-[12.5px] font-medium text-white/80">{item.label}</p>
                    <p className="text-[11.5px] text-white/35">{item.note}</p>
                  </div>
                </div>
              ))}
              {(!coverageChecklist.length && !(coachInsight?.checklist?.length ?? 0)) && (
                <p className="text-[12.5px] text-white/40">No checklist yet. Use the live interview tools and this will populate automatically.</p>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <MessageSquareMore className="h-4 w-4 text-accent" />
              <h3 className="text-[13px] font-semibold">Likely follow-ups</h3>
            </div>
            <div className="mt-3 space-y-2">
              {(nextQuestions.length ? nextQuestions : coachInsight?.likelyFollowUps ?? []).map((item) => (
                <div key={`${item.question}-${item.priority}`} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12.5px] text-white/80">{item.question}</p>
                    <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider text-white/40">
                      {item.priority}
                    </span>
                  </div>
                  {item.reason && <p className="mt-1 text-[11.5px] text-white/35">{item.reason}</p>}
                </div>
              ))}
              {!nextQuestions.length && !(coachInsight?.likelyFollowUps?.length ?? 0) && (
                <p className="text-[12.5px] text-white/40">Likely follow-up questions will appear after your first real answer.</p>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-accent" />
              <h3 className="text-[13px] font-semibold">Debrief history</h3>
            </div>
            <div className="mt-3 space-y-3">
              {interviewDebriefs.slice().reverse().slice(0, 5).map((item) => (
                <div key={`${item.createdAt}-${item.question}`} className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[12.5px] font-medium text-white/80">{item.question}</p>
                    <span className="text-[10px] uppercase tracking-wider text-white/30">{item.mode}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-white/45">{item.summary}</p>
                  {item.storyTitle && <p className="mt-1 text-[11px] text-accent/75">Matched story: {item.storyTitle}</p>}
                  {item.followUps.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.followUps.map((followUp) => (
                        <span key={followUp} className="rounded border border-white/10 bg-white/[0.02] px-2 py-0.5 text-[10px] text-white/45">
                          {followUp}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {interviewDebriefs.length === 0 && (
                <p className="text-[12.5px] text-white/40">Your debriefs will appear here after each answer is analyzed.</p>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-accent" />
              <h3 className="text-[13px] font-semibold">Add story</h3>
            </div>
            <form className="mt-3 space-y-2.5" onSubmit={onSubmit}>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Story title" className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px]" />
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} placeholder="One-line summary" className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px]" />
              <textarea value={situation} onChange={(e) => setSituation(e.target.value)} rows={2} placeholder="Situation" className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px]" />
              <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={2} placeholder="Task" className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px]" />
              <textarea value={action} onChange={(e) => setAction(e.target.value)} rows={2} placeholder="Action" className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px]" />
              <textarea value={result} onChange={(e) => setResult(e.target.value)} rows={2} placeholder="Result" className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px]" />
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma separated" className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px]" />
              <input value={metrics} onChange={(e) => setMetrics(e.target.value)} placeholder="Metrics, comma separated" className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px]" />
              <button type="submit" className="inline-flex items-center gap-2 rounded-lg bg-accent/15 px-3 py-2 text-[12.5px] font-medium text-accent hover:bg-accent/25">
                <Plus className="h-4 w-4" />
                Save story
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-accent" />
                <h3 className="text-[13px] font-semibold">Story bank</h3>
              </div>
              <span className="text-[11px] text-white/35">{storyBank.length} items</span>
            </div>
            <div className="mt-3 space-y-2">
              {storyBank.slice().reverse().map((story) => (
                <div key={story.id} className="rounded-lg border border-white/5 bg-black/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[12.5px] font-medium text-white/80">{story.title}</p>
                      <p className="mt-0.5 text-[11.5px] text-white/45">{story.summary}</p>
                    </div>
                    <button onClick={() => deleteStory(story.id)} className="text-white/25 hover:text-danger" title="Delete story">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {story.tags.map((tag) => (
                      <span key={tag} className="rounded border border-white/10 bg-white/[0.02] px-2 py-0.5 text-[10px] text-white/45">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {storyBank.length === 0 && (
                <p className="text-[12.5px] text-white/40">Add 5 to 10 reusable stories here. This is the fastest way to get stronger answers.</p>
              )}
            </div>
          </section>

          {coachInsight?.suggestedStoryTags?.length ? (
            <section className="rounded-xl border border-accent/20 bg-accent/[0.04] p-4">
              <h3 className="text-[13px] font-semibold text-accent">Suggested story tags</h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {coachInsight.suggestedStoryTags.map((tag) => (
                  <span key={tag} className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] text-accent">
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}
