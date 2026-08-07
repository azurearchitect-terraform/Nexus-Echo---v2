import { useEffect, useState } from "react";
import { Puzzle, ShieldAlert } from "lucide-react";
import { pluginHost, type LoadedPlugin } from "@/lib/plugins";
import { Toggle } from "./SettingsPanel";

export function PluginsPanel() {
  const [plugins, setPlugins] = useState<LoadedPlugin[]>([]);

  useEffect(() => {
    setPlugins(pluginHost.list());
  }, []);

  const toggle = (id: string, enabled: boolean) => {
    pluginHost.setEnabled(id, enabled);
    setPlugins(pluginHost.list());
  };

  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold">Plugins</h2>
        <p className="text-[13px] text-white/40">
          Plugins extend Nexus with new commands, transcript processors, and answer post-processors.
          Each one declares the permissions it needs up front and is denied anything it did not ask for.
        </p>
      </header>

      <ul className="space-y-2">
        {plugins.map((plugin) => (
          <li key={plugin.manifest.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
            <div className="flex items-start gap-3">
              <Puzzle className="mt-0.5 h-4 w-4 shrink-0 text-white/30" />
              <div className="flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-medium">{plugin.manifest.name}</span>
                  <span className="font-mono text-[11px] text-white/30">v{plugin.manifest.version}</span>
                </div>
                <p className="mt-0.5 text-[12px] text-white/45">{plugin.manifest.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {plugin.manifest.permissions.map((permission) => (
                    <span
                      key={permission}
                      className="flex items-center gap-1 rounded border border-warn/20 bg-warn/10 px-1.5 py-0.5 text-[10px] text-warn/90"
                    >
                      <ShieldAlert className="h-2.5 w-2.5" />
                      {permission}
                    </span>
                  ))}
                </div>
              </div>
              <Toggle checked={plugin.enabled} onChange={(v) => toggle(plugin.manifest.id, v)} />
            </div>
          </li>
        ))}
      </ul>

      {plugins.length === 0 && (
        <p className="rounded-xl border border-dashed border-white/10 p-8 text-center text-[13px] text-white/30">
          No plugins loaded.
        </p>
      )}
    </section>
  );
}
