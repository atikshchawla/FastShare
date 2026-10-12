/** Types mirroring GET /api/topology (FEATURE_SPEC_MULTI_SERVER_TOPOLOGY §6). */

export type TopologyRole =
  | "hub"
  | "cluster"
  | "leaf"
  | "source"
  | "dest"
  | "router";

/** Effective per-node config: the node's override, else the global values. */
export interface NodeConfigView {
  latency_ms: number;
  loss_enabled: boolean;
  loss_probability: number;
  corrupt_enabled: boolean;
  corrupt_probability: number;
  enabled: boolean;
}

export interface TopologyNode {
  id: string;
  label: string;
  role: TopologyRole;
  host: string;
  port: number;
  up: boolean;
  config?: NodeConfigView;
}

export interface TopologyLink {
  id: string;
  a: string;
  b: string;
  latency_ms: number;
}

export interface LinkStats {
  data_packets: number;
  ack_packets: number;
  dropped: number;
  latency_ms: number;
}

export interface TopologySnapshot {
  enabled: boolean;
  nodes: TopologyNode[];
  links: TopologyLink[];
  route: string[] | null;
  source: string;
  dest: string;
  link_stats: Record<string, LinkStats>;
  /** Active preset id ("star" | "tri"). */
  preset: string;
  /** Switchable preset graphs (POST /api/topology/preset). */
  presets: PresetInfo[];
  /** All source→dest lanes for the current pick (index = scheduler lane). */
  paths: string[][];
  /** Source-side multipath policy (POST /api/topology/multipath/config). */
  multipath: MultipathPolicy;
}

export interface PresetInfo {
  id: string;
  label: string;
  source: string;
  dest: string;
}

/** Patchable PathScheduler policy (None fields = keep current value). */
export interface MultipathPolicy {
  enabled: boolean;
  window: number;
  flag_loss: number;
  recover_loss: number;
  probe_share: number;
  explore_per_lane: number;
  min_samples: number;
}

/** Per-lane rolling stats from the source-side PathScheduler. */
export interface SchedulerLane {
  lane: number;
  name: string;
  sent: number;
  lost: number;
  attempts: number;
  window_loss: number;
  flagged: boolean;
  weight: number;
}

/** GET /api/status → snapshot.scheduler (null before the first transfer). */
export interface SchedulerState {
  mode: "explore" | "round_robin" | "weighted" | "single" | "disabled";
  enabled: boolean;
  window: number;
  flag_loss: number;
  recover_loss: number;
  probe_share: number;
  lanes: SchedulerLane[];
}

export interface NodeLogLine {
  t: number;
  text: string;
}

/** Answer of GET /api/topology/node/{id}/logs. */
export interface NodeLogsResponse {
  node: string;
  lines: NodeLogLine[];
}
