"use client";

import { Check, Cpu } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui";
import type { Snapshot } from "@/lib/types";

const IMPLEMENTED_FEATURES = [
  "Raw UDP Socket Client / Server Architecture",
  "Application-Layer Packet Segmentation (MTU/MSS)",
  "Monotonic Sequence Numbers (Stop-and-Wait)",
  "Explicit Acknowledgement (ACK) Control Packets",
  "Stop-and-Wait ARQ Automatic Retransmit on Timeout",
  "Receiver Duplicate Packet Discarding",
  "Live Network Fault Simulation (Drop & Bitflip)",
  "CRC-32 Checksum Integrity Verification",
  "Corrupted Frame Silent Drop (Triggering Timeout)",
  "Resume Interrupted Sessions via State Metainfo",
  "EWMA Smoothed Round-Trip-Time (SRTT) RFC 6298",
  "Net Goodput vs Total Wire Overhead Telemetry",
];

const PROTOCOL_PROPERTIES = [
  "ARQ Window Size = 1 (Pure Stop-and-Wait)",
  "Custom Binary Header: SEQ(4B) + TYPE(1B) + LEN(4B) + CRC(4B)",
  "End-to-End CRC-32 integrity over raw datagram payload",
  "Sender retransmission timer backed by select()/socket timeout",
  "Interrupted transfer recovery resumes from last confirmed packet",
  "SRTT computed with alpha=0.125 smoothing filter",
  "Goodput metric computes payload bytes delivered per second",
];

export function ProtocolPanel({ status }: { status: Snapshot | null }) {
  const packetSize = status?.config.packet_size ?? 1024;

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Protocol Specification & RFC Compliance Matrix"
        badgeText="SPECIFICATION SHEET"
        icon={<Cpu size={20} className="stroke-[2.5]" />}
        right={
          <span className="font-mono text-xs sm:text-sm font-extrabold text-teal-800 bg-teal-50 px-3 py-1 rounded-xl border border-teal-200">
            FASTSHARE RFC SPEC
          </span>
        }
      />

      <div className="p-6 font-mono text-xs sm:text-sm space-y-6">
        {/* Wire Header Specification */}
        <div className="rounded-2xl border-2 border-slate-200 bg-slate-50/70 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs sm:text-sm font-extrabold uppercase tracking-wide text-teal-900">
              Binary Wire Format (13-Byte Custom Datagram Header)
            </span>
            <span className="text-xs text-slate-500 font-semibold">
              Network Byte Order (Big-Endian)
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 divide-y-2 sm:divide-y-0 sm:divide-x-2 divide-slate-200 border-2 border-slate-200 rounded-xl bg-white text-center font-bold overflow-hidden shadow-2xs">
            <div className="p-3.5">
              <span className="block text-[11px] text-slate-500 uppercase font-semibold">SEQ NUMBER</span>
              <span className="text-slate-900 text-sm sm:text-base font-extrabold mt-0.5 block font-tabular">4 BYTES</span>
            </div>
            <div className="p-3.5">
              <span className="block text-[11px] text-slate-500 uppercase font-semibold">FRAME TYPE</span>
              <span className="text-slate-900 text-sm sm:text-base font-extrabold mt-0.5 block">1 BYTE</span>
            </div>
            <div className="p-3.5">
              <span className="block text-[11px] text-slate-500 uppercase font-semibold">PAYLOAD LEN</span>
              <span className="text-slate-900 text-sm sm:text-base font-extrabold mt-0.5 block font-tabular">4 BYTES</span>
            </div>
            <div className="p-3.5">
              <span className="block text-[11px] text-slate-500 uppercase font-semibold">CRC-32 CODE</span>
              <span className="text-orange-600 text-sm sm:text-base font-extrabold mt-0.5 block">4 BYTES</span>
            </div>
            <div className="p-3.5 bg-teal-50/80">
              <span className="block text-[11px] text-teal-900 font-extrabold uppercase">PAYLOAD CHUNK</span>
              <span className="text-teal-950 text-sm sm:text-base font-extrabold mt-0.5 block font-tabular">≤ {packetSize} B</span>
            </div>
          </div>
        </div>

        {/* Feature Implementation Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Implemented checklist */}
          <div className="rounded-2xl border-2 border-teal-200 bg-teal-50/40 p-5">
            <span className="text-xs sm:text-sm font-extrabold uppercase text-teal-950 block mb-3">
              ✓ Core Lab Architecture Implemented
            </span>
            <div className="grid grid-cols-1 gap-2 text-xs sm:text-sm">
              {IMPLEMENTED_FEATURES.map((f) => (
                <div key={f} className="flex items-center gap-2 text-slate-800">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-teal-700 text-white">
                    <Check size={11} className="stroke-[3]" />
                  </span>
                  <span className="font-medium">{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Protocol Design Rules */}
          <div className="rounded-2xl border-2 border-slate-200 bg-slate-50/70 p-5">
            <span className="text-xs sm:text-sm font-extrabold uppercase text-slate-800 block mb-3">
              Engine Mechanics &amp; RFC Standards
            </span>
            <div className="grid grid-cols-1 gap-2 text-xs sm:text-sm">
              {PROTOCOL_PROPERTIES.map((p, idx) => (
                <div key={p} className="flex items-start gap-2.5 text-slate-700">
                  <span className="text-orange-600 font-black shrink-0">0{idx + 1}.</span>
                  <span className="font-medium leading-relaxed">{p}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
