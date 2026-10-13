"use client";

import { Loader2, Power, X, Server } from "lucide-react";
import { StatusDot } from "@/components/ui";
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border-2 border-slate-200 bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="flex items-center justify-between border-b-2 border-slate-100 bg-slate-50/80 px-6 py-4 font-mono">
          <div className="flex items-center gap-3">
            <Server size={20} className="text-teal-700" />
            <h2 className="text-sm sm:text-base font-extrabold uppercase tracking-wide text-slate-900">
              SOCKET DAEMON CONTROLLER
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-4 font-mono text-xs sm:text-sm">
          <div className="flex items-center justify-between rounded-xl border-2 border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center gap-3">
              <StatusDot tone={running ? "teal" : "slate"} pulse={running} />
              <span className="font-extrabold text-slate-900 uppercase">
                DAEMON: {running ? "ONLINE (BOUND)" : "STOPPED"}
              </span>
            </div>
            <span className="rounded-lg bg-teal-50 border border-teal-200 text-teal-900 px-3 py-1 font-extrabold">
              PORT {status?.server_port ?? 5001}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border-2 border-slate-100 bg-slate-50/70 p-3.5">
              <span className="text-[11px] text-slate-500 uppercase font-bold block">
                Total Sessions
              </span>
              <span className="text-base font-black text-slate-900 mt-0.5 block font-tabular">
                {status?.server_sessions ?? 0}
              </span>
            </div>
            <div className="rounded-xl border-2 border-slate-100 bg-slate-50/70 p-3.5">
              <span className="text-[11px] text-slate-500 uppercase font-bold block">
                Bound Host
              </span>
              <span className="text-base font-black text-slate-900 mt-0.5 block font-tabular">
                {status?.config.server_ip ?? "127.0.0.1"}
              </span>
            </div>
          </div>

          {!running ? (
            <button
              onClick={onStart}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-teal-800 text-white py-3.5 text-xs sm:text-sm font-extrabold uppercase hover:bg-teal-700 shadow-md shadow-teal-800/25 transition-all disabled:opacity-50 cursor-pointer"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
              <span>[ START UDP RECEIVER DAEMON ]</span>
            </button>
          ) : (
            <button
              onClick={onStop}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-rose-600 text-white py-3.5 text-xs sm:text-sm font-extrabold uppercase hover:bg-rose-500 shadow-md shadow-rose-600/25 transition-all disabled:opacity-50 cursor-pointer"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
              <span>[ STOP UDP RECEIVER DAEMON ]</span>
            </button>
          )}

          <div className="border-t-2 border-slate-100 pt-3 text-xs text-slate-500 leading-relaxed font-sans">
            FastShare executes reliable Stop-and-Wait file transfers via standard UDP datagram sockets (`AF_INET`, `SOCK_DGRAM`) with application-layer ARQ and CRC-32 integrity checking.
          </div>
        </div>
      </div>
    </div>
  );
}