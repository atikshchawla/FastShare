"use client";

import { Loader2, Power, X } from "lucide-react";
import { Badge, Panel, StatusDot } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Snapshot } from "@/lib/types";

export function SettingsModal({
  open,
  status,
  busy,
  onClose,
  onStart,
  onStop,
}: {
  open: boolean;
  status: Snapshot | null;
  busy: boolean;
  onClose: () => void;
  onStart: () => void;
  onStop: () => void;
}) {
  if (!open) return null;
  const running = status?.server_status === "running";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <Panel
        className="w-full max-w-md"
      >
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-slate-800/70 px-4 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-300">
              Settings
            </h2>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:text-slate-200"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#070b12] px-3 py-3">
              <div className="flex items-center gap-2">
                <StatusDot tone={running ? "green" : "slate"} pulse={running} />
                <span className="text-[13px] font-semibold text-slate-200">
                  UDP Receiver {running ? "Running" : "Stopped"}
                </span>
              </div>
              <Badge tone={running ? "green" : "slate"}>
                port {status?.server_port ?? 5001}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono text-[12px] text-slate-400">
              <div className="rounded-md border border-slate-800 bg-[#070b12] px-3 py-2">
                sessions <span className="text-slate-200">{status?.server_sessions ?? 0}</span>
              </div>
              <div className="rounded-md border border-slate-800 bg-[#070b12] px-3 py-2">
                server IP <span className="text-slate-200">{status?.config.server_ip}</span>
              </div>
            </div>

            {!running ? (
              <button
                onClick={onStart}
                disabled={busy}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/50",
                  "bg-emerald-500/15 px-4 py-2.5 text-sm font-semibold text-emerald-300",
                  "transition hover:bg-emerald-500/25 disabled:opacity-50",
                )}
              >
                <Power size={15} /> Start UDP Server
              </button>
            ) : (
              <button
                onClick={onStop}
                disabled={busy}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-lg border border-rose-500/50",
                  "bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-300",
                  "transition hover:bg-rose-500/20 disabled:opacity-50",
                )}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
                Stop UDP Server
              </button>
            )}

            <p className="text-[11px] leading-5 text-slate-500">
              Server IP, port, packet size and timeout are edited in the{" "}
              <span className="text-slate-300">Transfer Configuration</span>{" "}
              card. Changing the port requires restarting the receiver.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}