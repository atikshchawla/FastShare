"use client";

import { useEffect, useReducer, useRef } from "react";
import {
  PATH_STATE_FILL,
  PATH_STATE_STROKE,
  buildCanvasGraph,
  laneIds,
  lanePath,
  laneStates,
} from "@/lib/canvas";
import { buildTimings, posAlong, sum, type Polyline } from "@/lib/anim";
import type { TopologySnapshot } from "@/lib/topology";
import type { PacketEvent, Snapshot } from "@/lib/types";

/**
 * Event-driven packet animation (plan §2). Sprites are driven 1:1 by the
 * backend's append-only transition stream (`events`, each with a monotonic
 * `id` the layer draws exactly once) — no more sampling a latest-status
 * table, so fast transitions (TIMEOUT -> RETRANSMITTED) actually render:
 *
 *  - SENT/WAITING  → spawn a DATA dot at the source; it travels the lane
 *                    polyline the scheduler picked (segment times
 *                    proportional to each link's latency, normalized to
 *                    ~900 ms total),
 *  - ACKED         → the dot completes at the dest, an ACK dot travels
 *                    back on the same lane (ACKs mirror the path),
 *  - TIMEOUT       → the dot turns red, fades in place (+ red ✕ flash),
 *  - RETRANSMITTED → a fresh DATA dot spawns with a `#seq ×n` retry label
 *                    (it may already be on a healthier lane),
 *  - anything but `transferring` → all dots drain and the layer idles.
 *
 * While multiple lanes exist each DATA dot carries its lane letter (A/B/C)
 * so the scheduler's shifting is visible mid-flight. `speed < 1` runs the
 * whole animation in slow-mo (transport is unaffected; at most 5 DATA dots
 * stay alive so a ¼× crawl remains legible).
 *
 * Dedupe by event `id` (`lastIdRef`) keeps every transition single-draw even
 * if React re-runs the ingest effect for a non-events reason.
 */

type Point = { x: number; y: number };
type Path = Polyline;

interface Sprite {
  /** Stable identity: survives splices so React never remounts by index. */
  id: number;
  seq: number;
  retries: number;
  dir: "data" | "ack";
  phase: "travel" | "hold" | "timeout";
  startedAt: number;
  timings: number[];
  path: Path;
  /** Scheduler lane this sprite travelled (ACK mirrors the DATA lane). */
  lane: number;
  /** Dot fill: the path state's colour (green/blue/red), white for ACK. */
  fill: string;
  /** Matching stroke colour for the hold pulse. */
  strokeCls: string;
  /** Lane letter drawn next to DATA dots while multiple lanes exist. */
  letter: string | null;
  ackSeen: boolean;
  timeoutAt: number;
  pos: Point;
}

interface Blast {
  /** Stable identity (same reason as Sprite.id). */
  id: number;
  x: number;
  y: number;
  at: number;
}

const DATA_TOTAL = 900;
const ACK_TOTAL = 700;
const TIMEOUT_FADE = 600;
const BLAST_FADE = 800;
const TRAIL_STEPS = [50, 100, 150];

