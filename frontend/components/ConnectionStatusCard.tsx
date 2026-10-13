"use client";

import { Loader2, Power, Server, CheckCircle2 } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui";
import type { Snapshot } from "@/lib/types";

export function ConnectionStatusCard({
  status,
  busy,
  onStart,
  onStop,
}: {
  status: Snapshot | null;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const running = status?.server_status === "running";
  const error = status?.server_status === "error";

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="UDP Receiver Socket Daemon"
        badgeText="RX DAEMON"
        icon={<Server size={20} className="stroke-[2.5]" />}
        right={
          <div className="flex items-center gap-2">
            <span
              className={`flex items-center gap-1.5 px-3 py-1 rounded-xl font-mono text-xs sm:text-sm font-extrabold border-2 ${
                running
                  ? "bg-orange-50 text-orange-900 border-orange-300"
                  : error
                  ? "bg-rose-50 text-rose-900 border-rose-300"
                  : "bg-slate-100 text-slate-700 border-slate-200"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  running ? "bg-orange-600 animate-pulse" : error ? "bg-rose-600" : "bg-slate-400"
                }`}
              />
              <span>{running ? "LISTENING" : error ? "ERROR" : "OFFLINE"}</span>
            </span>
          </div>
        }
      />

      <div className="p-6 font-mono">
        {running ? (
          <div className="rounded-2xl border-2 border-orange-200 bg-orange-50/50 p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={18} className="text-orange-600 shrink-0" />
                  <span className="text-base font-extrabold text-orange-950 block">
                    UDP SOCKET BOUND &amp; LISTENING
                  </span>
                </div>
                <span className="text-xs sm:text-sm text-orange-900 font-medium mt-1 block">
                  Background thread active on port {status?.server_port ?? 5001}
                </span>
              </div>

              <button
                onClick={onStop}
                disabled={busy}
                className="flex items-center gap-2 rounded-xl bg-rose-600 text-white px-4 py-2.5 text-xs sm:text-sm font-extrabold uppercase hover:bg-rose-500 shadow-md shadow-rose-600/25 transition-all disabled:opacity-50 shrink-0 cursor-pointer"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                <span>Stop</span>
              </button>
            </div>

            <div className="mt-4 divide-y-2 border-t-2 border-orange-200/80 pt-2 text-xs sm:text-sm divide-orange-100">
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-600 font-semibold">Binding Address:</span>
                <span className="font-extrabold text-slate-900 font-tabular">
                  {status?.config.server_ip ?? "127.0.0.1"} : {status?.server_port ?? 5001}
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-600 font-semibold">Socket Protocol:</span>
                <span className="font-extrabold text-orange-700">
                  AF_INET / SOCK_DGRAM (UDP)
                </span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-slate-600 font-semibold">Total Handled Sessions:</span>
                <span className="font-extrabold text-slate-900 font-tabular">
                  {status?.server_sessions ?? 0}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-slate-200 bg-slate-50/80 p-6 text-center sm:text-left">
            <span className={`text-base font-black block ${error ? "text-rose-700" : "text-slate-900"}`}>
              {error ? "RECEIVER DAEMON ERROR" : "UDP RECEIVER OFFLINE"}
            </span>

            <p className="mt-1 text-xs sm:text-sm text-slate-600 font-medium">
              {error && status?.server_error
                ? status.server_error
                : "The Python receiver thread is not running. Start the daemon to accept incoming UDP datagrams on port 5001."}
            </p>

            <button
              onClick={onStart}
              disabled={busy}
              className="mt-4 flex w-full items-center justify-center gap-2.5 rounded-xl bg-orange-600 text-white py-3.5 text-xs sm:text-sm font-extrabold uppercase hover:bg-orange-500 shadow-md shadow-orange-600/25 transition-all disabled:opacity-50 cursor-pointer"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
              <span>[ START UDP RECEIVER DAEMON ]</span>
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}