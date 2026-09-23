"use client";

import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { Badge, Panel, PanelHeader, StatusDot } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { FeedLine, Snapshot } from "@/lib/types";

/**
 * HERO SECTION — Animated Stop-and-Wait visualization.
 *
 * CLIENT ──── DATA #N ────► SERVER
 * CLIENT ◄──── ACK #N ───── SERVER
 *
 * The DATA/ACK phases alternate using real backend state so the professor
 * can watch Stop-and-Wait handshakes happen live, packet by packet.
 */
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

  // Check live feed for recent events
  const recentFeed = feed.slice(-3);
  const hasRecentLoss = recentFeed.some((f) => /lost|timeout/i.test(f.text));
  const hasRecentRetransmit = recentFeed.some((f) =>
    /retransmit/i.test(f.text),
  );

  useEffect(() => {
    if (!transferring) return;
    const id = setInterval(
      () => setPhase((p) => (p === "data" ? "ack" : "data")),
      600,
    );
    return () => clearInterval(id);
  }, [transferring]);

  const sending =
    status && transferring ? status.current_sequence + 1 : null;
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
    <Panel>
      <PanelHeader
        title="LIVE UDP TRANSFER"
        icon={<Activity size={15} />}
        right={
          transferring ? (
            <Badge tone="cyan">
              <StatusDot tone="cyan" pulse className="h-2.5 w-2.5" /> STREAMING
            </Badge>
          ) : completed ? (
            <Badge tone="green">✓ COMPLETE</Badge>
          ) : failed ? (
            <Badge tone="red">✕ FAILED</Badge>
          ) : (
            <Badge tone="slate">IDLE</Badge>
          )
        }
      />

      {/* === HERO: SENDER → CHANNEL → RECEIVER === */}
      <div className="grid grid-cols-1 gap-0 p-0 md:grid-cols-[1fr_auto_1fr]">
        {/* CLIENT BOX */}
        <div className="flex flex-col items-center gap-2 border-b-2 border-r-0 border-neutral-700 bg-neutral-900 px-6 py-8 md:border-b-0 md:border-r-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-neutral-500">
            Sender
          </span>
          <span className="text-2xl font-black uppercase tracking-wider text-white">
            CLIENT
          </span>
          <span className="font-mono text-[12px] font-bold text-cyan-400">
            UDP SENDER
          </span>
          <span className="font-mono text-[11px] text-neutral-400">
            {status?.config.server_ip ?? "127.0.0.1"}
          </span>
          <div className="mt-2 flex items-center gap-2 border-2 border-cyan-500/40 bg-cyan-500/10 px-3 py-1 font-mono text-[12px] font-bold">
            <span className="text-neutral-400">SEQ</span>
            <span className="text-cyan-300">#{tx}</span>
          </div>
        </div>

        {/* THE CHANNEL — DATA & ACK visualization */}
        <div className="flex flex-col items-center justify-center gap-4 bg-neutral-950 px-8 py-8 md:min-w-[280px]">
          {/* DATA packet → */}
          <div
            className={cn(
              "flex items-center gap-2 font-mono text-[13px] font-bold transition-opacity duration-200",
              transferring && phase === "data" ? "opacity-100" : "opacity-20",
            )}
          >
            <span className="border-2 border-cyan-500 bg-cyan-500/15 px-2 py-0.5 text-cyan-300">
              DATA
            </span>
            <span className="text-neutral-300">#{tx}</span>
            <span
              className={cn(
                "text-cyan-400",
                transferring && phase === "data" && "flow-data",
              )}
            >
              ─────────►
            </span>
          </div>

          {/* ◄ ACK packet */}
          <div
            className={cn(
              "flex items-center gap-2 font-mono text-[13px] font-bold transition-opacity duration-200",
              transferring && phase === "ack" ? "opacity-100" : "opacity-20",
            )}
          >
            <span
              className={cn(
                "text-green-400",
                transferring && phase === "ack" && "flow-ack",
              )}
            >
              ◄─────────
            </span>
            <span className="text-neutral-300">ACK</span>
            <span className="border-2 border-green-500 bg-green-500/15 px-2 py-0.5 text-green-300">
              #{lastAcked}
            </span>
          </div>

          {/* STATUS FEEDBACK */}
          {completed && (
            <div className="flex flex-col items-center gap-1 border-2 border-green-500 bg-green-500/10 px-4 py-2">
              <span className="text-2xl">✓</span>
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-green-300">
                ALL {total} PACKETS CONFIRMED
              </span>
            </div>
          )}
          {failed && (
            <div className="flex flex-col items-center gap-1 border-2 border-red-500 bg-red-500/10 px-4 py-2">
              <span className="text-2xl">✕</span>
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-red-300">
                TRANSFER FAILED
              </span>
            </div>
          )}
          {transferring && hasRecentLoss && (
            <div className="blink-warn flex items-center gap-2 border-2 border-red-500 bg-red-500/10 px-3 py-1.5 font-mono text-[11px] font-bold text-red-400">
              ✕ PACKET LOST — TIMEOUT — RETRANSMITTING
            </div>
          )}
          {transferring && !hasRecentLoss && hasRecentRetransmit && (
            <div className="flex items-center gap-2 border-2 border-amber-500 bg-amber-500/10 px-3 py-1.5 font-mono text-[11px] font-bold text-amber-400">
              ↻ RETRANSMITTED — WAITING FOR ACK
            </div>
          )}
          {transferring && !hasRecentLoss && !hasRecentRetransmit && (
            <span className="font-mono text-[11px] font-bold text-neutral-500">
              ✓ PACKET ACKNOWLEDGED — SENDING #{tx}
            </span>
          )}
        </div>

        {/* SERVER BOX */}
        <div className="flex flex-col items-center gap-2 border-l-0 border-t-2 border-neutral-700 bg-neutral-900 px-6 py-8 md:border-l-2 md:border-t-0">
          <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-neutral-500">
            Receiver
          </span>
          <span className="text-2xl font-black uppercase tracking-wider text-white">
            SERVER
          </span>
          <span className="font-mono text-[12px] font-bold text-green-400">
            UDP RECEIVER
          </span>
          <span className="font-mono text-[11px] text-neutral-400">
            :{status?.server_port ?? 5001}
          </span>
          <div className="mt-2 flex items-center gap-2 border-2 border-green-500/40 bg-green-500/10 px-3 py-1 font-mono text-[12px] font-bold">
            <span className="text-neutral-400">EXPECTS</span>
            <span className="text-green-300">
              #{transferring ? tx : lastAcked + 1}
            </span>
          </div>
        </div>
      </div>

      {/* === PROTOCOL TRACE LOG (SCROLLABLE TERMINAL) === */}
      <div className="border-t-2 border-neutral-700 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-neutral-400">
              PROTOCOL TRACE TERMINAL
            </span>
            {status?.last_duplicate_seq != null &&
              status.duplicate_packets > 0 && (
                <Badge tone="amber">DUPLICATE #{status.last_duplicate_seq}</Badge>
              )}
            {status?.last_loss_seq != null && status.packets_lost > 0 && (
              <Badge tone="red">LOSS @#{status.last_loss_seq}</Badge>
            )}
          </div>
          <span className="font-mono text-[10px] text-neutral-500 uppercase">
            {feed.length} EVENTS LOGGED · SCROLLABLE
          </span>
        </div>
        <div
          ref={terminalRef}
          onScroll={handleScroll}
          onWheel={handleWheel}
          className="h-44 overflow-y-auto border-2 border-neutral-700 bg-black p-3 font-mono text-[12px] leading-6"
        >
          {feed.length === 0 ? (
            <p className="text-neutral-600">
              IDLE — START A TRANSFER TO SEE DATA → ACK ACTIVITY
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
                ? "text-red-400 font-bold"
                : isDuplicate
                  ? "text-amber-400 font-bold"
                  : isRetransmit
                    ? "text-amber-300 font-bold"
                    : isAck
                      ? "text-green-400 font-medium"
                      : isServerData
                        ? "text-emerald-300"
                        : isClientData
                          ? "text-cyan-300"
                          : isLifecycle
                            ? "text-green-400 font-bold"
                            : "text-neutral-300";

              return (
                <p key={`${line.t}-${i}`} className={cls}>
                  <span className="text-neutral-600">
                    [{new Date(line.t * 1000).toLocaleTimeString(undefined, {
                      hour12: false,
                    })}]
                  </span>{" "}
                  {line.text}
                </p>
              );
            })
          )}
        </div>
      </div>
    </Panel>
  );
}