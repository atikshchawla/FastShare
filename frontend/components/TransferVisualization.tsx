"use client";

import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { Badge, Panel, PanelHeader, StatusDot } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { FeedLine, Snapshot } from "@/lib/types";

/**
 * SENDER ----DATA #N----> RECEIVER
 * SENDER <----ACK #N----  RECEIVER
 *
 * While a transfer runs, the DATA/ACK phases alternate so the professor can
 * watch Stop-and-Wait handshakes happen live, packet by packet.
 */
export function TransferVisualization({
  status,
  feed,
}: {
  status: Snapshot | null;
  feed: FeedLine[];
}) {
  const transferring = status?.transfer_status === "transferring";
  const [phase, setPhase] = useState<"data" | "ack">("data");

  useEffect(() => {
    if (!transferring) return;
    const id = setInterval(
      () => setPhase((p) => (p === "data" ? "ack" : "data")),
      500,
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
  const completed = status?.transfer_status === "completed";

  const trace = feed.slice(-6).reverse();

  return (
    <Panel>
      <PanelHeader
        title="Live Transfer — Stop-and-Wait"
        icon={<Activity size={14} />}
        right={
          transferring ? (
            <Badge tone="cyan">
              <StatusDot tone="cyan" pulse /> streaming
            </Badge>
          ) : completed ? (
            <Badge tone="green">done</Badge>
          ) : (
            <Badge tone="slate">idle</Badge>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
        {/* SENDER */}
        <div className="flex flex-col items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
            Sender
          </span>
          <span className="text-lg font-bold text-slate-100">CLIENT</span>
          <span className="font-mono text-[11px] text-cyan-300">
            {status?.config.server_ip ?? "127.0.0.1"} → UDP
          </span>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 font-mono text-[10px]">
            <span className="text-slate-500">seq</span>
            <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-cyan-300">
              #{tx}
            </span>
          </div>
        </div>

        {/* THE CHANNEL */}
        <div className="flex flex-col items-center gap-3 py-2">
          <div
            className={cn(
              "flex items-center gap-1.5 font-mono text-[11px] transition-opacity",
              transferring && phase === "data" ? "opacity-100" : "opacity-30",
            )}
          >
            <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 font-semibold text-cyan-300">
              DATA
            </span>
            <span className="text-slate-300">#{tx}</span>
            <span className={cn("text-cyan-400", transferring && "flow-active")}>
              ─────►
            </span>
          </div>

          <div
            className={cn(
              "flex items-center gap-1.5 font-mono text-[11px] transition-opacity",
              transferring && phase === "ack" ? "opacity-100" : "opacity-30",
            )}
          >
            <span className="text-violet-300">◄─────</span>
            <span className="text-slate-300">ACK</span>
            <span className="rounded bg-violet-500/10 px-1.5 py-0.5 font-semibold text-violet-300">
              #{lastAcked}
            </span>
          </div>

          {completed && (
            <div className="flex flex-col items-center gap-1">
              <span className="text-xl text-emerald-400">✓</span>
              <span className="whitespace-nowrap font-mono text-[10px] text-emerald-300">
                all {total} packets confirmed
              </span>
            </div>
          )}
          {transferring && (
            <span className="whitespace-nowrap font-mono text-[10px] text-slate-500">
              waiting for ACK #{tx}
            </span>
          )}
        </div>

        {/* RECEIVER */}
        <div className="flex flex-col items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
            Receiver
          </span>
          <span className="text-lg font-bold text-slate-100">SERVER</span>
          <span className="font-mono text-[11px] text-violet-300">
            UDP port {status?.server_port ?? 5001}
          </span>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 font-mono text-[10px]">
            <span className="text-slate-500">expects</span>
            <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-300">
              #{transferring ? tx : lastAcked + 1}
            </span>
          </div>
        </div>
      </div>

      {/* trace readout */}
      <div className="border-t border-slate-800/70 px-4 py-3">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Protocol trace
          </span>
          {status?.last_duplicate_seq != null &&
            status.duplicate_packets > 0 && (
              <Badge tone="amber">
                duplicate #{status.last_duplicate_seq}
              </Badge>
            )}
          {status?.last_loss_seq != null && status.packets_lost > 0 && (
            <Badge tone="red">loss @#{status.last_loss_seq}</Badge>
          )}
        </div>
        <div className="h-28 overflow-hidden rounded-md border border-slate-800/70 bg-[#070b12] p-2 font-mono text-[11px] leading-5">
          {trace.length === 0 ? (
            <p className="text-slate-600">
              idle — start a transfer to see DATA → ACK activity
            </p>
          ) : (
            trace.map((line, i) => {
              const cls =
                /lost|timeout/i.test(line.text)
                  ? "text-rose-400"
                  : /duplicate/i.test(line.text)
                    ? "text-amber-400"
                    : /complete|^Server listening|Transfer started/i.test(
                          line.text,
                        )
                      ? "text-emerald-300"
                      : "text-slate-400";
              return (
                <p key={`${line.t}-${i}`} className={cls}>
                  <span className="text-slate-700">
                    {new Date(line.t * 1000).toLocaleTimeString(undefined, {
                      hour12: false,
                    })}{" "}
                  </span>
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