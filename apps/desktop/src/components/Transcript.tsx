import { useEffect, useRef } from "react";
import type { TranscriptSegment, CompanyIntel } from "@nexus/core";
import { formatClock } from "@nexus/core";
import { cn } from "@/lib/cn";
import { Sparkles } from "lucide-react";
import Markdown from "react-markdown";

interface AnswerItem {
  id: string;
  question?: string | undefined;
  text: string;
}

export function Transcript({
  segments,
  answersList,
  currentAnswer,
}: {
  segments: TranscriptSegment[];
  answersList: AnswerItem[];
  currentAnswer: AnswerItem | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // Auto-scroll, but only while the user is already at the bottom. Yanking the
  // view away from someone who scrolled up to re-read something is infuriating.
  useEffect(() => {
    if (pinnedRef.current) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [segments.length]);

  const onScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  if (!segments.length) {
    return (
      <p className="px-1 py-6 text-center text-[12px] text-white/35">
        Listening. The transcript appears here as people speak.
      </p>
    );
  }

  return (
    <div ref={containerRef} onScroll={onScroll} className="max-h-full space-y-3 overflow-y-auto pr-1">
      {segments.map((segment) => {
        // Find if this segment has a matching answer (either completed or streaming)
        const segmentTextNorm = segment.text.trim().toLowerCase();
        
        let matchingAnswerText = "";
        let isStreaming = false;

        if (currentAnswer && currentAnswer.question && segmentTextNorm.includes(currentAnswer.question.trim().toLowerCase())) {
          matchingAnswerText = currentAnswer.text;
          isStreaming = true;
        } else {
          const match = answersList.find(
            (a) => a.question && segmentTextNorm.includes(a.question.trim().toLowerCase())
          );
          if (match) {
            matchingAnswerText = match.text;
          }
        }

        return (
          <div key={segment.id} className="space-y-1 animate-fade-up">
            <div className="flex gap-2 text-[12.5px] leading-snug">
              <span className="w-9 shrink-0 pt-[2px] font-mono text-[10px] text-white/25">
                {formatClock(segment.startMs)}
              </span>
              <span
                className={cn(
                  "w-16 shrink-0 truncate pt-[1px] text-[11px] font-medium",
                  segment.source === "microphone" ? "text-accent" : "text-sky-300",
                )}
                title={segment.speaker}
              >
                {segment.speaker}
              </span>
              <span className={cn("flex-1", segment.isFinal ? "text-white/80" : "text-white/45 italic")}>
                {segment.text}
              </span>
            </div>

            {matchingAnswerText && (
              <div className="ml-11 mt-1 rounded-lg border border-accent/20 bg-accent/5 p-3 text-[12.5px] text-white/90 leading-relaxed shadow-sm animate-fade-up">
                <div className="flex items-center gap-1.5 text-accent text-[9px] font-mono uppercase tracking-wider mb-1.5 select-none">
                  <Sparkles className={cn("h-3 w-3", isStreaming && "animate-pulse")} />
                  <span>{isStreaming ? "Formulating Answer..." : "Suggested Response"}</span>
                </div>
                <div className="prose prose-invert max-w-none text-white/85">
                  <Markdown>{matchingAnswerText}</Markdown>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
