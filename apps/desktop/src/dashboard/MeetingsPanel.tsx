import { useEffect, useState } from "react";
import { CheckSquare, Search, Sparkles } from "lucide-react";
import { bridge, type SearchHit } from "@/lib/bridge";
import { useStore } from "@/lib/store";
import { listen } from "@tauri-apps/api/event";

export function MeetingsPanel() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const { segments } = useStore();
  const [latestReport, setLatestReport] = useState<{ meetingId: string; summary: any } | null>(null);

  useEffect(() => {
    const unlisten = listen<{ meetingId: string; summary: any }>("nexus://meeting-finalized", (event) => {
      setLatestReport(event.payload);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold">Meetings & Debrief Reports</h2>
        <p className="text-[13px] text-white/40">
          Full-text search across every transcript, answer, and post-interview debrief stored on this machine.
        </p>
      </header>

      {latestReport && (
        <div className="rounded-xl border border-accent/30 bg-accent/[0.08] p-5 space-y-3 animate-fade-up">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-accent">
              <Sparkles className="h-4 w-4" /> Post-Interview Performance Debrief
            </h3>
            <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-mono text-accent">
              {latestReport.summary.title}
            </span>
          </div>

          <p className="text-[12.5px] leading-relaxed text-white/80">
            {latestReport.summary.summary}
          </p>

          {latestReport.summary.decisions && latestReport.summary.decisions.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] font-mono uppercase tracking-wider text-white/40">Key Topics & Takeaways:</span>
              <ul className="list-disc list-inside text-[12px] text-white/70 space-y-0.5">
                {latestReport.summary.decisions.map((d: string, idx: number) => (
                  <li key={idx}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search everything…"
          className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-9 pr-3 text-[13px] focus:border-accent/40 focus:outline-none"
        />
      </div>

      {hits.length > 0 && (
        <ul className="space-y-1.5">
          {hits.map((hit, i) => (
            <li key={`${hit.entityId}-${i}`} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
              <div className="flex items-center gap-2">
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
                  {hit.kind}
                </span>
                {hit.title && <span className="text-[12.5px] text-white/70">{hit.title}</span>}
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/55">{hit.snippet}</p>
            </li>
          ))}
        </ul>
      )}

      {query && hits.length === 0 && (
        <p className="py-6 text-center text-[13px] text-white/30">No matches.</p>
      )}

      {!query && segments.length > 0 && (
        <div className="rounded-xl border border-accent/20 bg-accent/[0.05] p-4">
          <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-accent">
            <Sparkles className="h-3.5 w-3.5" /> Session in progress
          </h3>
          <p className="mt-1 text-[12.5px] text-white/55">
            {segments.length} segments captured. The summary, decisions, and action items are extracted
            when you stop listening.
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-[12px] text-white/35">
            <CheckSquare className="h-3.5 w-3.5" />
            Nothing is sent anywhere until you ask for a suggestion.
          </div>
        </div>
      )}
    </section>
  );
}
