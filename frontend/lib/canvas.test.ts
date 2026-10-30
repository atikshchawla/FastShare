import { describe, expect, it } from "vitest";
import {
  buildCanvasGraph,
  laneIds,
  laneStates,
  schedulerLaneStates,
  type CanvasGraph,
} from "./canvas";
import type { SchedulerState, SchedulerLane, TopologySnapshot } from "./topology";
import type { Snapshot } from "./types";

/** Minimal scheduler fixture: lane i flagged / loss configurable. */
function sched(
  lanes: Array<{ flagged?: boolean; window_loss?: number }>,
  enabled = true,
): SchedulerState {
  return {
    mode: "weighted",
    enabled,
    window: 100,
    flag_loss: 0.2,
    recover_loss: 0.1,
    probe_share: 0.1,
    lanes: lanes.map((l, i): SchedulerLane => ({
      lane: i,
      name: String.fromCharCode(65 + i),
      sent: 50,
      lost: 5,
      attempts: 20,
      window_loss: l.window_loss ?? 0,
      flagged: l.flagged ?? false,
      weight: 1 / lanes.length,
    })),
  };
}

/** A tiny 4-node topology whose paths form 2 node-disjoint lanes. */
function triTopology(): TopologySnapshot {
  return {
    enabled: true,
    nodes: ["src", "a1", "b1", "dst"].map((id) => ({
      id,
      label: id.toUpperCase(),
      role: "router" as const,
      host: "127.0.0.1",
      port: 6201,
      up: true,
    })),
    links: [
      { id: "src-a1", a: "src", b: "a1", latency_ms: 5 },
      { id: "a1-dst", a: "a1", b: "dst", latency_ms: 15 },
      { id: "src-b1", a: "src", b: "b1", latency_ms: 5 },
      { id: "b1-dst", a: "b1", b: "dst", latency_ms: 5 },
    ],
    route: ["src", "a1", "dst"],
    source: "src",
    dest: "dst",
    link_stats: {
      "src-a1": { data_packets: 10, ack_packets: 9, dropped: 1, latency_ms: 5 },
      "a1-dst": { data_packets: 10, ack_packets: 9, dropped: 1, latency_ms: 15 },
      "src-b1": { data_packets: 4, ack_packets: 4, dropped: 0, latency_ms: 5 },
      "b1-dst": { data_packets: 4, ack_packets: 4, dropped: 0, latency_ms: 5 },
    },
    preset: "tri",
    presets: [{ id: "tri", label: "Tri-path", source: "src", dest: "dst" }],
    paths: [
      ["src", "a1", "dst"],
      ["src", "b1", "dst"],
    ],
    multipath: {
      enabled: true,
      window: 100,
      flag_loss: 0.2,
      recover_loss: 0.1,
      probe_share: 0.1,
      explore_per_lane: 10,
      min_samples: 25,
    },
  };
}

describe("schedulerLaneStates", () => {
  it("returns null when the scheduler is off or single-lane", () => {
    expect(schedulerLaneStates(null)).toBeNull();
    expect(schedulerLaneStates(sched([{}, {}], false))).toBeNull();
    expect(schedulerLaneStates(sched([{}]))).toBeNull();
  });

  it("flags are restricted; lowest-loss healthy lane is optimal", () => {
    const states = schedulerLaneStates(
      sched([
        { flagged: true, window_loss: 0.4 },
        { window_loss: 0.01 },
        { window_loss: 0.15 },
      ]),
    );
    expect(states).toEqual(["restricted", "optimal", "candidate"]);
  });

  it("a 2% tolerance keeps near-equal lanes both optimal (no flapping)", () => {
    const states = schedulerLaneStates(
      sched([{ window_loss: 0.01 }, { window_loss: 0.03 }]),
    );
    expect(states).toEqual(["optimal", "optimal"]);
  });

  it("all lanes flagged -> every lane restricted", () => {
    const states = schedulerLaneStates(
      sched([{ flagged: true }, { flagged: true }]),
    );
    expect(states).toEqual(["restricted", "restricted"]);
  });
});

describe("laneStates", () => {
  const topo = triTopology();
  const topoOn = { config: { topology_enabled: true } } as Snapshot;

  it("uses the scheduler's states when lengths match", () => {
    const graph = buildCanvasGraph(topo, topoOn);
    const states = laneStates(
      sched([{ flagged: true }, { window_loss: 0.0 }]),
      graph,
    );
    expect(states).toEqual(["restricted", "optimal"]);
  });

  it("falls back to the active route when no scheduler is live", () => {
    const graph = buildCanvasGraph(topo, topoOn);
    const states = laneStates(null, graph);
    // lane 0 is the configured route -> optimal, lane 1 -> candidate
    expect(states).toEqual(["optimal", "candidate"]);
  });
});

describe("buildCanvasGraph", () => {
  const topoOn = { config: { topology_enabled: true } } as Snapshot;

  it("direct mode while the topology flag is off", () => {
    const graph = buildCanvasGraph(triTopology(), {
      config: { topology_enabled: false },
    } as Snapshot);
    expect(graph.mode).toBe("direct");
    expect(graph.nodes.map((n) => n.id)).toEqual(["client", "server"]);
    expect(graph.paths).toEqual([["client", "server"]]);
  });

  it("direct mode with no status at all (first paint)", () => {
    const graph = buildCanvasGraph(null, null);
    expect(graph.mode).toBe("direct");
    expect(graph.byId.server.up).toBe(false); // server not started yet
  });

  it("maps every lane edge to its lane index (node-disjoint)", () => {
    const graph = buildCanvasGraph(triTopology(), topoOn);
    expect(graph.mode).toBe("tri");
    expect(graph.paths).toHaveLength(2);
    const byEdge = (a: string, b: string) =>
      graph.links.find(
        (l) => (l.a === a && l.b === b) || (l.a === b && l.b === a),
      )?.lane;
    expect(byEdge("src", "a1")).toBe(0);
    expect(byEdge("a1", "dst")).toBe(0);
    expect(byEdge("src", "b1")).toBe(1);
    expect(byEdge("b1", "dst")).toBe(1);
    // every node has coordinates + a byId entry
    for (const n of graph.nodes) expect(graph.byId[n.id]).toBe(n);
  });

  it("marks nodes on the route and picks up link stats", () => {
    const graph = buildCanvasGraph(triTopology(), topoOn);
    expect(graph.byId["a1"].onRoute).toBe(true);
    expect(graph.byId["b1"].onRoute).toBe(false);
    const link = graph.links.find((l) => l.id === "a1-dst");
    expect(link?.stats).toEqual({
      data: 10,
      ack: 9,
      dropped: 1,
      latency_ms: 15,
    });
  });

  it("laneIds falls back to the route for an unknown lane", () => {
    const graph: CanvasGraph = buildCanvasGraph(triTopology(), topoOn);
    expect(laneIds(graph, 1)).toEqual(["src", "b1", "dst"]);
    expect(laneIds(graph, 99)).toEqual(["src", "a1", "dst"]);
    expect(laneIds(graph, null)).toEqual(["src", "a1", "dst"]);
  });
});
