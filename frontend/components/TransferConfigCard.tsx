"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Save, SlidersHorizontal } from "lucide-react";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
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

  // Anti-clobber behavior: the 500ms status poll rebuilds `config` on every
  // tick. Once the user edits, stop re-syncing so typing is never wiped.
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
      return "UDP port must be a number between 1 and 65535.";
    const size = Number(form.packet_size);
    if (!Number.isInteger(size) || size < 64 || size > 60000)
      return "Packet size must be between 64 and 60000 bytes.";
    const to = Number(form.timeout_ms);
    if (!Number.isInteger(to) || to < 50 || to > 5000)
      return "Timeout must be between 50 and 5000 ms.";
    const retries = Number(form.max_retries);
    if (!Number.isInteger(retries) || retries < 1 || retries > 20)
      return "Max retries must be between 1 and 20.";
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

  const field = (
    label: string,
    value: string | number,
    onChange: (v: string) => void,
    unit?: string,
    disabled?: boolean,
    hint?: string,
  ) => (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wider text-slate-500">
        {label}
        {hint && <span className="ml-1.5 normal-case text-slate-600">{hint}</span>}
      </span>
      <div className="relative">
        <input
          value={value}
          disabled={disabled}
          onFocus={() => !dirty && setDirty(true)}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "w-full rounded-md border border-slate-800 bg-[#0a0f1a] px-3 py-2",
            "font-mono text-[13px] text-slate-100 outline-none transition",
            "focus:border-cyan-500/60",
            disabled && "cursor-not-allowed opacity-60",
          )}
        />
        {unit && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-slate-600">
            {unit}
          </span>
        )}
      </div>
    </label>
  );

  return (
    <Panel>
      <PanelHeader
        title="Transfer Configuration"
        icon={<SlidersHorizontal size={14} />}
        right={
          <div className="flex items-center gap-2">
            {savedFlash && (
              <Badge tone="green">
                <Check size={11} /> Saved
              </Badge>
            )}
            {dirty && !savedFlash && <Badge tone="amber">unsaved edits</Badge>}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 p-4">
        {field("Server IP", form.server_ip, (v) => setText("server_ip", v))}
        {field(
          "UDP Port",
          form.udp_port,
          (v) => setNum("udp_port", v),
          undefined,
          undefined,
          "1–65535",
        )}
        {field(
          "Packet Size",
          form.packet_size,
          (v) => setNum("packet_size", v),
          "bytes",
          undefined,
          "64–60000",
        )}
        {field(
          "Timeout",
          form.timeout_ms,
          (v) => setNum("timeout_ms", v),
          "ms",
          undefined,
          "50–5000",
        )}
        {field(
          "Max Retries",
          form.max_retries,
          (v) => setNum("max_retries", v),
          undefined,
          undefined,
          "1–20",
        )}
        <div className="col-span-2">
          {field(
            "Window Size",
            form.window_size,
            (v) => setNum("window_size", v),
            undefined,
            true,
          )}
          <p className="mt-2 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-1.5 text-[11px] text-slate-500">
            Window locked to <span className="font-mono text-cyan-300">1</span>{" "}
            → <span className="text-slate-300">Stop-and-Wait ARQ</span>.
            Sliding window is a planned improvement.
          </p>
        </div>
      </div>

      {error && (
        <div className="mx-4 mb-3 flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-300">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-800/70 px-4 py-3">
        <div className="flex items-center gap-2">
          {serverRunning ? (
            <Badge tone="amber">receiver running</Badge>
          ) : (
            <Badge tone="slate">receiver stopped</Badge>
          )}
          <span className="hidden text-[11px] text-slate-600 xl:block">
            Port applies on restart · packet size, timeout &amp; retries apply to
            the next transfer
          </span>
        </div>
        <button
          onClick={() => void save()}
          disabled={busy}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40",
            "bg-cyan-500/10 px-3 py-1.5 text-[12px] font-semibold text-cyan-300",
            "transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <Save size={13} /> Apply Settings
        </button>
      </div>
    </Panel>
  );
}