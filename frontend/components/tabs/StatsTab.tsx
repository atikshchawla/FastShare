"use client";

import { Activity, Shuffle } from "lucide-react";
import { NetworkingStats } from "@/components/NetworkingStats";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import { PATH_STATE_HEX, schedulerLaneStates } from "@/lib/canvas";
import { formatBytes, formatSeconds } from "@/lib/format";
import type { SchedulerState } from "@/lib/topology";
import type { Snapshot } from "@/lib/types";

const MODE_HINT: Record<SchedulerState["mode"], string> = {
  explore: "exploring every lane (fresh view before judging)",
  round_robin: "even split while the rolling windows fill",
  weighted: "weighted by lane health — probes keep flagged lanes visible",
  single: "single path — no lane choice to make",
  disabled: "scheduler off — traffic stays on the route",
};

const MODE_TONE = {
  explore: "cyan",
  round_robin: "amber",
  weighted: "green",
  single: "slate",
  disabled: "slate",
} as const;

function percent(status: Snapshot): number {
  const t = status.total_packets || 1;
  return Math.min(100, (status.packets_acked / t) * 100);
}

/** Progress bar + byte/frames/elapsed readout (formerly TransferProgress). */
function ProgressPanel({ status }: { status: Snapshot | null }) {
  const pct = status ? percent(status) : 0;
  const transferring = status?.transfer_status === "transferring";
  const completed = status?.transfer_status === "completed";

  return (
    <Panel>
      <PanelHeader
        title="Progress"
        icon={<Activity size={15} />}
        right={
          <span className="font-mono text-sm font-black text-cyan-400">
            {Math.round(pct)}%
          </span>
        }
      />

      <div className="space-y-2 p-2.5 font-mono">
        <div className="h-4 border-2 border-neutral-700 bg-neutral-950 p-0.5">
          <div
            className={`h-full transition-all duration-300 ${
              completed ? "bg-green-500" : transferring ? "bg-cyan-400" : "bg-neutral-700"
            }`}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>

        {(status?.resumed_from_seq ?? 0) > 0 && (
          <div className="border-2 border-amber-500/60 bg-amber-950/20 px-2 py-1.5 text-[11px] font-bold text-amber-300">
            ⏩ Resumed at #{(status?.resumed_from_seq ?? 0) + 1} —{" "}
            {formatBytes(status?.resumed_bytes ?? 0)} reused, not re-sent
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 border-2 border-neutral-800 bg-neutral-950 p-2 text-xs">
          <div>
            <span className="block text-[10px] font-bold uppercase text-neutral-500">
              Bytes
            </span>
            <span className="font-bold text-white">
              {formatBytes(status?.confirmed_bytes ?? 0)} /{" "}
              {formatBytes(status?.file_size ?? 0)}
            </span>
          </div>
          <div className="text-center">
            <span className="block text-[10px] font-bold uppercase text-neutral-500">
              Frames
            </span>
            <span className="font-bold text-cyan-300">
              {status?.packets_acked ?? 0} / {status?.total_packets ?? 0}
            </span>
          </div>
          <div className="text-right">
            <span className="block text-[10px] font-bold uppercase text-neutral-500">
              Elapsed
            </span>
            <span className="font-bold text-neutral-300">
              {formatSeconds(status?.elapsed_seconds ?? 0)}s
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/**
 * Source-side multipath scheduler readout (multi-path plan): one row per
 * lane with the rolling window-loss bar, weight share and FLAG badge. Null
 * before the first transfer.
 */
function PathsPanel({ status }: { status: Snapshot | null }) {
  const sched = status?.scheduler;
  if (!sched) return null;
  // same colour language as the canvas: green optimal / blue candidate /
  // red restricted (the loss bar keeps its own amber/red severity fill)
  const states = schedulerLaneStates(sched);

  return (
    <Panel>
      <PanelHeader
        title="Path scheduler"
        icon={<Shuffle size={15} />}
        right={
          <Badge tone={MODE_TONE[sched.mode]} className="px-2 py-0.5 font-mono text-[10px]">
            {sched.mode.replace("_", " ")}
          </Badge>
        }
      />
      <div className="space-y-2 p-2.5">
        <p className="font-mono text-[10px] text-neutral-500">
          {MODE_HINT[sched.mode]} · window {sched.window} · flag ≥
          {Math.round(sched.flag_loss * 100)}% · probe{" "}
          {Math.round(sched.probe_share * 100)}%
        </p>

        <div className="space-y-1.5">
          {sched.lanes.map((l) => {
            const lossPct = Math.round(l.window_loss * 100);
            const weightPct = Math.round(l.weight * 100);
            return (
              <div
                key={l.lane}
                className="flex items-center gap-2 border-2 border-neutral-800 bg-neutral-950 px-2 py-1.5"
              >
                <span
                  className="inline-block h-2 w-2 shrink-0"
                  style={{
                    backgroundColor:
                      PATH_STATE_HEX[states?.[l.lane] ?? "candidate"],
                  }}
                />
                <span className="w-12 shrink-0 font-mono text-[11px] font-black text-neutral-200">
                  {l.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-neutral-500">
                  {l.sent}↗ {l.lost}✕
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  <div className="h-2 w-16 shrink-0 border border-neutral-700 bg-neutral-900">
                    <div
                      className={`h-full ${l.flagged ? "bg-red-500" : "bg-amber-500"}`}
                      style={{ width: `${Math.min(100, lossPct)}%` }}
                    />
                  </div>
                  <span
                    className={`w-8 shrink-0 text-right font-mono text-[10px] font-bold ${
                      l.flagged ? "text-red-400" : "text-neutral-400"
                    }`}
                  >
                    {lossPct}%
                  </span>
                  {l.flagged ? (
                    <Badge tone="red" className="px-1.5 py-0 font-mono text-[9px]">
                      flag
                    </Badge>
                  ) : (
                    <Badge tone="slate" className="px-1.5 py-0 font-mono text-[9px]">
                      {weightPct}%
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

export function StatsTab({ status }: { status: Snapshot | null }) {
  return (
    <>
      <NetworkingStats status={status} />
      <ProgressPanel status={status} />
      <PathsPanel status={status} />
    </>
  );
}
