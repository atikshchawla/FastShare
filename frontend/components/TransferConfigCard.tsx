"use client";

import { useEffect, useState } from "react";
import { Save, SlidersHorizontal, CheckCircle2 } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui";
import type { Config } from "@/lib/types";

export function TransferConfigCard({
  config,
  busy,
  onSave,
}: {
  config: Config;
  serverRunning?: boolean;
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
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Protocol Tuning & Socket Parameters"
        badgeText="CONFIGURATION"
        icon={<SlidersHorizontal size={20} className="stroke-[2.5]" />}
        right={
          <div className="flex items-center gap-2 font-mono text-xs sm:text-sm">
            {savedFlash && (
              <span className="flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-900 font-extrabold px-2.5 py-1">
                <CheckCircle2 size={14} className="text-emerald-600" />
                <span>SAVED</span>
              </span>
            )}
            {dirty && !savedFlash && (
              <span className="rounded-lg bg-amber-50 border border-amber-300 text-amber-900 font-extrabold px-2.5 py-1">
                EDITED
              </span>
            )}
          </div>
        }
      />

      <div className="p-6 font-mono space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs sm:text-sm font-extrabold text-slate-700 block mb-1.5 uppercase">
              Target IP Address
            </label>
            <input
              type="text"
              value={form.server_ip}
              onChange={(e) => setText("server_ip", e.target.value)}
              className="w-full rounded-xl border-2 border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-hidden transition-colors"
            />
          </div>

          <div>
            <label className="text-xs sm:text-sm font-extrabold text-slate-700 block mb-1.5 uppercase">
              UDP Socket Port
            </label>
            <input
              type="text"
              value={form.udp_port}
              onChange={(e) => setNum("udp_port", e.target.value)}
              className="w-full rounded-xl border-2 border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-hidden transition-colors font-tabular"
            />
          </div>

          <div>
            <label className="text-xs sm:text-sm font-extrabold text-slate-700 block mb-1.5 uppercase">
              Packet MSS Size (Bytes)
            </label>
            <input
              type="text"
              value={form.packet_size}
              onChange={(e) => setNum("packet_size", e.target.value)}
              className="w-full rounded-xl border-2 border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-hidden transition-colors font-tabular"
            />
          </div>

          <div>
            <label className="text-xs sm:text-sm font-extrabold text-slate-700 block mb-1.5 uppercase">
              ARQ Retransmit Timeout (ms)
            </label>
            <input
              type="text"
              value={form.timeout_ms}
              onChange={(e) => setNum("timeout_ms", e.target.value)}
              className="w-full rounded-xl border-2 border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-hidden transition-colors font-tabular"
            />
          </div>

          <div>
            <label className="text-xs sm:text-sm font-extrabold text-slate-700 block mb-1.5 uppercase">
              Max ARQ Retries
            </label>
            <input
              type="text"
              value={form.max_retries}
              onChange={(e) => setNum("max_retries", e.target.value)}
              className="w-full rounded-xl border-2 border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-900 focus:border-teal-600 focus:bg-white focus:outline-hidden transition-colors font-tabular"
            />
          </div>

          <div>
            <label className="text-xs sm:text-sm font-extrabold text-slate-700 block mb-1.5 uppercase">
              ARQ Window Size
            </label>
            <input
              type="text"
              disabled
              value="1 (Stop-and-Wait Lockstep)"
              className="w-full rounded-xl border-2 border-slate-200 bg-slate-100 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-slate-500 cursor-not-allowed"
            />
          </div>
        </div>

        {error && (
          <p className="rounded-xl border-2 border-rose-200 bg-rose-50 p-3 text-xs sm:text-sm font-bold text-rose-700">
            {error}
          </p>
        )}

        <button
          onClick={save}
          disabled={!dirty || busy}
          className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-xs sm:text-sm font-extrabold uppercase transition-all shadow-xs ${
            dirty && !busy
              ? "bg-orange-600 text-white hover:bg-orange-500 cursor-pointer shadow-orange-600/20"
              : "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
          }`}
        >
          <Save size={16} />
          <span>[ Save Socket Parameters ]</span>
        </button>
      </div>
    </Panel>
  );
}