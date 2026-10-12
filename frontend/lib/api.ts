/** HTTP client for the Python controller.

The browser never touches UDP: file transfer runs on the Python side over
real UDP sockets; the dashboard only sends JSON requests and receives JSON.

FastAPI runs at http://127.0.0.1:8000 (see backend/main.py).
*/

import type {
  ApiOk,
  Config,
  PacketResponse,
  ResumeInfo,
  Snapshot,
  TestingConfig,
} from "./types";
import type {
  MultipathPolicy,
  NodeLogsResponse,
  TopologySnapshot,
} from "./topology";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

/** Partial patch for POST /api/topology/node/config (null/omitted = keep). */
export interface NodeConfigPatch {
  id: string;
  reset?: boolean;
  latency_ms?: number | null;
  loss_enabled?: boolean | null;
  loss_probability?: number | null;
  corrupt_enabled?: boolean | null;
  corrupt_probability?: number | null;
  enabled?: boolean | null;
}

/** Answer of POST /api/topology/preset (new default source/dest). */
export interface PresetSwitchResult {
  ok: boolean;
  preset: string;
  source: string;
  dest: string;
  nodes?: string[];
}

/** Answer of POST /api/topology/multipath/config (full patched policy). */
export interface MultipathResult {
  ok: boolean;
  config: MultipathPolicy;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail ?? body.error ?? detail;
    } catch {
      /* keep status code */
    }
    throw new Error(String(detail));
  }
  return (await res.json()) as T;
}

function post(path: string, body?: unknown): Promise<ApiOk> {
  return json<ApiOk>(path, {
    method: "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const api = {
  status: () => json<Snapshot>("/api/status"),
  transferPackets: (limit = 120) =>
    json<PacketResponse>(`/api/transfer/packets?limit=${limit}`),
  topology: () => json<TopologySnapshot>("/api/topology"),
  nodeLogs: (id: string, limit = 200) =>
    json<NodeLogsResponse>(
      `/api/topology/node/${encodeURIComponent(id)}/logs?limit=${limit}`,
    ),

  /** Switch the active preset graph (star <-> tri-path). */
  setPreset: (name: string) =>
    json<PresetSwitchResult>("/api/topology/preset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),

  /** Patch the source-side multipath policy (None fields = keep). */
  multipathConfig: (patch: Partial<MultipathPolicy>) =>
    json<MultipathResult>("/api/topology/multipath/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),

  startServer: () => post("/api/server/start"),
  stopServer: () => post("/api/server/stop"),
  saveConfig: (cfg: Config) =>
    post("/api/server/config", cfg).then(() => api.status()),
  testingConfig: (cfg: TestingConfig) =>
    post("/api/testing/config", {
      loss_enabled: cfg.loss_enabled,
      loss_probability: cfg.loss_probability,
      corrupt_enabled: cfg.corrupt_enabled,
      corrupt_probability: cfg.corrupt_probability,
    }),
  saveNodeConfig: (cfg: NodeConfigPatch) =>
    post("/api/topology/node/config", cfg),

  startTransfer: async (
    file: File,
    resume = true,
    source?: string,
    dest?: string,
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    const params = new URLSearchParams({ resume: resume ? "true" : "false" });
    if (source) params.set("source", source);
    if (dest) params.set("dest", dest);
    const res = await fetch(`${BASE}/api/transfer/start?${params}`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(String(body.detail ?? body.error ?? `HTTP ${res.status}`));
    }
    return (await res.json()) as ApiOk;
  },

  cancelTransfer: () => post("/api/transfer/cancel"),

  resumeCheck: (name: string, size: number) =>
    json<ResumeInfo>(
      `/api/resume/check?name=${encodeURIComponent(name)}&size=${size}`,
    ),
};
