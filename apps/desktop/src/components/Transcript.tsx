import { useEffect, useRef } from "react";
import type { TranscriptSegment } from "@nexus/core";
import { formatClock } from "@nexus/core";
import { cn } from "@/lib/cn";

export function Transcript({ segments }: { segments: TranscriptSegment[] }) {
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
    <div ref={containerRef} onScroll={onScroll} className="max-h-full space-y-2 overflow-y-auto pr-1">
      {segments.map((segment) => (
        <div key={segment.id} className="flex gap-2 text-[12.5px] leading-snug animate-fade-up">
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
      ))}
      <div ref={endRef} />
    </div>
  );
}