export function PacketLayer({
  topology,
  status,
  events,
  speed,
}: {
  topology: TopologySnapshot | null;
  status: Snapshot | null;
  /** Append-only packet transitions since the last poll (id-ordered). */
  events: PacketEvent[];
  /** Animation speed: 1 = real time, <1 = slow-mo (visual only — the
   *  transport keeps running at full speed; sprites just crawl). */
  speed?: number;
}) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const spritesRef = useRef<Sprite[]>([]);
  const blastsRef = useRef<Blast[]>([]);
  /** Monotonic id source: every sprite/blast keeps a stable React key. */
  const nextIdRef = useRef(1);
  /** Highest event id already drawn — every transition renders exactly once. */
  const lastIdRef = useRef(0);
  const latestRef = useRef({ topology, status, events, speed });
  latestRef.current = { topology, status, events, speed };

  /** 1/slowdown factor: 1 at real time, 4 at ¼× … */
  const slowK = () => 1 / (latestRef.current.speed || 1);

  const spawnAck = (seq: number, retries: number, at: number, lane: number) => {
    const { topology, status } = latestRef.current;
    const graph = buildCanvasGraph(topology, status);
    const ids = laneIds(graph, lane);
    const revPts = lanePath(graph, lane);
    if (!revPts) return;
    const rev = [...revPts].reverse();
    spritesRef.current.push({
      id: nextIdRef.current++,
      seq,
      retries,
      dir: "ack",
      phase: "travel",
      startedAt: at,
      timings: buildTimings(graph, ids ?? [], ACK_TOTAL * slowK(), true),
      path: rev,
      lane,
      fill: "fill-white",
      strokeCls: "stroke-green-400",
      letter: null,
      ackSeen: true,
      timeoutAt: 0,
      pos: rev[0],
    });
  };

  // ------------------------------------------------------------- ingest
  useEffect(() => {
    const { status, events, topology } = latestRef.current;
    const transferring = status?.transfer_status === "transferring";
    if (!transferring) {
      if (spritesRef.current.length || lastIdRef.current) {
        spritesRef.current = [];
        lastIdRef.current = 0;
      }
      return;
    }

    const graph = buildCanvasGraph(topology, status);
    const states = laneStates(status?.scheduler ?? null, graph);
    const now = performance.now();
    const sprites = spritesRef.current;

    const activeData = (seq: number) =>
      sprites.find(
        (s) => s.dir === "data" && s.seq === seq && s.phase !== "timeout",
      );

    const spawnData = (spec: {
      seq: number;
      retries: number;
      lane?: number | null;
    }) => {
      const lane = spec.lane ?? 0;
      const ids = laneIds(graph, lane);
      const path = lanePath(graph, lane);
      if (!ids || !path) return;
      // slow-mo: keep at most 5 DATA dots alive so a ¼× crawl stays legible
      const slow = (latestRef.current.speed ?? 1) < 1;
      if (
        slow &&
        sprites.filter((sp) => sp.dir === "data").length >= 5
      )
        return;
      const state = states[lane] ?? "candidate";
      sprites.push({
        id: nextIdRef.current++,
        seq: spec.seq,
        retries: spec.retries,
        dir: "data",
        phase: "travel",
        startedAt: now,
        timings: buildTimings(graph, ids, DATA_TOTAL * slowK(), false),
        path,
        lane,
        fill: PATH_STATE_FILL[state],
        strokeCls: PATH_STATE_STROKE[state],
        letter:
          graph.paths.length > 1
            ? String.fromCharCode(65 + (lane % 26))
            : null,
        ackSeen: false,
        timeoutAt: 0,
        pos: path[0],
      });
    };

    // Events arrive id-ordered and gap-free (cursor drain); draw each once.
    for (const e of events) {
      if (e.id <= lastIdRef.current) continue;
      lastIdRef.current = e.id;
      const seq = e.seq;

      switch (e.status) {
        case "SENT":
        case "WAITING": {
          if (!activeData(seq))
            spawnData({ seq, retries: e.retries, lane: e.lane });
          break;
        }
        case "ACKED": {
          const data = activeData(seq);
          if (data) data.ackSeen = true;
          else spawnAck(seq, e.retries, now, e.lane ?? 0);
          break;
        }
        case "TIMEOUT":
        case "FAILED": {
          const data = activeData(seq);
          if (data) {
            const elapsed = now - data.startedAt;
            data.pos =
              posAlong(data.path, data.timings, elapsed) ??
              data.path[data.path.length - 1];
            data.phase = "timeout";
            data.timeoutAt = now;
            blastsRef.current.push({
              id: nextIdRef.current++,
              x: data.pos.x,
              y: data.pos.y,
              at: now,
            });
          }
          break;
        }
        case "RETRANSMITTED": {
          const idx = sprites.findIndex(
            (s) => s.dir === "data" && s.seq === seq,
          );
          if (idx >= 0) sprites.splice(idx, 1);
          spawnData({ seq, retries: e.retries, lane: e.lane });
          break;
        }
      }
    }
  }, [events, status?.transfer_status]);

  // ------------------------------------------------- frame loop + prune
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const sprites = spritesRef.current;
      const blasts = blastsRef.current;
      const k = 1 / (latestRef.current.speed || 1);
      let changed = false;

      for (let i = sprites.length - 1; i >= 0; i--) {
        const s = sprites[i];
        const dur = sum(s.timings);
        const elapsed = now - s.startedAt;

        if (s.dir === "data" && s.phase === "travel") {
          if (elapsed >= dur) {
            if (s.ackSeen) {
              sprites.splice(i, 1);
              spawnAck(s.seq, s.retries, now, s.lane);
            } else {
              s.phase = "hold";
              s.pos = s.path[s.path.length - 1];
            }
            changed = true;
          } else {
            s.pos = posAlong(s.path, s.timings, elapsed) ?? s.pos;
          }
        } else if (s.dir === "data" && s.phase === "hold" && s.ackSeen) {
          sprites.splice(i, 1);
          spawnAck(s.seq, s.retries, now, s.lane);
          changed = true;
        } else if (
          s.phase === "timeout" &&
          now - s.timeoutAt > TIMEOUT_FADE * k
        ) {
          sprites.splice(i, 1);
          changed = true;
        } else if (s.dir === "ack" && elapsed >= dur) {
          sprites.splice(i, 1);
          changed = true;
        }
      }

      for (let i = blasts.length - 1; i >= 0; i--) {
        if (now - blasts[i].at > BLAST_FADE * k) {
          blasts.splice(i, 1);
          changed = true;
        }
      }

      if (changed || sprites.length || blasts.length) tick();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ------------------------------------------------------------- render
  const now = performance.now();
  const sprites = spritesRef.current;
  const k = 1 / (speed || 1);

  return (
    <g className="pointer-events-none">
      {sprites.map((s) => {
        const elapsed = now - s.startedAt;
        const isData = s.dir === "data";

        let x = s.pos.x;
        let y = s.pos.y;
        let opacity = 1;
        const colorClass = s.phase === "timeout" ? "fill-red-500" : s.fill;

        if (s.phase === "travel") {
          const p = posAlong(s.path, s.timings, elapsed);
          if (p) {
            x = p.x;
            y = p.y;
          }
        } else if (s.phase === "timeout") {
          opacity = Math.max(0, 1 - (now - s.timeoutAt) / (TIMEOUT_FADE * k));
        }

        const trail =
          s.phase === "travel"
            ? TRAIL_STEPS.map((step, j) => {
                const tp = posAlong(s.path, s.timings, elapsed - step * k);
                if (!tp) return null;
                return (
                  <circle
                    key={j}
                    cx={tp.x}
                    cy={tp.y}
                    r={5 - j}
                    className={colorClass}
                    opacity={0.3 - j * 0.09}
                  />
                );
              })
            : null;

        return (
          <g key={s.id} opacity={opacity}>
            {trail}
            <circle
              cx={x}
              cy={y}
              r={isData ? 6 : 5}
              className={colorClass}
              stroke="#000"
              strokeWidth={1.5}
            />
            {s.phase === "hold" && (
              <circle
                cx={x}
                cy={y}
                r={9}
                className={`fill-none ${s.strokeCls}`}
                strokeWidth={1.5}
                opacity={0.6}
              >
                <animate
                  attributeName="r"
                  values="7;12;7"
                  dur={`${k}s`}
                  repeatCount="indefinite"
                />
              </circle>
            )}
            {isData && s.retries > 0 && (
              <text
                x={x}
                y={y - 12}
                textAnchor="middle"
                className="fill-amber-400 font-mono text-[10px] font-black"
              >
                {`#${s.seq} ×${s.retries + 1}`}
              </text>
            )}
            {isData && s.letter && (
              <text
                x={x + 11}
                y={y + 4}
                textAnchor="middle"
                className={`${colorClass} font-mono text-[9px] font-black`}
              >
                {s.letter}
              </text>
            )}
            {!isData && (
              <text
                x={x}
                y={y - 11}
                textAnchor="middle"
                className="fill-white font-mono text-[9px] font-black"
              >
                ACK
              </text>
            )}
          </g>
        );
      })}

      {blastsRef.current.map((b) => {
        const age = now - b.at;
        if (age > BLAST_FADE * k) return null;
        return (
          <text
            key={b.id}
            x={b.x}
            y={b.y + 4}
            textAnchor="middle"
            className="fill-red-500 font-mono text-[14px] font-black"
            opacity={1 - age / (BLAST_FADE * k)}
          >
            ✕
          </text>
        );
      })}
    </g>
  );
}
