"use client";

import { useEffect, useRef } from "react";
import { LayoutList } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { PacketEntry, PacketStatus } from "@/lib/types";

const statusStyle: Record<PacketStatus, string> = {
  SENT: "text-cyan-300",
  WAITING: "text-cyan-400",
  ACKED: "text-emerald-400",
  TIMEOUT: "text-rose-400",
  RETRANSMITTED: "text-amber-400",
  FAILED: "text-rose-500",
};

const statusDot: Record<PacketStatus, string> = {
  SENT: "bg-cyan-400",
  WAITING: "bg-cyan-300",
  ACKED: "bg-emerald-400",
  TIMEOUT: "bg-rose-500",
  RETRANSMITTED: "bg-amber-400",
  FAILED: "bg-rose-500",
};

export function PacketMonitor({ packets }: { packets: PacketEntry[] }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const rows = packets.slice(-80);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  return (
    <Panel>
      <PanelHeader
        title="Packet Monitor"
        icon={<LayoutList size={14} />}
        right={
          <span className="font-mono text-[11px] text-slate-500">
            {packets.length} tracked · showing last {rows.length}
          </span>
        }
      />
      <div className="p-4 pt-3">
        <div className="overflow-hidden rounded-lg border border-slate-800/70">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-slate-800 bg-[#070b12] text-[10px] uppercase tracking-widest text-slate-500">
                <th className="px-3 py-2 font-semibold">Sequence</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 text-right font-semibold">Size</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Retries</th>
              </tr>
            </thead>
          </table>
          <div
            ref={bodyRef}
            className="h-56 overflow-y-auto bg-[#070b12]"
          >
            <table className="w-full text-left text-[12px]">
              <tbody className="divide-y divide-slate-800/40 font-mono">
                {rows.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-slate-600">
                      no packets yet — start a transfer
                    </td>
                  </tr>
                )}
                {rows.map((p) => (
                  <tr
                    key={`${p.seq}-${p.status}-${p.retries}`}
                    className={cn(
                      "transition-colors",
                      p.status === "RETRANSMITTED"
                        ? "bg-amber-500/[0.06]"
                        : p.status === "TIMEOUT" || p.status === "FAILED"
                          ? "bg-rose-500/[0.05]"
                          : "hover:bg-slate-800/40",
                    )}
                  >
                    <td className="px-3 py-1.5 text-slate-300">#{p.seq}</td>
                    <td className="px-3 py-1.5">
                      <span className="text-slate-400">{p.type}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-400">
                      {p.size} B
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 font-semibold",
                          statusStyle[p.status],
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            statusDot[p.status],
                          )}
                        />
                        {p.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-slate-400">
                      {p.retries}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Panel>
  );
}