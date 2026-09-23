/** HTTP client for the Python controller.

The browser never touches UDP: file transfer runs on the Python side over
real UDP sockets; the dashboard only sends JSON requests and receives JSON.

FastAPI runs at http://127.0.0.1:8000 (see backend/main.py).
*/

import type {
  ApiOk,
  Config,
  PacketResponse,
  Snapshot,
  StatusResponse,
  TestingConfig,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

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
  status: () => json<StatusResponse>("/api/status"),
  transferStatus: () => json<Snapshot>("/api/transfer/status"),
  transferPackets: (limit = 120) =>
    json<PacketResponse>(`/api/transfer/packets?limit=${limit}`),

  startServer: () => post("/api/server/start"),
  stopServer: () => post("/api/server/stop"),
  saveConfig: (cfg: Config) =>
    post("/api/server/config", cfg).then(() => api.status()),
  testingConfig: (cfg: TestingConfig) =>
    post("/api/testing/config", {
      loss_enabled: cfg.loss_enabled,
      loss_probability: cfg.loss_probability,
    }),

  startTransfer: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${BASE}/api/transfer/start`, {
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
};

/** Lightweight error that still surfaces the controller message. */
export class ControllerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControllerError";
  }
}