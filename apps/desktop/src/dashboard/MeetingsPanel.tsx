import { useEffect, useState } from "react";
import { CheckSquare, Search, Sparkles } from "lucide-react";
import { bridge, type SearchHit } from "@/lib/bridge";
import { useStore } from "@/lib/store";
import { listen } from "@tauri-apps/api/event";

export function MeetingsPanel() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [meetingsList, setMeetingsList] = useState<SearchHit[]>([]);
  const { segments } = useStore();
  const [latestReport, setLatestReport] = useState<{ meetingId: string; summary: any; speechMetrics?: any; speechFeedback?: string[] } | null>(null);

  const loadMeetings = async () => {
    try {
      const results = await bridge.searchEverything("");
      setMeetingsList(results);
    } catch (err) {
      console.error("failed to load meetings", err);
    }
  };

  useEffect(() => {
    void loadMeetings();
    const unlisten = listen<{ meetingId: string; summary: any }>("nexus://meeting-finalized", (event) => {
      setLatestReport(event.payload);
      void loadMeetings();
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (query.trim()) {
      void bridge.searchEverything(query.trim()).then(setHits);
    } else {
      setHits([]);
    }
  }, [query]);

  return (
    <section className="space-y-6 animate-fadeIn">
      <header>
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-semibold">Post-Interview Summary &amp; Debrief Reports</h2>
        </div>
        <p className="text-[13px] text-white/40 mt-0.5">
          Structured executive summaries, technical decisions, key takeaways, and action items extracted from your interview sessions.
        </p>
      </header>

      {/* Latest Session Live Report */}
      {latestReport && (
        <div className="rounded-xl border border-accent/30 bg-accent/[0.08] p-5 space-y-4 animate-slideUp">
          <div className="flex items-center justify-between border-b border-accent/20 pb-3">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-accent/70">Latest Finalized Session</span>
              <h3 className="text-md font-semibold text-accent mt-0.5">{latestReport.summary.title}</h3>
            </div>
            <span className="rounded-full bg-accent/20 px-3 py-1 text-[11px] font-medium text-accent font-mono">
              Debrief Ready
            </span>
          </div>

          <div className="space-y-1">
            <h4 className="text-[11px] font-mono uppercase tracking-wider text-white/40 font-semibold">Executive Summary</h4>
            <p className="text-[13px] leading-relaxed text-white/85 bg-black/30 p-3 rounded-lg border border-white/5">
              {latestReport.summary.summary}
            </p>
          </div>

          {latestReport.summary.decisions && latestReport.summary.decisions.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-mono uppercase tracking-wider text-white/40 font-semibold">Key Decisions &amp; Architectural Takeaways:</h4>
              <ul className="list-disc list-inside text-[12.5px] text-white/75 space-y-1 bg-black/20 p-3 rounded-lg border border-white/5">
                {latestReport.summary.decisions.map((d: string, idx: number) => (
                  <li key={idx}>{d}</li>
                ))}
              </ul>
            </div>
          )}

          {latestReport.summary.actionItems && latestReport.summary.actionItems.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-[11px] font-mono uppercase tracking-wider text-white/40 font-semibold">Action Items &amp; Follow-ups:</h4>
              <div className="space-y-1">
                {latestReport.summary.actionItems.map((item: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-2 text-[12.5px] text-white/80 bg-black/20 px-3 py-2 rounded-md">
                    <CheckSquare className="h-3.5 w-3.5 text-accent shrink-0" />
                    <span>{typeof item === "string" ? item : item.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Speech Quality Metrics */}
          {latestReport.speechMetrics && (
            <div className="rounded-lg border border-blue-400/30 bg-blue-400/[0.08] p-4 space-y-2">
              <h4 className="text-[11px] font-mono uppercase tracking-wider text-blue-300 font-semibold">Speech Quality Analysis</h4>
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div className="space-y-1">
                  <p className="text-white/60">Overall Score</p>
                  <p className="text-[13px] font-semibold text-blue-300">
                    {Math.round(latestReport.speechMetrics.overallSpeechQuality)}/100
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-white/60">Words/Min</p>
                  <p className="text-[13px] font-semibold text-blue-300">{latestReport.speechMetrics.wordsPerMinute}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-white/60">Filler Words</p>
                  <p className="text-[13px] font-semibold text-blue-300">
                    {latestReport.speechMetrics.fillerWordPercentage}%
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-white/60">Clarity</p>
                  <p className="text-[13px] font-semibold text-blue-300">
                    {Math.round(latestReport.speechMetrics.claritySentenceCompletion)}/100
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transcripts, keywords, decisions, or debrief reports…"
          className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-9 pr-3 text-[13px] focus:border-accent/40 focus:outline-none"
        />
      </div>

      {/* Search hits */}
      {query && hits.length > 0 && (
        <ul className="space-y-2">
          {hits.map((hit, i) => (
            <li key={`${hit.entityId}-${i}`} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wide text-accent">
                  {hit.kind}
                </span>
                {hit.title && <span className="text-[12.5px] font-semibold text-white/80">{hit.title}</span>}
              </div>
              <p className="text-[12.5px] leading-relaxed text-white/60">{hit.snippet}</p>
            </li>
          ))}
        </ul>
      )}

      {query && hits.length === 0 && (
        <p className="py-6 text-center text-[13px] text-white/30">No debrief reports or transcripts match your query.</p>
      )}

      {/* Default view: List of all past meetings & debrief reports */}
      {!query && meetingsList.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-[13px] font-semibold text-white/50 font-mono uppercase tracking-wider">All Stored Debrief Reports &amp; Transcripts</h3>
          <div className="space-y-3">
            {meetingsList.map((hit, i) => (
              <div key={`${hit.entityId}-${i}`} className="rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-2 hover:border-white/10 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-accent/15 px-2 py-0.5 text-[10px] font-mono uppercase text-accent font-semibold">
                      {hit.kind}
                    </span>
                    <h4 className="text-[13px] font-semibold text-white/90">{hit.title || "Interview Session"}</h4>
                  </div>
                </div>
                <p className="text-[12.5px] leading-relaxed text-white/65">{hit.snippet}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!query && segments.length > 0 && (
        <div className="rounded-xl border border-accent/20 bg-accent/[0.05] p-4">
          <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-accent">
            <Sparkles className="h-3.5 w-3.5" /> Session in progress
          </h3>
          <p className="mt-1 text-[12.5px] text-white/55">
            {segments.length} segments captured. Executive summary, key takeaways, and action items will be generated when you stop listening.
          </p>
        </div>
      )}
    </section>
  );
}
