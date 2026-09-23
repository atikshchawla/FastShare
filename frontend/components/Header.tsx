"use client";

import { Settings, Zap } from "lucide-react";
import { Badge, StatusDot } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Snapshot } from "@/lib/types";

function serverPill(status: Snapshot | null) {
  if (status?.server_status === "running") {
    return (
      <Badge tone="green" className="px-3 py-1">
        <StatusDot tone="green" pulse /> SERVER ONLINE
      </Badge>
    );
  }
  if (status?.server_status === "error") {
    return (
      <Badge tone="red" className="px-3 py-1">
        <StatusDot tone="red" /> SERVER ERROR
      </Badge>
    );
  }
  return (
    <Badge tone="slate" className="px-3 py-1">
      <StatusDot tone="slate" /> SERVER OFFLINE
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
    <header className="sticky top-0 z-20 border-b-2 border-neutral-700 bg-neutral-900">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center border-2 border-cyan-500 bg-cyan-500/10">
            <Zap size={20} className="text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-black uppercase tracking-wider text-white">
              FastShare
            </h1>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-500">
              Reliable File Transfer over UDP
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {serverPill(status)}
          <div className="hidden items-center gap-2 border-2 border-neutral-700 bg-neutral-800 px-3 py-1.5 font-mono text-[12px] font-bold tracking-wider text-neutral-300 sm:flex">
            <span className="text-cyan-400">UDP</span>
            <span className="text-neutral-600">|</span>
            <span>PORT {status?.server_port ?? 5001}</span>
          </div>
          <button
            onClick={onOpenSettings}
            title="Settings"
            className={cn(
              "flex h-10 w-10 items-center justify-center border-2 border-neutral-700",
              "bg-neutral-800 text-neutral-400 transition-colors hover:border-neutral-500 hover:text-white",
            )}
          >
            <Settings size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}