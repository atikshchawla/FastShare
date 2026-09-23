"use client";

import { Flame } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatBytes, formatSeconds } from "@/lib/types";
import type { Snapshot } from "@/lib/types";

function percent(status: Snapshot): number {
  const t = status.total_packets || 1;
  return Math.min(100, (status.packets_acked / t) * 100);
}

export function TransferProgress({ status }: { status: Snapshot | null }) {
  const pct = status ? percent(status) : 0;
  const transferring = status?.transfer_status === "transferring";

  return (
    <Panel>
      <PanelHeader
        title="Transfer Progress"
        icon={<Flame size={14} />}
        right={
          status ? (
            <span
              className={cn(
                "font-mono text-xl font-bold",
                transferring ? "text-cyan-300" : "text-slate-200",
              )}
            >
              {Math.round(pct)}%
            </span>
          ) : (
            <span className="font-mono text-xl text-slate-600">--%</span>
          )
        }
      />
      <div className="p-4">
        <div className="h-3 overflow-hidden rounded-full border border-slate-800 bg-[#070b12]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-[width] duration-300"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 font-mono text-[12px]">
          <span className="text-slate-400">
            <span className="text-slate-200">
              {formatBytes(status?.confirmed_bytes ?? 0)}
            </span>{" "}
            / {formatBytes(status?.file_size ?? 0)}
          </span>
          <span className="text-slate-400">
            Packet{" "}
            <span className="text-slate-200">
              {status?.packets_acked ?? 0}
            </span>{" "}
            / {status?.total_packets ?? 0}
          </span>
          <span className="text-slate-500">
            {formatSeconds(status?.elapsed_seconds ?? 0)}s
          </span>
        </div>

        {!status && (
          <p className="mt-2 text-[11px] text-slate-600">
            waiting for controller
          </p>
        )}
      </div>
    </Panel>
  );
}