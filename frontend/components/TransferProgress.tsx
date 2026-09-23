"use client";

import { Activity } from "lucide-react";
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
    <Panel>
      <PanelHeader
        title="TRANSFER PROGRESS & THROUGHPUT"
        icon={<Activity size={15} />}
        right={
          <span className="font-mono text-xl font-black text-cyan-400">
            {Math.round(pct)}%
          </span>
        }
      />
      
      <div className="p-4 space-y-3 font-mono">
        {/* Neo-brutalist progress track */}
        <div className="h-6 border-2 border-neutral-700 bg-neutral-950 p-0.5">
          <div
            className={`h-full transition-all duration-300 ${
              completed
                ? "bg-green-500"
                : transferring
                ? "bg-cyan-400"
                : "bg-neutral-700"
            }`}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>

        {/* Telemetry info row */}
        <div className="grid grid-cols-3 gap-2 border-2 border-neutral-800 bg-neutral-950 p-2 text-xs">
          <div>
            <span className="block text-[10px] font-bold text-neutral-500 uppercase">Bytes Confirmed</span>
            <span className="font-bold text-white">
              {formatBytes(status?.confirmed_bytes ?? 0)} / {formatBytes(status?.file_size ?? 0)}
            </span>
          </div>

          <div className="text-center">
            <span className="block text-[10px] font-bold text-neutral-500 uppercase">Frames ACKed</span>
            <span className="font-bold text-cyan-300">
              {status?.packets_acked ?? 0} / {status?.total_packets ?? 0}
            </span>
          </div>

          <div className="text-right">
            <span className="block text-[10px] font-bold text-neutral-500 uppercase">Elapsed Time</span>
            <span className="font-bold text-neutral-300">
              {formatSeconds(status?.elapsed_seconds ?? 0)}s
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}