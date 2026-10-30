/**
 * Pure animation math for the packet canvas (P1-14 extraction): where a dot
 * is along its polyline after `elapsed` ms, and how to split a hop chain's
 * duration across segments proportionally to each link's simulated latency.
 *
 * Kept DOM-free so the frontend test suite can cover it directly.
 */

import type { CanvasGraph } from "./canvas";

export interface Point {
  x: number;
  y: number;
}
export type Polyline = Point[];

export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Position along `path` after `elapsed` ms (null on degenerate input). */
export function posAlong(
  path: Polyline,
  timings: number[],
  elapsed: number,
): Point | null {
  if (path.length < 2 || timings.length === 0) return null;
  let t = Math.max(0, elapsed);
  for (let i = 0; i < timings.length; i++) {
    const seg = timings[i];
    if (t <= seg || i === timings.length - 1) {
      const frac = seg <= 0 ? 1 : Math.min(1, t / seg);
      return lerp(path[i], path[i + 1], frac);
    }
    t -= seg;
  }
  return null;
}

/** Total duration of a segment chain. */
export function sum(timings: number[]): number {
  return timings.reduce((a, b) => a + b, 0);
}

/**
 * Per-segment durations proportional to each link's simulated latency,
 * normalized so the whole hop chain stays legible (700–900 ms).
 */
export function buildTimings(
  graph: CanvasGraph,
  ids: string[],
  target: number,
  reverse: boolean,
): number[] {
  const weights: number[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    const a = ids[i];
    const b = ids[i + 1];
    const link = graph.links.find(
      (l) => (l.a === a && l.b === b) || (l.a === b && l.b === a),
    );
    weights.push(Math.max(1, link?.stats?.latency_ms ?? 10));
  }
  if (reverse) weights.reverse();
  const totalWeight = weights.reduce((x, y) => x + y, 0) || 1;
  return weights.map((w) => (w / totalWeight) * target);
}
