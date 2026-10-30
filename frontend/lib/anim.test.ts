import { describe, expect, it } from "vitest";
import { buildTimings, posAlong, sum } from "./anim";
import type { CanvasGraph } from "./canvas";

/** Two-link chain: A --10ms--> B --30ms--> C (latencies weight the split). */
const graph = {
  links: [
    { a: "A", b: "B", stats: { latency_ms: 10 } },
    { a: "B", b: "C", stats: { latency_ms: 30 } },
  ],
} as unknown as CanvasGraph;

const path = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

describe("posAlong", () => {
  it("returns null on degenerate input", () => {
    expect(posAlong([], [], 10)).toBeNull();
    expect(posAlong([{ x: 0, y: 0 }], [100], 10)).toBeNull();
    expect(posAlong(path, [], 10)).toBeNull();
  });

  it("clamps elapsed before the start to the first point", () => {
    expect(posAlong(path, [100, 100], -50)).toEqual({ x: 0, y: 0 });
  });

  it("interpolates inside each segment", () => {
    expect(posAlong(path, [100, 100], 0)).toEqual({ x: 0, y: 0 });
    expect(posAlong(path, [100, 100], 50)).toEqual({ x: 50, y: 0 });
    expect(posAlong(path, [100, 100], 100)).toEqual({ x: 100, y: 0 });
    expect(posAlong(path, [100, 100], 150)).toEqual({ x: 100, y: 50 });
  });

  it("clamps past the end to the final point", () => {
    expect(posAlong(path, [100, 100], 9999)).toEqual({ x: 100, y: 100 });
  });

  it("survives zero-length segments (division guard)", () => {
    // a zero-duration segment is traversed instantly: elapsed 0 already
    // sits at its far end — and never produces NaN
    const p = posAlong(path, [0, 100], 0);
    expect(p).toEqual({ x: 100, y: 0 });
    expect(Number.isFinite(p!.x) && Number.isFinite(p!.y)).toBe(true);
  });
});

describe("buildTimings", () => {
  it("splits the target duration proportionally to link latency", () => {
    const t = buildTimings(graph, ["A", "B", "C"], 400, false);
    expect(t).toHaveLength(2);
    expect(sum(t)).toBeCloseTo(400, 6);
    expect(t[0]).toBeCloseTo(100, 6); // 10/(10+30) * 400
    expect(t[1]).toBeCloseTo(300, 6); // 30/(10+30) * 400
  });

  it("reverses the chain for the ACK trip home", () => {
    const fwd = buildTimings(graph, ["A", "B", "C"], 400, false);
    const rev = buildTimings(graph, ["A", "B", "C"], 400, true);
    expect(rev[0]).toBeCloseTo(fwd[1], 6);
    expect(rev[1]).toBeCloseTo(fwd[0], 6);
  });

  it("falls back to a default weight for unknown links", () => {
    const t = buildTimings(graph, ["X", "Y"], 200, false);
    expect(t).toHaveLength(1);
    expect(t[0]).toBeCloseTo(200, 6);
  });

  it("sum returns the total duration", () => {
    expect(sum([1, 2, 3.5])).toBe(6.5);
    expect(sum([])).toBe(0);
  });
});
