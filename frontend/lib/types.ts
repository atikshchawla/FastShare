/** Shared types mirroring the FastAPI controller responses. */

import type { SchedulerState } from "./topology";

export type ServerStatus = "stopped" | "running" | "error";
export type TransferStatus =
  | "idle"
  | "transferring"
  | "completed"
  | "failed"
  | "cancelled";

export type PacketStatus =
  | "SENT"
  | "WAITING"
  | "ACKED"
  | "TIMEOUT"
  | "RETRANSMITTED"
  | "FAILED";

export interface Config {
  server_ip: string;
  udp_port: number;
  packet_size: number;
  timeout_ms: number;
  window_size: number;
  max_retries: number;
  topology_enabled: boolean;
  topology_latency_ms: number;
}

export interface TestingConfig {
  loss_enabled: boolean;
  loss_probability: number; // 0..1
  corrupt_enabled: boolean;
  corrupt_probability: number; // 0..1
}

/** State snapshot returned by GET /api/status and GET /api/transfer/status. */
export interface Snapshot {
  server_status: ServerStatus;
  server_error: string | null;
  server_sessions: number;
  server_port: number;
  config: Config;
  testing: TestingConfig;
  transfer_status: TransferStatus;
  transfer_error: string | null;
  file_size: number;
  total_packets: number;
  packets_sent: number;
  packets_acked: number;
  packets_lost: number;
  retransmissions: number;
  confirmed_bytes: number;
  current_sequence: number;
  duplicate_packets: number;
  checksum_errors: number;
  last_duplicate_seq: number | null;
  last_loss_seq: number | null;
  elapsed_seconds: number;
  received_path: string | null;
  // performance statistics
  wire_bytes: number;
  rtt_ms: number | null;
  rtt_min_ms: number | null;
  rtt_max_ms: number | null;
  srtt_ms: number | null;
  rtt_samples: number;
  goodput_kbps: number;
  throughput_kbps: number;
  loss_percent: number;
  eta_seconds: number | null;
  resumed_from_seq: number;
  resumed_bytes: number;
  // source-side multipath scheduler (null before the first transfer)
  scheduler: SchedulerState | null;
}

/** Answer of GET /api/resume/check for the currently selected file. */
export interface ResumeInfo {
  available: boolean;
  resumed_seq: number;
  received_bytes: number;
  total_packets: number;
  file_size: number;
  percent: number;
}

export type PacketType = "START" | "DATA" | "END" | "ACK";

export interface PacketEntry {
  seq: number;
  type: PacketType;
  size: number;
  status: PacketStatus;
  retries: number;
  /** RTT of the ACK that closed this entry (ACKED only). */
  rtt_ms?: number;
  /** Multipath lane index that carried the send (absent when single-path). */
  lane?: number;
}

export interface FeedLine {
  t: number;
  text: string;
}

export interface PacketResponse {
  packets: PacketEntry[];
  feed: FeedLine[];
}

export interface SelectedFile {
  name: string;
  size: number;
}

export interface ApiOk {
  ok: boolean;
  message?: string | null;
  error?: string | null;
}
