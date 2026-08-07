import { useState } from "react";
import { Check, Eye, EyeOff, Zap } from "lucide-react";
import { useStore } from "@/lib/store";
import { bridge } from "@/lib/bridge";
import { DEFAULT_MODELS } from "@/lib/engine";
import { cn } from "@/lib/cn";
import type { ProviderId, RoutingMode } from "@nexus/core";

const ROUTING_COPY: Record<RoutingMode, { title: string; body: string }> = {
  "hybrid-race": {
    title: "Hybrid — race",
    body: "Fires Gemini and OpenAI at the same moment and streams whichever answers first. The loser is cancelled after a few tokens, so you pay for roughly one and a bit completions and get the lower of the two latencies every time. This is the fastest setting.",
  },
  "hybrid-tier": {
    title: "Hybrid — instant then refine",
    body: "The fast model answers in about 300ms so you always have something to say. The stronger model works in the background and quietly replaces the answer when it lands. Best when the questions are hard and the room gives you a beat.",
  },
  single: {
    title: "Single provider",
    body: "One model, no fan-out. Predictable cost, predictable behaviour.",
  },
  offline: {
    title: "Offline — Ollama only",
    body: "Nothing leaves the machine. Slower and less capable, but nothing is ever transmitted, which is the only setting that is safe under a strict NDA.",
  },
};

export function SettingsPanel() {
  const { settings, saveSettings } = useStore();
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const saveKey = async (id: ProviderId, keyRef: string) => {
    const value = keys[keyRef];
    if (!value?.trim()) return;
    await bridge.setProviderKey(keyRef, value);
    setKeys((k) => ({ ...k, [keyRef]: "" }));
    setSaved(id);
    setTimeout(() => setSaved(null), 1800);
    await saveSettings(settings);
  };

  return (
    <section className="space-y-8">
      <header>
        <h2 className="text-lg font-semibold">Providers & routing</h2>
        <p className="text-[13px] text-white/40">
          Keys are stored in your operating system's keychain, never in the database and never in a
          settings file.
        </p>
      </header>

      {/* ---------------- routing mode ---------------- */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-medium">
          <Zap className="h-3.5 w-3.5 text-accent" /> Speed mode
        </h3>
        <div className="grid gap-2">
          {(Object.keys(ROUTING_COPY) as RoutingMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => void saveSettings({ ...settings, routing: { ...settings.routing, mode } })}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                settings.routing.mode === mode
                  ? "border-accent/40 bg-accent/[0.07]"
                  : "border-white/5 bg-white/[0.02] hover:border-white/15",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium">{ROUTING_COPY[mode].title}</span>
                {settings.routing.mode === mode && <Check className="h-3.5 w-3.5 text-accent" />}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-white/45">{ROUTING_COPY[mode].body}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ---------------- hybrid pair ---------------- */}
      {settings.routing.mode.startsWith("hybrid") && (
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Fast side"
            value={settings.routing.primary}
            options={["gemini", "openai", "ollama"]}
            onChange={(primary) =>
              void saveSettings({ ...settings, routing: { ...settings.routing, primary: primary as ProviderId } })
            }
          />
          <Select
            label="Deep side"
            value={settings.routing.secondary}
            options={["openai", "gemini", "ollama"]}
            onChange={(secondary) =>
              void saveSettings({
                ...settings,
                routing: { ...settings.routing, secondary: secondary as ProviderId },
              })
            }
          />
        </div>
      )}

      <Slider
        label="First-token timeout"
        hint="How long to wait before declaring both providers dead and failing over."
        value={settings.routing.firstTokenTimeoutMs}
        min={500}
        max={8000}
        step={250}
        suffix="ms"
        onChange={(firstTokenTimeoutMs) =>
          void saveSettings({ ...settings, routing: { ...settings.routing, firstTokenTimeoutMs } })
        }
      />

      {/* ---------------- credentials ---------------- */}
      <div className="space-y-3">
        <h3 className="text-[13px] font-medium">Credentials</h3>
        {settings.providers.map((provider) => {
          const keyRef = provider.keyRef ?? `${provider.id}_api_key`;
          const models = DEFAULT_MODELS[provider.id];
          return (
            <div key={provider.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[13px] font-medium capitalize">{provider.id}</span>
                  <p className="font-mono text-[11px] text-white/30">
                    {models.fast} · {models.deep}
                  </p>
                </div>
                <Toggle
                  checked={provider.enabled}
                  onChange={(enabled) =>
                    void saveSettings({
                      ...settings,
                      providers: settings.providers.map((p) =>
                        p.id === provider.id ? { ...p, enabled } : p,
                      ),
                    })
                  }
                />
              </div>

              {provider.id === "ollama" ? (
                <input
                  value={provider.baseUrl ?? ""}
                  onChange={(e) =>
                    void saveSettings({
                      ...settings,
                      providers: settings.providers.map((p) =>
                        p.id === "ollama" ? { ...p, baseUrl: e.target.value } : p,
                      ),
                    })
                  }
                  placeholder="http://127.0.0.1:11434"
                  className="mt-2.5 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[12px]"
                />
              ) : (
                <div className="mt-2.5 flex gap-1.5">
                  <div className="relative flex-1">
                    <input
                      type={reveal[keyRef] ? "text" : "password"}
                      value={keys[keyRef] ?? ""}
                      onChange={(e) => setKeys((k) => ({ ...k, [keyRef]: e.target.value }))}
                      placeholder={`Paste your ${provider.id} API key`}
                      className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 pr-8 font-mono text-[12px]"
                    />
                    <button
                      onClick={() => setReveal((r) => ({ ...r, [keyRef]: !r[keyRef] }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30"
                    >
                      {reveal[keyRef] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <button
                    onClick={() => void saveKey(provider.id, keyRef)}
                    className="rounded-lg bg-accent/15 px-3 text-[12px] font-medium text-accent hover:bg-accent/25"
                  >
                    {saved === provider.id ? "Saved" : "Save"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ---------------- system prompt ---------------- */}
      <div className="space-y-2">
        <h3 className="text-[13px] font-medium">Your standing instructions</h3>
        <p className="text-[12px] text-white/40">
          Added to every request. Use it for who you are and how you want to sound — "I'm a backend
          engineer interviewing for staff roles, keep answers concrete and skip the theory."
        </p>
        <textarea
          value={settings.systemPrompt}
          onChange={(e) => void saveSettings({ ...settings, systemPrompt: e.target.value })}
          rows={4}
          className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[13px]"
        />
      </div>
    </section>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors",
        checked ? "bg-accent" : "bg-white/15",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-black transition-transform",
          checked ? "translate-x-4.5 left-0.5" : "left-0.5",
        )}
        style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-white/40">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 text-[13px] capitalize"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px]">{label}</span>
        <span className="font-mono text-[12px] text-accent">
          {value}
          {suffix}
        </span>
      </div>
      {hint && <p className="mb-1.5 text-[12px] text-white/40">{hint}</p>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </div>
  );
}
