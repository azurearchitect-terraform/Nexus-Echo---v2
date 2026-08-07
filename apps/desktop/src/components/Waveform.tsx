import { cn } from "@/lib/cn";

/**
 * A twelve-bar activity meter. It is deliberately abstract rather than a real
 * waveform: the user needs to confirm "it is hearing me" in peripheral vision
 * while looking at someone's face, and a detailed waveform is worse at that job
 * than a few bars moving.
 */
export function Waveform({ active, tone }: { active: boolean; tone: "mic" | "system" }) {
  const color = tone === "mic" ? "bg-accent" : "bg-sky-400";
  return (
    <div className="flex h-4 items-end gap-[2px]" aria-hidden>
      {Array.from({ length: 12 }).map((_, i) => (
        <span
          key={i}
          className={cn("w-[2px] rounded-full transition-all duration-150", active ? color : "bg-white/15")}
          style={{
            height: active ? `${25 + Math.abs(Math.sin((Date.now() / 180) + i)) * 70}%` : "18%",
          }}
        />
      ))}
    </div>
  );
}
