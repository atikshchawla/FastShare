"use client";

import { useEffect, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import { Badge } from "@/components/ui";
import {
  PATH_STATE_HEX,
  schedulerLaneStates,
  type PathState,
} from "@/lib/canvas";
import type { PacketEntry, Snapshot } from "@/lib/types";

/** Animation speed steps for the packet dots (slow-mo for demos). */
export const ANIM_SPEEDS = [0.25, 0.5, 1] as const;

/** How many recent lane picks the timeline strip shows. */
const TICKS = 56;

interface Marker {
  seq: number;
  kind: "flag" | "recover";
  lane: number;
  name: string;
}

const MODE_LABEL: Record<string, string> = {
  explore: "exploring",
  round_robin: "even split",
  weighted: "weighted",
  single: "single path",
  disabled: "off",
};

/**
 * Bottom-left demo HUD: animation speed (slow-mo), live per-lane health
 * (weight share + rolling loss + FLAG) and a pick-timeline strip — one
 * coloured tick per packet, in send order, with carets at the exact pick
 * where a lane flagged/recovered. Together with the red-dashed path on the
 * canvas this makes the *adaptive* shift visible: before the caret the
 * strip is mixed, after it the bad lane's colour dries up.
 */
export function PathSwitchHud({
  status,
  packets,
  speed,
  onSpeedChange,
}: {
  status: Snapshot | null;
  packets: PacketEntry[];
  speed: number;
  onSpeedChange: (speed: number) => void;
}) {
  const sched = status?.scheduler ?? null;
  const transferStatus = status?.transfer_status ?? null;
  const multi = !!sched && sched.enabled && sched.lanes.length > 1;
  // green optimal / blue candidate / red restricted (matches the canvas)
  const states = multi ? schedulerLaneStates(sched) : null;
  const stateOf = (lane: number): PathState =>
    states?.[lane] ?? "candidate";

  // packet rows that carried a lane (server order = oldest first)
  const picks = packets.filter((p) => p.lane !== undefined);
  const visible = picks.slice(-TICKS);

  const [markers, setMarkers] = useState<Marker[]>([]);
  const flagsRef = useRef<string | null>(null);
  const picksRef = useRef(picks);
  picksRef.current = picks;
  const prevTransferRef = useRef<string | null>(null);

  // a fresh transfer restarts seq numbering — drop the old markers and
  // re-baseline the flag state so no phantom transition is recorded
  useEffect(() => {
    const was = prevTransferRef.current;
    prevTransferRef.current = transferStatus;
    if (transferStatus === "transferring" && was !== "transferring") {
      setMarkers([]);
      flagsRef.current = null;
    }
  }, [transferStatus]);

  // record flag/recover transitions anchored to the next packet seq
  useEffect(() => {
    if (!sched) {
      flagsRef.current = null;
      return;
    }
    const key = sched.lanes.map((l) => (l.flagged ? "1" : "0")).join("");
    const prev = flagsRef.current;
    flagsRef.current = key;
    if (prev === null || prev === key) return;
    const rows = picksRef.current;
    const lastSeq = rows.length ? rows[rows.length - 1].seq : 0;
    const added: Marker[] = [];
    sched.lanes.forEach((l, i) => {
      const was = prev[i] === "1";
      if (l.flagged !== was) {
        added.push({
          seq: lastSeq + 1,
          kind: l.flagged ? "flag" : "recover",
          lane: i,
          name: l.name,
        });
      }
    });
    if (added.length) setMarkers((m) => [...m, ...added].slice(-8));
  }, [sched]);

  const markerIndex = (m: Marker) => visible.findIndex((p) => p.seq === m.seq);

  return (
    <div className="pointer-events-auto w-[17.5rem] border-2 border-neutral-700 bg-neutral-900/95 shadow-[3px_3px_0px_#000]">
      {/* header + slow-mo control */}
      <div className="flex items-center justify-between border-b-2 border-neutral-700 bg-neutral-800 px-2 py-1">
        <span className="flex items-center gap-1.5 font-mono text-[10px] font-black uppercase tracking-[0.15em] text-neutral-300">
          <Gauge size={11} className="text-cyan-400" />
          Path switching
        </span>
        {sched && (
          <Badge
            tone={
              sched.mode === "weighted" ? "green" : sched.mode === "explore" ? "cyan" : "slate"
            }
            className="px-1.5 py-0 font-mono text-[9px]"
          >
            {MODE_LABEL[sched.mode] ?? sched.mode}
          </Badge>
        )}
      </div>

      <div className="space-y-2 p-2">
        {/* animation speed (slow-mo) */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-500">
            Anim
          </span>
          <div className="flex border-2 border-neutral-700 font-mono text-[10px] font-black">
            {ANIM_SPEEDS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onSpeedChange(v)}
                className={`cursor-pointer border-r-2 border-neutral-700 px-2 py-0.5 last:border-r-0 transition ${
                  speed === v
                    ? "bg-cyan-500 text-black"
                    : "bg-neutral-950 text-neutral-400 hover:text-white"
                }`}
              >
                {v === 1 ? "1×" : v === 0.25 ? "¼×" : "½×"}
              </button>
            ))}
          </div>
          <span className="ml-auto font-mono text-[9px] text-neutral-600">
            {speed < 1 ? `slow-mo ${1 / speed}×` : "real time"}
          </span>
        </div>

        {multi && sched && (
          <>
            {/* live lane health */}
            <div className="space-y-1">
              {sched.lanes.map((l) => {
                const lossPct = Math.round(l.window_loss * 100);
                return (
                  <div key={l.lane} className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0"
                      style={{
                        backgroundColor: PATH_STATE_HEX[stateOf(l.lane)],
                      }}
                    />
                    <span className="w-3 shrink-0 font-mono text-[10px] font-black text-neutral-200">
                      {l.name}
                    </span>
                    <div
                      className="h-2 flex-1 border border-neutral-700 bg-neutral-950"
                      title={`${Math.round(l.weight * 100)}% of picks`}
                    >
                      <div
                        className="h-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, l.weight * 100)}%`,
                          backgroundColor: PATH_STATE_HEX[stateOf(l.lane)],
                        }}
                      />
                    </div>
                    <span
                      className={`w-9 shrink-0 text-right font-mono text-[9px] font-bold ${
                        l.flagged ? "text-red-400" : "text-neutral-400"
                      }`}
                    >
                      {lossPct}%
                    </span>
                    {l.flagged && (
                      <Badge tone="red" className="shrink-0 px-1 py-0 font-mono text-[8px]">
                        flag
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>

            {/* pick timeline: one tick per packet, oldest → newest */}
            <div>
              <div className="mb-0.5 flex items-baseline justify-between">
                <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-neutral-500">
                  Frames → lane
                </span>
                <span className="font-mono text-[9px] text-neutral-600">
                  last {visible.length}
                </span>
              </div>
              {visible.length === 0 ? (
                <p className="border border-dashed border-neutral-700 px-1.5 py-1 font-mono text-[9px] text-neutral-600">
                  no lane picks yet — start a transfer
                </p>
              ) : (
                <>
                  <div className="flex h-3.5 items-end gap-px border border-neutral-800 bg-neutral-950 px-0.5">
                    {visible.map((p) => (
                      <span
                        key={p.seq}
                        className="h-full w-[3px] shrink-0"
                        style={{
                          backgroundColor: PATH_STATE_HEX[
                            stateOf(p.lane ?? 0)
                          ],
                          opacity: 0.9,
                        }}
                        title={`#${p.seq} → lane ${String.fromCharCode(65 + (p.lane ?? 0))}`}
                      />
                    ))}
                  </div>
                  <div className="relative h-3">
                    {markers.map((m, i) => {
                      const idx = markerIndex(m);
                      if (idx < 0) return null;
                      return (
                        <span
                          key={`${m.seq}-${m.kind}-${i}`}
                          className="absolute top-0 -translate-x-1/2 font-mono text-[9px] font-black leading-none"
                          style={{
                            left: `${idx * 4 + 1.5}px`,
                            color: m.kind === "flag" ? "#f87171" : "#4ade80",
                          }}
                          title={`${m.kind === "flag" ? "FLAGGED" : "recovered"} at packet #${m.seq}`}
                        >
                          {m.kind === "flag" ? "▼" : "▲"}
                        </span>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <p className="font-mono text-[9px] leading-snug text-neutral-600">
              bar = share of picks · green = optimal · blue = candidate ·
              red = restricted · ▼ = flagged here → traffic shifted
            </p>
          </>
        )}
      </div>
    </div>
  );
}
