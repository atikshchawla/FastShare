"use client";

import { Activity, FastForward } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui";
import { formatBytes, formatSeconds } from "@/lib/types";
import type { Snapshot } from "@/lib/types";

function percent(status: Snapshot): number {
  const t = status.total_packets || 1;
  return Math.min(100, (status.packets_acked / t) * 100);
}

export function TransferProgress({ status }: { status: Snapshot | null }) {
  const pct = status ? percent(status) : 0;
  const transferring = status?.transfer_status === "transferring";
  const completed = status?.transfer_status === "completed";

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Physical Buffer & Frame Transfer Progress"
        badgeText="BUFFER TELEMETRY"
        icon={<Activity size={20} className="stroke-[2.5]" />}
        right={
          <div className="flex items-center gap-3 font-mono">
            <span className="text-2xl sm:text-3xl font-black text-teal-800 font-tabular">
              {Math.round(pct)}%
            </span>
            <span className={`px-3 py-1 rounded-xl text-xs sm:text-sm font-extrabold border-2 ${
              completed
                ? "bg-emerald-50 text-emerald-900 border-emerald-300"
                : transferring
                ? "bg-teal-50 text-teal-900 border-teal-300 animate-pulse"
                : "bg-slate-100 text-slate-700 border-slate-200"
            }`}>
              {completed ? "COMPLETE" : transferring ? "STREAMING" : "STANDBY"}
            </span>
          </div>
        }
      />

      <div className="p-6 space-y-5 font-mono">
        {/* Physical Segmented Progress Track with Modern Shimmer */}
        <div className="h-7 rounded-xl border-2 border-slate-200/90 bg-slate-100 p-1 shadow-inner relative overflow-hidden">
          <div
            className={`h-full rounded-lg transition-all duration-300 relative ${
              completed
                ? "bg-emerald-600"
                : transferring
                ? "bg-gradient-to-r from-teal-700 to-teal-500 animate-shimmer"
                : "bg-slate-300"
            }`}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>

        {/* Resumed Checkpoint Banner */}
        {(status?.resumed_from_seq ?? 0) > 0 && (
          <div className="rounded-xl border-2 border-orange-300 bg-orange-50/90 p-4 text-xs sm:text-sm font-bold text-orange-950 flex items-center gap-2.5 shadow-xs">
            <FastForward size={18} className="text-orange-600 shrink-0" />
            <div>
              <span className="uppercase font-extrabold">Session Resumed at Packet #{(status?.resumed_from_seq ?? 0) + 1}</span>
              <span className="text-orange-800 font-medium ml-1.5">— {formatBytes(status?.resumed_bytes ?? 0)} re-used from disk.</span>
            </div>
          </div>
        )}

        {/* Telemetry info row in clean technical cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t-2 border-slate-100 pt-4 text-xs sm:text-sm">
          <div className="rounded-xl bg-slate-50/80 border-2 border-slate-100 p-3.5">
            <span className="text-[11px] uppercase font-bold text-slate-500 block">Confirmed Bytes:</span>
            <span className="font-extrabold text-slate-900 text-base mt-1 block font-tabular">
              {formatBytes(status?.confirmed_bytes ?? 0)} <span className="text-slate-400 font-normal">/</span> {formatBytes(status?.file_size ?? 0)}
            </span>
          </div>

          <div className="rounded-xl bg-teal-50/50 border-2 border-teal-100 p-3.5">
            <span className="text-[11px] uppercase font-bold text-teal-800 block">Frames Confirmed:</span>
            <span className="font-extrabold text-teal-900 text-base mt-1 block font-tabular">
              {status?.packets_acked ?? 0} <span className="text-teal-400 font-normal">/</span> {status?.total_packets ?? 0} frames
            </span>
          </div>

          <div className="rounded-xl bg-slate-50/80 border-2 border-slate-100 p-3.5">
            <span className="text-[11px] uppercase font-bold text-slate-500 block">Elapsed Time:</span>
            <span className="font-extrabold text-slate-900 text-base mt-1 block font-tabular">
              {formatSeconds(status?.elapsed_seconds ?? 0)}s elapsed
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}