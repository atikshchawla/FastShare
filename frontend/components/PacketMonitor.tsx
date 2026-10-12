"use client";

import { useState } from "react";
import { LayoutList, SplitSquareVertical, Table, Terminal } from "lucide-react";
import {
  EventTraceConsole,
  ROW_TONE_CLASSES,
} from "@/components/EventTraceConsole";
import { Panel, PanelHeader } from "@/components/ui";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import type { FeedLine, PacketEntry, PacketStatus } from "@/lib/types";

function getStatusBadge(status: PacketStatus, retries: number) {
  switch (status) {
    case "ACKED":
      return (
        <span className="inline-flex items-center gap-1 border border-green-500 bg-green-500/20 px-2 py-0.5 text-[11px] font-black text-green-400">
          ✓ ACKED
        </span>
      );
    case "RETRANSMITTED":
      return (
        <span className="inline-flex items-center gap-1 border border-amber-500 bg-amber-500/20 px-2 py-0.5 text-[11px] font-black text-amber-400">
          ↻ RETRIED ({retries})
        </span>
      );
    case "TIMEOUT":
      return (
        <span className="inline-flex items-center gap-1 border border-red-500 bg-red-500/20 px-2 py-0.5 text-[11px] font-black text-red-400">
          ✕ TIMEOUT
        </span>
      );
    case "SENT":
      return (
        <span className="inline-flex items-center gap-1 border border-cyan-500 bg-cyan-500/20 px-2 py-0.5 text-[11px] font-black text-cyan-300">
          → SENT
        </span>
      );
    case "WAITING":
      return (
        <span className="inline-flex items-center gap-1 border border-cyan-500/50 bg-cyan-950/40 px-2 py-0.5 text-[11px] font-bold text-cyan-400">
          … WAITING
        </span>
      );
    case "FAILED":
      return (
        <span className="inline-flex items-center gap-1 border border-red-600 bg-red-600/30 px-2 py-0.5 text-[11px] font-black text-red-300">
          ✕ FAILED
        </span>
      );
  }
}

