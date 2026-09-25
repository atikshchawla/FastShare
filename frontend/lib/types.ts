/** Shared types mirroring the FastAPI controller responses. */

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
}

export interface TestingConfig {
  loss_enabled: boolean;
  loss_probability: number; // 0..1
  corrupt_enabled: boolean;
  corrupt_probability: number; // 0..1
}

export interface ProtocolInfo {
  transport: string;
  reliability: string;
  packet_size: number;
  sequence_numbers: string;
  acknowledgements: string;
  retransmission: string;
  checksum: string;
  resume: string;
}

export type StatusResponse = Snapshot & { protocol: ProtocolInfo };

export interface Snapshot {
  server_status: ServerStatus;
  server_error: string | null;
  server_sessions: number;
  server_port: number;
  config: Config;
  testing: TestingConfig;
  transfer_status: TransferStatus;
  transfer_error: string | null;
  file_name: string | null;
  file_size: number;
  total_packets: number;
  packets_sent: number;
  packets_acked: number;
  packets_lost: number;
  retransmissions: number;
  bytes_sent: number;
  confirmed_bytes: number;
  current_sequence: number;
  duplicate_packets: number;
  checksum_errors: number;
  last_duplicate_seq: number | null;
  last_loss_seq: number | null;
  last_checksum_seq: number | null;
  progress_percent: number;
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
  checksum: string;
  resume: string;
  resumed_from_seq: number;
  resumed_bytes: number;
  protocol?: ProtocolInfo;
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
  rtt_ms?: number;
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
  packets: number;
}

export interface ApiOk {
  ok: boolean;
  message?: string | null;
  error?: string | null;
}

export function formatBytes(n: number): string {
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSeconds(s: number): string {
  if (s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}