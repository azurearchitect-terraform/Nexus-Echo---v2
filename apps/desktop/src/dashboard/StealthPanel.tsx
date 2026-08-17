import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useStore } from "@/lib/store";
import { bridge, type StealthReport } from "@/lib/bridge";
import { Slider, Toggle } from "./SettingsPanel";

const OPTIONS = [
  {
    key: "contentProtected" as const,
    title: "Exclude from screen capture",
    body: "Tells the compositor to omit this window from any capture. On Windows this is WDA_EXCLUDEFROMCAPTURE, on macOS NSWindowSharingNone. Screen shares, recordings, and screenshots all see the desktop behind the overlay instead of the overlay.",
  },
  {
    key: "neverStealFocus" as const,
    title: "Never take focus",
    body: "The overlay renders above your work but never becomes the active window. This matters more than it sounds: an app visibly deactivating mid-sentence is what actually gives people away, not the window itself.",
  },
  {
    key: "hideFromTaskbar" as const,
    title: "Hide from taskbar and Alt-Tab",
    body: "No taskbar button, no window-switcher entry.",
  },
  {
    key: "hideFromDock" as const,
    title: "Hide from the Dock",
    body: "macOS only. Runs as an accessory app with no Dock tile.",
  },
  {
    key: "alwaysOnTop" as const,
    title: "Always on top",
    body: "Floats above full-screen apps and every desktop.",
  },
  {
    key: "clickThrough" as const,
    title: "Click-through",
    body: "Mouse events pass straight to whatever is underneath. Press Ctrl+Shift+R from any application to temporarily restore interaction and resize the overlay, then press it again to return to click-through.",
  },
];

export function StealthPanel() {
  const { settings, saveSettings } = useStore();
  const [report, setReport] = useState<StealthReport | null>(null);

  useEffect(() => {
    void bridge.applyStealth(settings.stealth).then(setReport);
  }, [settings.stealth]);

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold">Stealth & privacy</h2>
        <p className="text-[13px] text-white/40">
          These settings are applied to the live window and re-verified each time you change one.
        </p>
      </header>

      {report && (
        <div
          className={
            report.captureExcluded
              ? "flex gap-2.5 rounded-xl border border-accent/25 bg-accent/[0.06] p-3.5"
              : "flex gap-2.5 rounded-xl border border-warn/30 bg-warn/[0.07] p-3.5"
          }
        >
          {report.captureExcluded ? (
            <ShieldCheck className="h-4 w-4 shrink-0 text-accent" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-warn" />
          )}
          <p className="text-[12.5px] leading-relaxed text-white/70">{report.platformNote}</p>
        </div>
      )}

      <div className="space-y-2.5">
        {OPTIONS.map((option) => (
          <div
            key={option.key}
            className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3.5"
          >
            <div className="flex-1">
              <span className="text-[13px] font-medium">{option.title}</span>
              <p className="mt-1 text-[12px] leading-relaxed text-white/45">{option.body}</p>
            </div>
            <Toggle
              checked={settings.stealth[option.key]}
              onChange={(value) =>
                void saveSettings({ ...settings, stealth: { ...settings.stealth, [option.key]: value } })
              }
            />
          </div>
        ))}
      </div>

      <Slider
        label="Overlay opacity"
        hint="Lower values blend into the desktop but cost readability. 0.9 is the practical floor for text you need to read at a glance."
        value={Math.round(settings.stealth.opacity * 100)}
        min={15}
        max={100}
        step={1}
        suffix="%"
        onChange={(v) =>
          void saveSettings({ ...settings, stealth: { ...settings.stealth, opacity: v / 100 } })
        }
      />

      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
        <h3 className="text-[13px] font-medium">Panic key</h3>
        <p className="mt-1 text-[12px] text-white/45">
          Blanks the overlay instantly, from inside any application. Worth committing to muscle memory
          before you rely on any of the rest of this.
        </p>
        <kbd className="mt-2 inline-block rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[12px] text-accent">
          ⌘/Ctrl + ⇧ + \
        </kbd>
      </div>
    </section>
  );
}