export function PacketMonitor({
  packets,
  feed = [],
}: {
  packets: PacketEntry[];
  feed?: FeedLine[];
}) {
  const [view, setView] = useState<"table" | "trace" | "both">("both");
  const body = useStickToBottom<HTMLDivElement>();
  const rows = packets.slice(-150);

  return (
    <Panel>
      <PanelHeader
        title="PACKET MONITOR"
        icon={<LayoutList size={15} />}
        right={
          <div className="flex items-center gap-2">
            {/* View switcher buttons */}
            <div className="flex border-2 border-neutral-700 bg-neutral-900 font-mono text-[11px]">
              <button
                onClick={() => setView("table")}
                className={`flex items-center gap-1.5 px-3 py-1 font-bold uppercase transition ${
                  view === "table"
                    ? "bg-cyan-500 text-black font-black"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                <Table size={12} />
                FRAME TABLE ({packets.length})
              </button>
              <button
                onClick={() => setView("both")}
                className={`flex items-center gap-1.5 border-l-2 border-neutral-700 px-3 py-1 font-bold uppercase transition ${
                  view === "both"
                    ? "bg-cyan-500 text-black font-black"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                <SplitSquareVertical size={12} />
                SPLIT VIEW
              </button>
              <button
                onClick={() => setView("trace")}
                className={`flex items-center gap-1.5 border-l-2 border-neutral-700 px-3 py-1 font-bold uppercase transition ${
                  view === "trace"
                    ? "bg-cyan-500 text-black font-black"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                <Terminal size={12} />
                TRACE ({feed.length})
              </button>
            </div>
          </div>
        }
      />

      <div className="w-full">
        {/* TRANSMISSION FRAME TABLE (Takes full 100% width) */}
        {(view === "table" || view === "both") && (
          <div className="w-full">
            <div className="flex items-center justify-between border-b-2 border-neutral-700 bg-neutral-950 px-2.5 py-2 font-mono text-[11px] font-black uppercase tracking-wider text-neutral-300">
              <span>TRANSMISSION FRAME TABLE (STOP-AND-WAIT ARQ)</span>
              <span className="text-neutral-500 text-[10px]">SHOWING LAST {rows.length} FRAMES</span>
            </div>

            <div className="w-full overflow-hidden">
              {/* Header table with 100% full width and fixed column percentages */}
              <table className="w-full table-fixed text-left font-mono text-xs">
                <thead>
                  <tr className="border-b-2 border-neutral-700 bg-neutral-900 text-[11px] font-black uppercase tracking-widest text-neutral-300">
                    <th className="w-[15%] px-2.5 py-2.5 text-right">SEQUENCE</th>
                    <th className="w-[15%] px-2.5 py-2.5">PACKET TYPE</th>
                    <th className="w-[20%] px-2.5 py-2.5 text-right">PAYLOAD SIZE</th>
                    <th className="w-[30%] px-2.5 py-2.5">TRANSMISSION STATUS</th>
                    <th className="w-[20%] px-2.5 py-2.5 text-right">RETRY ATTEMPTS</th>
                  </tr>
                </thead>
              </table>

              {/* Scrollable Body table with exact matching column widths */}
              <div
                ref={body.ref}
                onScroll={body.onScroll}
                onWheel={body.onWheel}
                className={`${view === "both" ? "h-64" : "h-80"} w-full overflow-y-auto bg-black`}
              >
                <table className="w-full table-fixed text-left font-mono text-xs">
                  <tbody className="divide-y divide-neutral-800">
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-2.5 py-16 text-center text-neutral-600 font-bold uppercase tracking-wider"
                        >
                          NO PACKETS TRANSMITTED YET — START A TRANSFER TO POPULATE TABLE
                        </td>
                      </tr>
                    ) : (
                      rows.map((p) => (
                        <tr
                          key={`${p.seq}-${p.status}-${p.retries}`}
                          className={`transition-colors ${
                            p.status === "TIMEOUT" || p.status === "FAILED"
                              ? "bg-red-950/30"
                              : p.status === "RETRANSMITTED"
                              ? "bg-amber-950/20"
                              : "hover:bg-neutral-900/60"
                          }`}
                        >
                          <td className="w-[15%] px-2.5 py-2 text-right font-black text-cyan-400">
                            #{p.seq}
                          </td>
                          <td className="w-[15%] px-2.5 py-2 font-bold text-neutral-200">
                            {p.type}
                          </td>
                          <td className="w-[20%] px-2.5 py-2 text-right text-neutral-300">
                            {p.size} B
                          </td>
                          <td className="w-[30%] px-2.5 py-2">
                            {getStatusBadge(p.status, p.retries)}
                          </td>
                          <td
                            className={`w-[20%] px-2.5 py-2 text-right font-black ${
                              p.retries > 0 ? "text-amber-400" : "text-neutral-500"
                            }`}
                          >
                            {p.retries}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* LIVE EVENT TRACE (Full 100% width) */}
        {(view === "trace" || view === "both") && (
          <div className={`w-full ${view === "both" ? "border-t-2 border-neutral-700" : ""}`}>
            <div className="flex items-center justify-between border-b-2 border-neutral-700 bg-neutral-950 px-2.5 py-2 text-[11px] font-black uppercase tracking-wider text-neutral-300">
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-cyan-400" />
                <span>LIVE EVENT TRACE CONSOLE (FULL-WIDTH)</span>
              </div>
              <span className="font-mono text-[10px] text-neutral-500">
                {feed.length} EVENTS RECORDED
              </span>
            </div>

            <EventTraceConsole
              feed={feed}
              variant="rows"
              toneClasses={ROW_TONE_CLASSES}
              heightClass={view === "both" ? "h-48" : "h-80"}
              containerClass="p-4 font-mono text-[12px] leading-6 space-y-1.5 bg-black"
              emptyText="Awaiting socket events..."
              emptyClass="text-neutral-600 italic"
            />
          </div>
        )}
      </div>
    </Panel>
  );
}
