/**
 * Canvas graph model shared by TopologyCanvas and PacketLayer: whichever
 * mode the dashboard is in (direct 2-node link while `topology_enabled` is
 * off, the preset graph while it is on — extended star or tri-path with
 * node-disjoint lanes) both need the same node coordinates, route/lane
 * polylines and per-link stats.
 */

import type { SchedulerState, TopologySnapshot } from "./topology";
import type { Snapshot } from "./types";

export interface LinkStatsView {
  data: number;
  ack: number;
  dropped: number;
  latency_ms: number;
}

export interface CanvasNode {
  id: string;
  label: string;
  sub: string;
  up: boolean;
  x: number;
  y: number;
  isSource: boolean;
  isDest: boolean;
  onRoute: boolean;
}

export interface CanvasLink {
  id: string;
  a: string;
  b: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  onRoute: boolean;
  /** Index of the path (lane) this link belongs to, null when on none. */
  lane: number | null;
  stats: LinkStatsView | null;
}

export interface CanvasGraph {
  mode: "direct" | "star" | "tri";
  /** Active preset id (direct | star | tri). */
  preset: string;
  /** Human label for the mode chip. */
  presetLabel: string;
  nodes: CanvasNode[];
  links: CanvasLink[];
  route: string[] | null;
  /** Every source→dest lane for the current pick (index = scheduler lane). */
  paths: string[][];
  /** The multipath policy is on and there is more than one lane to use. */
  multipathOn: boolean;
  source: string;
  dest: string;
  byId: Record<string, CanvasNode>;
}

export const VIEWBOX = { w: 640, h: 400 };

/** Fixed preset layout (spec §4): hub centre, CHs mid-ring, leaves outer. */
const STAR_POS: Record<string, { x: number; y: number }> = {
  hub: { x: 320, y: 200 },
  ch1: { x: 168, y: 200 },
  ch2: { x: 472, y: 200 },
  l1: { x: 56, y: 76 },
  l2: { x: 56, y: 324 },
  l3: { x: 584, y: 76 },
  l4: { x: 584, y: 324 },
};

const DIRECT_POS = {
  client: { x: 170, y: 200 },
  server: { x: 470, y: 200 },
};

/** Tri-path layout: source left, dest right, three node-disjoint lanes. */
const TRI_POS: Record<string, { x: number; y: number }> = {
  src: { x: 56, y: 200 },
  a1: { x: 240, y: 72 },
  a2: { x: 400, y: 72 },
  b1: { x: 240, y: 200 },
  b2: { x: 400, y: 200 },
  c1: { x: 240, y: 328 },
  c2: { x: 400, y: 328 },
  dst: { x: 584, y: 200 },
};

/** Position lookup for every preset (star + tri share the same canvas). */
const PRESET_POS: Record<string, { x: number; y: number }> = {
  ...STAR_POS,
  ...TRI_POS,
};

/**
 * Visual state of a path — the demo's colour language:
 *   green  = most optimal  (lowest rolling loss among the healthy lanes),
 *   blue   = candidate     (healthy, available, but not the best right now),
 *   red    = restricted    (flagged — the scheduler avoids it; dashed).
 */
export type PathState = "optimal" | "candidate" | "restricted";

/** Full class names so Tailwind can see them. */
export const PATH_STATE_STROKE: Record<PathState, string> = {
  optimal: "stroke-green-500",
  candidate: "stroke-blue-500",
  restricted: "stroke-red-500",
};
export const PATH_STATE_FILL: Record<PathState, string> = {
  optimal: "fill-green-400",
  candidate: "fill-blue-400",
  restricted: "fill-red-400",
};
export const PATH_STATE_HEX: Record<PathState, string> = {
  optimal: "#22c55e",
  candidate: "#3b82f6",
  restricted: "#ef4444",
};

/**
 * Per-lane state derived from the live scheduler: flagged lanes are
 * restricted; among the healthy lanes the ones with the (near-)lowest
 * rolling loss are optimal (2 % tolerance stops green/blue flapping),
 * the rest are candidates. Null while the scheduler is off / single-lane.
 */
export function schedulerLaneStates(
  sched: SchedulerState | null | undefined,
): PathState[] | null {
  if (!sched?.enabled || sched.lanes.length < 2) return null;
  const healthy = sched.lanes.filter((l) => !l.flagged);
  const minLoss = healthy.length
    ? Math.min(...healthy.map((l) => l.window_loss))
    : 0;
  return sched.lanes.map((l) =>
    l.flagged
      ? "restricted"
      : l.window_loss <= minLoss + 0.02
        ? "optimal"
        : "candidate",
  );
}

/** State of every lane in `graph.paths` (scheduler first; active-route
 *  fallback while no scheduler is live, e.g. multipath off or idle). */
export function laneStates(
  sched: SchedulerState | null | undefined,
  graph: CanvasGraph,
): PathState[] {
  const fromSched = schedulerLaneStates(sched);
  if (fromSched && fromSched.length === graph.paths.length) return fromSched;
  const routeKey = graph.route ? graph.route.join(">") : null;
  return graph.paths.map((ids) =>
    routeKey && ids.join(">") === routeKey ? "optimal" : "candidate",
  );
}

