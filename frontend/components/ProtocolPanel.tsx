"use client";

import { useState } from "react";
import { ChevronDown, FileCode2 } from "lucide-react";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Snapshot } from "@/lib/types";

function Row({ label, value, on }: { label: string; value: string; on?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md px-3 py-2 font-mono text-[12px]">
      <span className="text-slate-500">{label}</span>
      <span className={on ? "text-emerald-400" : "text-slate-200"}>{value}</span>
    </div>
  );
}

export function ProtocolPanel({ status }: { status: Snapshot | null }) {
  const [open, setOpen] = useState(false);
  const name = status?.protocol;

  return (
    <Panel>
      <PanelHeader
        title="Protocol Details"
        icon={<FileCode2 size={14} />}
        right={
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1 rounded-md border border-slate-800 px-2 py-1 text-[11px] text-slate-400 transition hover:text-slate-200"
          >
            {open ? "collapse" : "expand"}
            <ChevronDown
              size={13}
              className={cn("transition-transform", open && "rotate-180")}
            />
          </button>
        }
      />
      <div className={cn("px-2 pb-2", !open && "hidden")}>
        <div className="divide-y divide-slate-800/50">
          <Row label="Transport Layer" value={name?.transport ?? "UDP"} />
          <Row label="Reliability" value={name?.reliability ?? "Stop-and-Wait ARQ"} on />
          <Row
            label="Packet Size"
            value={`${name?.packet_size ?? status?.config.packet_size ?? 1024} bytes`}
          />
          <Row label="Sequence Numbers" value="Enabled" on />
          <Row label="Acknowledgements" value="Enabled" on />
          <Row label="Retransmission" value="Enabled" on />
        </div>
        <div className="mt-2 flex flex-wrap gap-2 px-1">
          <Badge tone="slate">checksum: {name?.checksum ?? "coming soon"}</Badge>
          <Badge tone="slate">resume: {name?.resume ?? "coming soon"}</Badge>
        </div>
      </div>
      {!open && (
        <p className="px-4 pb-3 text-[11px] text-slate-600">
          Header layout: seq (4B) · type (1B) · length (4B) · payload — expand for details
        </p>
      )}
    </Panel>
  );
}