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
      <div className="grid grid-cols-4 divide-x-2 divide-neutral-700 border-b-2 border-neutral-700">
        <div className="bg-neutral-900/80 p-2.5 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-neutral-400">
            PACKETS SENT
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-cyan-400">
            {sent}
          </p>
        </div>

        <div className="bg-neutral-900/80 p-2.5 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-neutral-400">
            PACKETS ACK
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-green-400">
            {acked}
          </p>
        </div>

        <div className="bg-neutral-900/80 p-2.5 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-neutral-400">
            RETRIES
          </p>
          <p className={`mt-1 font-mono text-2xl font-black ${retries > 0 ? "text-amber-400" : "text-neutral-300"}`}>
            {retries}
          </p>
        </div>

        <div className="bg-neutral-900/80 p-2.5 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-neutral-400">
            SEQUENCE
          </p>
          <p className="mt-1 font-mono text-2xl font-black text-white">
            {seq}
          </p>
        </div>
      </div>

      {/* Secondary Metrics Bar */}
      <div className="grid grid-cols-3 divide-x-2 divide-neutral-700 bg-neutral-950 text-xs font-mono">
        <div className="flex flex-col gap-0.5 px-2.5 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Packets Lost</span>
          <span className={`font-black ${lost > 0 ? "text-red-400" : "text-neutral-300"}`}>{lost}</span>
        </div>
        <div className="flex flex-col gap-0.5 px-2.5 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Duplicates</span>
          <span className={`font-black ${duplicates > 0 ? "text-amber-400" : "text-neutral-300"}`}>{duplicates}</span>
        </div>
        <div className="flex flex-col gap-0.5 px-2.5 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Bytes Confirmed</span>
          <span className="font-black text-neutral-200">
            {status?.confirmed_bytes ? `${(status.confirmed_bytes / 1024).toFixed(1)} KB` : "0 KB"}
          </span>
        </div>
      </div>

      {/* RTT / throughput statistics (computed from real send->ACK timing) */}
      <div className="grid grid-cols-2 divide-2 divide-neutral-700 border-t-2 border-neutral-700">
        <div className="bg-neutral-900/80 p-2.5 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-neutral-400">
            RTT (LATEST)
          </p>
          <p className="mt-1 font-mono text-xl font-black text-cyan-300">
            {fmtMs(status?.rtt_ms)}
          </p>
          <p className="mt-1 font-mono text-[10px] text-neutral-500">{rttSub}</p>
        </div>

        <div className="bg-neutral-900/80 p-2.5 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-neutral-400">
            SRTT (EWMA)
          </p>
          <p className="mt-1 font-mono text-xl font-black text-cyan-300">
            {fmtMs(status?.srtt_ms)}
          </p>
          <p className="mt-1 font-mono text-[10px] text-neutral-500">
            {samples} sample{samples === 1 ? "" : "s"}
          </p>
        </div>

        <div className="bg-neutral-900/80 p-2.5 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-neutral-400">
            GOODPUT
          </p>
          <p className="mt-1 font-mono text-xl font-black text-green-400">
            {fmtKbps(status?.goodput_kbps)}
          </p>
          <p className="mt-1 font-mono text-[10px] text-neutral-500">
            file bytes / elapsed
          </p>
        </div>

        <div className="bg-neutral-900/80 p-2.5 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-neutral-400">
            WIRE THROUGHPUT
          </p>
          <p className="mt-1 font-mono text-xl font-black text-cyan-200">
            {fmtKbps(status?.throughput_kbps)}
          </p>
          <p className="mt-1 font-mono text-[10px] text-neutral-500">
            incl. headers + retransmits
          </p>
        </div>
      </div>

      {/* Loss / integrity / ETA bar */}
      <div className="grid grid-cols-4 divide-x-2 divide-neutral-700 bg-neutral-950 text-xs font-mono">
        <div className="flex flex-col gap-0.5 px-2.5 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Loss Rate</span>
          <span className={`font-black ${lossPct > 0 ? "text-amber-400" : "text-neutral-300"}`}>
            {lossPct.toFixed(2)}%
          </span>
        </div>
        <div className="flex flex-col gap-0.5 px-2.5 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">CRC Errors</span>
          <span className={`font-black ${crcErrors > 0 ? "text-violet-400" : "text-neutral-300"}`}>
            {crcErrors}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 px-2.5 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">ETA</span>
          <span className="font-black text-neutral-200">{fmtEta(status?.eta_seconds)}</span>
        </div>
        <div className="flex flex-col gap-0.5 px-2.5 py-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Wire Bytes</span>
          <span className="font-black text-neutral-200">{wireKb} KB</span>
        </div>
      </div>
    </Panel>
  );
}

