"use client";

import { BarChart3, ShieldOff } from "lucide-react";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import type { Snapshot } from "@/lib/types";

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-800/70 bg-[#070b12] px-3 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
        {label}
      </p>
      <p
        className={
          "mt-1 font-mono text-xl font-bold " +
          (accent ? "text-cyan-300" : "text-slate-100")
        }
      >
        {value}
      </p>
    </div>
  );
}

export function NetworkingStats({ status }: { status: Snapshot | null }) {
  return (
    <Panel>
      <PanelHeader
        title="Networking Statistics"
        icon={<BarChart3 size={14} />}
        right={<Badge tone="slate">live</Badge>}
      />
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
        <Stat label="Packets Sent" value={status?.packets_sent ?? 0} />
        <Stat label="Packets ACKed" value={status?.packets_acked ?? 0} accent />
        <Stat
          label="Retransmissions"
          value={status?.retransmissions ?? 0}
        />
        <Stat label="Packets Lost" value={status?.packets_lost ?? 0} />
        <Stat
          label="Current Sequence"
          value={status?.current_sequence ?? 0}
        />
        <Stat label="Duplicates" value={status?.duplicate_packets ?? 0} />
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-800/70 px-4 py-3">
        <Badge tone="slate" className="px-2.5 py-1">
          <ShieldOff size={11} /> Checksum — Coming Soon
        </Badge>
        <Badge tone="slate" className="px-2.5 py-1">
          <ShieldOff size={11} /> Resume Transfer — Coming Soon
        </Badge>
      </div>
    </Panel>
  );
}