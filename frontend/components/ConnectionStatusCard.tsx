"use client";

import { Loader2, Power, Server } from "lucide-react";
import { Badge, Panel, PanelHeader, StatusDot } from "@/components/ui";
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
    <Panel>
      <PanelHeader
        title="NETWORK STATUS"
        icon={<Server size={15} />}
        right={
          <Badge tone={running ? "green" : error ? "red" : "slate"}>
            {running ? "UDP ACTIVE" : error ? "ERROR" : "OFFLINE"}
          </Badge>
        }
      />

      <div className="p-4">
        {running ? (
          <div className="border-2 border-green-500 bg-green-500/10 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <StatusDot tone="green" pulse className="h-3.5 w-3.5" />
                <span className="text-lg font-black uppercase tracking-wider text-green-400">
                  SERVER ONLINE
                </span>
              </div>
              <button
                onClick={onStop}
                disabled={busy}
                className="flex items-center gap-1.5 border-2 border-red-500 bg-red-500/20 px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider text-red-300 shadow-[2px_2px_0px_#000] transition active:translate-x-0.5 active:translate-y-0.5 hover:bg-red-500/30 disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
                STOP SERVER
              </button>
            </div>

            <div className="mt-3 border-t-2 border-green-500/30 pt-3 font-mono text-xs">
              <div className="flex items-center justify-between py-1">
                <span className="font-bold text-neutral-400">ADDRESS</span>
                <span className="font-extrabold text-white">
                  {status?.config.server_ip ?? "127.0.0.1"} : {status?.server_port ?? 5001}
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="font-bold text-neutral-400">PROTOCOL</span>
                <span className="font-extrabold text-cyan-400">
                  UDP / STOP-AND-WAIT ARQ
                </span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="font-bold text-neutral-400">ACTIVE SESSIONS</span>
                <span className="font-extrabold text-white">
                  {status?.server_sessions ?? 0}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="border-2 border-neutral-700 bg-neutral-950 p-4">
            <div className="flex items-center gap-2.5">
              <StatusDot tone={error ? "red" : "slate"} className="h-3.5 w-3.5" />
              <span className={`text-lg font-black uppercase tracking-wider ${error ? "text-red-400" : "text-neutral-300"}`}>
                {error ? "SERVER ERROR" : "SERVER OFFLINE"}
              </span>
            </div>
            
            <p className="mt-2 font-mono text-xs text-neutral-400">
              {error && status?.server_error
                ? status.server_error
                : "UDP receiver is not running. Start the server to receive packets."}
            </p>

            <button
              onClick={onStart}
              disabled={busy}
              className="mt-4 flex w-full items-center justify-center gap-2 border-2 border-green-500 bg-green-500 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-black shadow-[3px_3px_0px_#000] transition active:translate-x-0.5 active:translate-y-0.5 hover:bg-green-400 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
              [ START SERVER ]
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}