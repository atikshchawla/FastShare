"use client";

import { useEffect, useRef, useState } from "react";
import { LayoutList, Terminal } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui";
import type { FeedLine, PacketEntry, PacketStatus } from "@/lib/types";

function getStatusBadge(status: PacketStatus, retries: number) {
  switch (status) {
    case "ACKED":
      return (
        <span className="rounded-md border border-emerald-300 bg-emerald-50 text-emerald-900 px-2.5 py-0.5 text-xs font-extrabold font-mono">
          ✓ ACKED
        </span>
      );
    case "RETRANSMITTED":
      return (
        <span className="rounded-md border border-orange-300 bg-orange-50 text-orange-950 px-2.5 py-0.5 text-xs font-extrabold font-mono">
          ↻ RETRIED ({retries})
        </span>
      );
    case "TIMEOUT":
      return (
        <span className="rounded-md border border-rose-300 bg-rose-50 text-rose-950 px-2.5 py-0.5 text-xs font-extrabold font-mono">
          ✕ TIMEOUT
        </span>
      );
    case "SENT":
      return (
        <span className="rounded-md border border-teal-300 bg-teal-50 text-teal-950 px-2.5 py-0.5 text-xs font-extrabold font-mono">
          → SENT
        </span>
      );
    case "WAITING":
      return (
        <span className="rounded-md border border-slate-300 bg-slate-100 text-slate-700 px-2.5 py-0.5 text-xs font-extrabold font-mono">
          … WAITING
        </span>
      );
    case "FAILED":
      return (
        <span className="rounded-md border border-rose-400 bg-rose-100 text-rose-950 px-2.5 py-0.5 text-xs font-extrabold font-mono">
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
  const [view, setView] = useState<"table" | "trace" | "both">("table");
  const bodyRef = useRef<HTMLDivElement>(null);
  const traceRef = useRef<HTMLDivElement>(null);
  const isBodyAtBottomRef = useRef(true);
  const isTraceAtBottomRef = useRef(true);
  const rows = packets.slice(-150);

  const handleBodyScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isBodyAtBottomRef.current = distanceToBottom <= 15;
  };

  const handleTraceScroll = () => {
    const el = traceRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isTraceAtBottomRef.current = distanceToBottom <= 15;
  };

  const handleBodyWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) {
      isBodyAtBottomRef.current = false;
    }
  };

  const handleTraceWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) {
      isTraceAtBottomRef.current = false;
    }
  };

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (isBodyAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [packets, view]);

  useEffect(() => {
    const el = traceRef.current;
    if (!el) return;
    if (isTraceAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [feed, view]);

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Transmission Frame Register & Physical Trace Monitor"
        badgeText="DATAGRAM LOG"
        icon={<LayoutList size={20} className="stroke-[2.5]" />}
        right={
          <div className="flex items-center gap-2">
            <div className="flex rounded-xl border-2 border-slate-200 bg-slate-100 p-1 font-mono text-xs">
              <button
                onClick={() => setView("table")}
                className={`rounded-lg px-3 py-1 font-extrabold transition-all ${
                  view === "table"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                FRAME TABLE
              </button>
              <button
                onClick={() => setView("trace")}
                className={`rounded-lg px-3 py-1 font-extrabold transition-all ${
                  view === "trace"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                RAW STREAM
              </button>
              <button
                onClick={() => setView("both")}
                className={`rounded-lg px-3 py-1 font-extrabold transition-all ${
                  view === "both"
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                SPLIT VIEW
              </button>
            </div>
            <span className="hidden sm:inline-block rounded-lg bg-teal-50 border border-teal-200 px-3 py-1 text-xs font-mono font-extrabold text-teal-900">
              {packets.length} FRAMES
            </span>
          </div>
        }
      />

      <div
        className={`grid ${
          view === "both" ? "grid-cols-1 lg:grid-cols-2 divide-y-2 lg:divide-y-0 lg:divide-x-2 divide-slate-100" : "grid-cols-1"
        }`}
      >
        {/* Table View */}
        {(view === "table" || view === "both") && (
          <div className="flex flex-col font-mono">
            {/* Table Header */}
            <div className="grid grid-cols-12 bg-slate-100/90 border-b-2 border-slate-200 px-4 py-3 text-xs sm:text-sm font-extrabold text-slate-700 uppercase tracking-wide">
              <div className="col-span-2">SEQ</div>
              <div className="col-span-3">STATUS</div>
              <div className="col-span-2">SIZE</div>
              <div className="col-span-2">RETRIES</div>
              <div className="col-span-3 text-right">TYPE / RTT</div>
            </div>

            {/* Table Rows Body */}
            <div
              ref={bodyRef}
              onScroll={handleBodyScroll}
              onWheel={handleBodyWheel}
              className="h-80 overflow-y-auto divide-y divide-slate-100 text-xs sm:text-sm bg-white"
            >
              {rows.length === 0 ? (
                <div className="p-8 text-center text-slate-400 italic">
                  No transmission frames sent yet. Start transfer to observe ARQ datagram log.
                </div>
              ) : (
                rows.map((p) => (
                  <div
                    key={p.seq}
                    className="grid grid-cols-12 items-center px-4 py-2.5 hover:bg-slate-50 transition-colors"
                  >
                    <div className="col-span-2 font-black text-slate-900 font-tabular">
                      #{p.seq}
                    </div>
                    <div className="col-span-3">{getStatusBadge(p.status, p.retries)}</div>
                    <div className="col-span-2 font-medium text-slate-600 font-tabular">
                      {p.size} B
                    </div>
                    <div className="col-span-2 font-medium text-slate-600 font-tabular">
                      {p.retries > 0 ? (
                        <span className="font-extrabold text-orange-600">×{p.retries}</span>
                      ) : (
                        "0"
                      )}
                    </div>
                    <div className="col-span-3 text-right font-mono text-xs text-slate-500 font-tabular truncate">
                      {p.type} {p.rtt_ms != null ? `(${p.rtt_ms.toFixed(1)}ms)` : ""}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Trace Stream View */}
        {(view === "trace" || view === "both") && (
          <div className="flex flex-col font-mono bg-slate-50/50">
            <div className="bg-slate-100/90 border-b-2 border-slate-200 px-4 py-3 text-xs sm:text-sm font-extrabold text-slate-700 uppercase tracking-wide flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal size={15} className="text-teal-700" />
                <span>RAW SOCKET EVENT STREAM</span>
              </div>
              <span className="text-xs text-slate-500 font-semibold">{feed.length} EVENTS</span>
            </div>

            <div
              ref={traceRef}
              onScroll={handleTraceScroll}
              onWheel={handleTraceWheel}
              className="h-80 overflow-y-auto p-4 space-y-1.5 text-xs sm:text-sm bg-white text-slate-700 font-mono shadow-inner"
            >
              {feed.length === 0 ? (
                <div className="p-8 text-center text-slate-400 italic">
                  Event log is empty. Socket events will appear here in real time.
                </div>
              ) : (
                feed.map((line, i) => (
                  <div key={`${line.t}-${i}`} className="leading-relaxed">
                    <span className="text-slate-400 mr-2 select-none">
                      [{new Date(line.t * 1000).toLocaleTimeString(undefined, { hour12: false })}]
                    </span>
                    <span className={
                      /lost|timeout/i.test(line.text)
                        ? "text-rose-700 font-bold bg-rose-50 px-1 py-0.5 rounded"
                        : /retransmit/i.test(line.text)
                        ? "text-orange-700 font-bold"
                        : /ack/i.test(line.text)
                        ? "text-emerald-700 font-bold"
                        : "text-slate-800"
                    }>
                      {line.text}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}