/** Canonical unordered edge key for lane membership checks. */
function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function buildCanvasGraph(
  topology: TopologySnapshot | null,
  status: Snapshot | null,
): CanvasGraph {
  const starOn =
    status?.config.topology_enabled === true && topology != null;

  if (!starOn || topology == null) {
    // ---- direct 2-node link (classic demo) -----------------------------
    const running = status?.server_status === "running";
    const route =
      status?.transfer_status === "transferring" ? ["client", "server"] : null;
    const stats: LinkStatsView = {
      data: (status?.packets_sent ?? 0) + (status?.retransmissions ?? 0),
      ack: status?.packets_acked ?? 0,
      dropped: status?.packets_lost ?? 0,
      latency_ms: Math.round(
        status?.rtt_ms ?? status?.config.topology_latency_ms ?? 10,
      ),
    };
    const nodes: CanvasNode[] = [
      {
        id: "client",
        label: "CLIENT",
        sub: "SENDER",
        up: true,
        x: DIRECT_POS.client.x,
        y: DIRECT_POS.client.y,
        isSource: true,
        isDest: false,
        onRoute: route != null,
      },
      {
        id: "server",
        label: "SERVER",
        sub: `:${status?.server_port ?? status?.config.udp_port ?? 5001}`,
        up: running,
        x: DIRECT_POS.server.x,
        y: DIRECT_POS.server.y,
        isSource: false,
        isDest: true,
        onRoute: route != null,
      },
    ];
    const links: CanvasLink[] = [
      {
        id: "client-server",
        a: "client",
        b: "server",
        x1: DIRECT_POS.client.x,
        y1: DIRECT_POS.client.y,
        x2: DIRECT_POS.server.x,
        y2: DIRECT_POS.server.y,
        onRoute: route != null,
        lane: 0,
        stats,
      },
    ];
    return {
      mode: "direct",
      preset: "direct",
      presetLabel: "Direct link",
      nodes,
      links,
      route,
      paths: [["client", "server"]],
      multipathOn: false,
      source: "client",
      dest: "server",
      byId: { client: nodes[0], server: nodes[1] },
    };
  }

  // ---- preset topology (flag on: star or tri-path) --------------------
  const route = topology.route;
  const routeSet = new Set(route ?? []);
  const paths = topology.paths.length
    ? topology.paths
    : route
      ? [route]
      : [];
  const multipathOn = topology.multipath.enabled && paths.length > 1;

  // every edge -> the first lane it belongs to (lanes are node-disjoint
  // except at the endpoints, so this is unambiguous)
  const laneOf = new Map<string, number>();
  paths.forEach((lanePath, i) => {
    for (let j = 0; j < lanePath.length - 1; j++) {
      const key = edgeKey(lanePath[j], lanePath[j + 1]);
      if (!laneOf.has(key)) laneOf.set(key, i);
    }
  });

  const presetLabel =
    topology.presets.find((p) => p.id === topology.preset)?.label ??
    topology.preset;

  const nodes: CanvasNode[] = topology.nodes.map((n) => {
    const pos = PRESET_POS[n.id] ?? { x: 0, y: 0 };
    return {
      id: n.id,
      label: n.label,
      sub: `:${n.port}`,
      up: n.up,
      x: pos.x,
      y: pos.y,
      isSource: n.id === topology.source,
      isDest: n.id === topology.dest,
      onRoute: routeSet.has(n.id),
    };
  });
  const links: CanvasLink[] = topology.links.map((l) => {
    const a = PRESET_POS[l.a];
    const b = PRESET_POS[l.b];
    const s = topology.link_stats[l.id];
    const lane = laneOf.get(edgeKey(l.a, l.b)) ?? null;
    return {
      id: l.id,
      a: l.a,
      b: l.b,
      x1: a?.x ?? 0,
      y1: a?.y ?? 0,
      x2: b?.x ?? 0,
      y2: b?.y ?? 0,
      onRoute:
        route != null &&
        route.some(
          (_, i) =>
            i < route.length - 1 &&
            ((route[i] === l.a && route[i + 1] === l.b) ||
              (route[i] === l.b && route[i + 1] === l.a)),
        ),
      lane,
      stats: s
        ? {
            data: s.data_packets,
            ack: s.ack_packets,
            dropped: s.dropped,
            latency_ms: s.latency_ms,
          }
        : null,
    };
  });
  return {
    mode: topology.preset === "tri" ? "tri" : "star",
    preset: topology.preset,
    presetLabel,
    nodes,
    links,
    route,
    paths,
    multipathOn,
    source: topology.source,
    dest: topology.dest,
    byId: Object.fromEntries(nodes.map((n) => [n.id, n])),
  };
}

/** Node coordinates for an explicit node-id chain (null on unknown ids). */
export function pathOf(
  graph: CanvasGraph,
  ids: string[] | null,
): { x: number; y: number }[] | null {
  if (!ids || ids.length < 2) return null;
  const pts: { x: number; y: number }[] = [];
  for (const id of ids) {
    const node = graph.byId[id];
    if (!node) return null;
    pts.push({ x: node.x, y: node.y });
  }
  return pts;
}

/** Node ids of one scheduler lane (falls back to the active route). */
export function laneIds(graph: CanvasGraph, lane: number | null): string[] | null {
  if (lane !== null && graph.paths[lane]) return graph.paths[lane];
  return graph.route;
}

/** Polyline for one scheduler lane (packet travel path). */
export function lanePath(
  graph: CanvasGraph,
  lane: number | null,
): { x: number; y: number }[] | null {
  return pathOf(graph, laneIds(graph, lane));
}
