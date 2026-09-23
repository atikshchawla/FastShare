"use client";

import { Loader2, Power, X } from "lucide-react";
import { Badge, StatusDot } from "@/components/ui";
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md border-2 border-neutral-700 bg-neutral-900 shadow-[6px_6px_0px_#000]"
      >
        <div className="flex items-center justify-between border-b-2 border-neutral-700 bg-neutral-800 px-4 py-3">
          <h2 className="text-sm font-black uppercase tracking-widest text-white">
            SOCKET &amp; RECEIVER CONTROLS
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center border-2 border-neutral-600 bg-neutral-900 text-neutral-400 hover:text-white"
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-4 space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between border-2 border-neutral-700 bg-neutral-950 p-3">
            <div className="flex items-center gap-2.5">
              <StatusDot tone={running ? "green" : "slate"} pulse={running} />
              <span className="font-bold text-white uppercase">
                UDP RECEIVER {running ? "ONLINE" : "STOPPED"}
              </span>
            </div>
            <Badge tone={running ? "green" : "slate"}>
              PORT {status?.server_port ?? 5001}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="border-2 border-neutral-700 bg-neutral-950 p-2.5">
              <span className="text-[10px] text-neutral-500 uppercase block">Sessions</span>
              <span className="text-sm font-black text-white">{status?.server_sessions ?? 0}</span>
            </div>
            <div className="border-2 border-neutral-700 bg-neutral-950 p-2.5">
              <span className="text-[10px] text-neutral-500 uppercase block">Bound IP</span>
              <span className="text-sm font-black text-white">{status?.config.server_ip ?? "127.0.0.1"}</span>
            </div>
          </div>

          {!running ? (
            <button
              onClick={onStart}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 border-2 border-green-500 bg-green-500 py-3 text-xs font-black uppercase tracking-widest text-black shadow-[3px_3px_0px_#000] hover:bg-green-400 disabled:opacity-50 cursor-pointer"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
              [ START UDP RECEIVER ]
            </button>
          ) : (
            <button
              onClick={onStop}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 border-2 border-red-500 bg-red-500/20 py-3 text-xs font-black uppercase tracking-widest text-red-300 shadow-[3px_3px_0px_#000] hover:bg-red-500/30 disabled:opacity-50 cursor-pointer"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
              [ STOP UDP RECEIVER ]
            </button>
          )}

          <p className="border-t border-neutral-800 pt-2 text-[11px] text-neutral-500">
            Note: UDP port updates require stopping and restarting the receiver thread in Python backend.
          </p>
        </div>
      </div>
    </div>
  );
}