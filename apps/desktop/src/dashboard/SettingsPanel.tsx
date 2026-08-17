import { useState } from "react";
import { Check, Eye, EyeOff, Zap, Building2, Download } from "lucide-react";
import { useStore } from "@/lib/store";
import { bridge } from "@/lib/bridge";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { DEFAULT_MODELS, clearQACache } from "@/lib/engine";
import { cn } from "@/lib/cn";
import type { ProviderId, RoutingMode } from "@nexus/core";

const ROUTING_COPY: Record<RoutingMode, { title: string; body: string }> = {
  "hybrid-race": {
    title: "Hybrid — race",
    body: "Fires Gemini and OpenAI at the same moment and streams whichever answers first. The loser is cancelled after a few tokens, so you pay for roughly one and a bit completions and get the lower of the two latencies every time. This is the fastest setting.",
  },
  "hybrid-tier": {
    title: "Hybrid — transcribe then answer",
    body: "The Speech-to-Text engine transcribes the interview audio, then the configured answer provider writes the response. With the defaults, Gemini listens and OpenAI answers. The answer fallback is used only if OpenAI fails before producing content.",
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
  const [modelEdits, setModelEdits] = useState<Record<string, { fast?: string; deep?: string; vision?: string }>>({});

  const saveKey = async (id: ProviderId, keyRef: string) => {
    const value = keys[keyRef];
    if (!value?.trim()) return;
    await bridge.setProviderKey(keyRef, value);
    setKeys((k) => ({ ...k, [keyRef]: "" }));
    setSaved(id);
    setTimeout(() => setSaved(null), 1800);
    await saveSettings(settings);
  };

  const saveModels = async (providerId: ProviderId) => {
    const edits = modelEdits[providerId] ?? {};
    await saveSettings({
      ...settings,
      providers: settings.providers.map((p) =>
        p.id === providerId
          ? {
              ...p,
              models: {
                ...p.models,
                ...(edits.fast ? { fast: edits.fast } : {}),
                ...(edits.deep ? { deep: edits.deep } : {}),
                ...(edits.vision ? { vision: edits.vision } : {}),
              },
            }
          : p,
      ),
    });
    setModelEdits((m) => ({ ...m, [providerId]: {} }));
    setSaved(`models-${providerId}`);
    setTimeout(() => setSaved(null), 1800);
  };

  return (
    <section className="space-y-8">
      <header>
        <h2 className="text-lg font-semibold">Providers &amp; routing</h2>
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
            label={settings.routing.mode === "hybrid-tier" ? "Answer fallback" : "Race primary"}
            value={settings.routing.primary}
            options={["gemini", "openai", "ollama"]}
            onChange={(primary) =>
              void saveSettings({ ...settings, routing: { ...settings.routing, primary: primary as ProviderId } })
            }
          />
          <Select
            label={settings.routing.mode === "hybrid-tier" ? "Answer provider" : "Race secondary"}
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
        hint="How long to wait for an answer provider to produce its first token before failing over."
        value={settings.routing.firstTokenTimeoutMs}
        min={500}
        max={8000}
        step={250}
        suffix="ms"
        onChange={(firstTokenTimeoutMs) =>
          void saveSettings({ ...settings, routing: { ...settings.routing, firstTokenTimeoutMs } })
        }
      />

      {/* ---------------- Appearance ---------------- */}
      <div className="space-y-2 border-t border-white/5 pt-6 mt-6">
        <h3 className="text-[13px] font-medium">Appearance</h3>
        <p className="text-[12px] text-white/40">
          Customize the UI accent color to match your preference.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={settings.accentColor || "#6ee7b7"}
            onChange={(e) => void saveSettings({ ...settings, accentColor: e.target.value })}
            className="h-8 w-14 cursor-pointer rounded bg-transparent p-0 border-0"
            title="Choose Accent Color"
          />
          <span className="font-mono text-[12px] text-white/60 uppercase">{settings.accentColor || "#6ee7b7"}</span>
        </div>
      </div>

      {/* ---------------- STT engine picker ---------------- */}
      <div className="space-y-2">
        <h3 className="text-[13px] font-medium">Speech-to-Text engine</h3>
        <p className="text-[12px] text-white/40">
          Which engine transcribes audio. <strong className="text-white/60">Auto</strong> tries Gemini → OpenAI Whisper → Local in order.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {([
            { value: "auto", label: "Auto (recommended)", desc: "Gemini → Whisper → Local" },
            { value: "gemini", label: "Gemini Flash", desc: "Fast, multimodal STT via API" },
            { value: "openai-whisper", label: "OpenAI Whisper", desc: "whisper-1 via API" },
            { value: "local-whisper", label: "Local Whisper", desc: "On-device, fully offline" },
          ] as const).map(({ value, label, desc }) => (
            <button
              key={value}
              onClick={() =>
                void saveSettings({ ...settings, audio: { ...settings.audio, sttEngine: value } })
              }
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                settings.audio.sttEngine === value
                  ? "border-accent/40 bg-accent/[0.07]"
                  : "border-white/5 bg-white/[0.02] hover:border-white/15",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium">{label}</span>
                {settings.audio.sttEngine === value && <Check className="h-3.5 w-3.5 text-accent" />}
              </div>
              <p className="mt-0.5 text-[11px] text-white/40">{desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ---------------- credentials + model names ---------------- */}
      <div className="space-y-3">
        <h3 className="text-[13px] font-medium">Credentials &amp; Models</h3>
        {settings.providers.map((provider) => {
          const keyRef = provider.keyRef ?? `${provider.id}_api_key`;
          const defaults = DEFAULT_MODELS[provider.id];
          const edits = modelEdits[provider.id] ?? {};
          const currentModels = {
            fast: provider.models?.fast ?? defaults?.fast ?? "",
            deep: provider.models?.deep ?? defaults?.deep ?? "",
            vision: provider.models?.vision ?? defaults?.vision ?? "",
          };
          return (
            <div key={provider.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[13px] font-medium capitalize">{provider.id}</span>
                  <p className="font-mono text-[11px] text-white/30">
                    fast: {currentModels.fast} · deep: {currentModels.deep}
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
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 font-mono text-[12px]"
                />
              ) : (
                <div className="flex gap-1.5">
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
                    {saved === provider.id ? "Saved ✓" : "Save"}
                  </button>
                </div>
              )}

              {/* Model name overrides */}
              <div className="space-y-1.5">
                <p className="text-[11px] text-white/35 font-medium uppercase tracking-widest">Model names</p>
                <div className="grid grid-cols-3 gap-2">
                  {(["fast", "deep", "vision"] as const).map((role) => (
                    <div key={role}>
                      <label className="block text-[10px] text-white/35 mb-0.5 capitalize">{role}</label>
                      <input
                        value={edits[role] ?? currentModels[role]}
                        onChange={(e) =>
                          setModelEdits((m) => ({
                            ...m,
                            [provider.id]: { ...(m[provider.id] ?? {}), [role]: e.target.value },
                          }))
                        }
                        placeholder={defaults?.[role] ?? role}
                        className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] placeholder:text-white/20"
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => void saveModels(provider.id)}
                  className="rounded-lg border border-white/10 px-3 py-1 text-[11px] text-white/50 hover:border-accent/40 hover:text-accent transition-colors"
                >
                  {saved === `models-${provider.id}` ? "Saved ✓" : "Apply model names"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------------- Target Company & Job Description Injection ---------------- */}
      <div className="rounded-xl border border-accent/20 bg-accent/[0.04] p-4 space-y-4">
        <div>
          <h3 className="text-[13px] font-semibold text-accent flex items-center gap-1.5">
            <Building2 className="h-4 w-4" /> Active Job Description & Company Value Injection
          </h3>
          <p className="mt-1 text-[12px] text-white/50 leading-relaxed">
            Enter your target company and job description / cultural values. The AI will dynamically align every live answer to match the company's culture and specific JD requirements.
          </p>
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
            <div>
              <label className="block text-[12px] font-medium text-white/70 mb-1">Target Role</label>
              <input
                type="text"
                maxLength={120}
                placeholder="e.g. Principal Cloud Architect"
                value={settings.targetRole}
                onChange={(e) => void saveSettings({ ...settings, targetRole: e.target.value })}
                className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-[13px] focus:border-accent/40 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-white/70 mb-1">Experience (Years)</label>
              <input
                type="number"
                min={0}
                max={60}
                value={settings.experienceYears}
                onChange={(e) => void saveSettings({ ...settings, experienceYears: Number(e.target.value) })}
                className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-[13px] focus:border-accent/40 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] font-medium text-white/70 mb-1">Target Company</label>
            <input
              type="text"
              placeholder="e.g. Microsoft, Amazon, Goldman Sachs"
              value={settings.targetCompany}
              onChange={(e) => void saveSettings({ ...settings, targetCompany: e.target.value })}
              className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-[13px] focus:border-accent/40 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[12px] font-medium text-white/70 mb-1">Job Description & Company Values</label>
            <textarea
              rows={3}
              placeholder="e.g. Principal Azure Architect - Focus on Zero Trust, FinOps cost management, Customer Obsession, and HA/DR resilience."
              value={settings.targetJd}
              onChange={(e) => void saveSettings({ ...settings, targetJd: e.target.value })}
              className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-[13px] focus:border-accent/40 focus:outline-none"
            />
          </div>
        </div>
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

      {/* ---------------- Export Bundle ---------------- */}
      <div className="space-y-2 border-t border-white/5 pt-6 mt-6">
        <h3 className="text-[13px] font-medium flex items-center gap-1.5">
          <Download className="h-4 w-4" /> Export Data Bundle
        </h3>
        <p className="text-[12px] text-white/40 mb-3">
          Download all your meetings, transcripts, and settings as a ZIP JSON bundle.
        </p>
        <button
          onClick={async () => {
            try {
              const path = await save({
                filters: [{ name: "Nexus Data Bundle", extensions: ["zip"] }],
                defaultPath: "nexus_data.zip",
              });
              if (path) {
                await invoke("export_bundle", { path });
                setSaved("export");
                setTimeout(() => setSaved(null), 2000);
              }
            } catch (e) {
              console.error("Export failed:", e);
              alert("Failed to export bundle");
            }
          }}
          className="flex h-8 w-fit items-center justify-center gap-2 rounded-lg border border-white/10 bg-black px-4 text-[12px] text-white transition-colors hover:bg-white/10"
        >
          {saved === "export" ? <Check className="h-4 w-4 text-accent" /> : "Save to ZIP"}
        </button>
      </div>

      {/* ---------------- Maintenance ---------------- */}
      <div className="space-y-2 border-t border-white/5 pt-6 mt-6">
        <h3 className="text-[13px] font-medium flex items-center gap-1.5">
          <Zap className="h-4 w-4" /> Clear Answer Cache
        </h3>
        <p className="text-[12px] text-white/40 mb-3">
          If the AI is returning an old or wrong answer instantly, clear the cache to force a fresh generation.
        </p>
        <button
          onClick={() => {
            clearQACache();
            setSaved("cache");
            setTimeout(() => setSaved(null), 2000);
          }}
          className="flex h-8 items-center justify-center gap-2 rounded-lg border border-white/10 bg-black px-4 w-fit text-[12px] text-white transition-colors hover:bg-white/10"
        >
          {saved === "cache" ? <Check className="h-4 w-4 text-accent" /> : "Clear Cache"}
        </button>
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
