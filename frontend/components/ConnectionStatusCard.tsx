"use client";

import { Loader2, Network, Play, Square } from "lucide-react";
import { KeyValue, Panel, PanelHeader, StatusDot } from "@/components/ui";
import type { Snapshot } from "@/lib/types";

export function ConnectionStatusCard({
  status,
  busy,
  onStart,
  onStop,
}: {
  status: Snapshot | null;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const running = status?.server_status === "running";
  const error = status?.server_status === "error";

  const tone = running ? "green" : error ? "red" : "slate";
  const label = running ? "Connected" : error ? "Error" : "Disconnected";

  return (
    <Panel>
      <PanelHeader title="1 · Network Status" icon={<Network size={14} />} />
      <div className="px-4 pt-4">
        <div className="flex items-center gap-3">
          <StatusDot tone={tone} pulse={running} className="h-3 w-3" />
          <span className="text-lg font-semibold text-slate-100">{label}</span>
        </div>
        {!running && (
          <p className="mt-2 text-[12px] text-slate-500">
            The UDP receiver must be started before any transfer can run.
          </p>
        )}
        <div className="mt-3">
          {running ? (
            <button
              onClick={onStop}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-[12px] font-semibold text-rose-300 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Square size={11} />
              )}
              Stop Server
            </button>
          ) : (
            <button
              onClick={onStart}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-[12px] font-semibold text-emerald-300 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={11} />
              )}
              Start Server
            </button>
          )}
        </div>
      </div>
      <div className="divide-y divide-slate-800/60 px-4 pb-3 pt-1">
        <KeyValue
          label="Server"
          value={`${status?.config.server_ip ?? "127.0.0.1"}:${
            status?.server_port ?? 5001
          }`}
        />
        <KeyValue
          label="Protocol"
          value="UDP / Stop-and-Wait ARQ"
          accent
        />
        {error && status?.server_error && (
          <p className="pt-2 font-mono text-[11px] text-rose-400">
            {status.server_error}
          </p>
        )}
      </div>
    </Panel>
  );
}