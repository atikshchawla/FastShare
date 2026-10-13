"use client";

import { Gauge, Zap, Clock, ShieldCheck, Flame } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui";
import type { Snapshot } from "@/lib/types";

function fmtMs(v: number | null | undefined): string {
  return v === null || v === undefined ? "--" : `${v.toFixed(1)} ms`;
}

function fmtKbps(v: number | null | undefined): string {
  return v === null || v === undefined ? "--" : `${v.toFixed(1)} KB/s`;
}

function fmtEta(v: number | null | undefined): string {
  if (v === null || v === undefined) return "--";
  return v <= 0 ? "0.0 s" : `${v.toFixed(1)} s`;
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

  const rttSub =
    samples > 0
      ? `min ${fmtMs(status?.rtt_min_ms)} · max ${fmtMs(status?.rtt_max_ms)}`
      : "awaiting first ACK";

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Physical Datagram Telemetry & EWMA Performance Matrix"
        badgeText="REAL-TIME TELEMETRY"
        icon={<Gauge size={20} className="stroke-[2.5]" />}
        right={
          <div className="flex items-center gap-2 font-mono text-xs sm:text-sm font-bold text-teal-900 bg-teal-50 px-3 py-1 rounded-xl border border-teal-200">
            <span className="h-2 w-2 rounded-full bg-teal-600 animate-pulse" />
            <span>SOCKET EWMA ENGINE</span>
          </div>
        }
      />

      {/* 4 Prominent Counter Tiles (Larger Numerals, Light Tint Backgrounds) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y-2 lg:divide-y-0 lg:divide-x-2 divide-slate-100 border-b-2 border-slate-100 bg-white">
        {/* Sent (Teal) */}
        <div className="p-6 bg-gradient-to-br from-teal-50/40 via-white to-white flex flex-col justify-between hover:bg-teal-50/60 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-mono font-extrabold uppercase text-teal-900">
              DATAGRAMS SENT
            </span>
            <span className="rounded-md bg-teal-100 px-2 py-0.5 text-xs font-mono font-extrabold text-teal-800">
              TX
            </span>
          </div>
          <div className="mt-4">
            <span className="font-mono text-4xl sm:text-5xl font-black text-teal-800 font-tabular tracking-tight">
              {sent}
            </span>
            <p className="mt-1 text-xs font-mono font-semibold text-slate-500 uppercase">
              Payload frames sent
            </p>
          </div>
        </div>

        {/* ACKed (Emerald) */}
        <div className="p-6 bg-gradient-to-br from-emerald-50/40 via-white to-white flex flex-col justify-between hover:bg-emerald-50/60 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-mono font-extrabold uppercase text-emerald-900">
              PACKETS ACKED
            </span>
            <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-mono font-extrabold text-emerald-800">
              ACK
            </span>
          </div>
          <div className="mt-4">
            <span className="font-mono text-4xl sm:text-5xl font-black text-emerald-700 font-tabular tracking-tight">
              {acked}
            </span>
            <p className="mt-1 text-xs font-mono font-semibold text-slate-500 uppercase">
              Confirmed delivered
            </p>
          </div>
        </div>

        {/* Retries (Orange) */}
        <div className="p-6 bg-gradient-to-br from-orange-50/40 via-white to-white flex flex-col justify-between hover:bg-orange-50/60 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-mono font-extrabold uppercase text-orange-900">
              RETRANSMISSIONS
            </span>
            <span className="rounded-md bg-orange-100 px-2 py-0.5 text-xs font-mono font-extrabold text-orange-800">
              ARQ
            </span>
          </div>
          <div className="mt-4">
            <span className="font-mono text-4xl sm:text-5xl font-black text-orange-600 font-tabular tracking-tight">
              {retries}
            </span>
            <p className="mt-1 text-xs font-mono font-semibold text-slate-500 uppercase">
              Timeout recoveries
            </p>
          </div>
        </div>

        {/* Sequence Lockstep (Slate/Teal) */}
        <div className="p-6 bg-gradient-to-br from-slate-50 via-white to-white flex flex-col justify-between hover:bg-slate-100/60 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-mono font-extrabold uppercase text-slate-800">
              CURRENT SEQUENCE
            </span>
            <span className="rounded-md bg-slate-200 px-2 py-0.5 text-xs font-mono font-extrabold text-slate-700">
              SEQ
            </span>
          </div>
          <div className="mt-4">
            <span className="font-mono text-4xl sm:text-5xl font-black text-slate-900 font-tabular tracking-tight">
              #{seq}
            </span>
            <p className="mt-1 text-xs font-mono font-semibold text-slate-500 uppercase">
              Stop-and-Wait head
            </p>
          </div>
        </div>
      </div>

      {/* Network Health Indicators & RFC Calculations Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 divide-y-2 md:divide-y-0 md:divide-x-2 divide-slate-100 p-2 bg-slate-50/50 text-xs sm:text-sm font-mono">
        {/* RTT EWMA */}
        <div className="p-4 space-y-1">
          <div className="flex items-center gap-2 text-slate-600 font-semibold">
            <Clock size={16} className="text-teal-700" />
            <span>EWMA SRTT (RFC 6298)</span>
          </div>
          <div className="text-2xl font-black text-slate-900 font-tabular">
            {fmtMs(status?.srtt_ms)}
          </div>
          <div className="text-xs text-slate-500 font-medium">{rttSub}</div>
        </div>

        {/* Goodput vs Wire */}
        <div className="p-4 space-y-1">
          <div className="flex items-center gap-2 text-slate-600 font-semibold">
            <Zap size={16} className="text-orange-600" />
            <span>GOODPUT / WIRE RATE</span>
          </div>
          <div className="text-2xl font-black text-teal-800 font-tabular">
            {fmtKbps(status?.goodput_kbps)}
          </div>
          <div className="text-xs text-slate-500 font-medium">
            Wire: {fmtKbps(status?.throughput_kbps)}
          </div>
        </div>

        {/* Channel Loss Ratio */}
        <div className="p-4 space-y-1">
          <div className="flex items-center gap-2 text-slate-600 font-semibold">
            <Flame size={16} className="text-rose-600" />
            <span>LOSS RATIO & DROPS</span>
          </div>
          <div className="text-2xl font-black text-rose-700 font-tabular">
            {lossPct.toFixed(1)}%
          </div>
          <div className="text-xs text-slate-500 font-medium">
            {lost} lost · {duplicates} dupes
          </div>
        </div>

        {/* CRC-32 Integrity & ETA */}
        <div className="p-4 space-y-1">
          <div className="flex items-center gap-2 text-slate-600 font-semibold">
            <ShieldCheck size={16} className="text-emerald-600" />
            <span>CRC-32 / EST. REMAINING</span>
          </div>
          <div className="text-2xl font-black text-slate-900 font-tabular">
            {fmtEta(status?.eta_seconds)}
          </div>
          <div className="text-xs text-slate-500 font-medium">
            {crcErrors > 0 ? `${crcErrors} CRC errors detected` : "0 checksum corruptions"}
          </div>
        </div>
      </div>
    </Panel>
  );
}