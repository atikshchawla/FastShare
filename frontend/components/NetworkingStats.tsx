"use client";

import { BarChart3 } from "lucide-react";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import type { Snapshot } from "@/lib/types";

function fmtMs(v: number | null | undefined): string {
  return v === null || v === undefined ? "--" : `${v.toFixed(1)} ms`;
}

function fmtKbps(v: number | null | undefined): string {
  return v === null || v === undefined ? "--" : `${v.toFixed(1)} KB/s`;
}

function fmtEta(v: number | null | undefined): string {
  if (v === null || v === undefined) return "--";
  return v <= 0 ? "done" : `${v.toFixed(1)} s`;
}

export function NetworkingStats({ status }: { status: Snapshot | null }) {
  const sent = status?.packets_sent ?? 0;
  const acked = status?.packets_acked ?? 0;
  const retries = status?.retransmissions ?? 0;
  const seq = status?.current_sequence ?? 0;
  const lost = status?.packets_lost ?? 0;
  const duplicates = status?.duplicate_packets ?? 0;
  const crcErrors = status?.checksum_errors ?? 0;
  const lossPct = status?.loss_percent ?? 0;
  const samples = status?.rtt_samples ?? 0;
  const wireKb = ((status?.wire_bytes ?? 0) / 1024).toFixed(1);

  const rttSub =
    samples > 0
      ? `min ${fmtMs(status?.rtt_min_ms)} · max ${fmtMs(status?.rtt_max_ms)}`
      : "awaiting first ACK";

  return (
    <Panel>
      <PanelHeader
        title="TELEMETRY & NETWORK METRICS"
        icon={<BarChart3 size={15} />}
        right={
          <Badge tone="cyan" className="px-2 py-0.5 font-mono text-[10px]">
            REAL-TIME UDP
          </Badge>
        }
      />

      {/* 4 Key Primary Metrics from Specification */}
      <div className="grid grid-cols-2 divide-y-2 divide-neutral-700 border-b-2 border-neutral-700 sm:grid-cols-4 sm:divide-x-2 sm:divide-y-0">
        <div className="bg-neutral-900/80 p-4 text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-neutral-400">
            PACKETS SENT
          </p>
          <p className="mt-1 font-mono text-3xl font-black text-cyan-400 sm:text-4xl">
            {sent}
          </p>
        </div>

        <div className="bg-neutral-900/80 p-4 text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-neutral-400">
            PACKETS ACK
          </p>
          <p className="mt-1 font-mono text-3xl font-black text-green-400 sm:text-4xl">
            {acked}
          </p>
        </div>

        <div className="bg-neutral-900/80 p-4 text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-neutral-400">
            RETRIES
          </p>
          <p className={`mt-1 font-mono text-3xl font-black sm:text-4xl ${retries > 0 ? "text-amber-400" : "text-neutral-300"}`}>
            {retries}
          </p>
        </div>

        <div className="bg-neutral-900/80 p-4 text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-neutral-400">
            SEQUENCE
          </p>
          <p className="mt-1 font-mono text-3xl font-black text-white sm:text-4xl">
            {seq}
          </p>
        </div>
      </div>

      {/* Secondary Metrics Bar */}
      <div className="grid grid-cols-2 divide-x-2 divide-neutral-700 bg-neutral-950 text-xs font-mono sm:grid-cols-4">
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="font-bold text-neutral-500 uppercase">Packets Lost</span>
          <span className={`font-black ${lost > 0 ? "text-red-400" : "text-neutral-300"}`}>{lost}</span>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="font-bold text-neutral-500 uppercase">Duplicates</span>
          <span className={`font-black ${duplicates > 0 ? "text-amber-400" : "text-neutral-300"}`}>{duplicates}</span>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="font-bold text-neutral-500 uppercase">Bytes Confirmed</span>
          <span className="font-black text-neutral-200">
            {status?.confirmed_bytes ? `${(status.confirmed_bytes / 1024).toFixed(1)} KB` : "0 KB"}
          </span>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="font-bold text-neutral-500 uppercase">ARQ Window</span>
          <span className="font-black text-cyan-400">1 (Stop & Wait)</span>
        </div>
      </div>

      {/* RTT / throughput statistics (computed from real send->ACK timing) */}
      <div className="grid grid-cols-2 divide-y-2 divide-neutral-700 border-t-2 border-neutral-700 sm:grid-cols-4 sm:divide-x-2 sm:divide-y-0">
        <div className="bg-neutral-900/80 p-4 text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-neutral-400">
            RTT (LATEST)
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-cyan-300 sm:text-3xl">
            {fmtMs(status?.rtt_ms)}
          </p>
          <p className="mt-1 font-mono text-[10px] text-neutral-500">{rttSub}</p>
        </div>

        <div className="bg-neutral-900/80 p-4 text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-neutral-400">
            SRTT (EWMA)
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-cyan-300 sm:text-3xl">
            {fmtMs(status?.srtt_ms)}
          </p>
          <p className="mt-1 font-mono text-[10px] text-neutral-500">
            {samples} sample{samples === 1 ? "" : "s"}
          </p>
        </div>

        <div className="bg-neutral-900/80 p-4 text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-neutral-400">
            GOODPUT
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-green-400 sm:text-3xl">
            {fmtKbps(status?.goodput_kbps)}
          </p>
          <p className="mt-1 font-mono text-[10px] text-neutral-500">
            file bytes / elapsed
          </p>
        </div>

        <div className="bg-neutral-900/80 p-4 text-center">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-neutral-400">
            WIRE THROUGHPUT
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-cyan-200 sm:text-3xl">
            {fmtKbps(status?.throughput_kbps)}
          </p>
          <p className="mt-1 font-mono text-[10px] text-neutral-500">
            incl. headers + retransmits
          </p>
        </div>
      </div>

      {/* Loss / integrity / ETA bar */}
      <div className="grid grid-cols-2 divide-x-2 divide-neutral-700 bg-neutral-950 text-xs font-mono sm:grid-cols-4">
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="font-bold text-neutral-500 uppercase">Loss Rate</span>
          <span className={`font-black ${lossPct > 0 ? "text-amber-400" : "text-neutral-300"}`}>
            {lossPct.toFixed(2)}%
          </span>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="font-bold text-neutral-500 uppercase">CRC Errors</span>
          <span className={`font-black ${crcErrors > 0 ? "text-violet-400" : "text-neutral-300"}`}>
            {crcErrors}
          </span>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="font-bold text-neutral-500 uppercase">ETA</span>
          <span className="font-black text-neutral-200">{fmtEta(status?.eta_seconds)}</span>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="font-bold text-neutral-500 uppercase">Wire Bytes</span>
          <span className="font-black text-neutral-200">{wireKb} KB</span>
        </div>
      </div>
    </Panel>
  );
}