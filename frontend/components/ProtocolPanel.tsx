"use client";

import { Check, Info, Cpu } from "lucide-react";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import type { Snapshot } from "@/lib/types";

const IMPLEMENTED_FEATURES = [
  "UDP Client / Server",
  "File Packetization",
  "Sequence Numbers",
  "ACK Mechanism",
  "Stop-and-Wait ARQ",
  "Retransmission on Timeout",
  "Duplicate Handling",
  "Packet Loss Simulation",
  "CRC-32 Checksum Verification",
  "Corruption Simulation (both directions)",
  "Resume Interrupted Transfer (.part + .meta)",
  "Statistics: RTT/SRTT, goodput, loss, ETA",
];

const PROTOCOL_PROPERTIES = [
  "Window size = 1 (pure Stop-and-Wait)",
  "Header: seq(4) + type(1) + len(4) + crc32(4)",
  "CRC-32 over payload (zlib, wire + replay path)",
  "Corrupted packets dropped without ACK",
  "Resume point = whole packets already on disk",
  "SRTT = EWMA(0.875, 0.125), RFC 6298 style",
  "Goodput excludes bytes reused by resume",
];

export function ProtocolPanel({ status }: { status: Snapshot | null }) {
  const packetSize = status?.config.packet_size ?? 1024;
  return (
    <Panel>
      <PanelHeader
        title="PROTOCOL SPECIFICATION & STATUS"
        icon={<Cpu size={15} />}
        right={
          <Badge tone="cyan" className="font-mono text-[10px]">
            RFC SPECIFICATION
          </Badge>
        }
      />

      <div className="p-4 space-y-4">
        {/* Wire Header Specification */}
        <div className="border-2 border-neutral-700 bg-neutral-950 p-3 font-mono text-xs">
          <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400 mb-2">
            FASTSHARE BINARY WIRE FORMAT (13-BYTE HEADER)
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-5 border-2 border-neutral-700 text-center font-bold">
            <div className="border-r-2 border-neutral-700 bg-neutral-900 p-2">
              <span className="block text-[10px] text-neutral-500">SEQ NUM</span>
              <span className="text-white">4 BYTES</span>
            </div>
            <div className="border-r-2 border-neutral-700 bg-neutral-900 p-2">
              <span className="block text-[10px] text-neutral-500">TYPE</span>
              <span className="text-white">1 BYTE</span>
            </div>
            <div className="border-r-2 border-neutral-700 bg-neutral-900 p-2">
              <span className="block text-[10px] text-neutral-500">LENGTH</span>
              <span className="text-white">4 BYTES</span>
            </div>
            <div className="border-r-2 sm:border-r-2 border-neutral-700 bg-neutral-900 p-2">
              <span className="block text-[10px] text-neutral-500">CRC-32</span>
              <span className="text-amber-300">4 BYTES</span>
            </div>
            <div className="bg-neutral-800 p-2">
              <span className="block text-[10px] text-neutral-500">PAYLOAD</span>
              <span className="text-cyan-300">{packetSize} BYTES MAX</span>
            </div>
          </div>
        </div>

        {/* Feature Implementation Status (Requirement from Section 9) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* IMPLEMENTED */}
          <div className="border-2 border-green-500/50 bg-green-950/10 p-3">
            <p className="text-xs font-black uppercase tracking-widest text-green-400 mb-2 flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 bg-green-400" />
              IMPLEMENTED
            </p>
            <div className="space-y-1.5 font-mono text-xs">
              {IMPLEMENTED_FEATURES.map((f) => (
                <div key={f} className="flex items-center gap-2 text-neutral-200">
                  <Check size={14} className="text-green-400 shrink-0" />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>

          {/* PROTOCOL PROPERTIES */}
          <div className="border-2 border-cyan-500/40 bg-cyan-950/10 p-3">
            <p className="text-xs font-black uppercase tracking-widest text-cyan-400 mb-2 flex items-center gap-1.5">
              <Info size={13} className="shrink-0" />
              PROTOCOL PROPERTIES
            </p>
            <div className="space-y-1.5 font-mono text-xs">
              {PROTOCOL_PROPERTIES.map((f) => (
                <div key={f} className="flex items-center gap-2 text-neutral-300">
                  <span className="text-cyan-500 shrink-0">›</span>
                  <span>{f}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t border-neutral-800 pt-2 text-[10px] font-mono text-neutral-500">
              All roadmap features (checksum · statistics · resume) are active
              in this build.
            </p>
          </div>
        </div>
      </div>
    </Panel>
  );
}
