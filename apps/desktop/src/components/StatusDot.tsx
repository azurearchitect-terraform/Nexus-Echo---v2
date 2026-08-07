import { cn } from "@/lib/cn";

export function StatusDot({
  active,
  label,
  tone = "accent",
}: {
  active: boolean;
  label: string;
  tone?: "accent" | "warn" | "danger";
}) {
  const color =
    tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-accent";
  return (
    <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-white/40">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full transition-opacity",
          active ? cn(color, "animate-pulse-soft") : "bg-white/20",
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}
