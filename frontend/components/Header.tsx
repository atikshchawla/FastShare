"use client";

import { Settings, Zap } from "lucide-react";
import { Badge, StatusDot } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Snapshot } from "@/lib/types";

function serverPill(status: Snapshot | null) {
  if (status?.server_status === "running") {
    return (
      <Badge tone="green" className="px-2.5 py-1">
        <StatusDot tone="green" pulse /> Server Connected
      </Badge>
    );
  }
  if (status?.server_status === "error") {
    return (
      <Badge tone="red" className="px-2.5 py-1">
        <StatusDot tone="red" /> Server Error
      </Badge>
    );
  }
  return (
    <Badge tone="slate" className="px-2.5 py-1">
      <StatusDot tone="slate" /> Server Offline
    </Badge>
  );
}

export function Header({
  status,
  onOpenSettings,
}: {
  status: Snapshot | null;
  onOpenSettings: () => void;
}) {
  return (
    <header className="scan-line sticky top-0 z-20 border-b border-slate-800/70 bg-[#06090f]/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/10">
            <Zap size={18} className="text-cyan-300" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-none tracking-tight text-slate-100">
              FastShare
            </h1>
            <p className="mt-1 text-[11px] uppercase tracking-widest text-slate-500">
              Reliable File Transfer over UDP
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {serverPill(status)}
          <div className="hidden items-center gap-1 rounded-md border border-slate-800 bg-slate-900/60 px-2.5 py-1.5 font-mono text-[11px] tracking-wider text-slate-300 sm:flex">
            <span className="text-cyan-400">UDP</span>
            <span className="text-slate-600">·</span>
            <span>PORT {status?.server_port ?? 5001}</span>
          </div>
          <button
            onClick={onOpenSettings}
            title="Settings"
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-md border border-slate-800",
              "bg-slate-900/60 text-slate-400 transition hover:border-slate-600 hover:text-slate-200",
            )}
          >
            <Settings size={17} />
          </button>
        </div>
      </div>
    </header>
  );
}