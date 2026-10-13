"use client";

import { useEffect, useRef, useState } from "react";
import {
  Terminal,
  Radio,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Sparkles,
} from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { FeedLine, Snapshot } from "@/lib/types";

export function TransferVisualization({
  status,
  feed,
}: {
  status: Snapshot | null;
  feed: FeedLine[];
}) {
  const transferring = status?.transfer_status === "transferring";
  const completed = status?.transfer_status === "completed";
  const failed = status?.transfer_status === "failed";
  const [phase, setPhase] = useState<"data" | "ack">("data");

  const recentFeed = feed.slice(-3);
  const hasRecentLoss = recentFeed.some((f) => /lost|timeout/i.test(f.text));
  const hasRecentRetransmit = recentFeed.some((f) =>
    /retransmit/i.test(f.text),
  );

  useEffect(() => {
    if (!transferring) return;
    const id = setInterval(
      () => setPhase((p) => (p === "data" ? "ack" : "data")),
      480,
    );
    return () => clearInterval(id);
  }, [transferring]);

  const sending = status && transferring ? status.current_sequence + 1 : null;
  const tx =
    status && status.total_packets > 0
      ? Math.min(sending ?? 1, status.total_packets)
      : (sending ?? 1);
  const lastAcked = status?.current_sequence ?? 0;
  const total = status?.total_packets ?? 0;

  const terminalRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const handleScroll = () => {
    const el = terminalRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAtBottomRef.current = distanceToBottom <= 15;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.deltaY < 0) {
      isAtBottomRef.current = false;
    }
  };

  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return;
    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [feed]);

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Physical Socket Wire & Stop-and-Wait ARQ Conduit"
        badgeText="REAL-TIME OSCILLOSCOPE"
        icon={<Radio size={20} className="stroke-[2.5]" />}
        right={
          transferring ? (
            <div className="flex items-center gap-2 rounded-xl bg-teal-50 border-2 border-teal-300 px-3.5 py-1.5 font-mono text-xs sm:text-sm font-extrabold text-teal-900 shadow-xs animate-pulse">
              <span className="h-2 w-2 rounded-full bg-teal-600" />
              <span>TRANSMITTING FRAME #{tx}</span>
            </div>
          ) : completed ? (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border-2 border-emerald-300 px-3.5 py-1.5 font-mono text-xs sm:text-sm font-extrabold text-emerald-900 shadow-xs">
              <CheckCircle2 size={16} className="text-emerald-600" />
              <span>ALL {total} FRAMES CONFIRMED</span>
            </div>
          ) : failed ? (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 border-2 border-rose-300 px-3.5 py-1.5 font-mono text-xs sm:text-sm font-extrabold text-rose-900 shadow-xs">
              <XCircle size={16} className="text-rose-600" />
              <span>TRANSMISSION FAILED</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl bg-slate-100 border-2 border-slate-200 px-3.5 py-1.5 font-mono text-xs sm:text-sm font-bold text-slate-700">
              <span className="h-2 w-2 rounded-full bg-slate-400" />
              <span>CHANNEL READY</span>
            </div>
          )
        }
      />

      {/* Main Conduit Body: Sender | Active Oscilloscope Wire | Receiver */}
      <div className="grid grid-cols-1 md:grid-cols-12 divide-y-2 md:divide-y-0 md:divide-x-2 divide-slate-100 bg-white">
        {/* SENDER NODE (Client) - Soft Teal */}
        <div className="md:col-span-3 p-6 bg-gradient-to-br from-teal-50/50 via-teal-50/20 to-white flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b-2 border-teal-100 pb-2 mb-3">
              <span className="text-xs font-mono font-extrabold text-teal-900 uppercase tracking-wider">
                TRANSMITTER [TX]
              </span>
              <span className="rounded-md bg-teal-100 px-2.5 py-0.5 text-xs font-mono font-extrabold text-teal-800">
                CLIENT
              </span>
            </div>
            <p className="font-display text-lg sm:text-xl font-black text-slate-900">
              Client Socket
            </p>
            <p className="font-mono text-xs sm:text-sm text-slate-600 mt-1">
              {status?.config.server_ip ?? "127.0.0.1"} (AF_INET)
            </p>
          </div>

          <div className="mt-6 rounded-xl border-2 border-teal-200 bg-white p-3.5 shadow-xs">
            <span className="text-[11px] font-mono uppercase text-slate-500 font-bold block">
              Outbound Register
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-mono text-2xl sm:text-3xl font-black text-teal-800 font-tabular">
                SEQ #{tx}
              </span>
              <span className="text-xs font-mono font-bold text-teal-600">
                / {total || "--"}
              </span>
            </div>
          </div>
        </div>

        {/* PHYSICAL ARQ CONDUIT & WIRE ANIMATION */}
        <div className="md:col-span-6 p-6 flex flex-col justify-between space-y-4 bg-slate-50/50">
          <div className="flex items-center justify-between border-b-2 border-slate-200/80 pb-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs sm:text-sm uppercase font-extrabold text-slate-700">
                Stop-and-Wait Wire Conduit
              </span>
              <span className="rounded-md bg-slate-200 px-2 py-0.5 text-[11px] font-mono font-bold text-slate-700">
                W=1
              </span>
            </div>
            <span className="font-mono text-xs sm:text-sm font-bold text-slate-600">
              MSS {status?.config.packet_size ?? 1024} Bytes
            </span>
          </div>

          {/* Dynamic SVG Animated Wire */}
          <div className="w-full py-2 px-1">
            <div className="relative flex items-center">
              <svg className="w-full h-4 overflow-visible" preserveAspectRatio="none">
                <line
                  x1="0%"
                  y1="50%"
                  x2="100%"
                  y2="50%"
                  stroke={transferring ? (phase === "data" ? "#0f766e" : "#ea580c") : "#cbd5e1"}
                  strokeWidth="4"
                  strokeDasharray="8 6"
                  className={cn(
                    transferring && (phase === "data" ? "animate-wire-forward" : "animate-wire-backward"),
                  )}
                />
              </svg>
            </div>
          </div>

          {/* Dual Packet Shuttles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
            {/* DATA Packet Flight Strip (Teal) */}
            <div
              className={cn(
                "rounded-xl border-2 p-3.5 transition-all text-xs sm:text-sm",
                transferring && phase === "data"
                  ? "border-teal-400 bg-teal-50 text-teal-950 shadow-sm font-bold ring-2 ring-teal-200/60"
                  : "border-slate-200 bg-white text-slate-400 opacity-60",
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="rounded-md bg-teal-700 text-white px-2 py-0.5 text-xs font-bold flex items-center gap-1">
                  DATA <ArrowRight size={12} />
                </span>
                <span className="font-extrabold text-teal-900">FRAME #{tx}</span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                {status?.config.packet_size ?? 1024} B Payload + 13 B Header
              </p>
            </div>

            {/* ACK Packet Return Strip (Orange) */}
            <div
              className={cn(
                "rounded-xl border-2 p-3.5 transition-all text-xs sm:text-sm",
                transferring && phase === "ack"
                  ? "border-orange-400 bg-orange-50 text-orange-950 shadow-sm font-bold ring-2 ring-orange-200/60"
                  : "border-slate-200 bg-white text-slate-400 opacity-60",
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-extrabold text-orange-900">ACK #{lastAcked}</span>
                <span className="rounded-md bg-orange-600 text-white px-2 py-0.5 text-xs font-bold flex items-center gap-1">
                  <ArrowLeft size={12} /> ACK
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                Timeout {status?.config.timeout_ms ?? 500}ms Timer
              </p>
            </div>
          </div>

          {/* Conduit Status Ticker Bar */}
          <div className="min-h-[38px] flex items-center justify-center font-mono text-xs sm:text-sm text-center">
            {completed && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-300 px-3 py-1.5 font-bold text-emerald-900">
                <CheckCircle2 size={16} className="text-emerald-600" />
                <span>All {total} datagrams delivered and integrity checksums verified.</span>
              </div>
            )}
            {failed && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-300 px-3 py-1.5 font-bold text-rose-900">
                <AlertTriangle size={16} className="text-rose-600" />
                <span>ARQ failure: Timeout retry threshold exceeded. Check link conditions.</span>
              </div>
            )}
            {transferring && hasRecentLoss && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-300 px-3 py-1.5 font-bold text-rose-900 animate-alert-pulse">
                <AlertTriangle size={16} className="text-rose-600" />
                <span>Datagram dropped or timed out · ARQ Retransmitting Frame #{tx}</span>
              </div>
            )}
            {transferring && !hasRecentLoss && hasRecentRetransmit && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-300 px-3 py-1.5 font-bold text-amber-900">
                <Clock size={16} className="text-amber-600" />
                <span>Retransmission in-flight · Waiting for Receiver ACK #{tx}</span>
              </div>
            )}
            {transferring && !hasRecentLoss && !hasRecentRetransmit && (
              <div className="flex items-center gap-2 rounded-lg bg-teal-50 border border-teal-200 px-3 py-1.5 font-bold text-teal-900">
                <Sparkles size={16} className="text-teal-600" />
                <span>Stop-and-Wait Lockstep: Streaming Payload Frame #{tx}</span>
              </div>
            )}
            {!transferring && !completed && !failed && (
              <span className="text-slate-500 font-semibold">
                Channel idle · Select payload file and click Start to initiate Stop-and-Wait transfer.
              </span>
            )}
          </div>
        </div>

        {/* RECEIVER NODE (Server) - Soft Orange */}
        <div className="md:col-span-3 p-6 bg-gradient-to-br from-orange-50/50 via-orange-50/20 to-white flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b-2 border-orange-100 pb-2 mb-3">
              <span className="text-xs font-mono font-extrabold text-orange-900 uppercase tracking-wider">
                RECEIVER [RX]
              </span>
              <span className="rounded-md bg-orange-100 px-2.5 py-0.5 text-xs font-mono font-extrabold text-orange-800">
                SERVER
              </span>
            </div>
            <p className="font-display text-lg sm:text-xl font-black text-slate-900">
              Receiver Daemon
            </p>
            <p className="font-mono text-xs sm:text-sm text-slate-600 mt-1">
              Bound on Port :{status?.server_port ?? 5001}
            </p>
          </div>

          <div className="mt-6 rounded-xl border-2 border-orange-200 bg-white p-3.5 shadow-xs">
            <span className="text-[11px] font-mono uppercase text-slate-500 font-bold block">
              Expected Sequence
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-mono text-2xl sm:text-3xl font-black text-orange-600 font-tabular">
                EXPECTS #{transferring ? tx : lastAcked + 1}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Real-time Oscilloscope Datagram Trace Log (CLEAN LIGHT SLATE TERMINAL) */}
      <div className="border-t-2 border-slate-100 bg-slate-50/90 p-4 font-mono text-xs sm:text-sm">
        <div className="flex items-center justify-between pb-2.5 border-b-2 border-slate-200/80 mb-2.5">
          <div className="flex items-center gap-2.5">
            <Terminal size={16} className="text-teal-700" />
            <span className="font-extrabold text-slate-800 uppercase tracking-wide">
              Datagram Stream Event Terminal
            </span>
            {status?.last_duplicate_seq != null && status.duplicate_packets > 0 && (
              <span className="rounded-md bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 text-xs font-bold">
                DUP #{status.last_duplicate_seq}
              </span>
            )}
            {status?.last_loss_seq != null && status.packets_lost > 0 && (
              <span className="rounded-md bg-rose-100 text-rose-900 border border-rose-300 px-2 py-0.5 text-xs font-bold">
                DROP #{status.last_loss_seq}
              </span>
            )}
          </div>
          <span className="text-xs text-slate-500 font-semibold uppercase">
            {feed.length} EVENTS RECORDED
          </span>
        </div>

        <div
          ref={terminalRef}
          onScroll={handleScroll}
          onWheel={handleWheel}
          className="h-32 overflow-y-auto space-y-1 rounded-xl bg-white border-2 border-slate-200/80 p-3 text-slate-700 leading-relaxed font-mono shadow-inner"
        >
          {feed.length === 0 ? (
            <p className="text-slate-400 italic">
              Socket console idle. Ready to record UDP datagram stream events...
            </p>
          ) : (
            feed.map((line, i) => {
              const isLoss = /lost|timeout/i.test(line.text);
              const isDuplicate = /duplicate/i.test(line.text);
              const isRetransmit = /retransmit/i.test(line.text);
              const isAck = /ack/i.test(line.text);
              const isServerData = /server <- data/i.test(line.text);
              const isClientData = /client -> data/i.test(line.text);
              const isLifecycle = /complete|finished|^Server listening|Transfer started/i.test(line.text);

              const cls = isLoss
                ? "text-rose-700 font-extrabold bg-rose-50 px-1.5 py-0.5 rounded"
                : isDuplicate
                ? "text-amber-800 font-extrabold bg-amber-50 px-1.5 py-0.5 rounded"
                : isRetransmit
                ? "text-orange-700 font-bold"
                : isAck
                ? "text-emerald-700 font-bold"
                : isServerData
                ? "text-orange-800"
                : isClientData
                ? "text-teal-800"
                : isLifecycle
                ? "text-teal-900 font-extrabold"
                : "text-slate-700";

              return (
                <div key={`${line.t}-${i}`} className={cls}>
                  <span className="text-slate-400 select-none mr-2 font-normal">
                    [{new Date(line.t * 1000).toLocaleTimeString(undefined, {
                      hour12: false,
                    })}]
                  </span>
                  <span>{line.text}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Panel>
  );
}