"use client";

import { useEffect, useState } from "react";
import { Check, Save, SlidersHorizontal } from "lucide-react";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import type { Config } from "@/lib/types";

export function TransferConfigCard({
  config,
  serverRunning,
  busy,
  onSave,
}: {
  config: Config;
  serverRunning: boolean;
  busy: boolean;
  onSave: (cfg: Config) => Promise<boolean>;
}) {
  const [form, setForm] = useState<Config>(config);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setForm(config);
  }, [config, dirty]);

  const touch = () => {
    setDirty(true);
    setSavedFlash(false);
    setError(null);
  };

  const setText = (key: "server_ip", value: string) => {
    touch();
    setForm((f) => ({ ...f, [key]: value }) as Config);
  };

  const setNum = (key: Exclude<keyof Config, "server_ip">, value: string) => {
    touch();
    const cleaned = value.replace(/\D/g, "");
    setForm((f) => ({ ...f, [key]: cleaned }) as Config);
  };

  const validate = (): string | null => {
    const port = Number(form.udp_port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return "UDP port must be 1–65535.";
    const size = Number(form.packet_size);
    if (!Number.isInteger(size) || size < 64 || size > 60000)
      return "Packet size must be 64–60000 bytes.";
    const to = Number(form.timeout_ms);
    if (!Number.isInteger(to) || to < 50 || to > 5000)
      return "Timeout must be 50–5000 ms.";
    const retries = Number(form.max_retries);
    if (!Number.isInteger(retries) || retries < 1 || retries > 20)
      return "Max retries must be 1–20.";
    return null;
  };

  const save = async () => {
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }
    setError(null);
    const ok = await onSave({
      server_ip: form.server_ip,
      udp_port: Number(form.udp_port),
      packet_size: Number(form.packet_size),
      timeout_ms: Number(form.timeout_ms),
      window_size: 1,
      max_retries: Number(form.max_retries),
    });
    if (ok) {
      setDirty(false);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    }
  };

  return (
    <Panel>
      <PanelHeader
        title="TRANSFER SETTINGS"
        icon={<SlidersHorizontal size={15} />}
        right={
          <div className="flex items-center gap-2">
            <Badge tone={serverRunning ? "green" : "slate"}>
              {serverRunning ? "RECEIVER ACTIVE" : "RECEIVER IDLE"}
            </Badge>
            {savedFlash && (
              <Badge tone="green">
                <Check size={11} /> SAVED
              </Badge>
            )}
            {dirty && !savedFlash && <Badge tone="amber">EDITED</Badge>}
          </div>
        }
      />

      <div className="p-4">
        {/* Compact Grid */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 font-mono text-xs">
          <div className="border-2 border-neutral-700 bg-neutral-950 p-2">
            <span className="block text-[10px] font-bold text-neutral-500 uppercase">Server IP</span>
            <input
              value={form.server_ip}
              onChange={(e) => setText("server_ip", e.target.value)}
              className="mt-1 w-full bg-neutral-900 border border-neutral-700 px-2 py-1 text-xs font-bold text-white outline-none focus:border-cyan-400"
            />
          </div>

          <div className="border-2 border-neutral-700 bg-neutral-950 p-2">
            <span className="block text-[10px] font-bold text-neutral-500 uppercase">UDP Port</span>
            <input
              value={form.udp_port}
              onChange={(e) => setNum("udp_port", e.target.value)}
              className="mt-1 w-full bg-neutral-900 border border-neutral-700 px-2 py-1 text-xs font-bold text-white outline-none focus:border-cyan-400"
            />
          </div>

          <div className="border-2 border-neutral-700 bg-neutral-950 p-2">
            <span className="block text-[10px] font-bold text-neutral-500 uppercase">Packet Size</span>
            <div className="mt-1 flex items-center bg-neutral-900 border border-neutral-700 px-2 py-1">
              <input
                value={form.packet_size}
                onChange={(e) => setNum("packet_size", e.target.value)}
                className="w-full bg-transparent text-xs font-bold text-white outline-none"
              />
              <span className="text-[10px] text-neutral-500">B</span>
            </div>
          </div>

          <div className="border-2 border-neutral-700 bg-neutral-950 p-2">
            <span className="block text-[10px] font-bold text-neutral-500 uppercase">Timeout</span>
            <div className="mt-1 flex items-center bg-neutral-900 border border-neutral-700 px-2 py-1">
              <input
                value={form.timeout_ms}
                onChange={(e) => setNum("timeout_ms", e.target.value)}
                className="w-full bg-transparent text-xs font-bold text-white outline-none"
              />
              <span className="text-[10px] text-neutral-500">ms</span>
            </div>
          </div>

          <div className="border-2 border-neutral-700 bg-neutral-950 p-2">
            <span className="block text-[10px] font-bold text-neutral-500 uppercase">Max Retries</span>
            <input
              value={form.max_retries}
              onChange={(e) => setNum("max_retries", e.target.value)}
              className="mt-1 w-full bg-neutral-900 border border-neutral-700 px-2 py-1 text-xs font-bold text-white outline-none focus:border-cyan-400"
            />
          </div>

          <div className="border-2 border-neutral-700 bg-neutral-950 p-2 opacity-80">
            <span className="block text-[10px] font-bold text-neutral-500 uppercase">Window</span>
            <div className="mt-1 bg-neutral-900 border border-neutral-800 px-2 py-1 font-bold text-cyan-400">
              1 (Locked)
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-3 border-2 border-red-500 bg-red-500/10 p-2 font-mono text-[11px] font-bold text-red-400">
            {error}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <span className="font-mono text-[10px] text-neutral-500">
            * Window locked to 1 for Stop-and-Wait ARQ
          </span>
          <button
            onClick={() => void save()}
            disabled={busy || !dirty}
            className="flex items-center gap-1.5 border-2 border-cyan-500 bg-cyan-500/20 px-3 py-1 font-mono text-xs font-bold uppercase text-cyan-300 shadow-[2px_2px_0px_#000] hover:bg-cyan-500/30 disabled:opacity-40 cursor-pointer"
          >
            <Save size={13} />
            APPLY SETTINGS
          </button>
        </div>
      </div>
    </Panel>
  );
}