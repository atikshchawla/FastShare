"use client";

import { useEffect } from "react";
import { Network, Settings } from "lucide-react";
import { Badge, StatusDot } from "@/components/ui";
import type { Snapshot } from "@/lib/types";

function serverPill(status: Snapshot | null) {
  if (status?.server_status === "running") {
    return (
      <Badge tone="teal" className="px-3 py-1 font-mono text-xs sm:text-sm">
        <StatusDot tone="teal" pulse />
        <span className="font-extrabold">UDP PORT 5001 ACTIVE</span>
      </Badge>
    );
  }
  if (status?.server_status === "error") {
    return (
      <Badge tone="red" className="px-3 py-1 font-mono text-xs sm:text-sm">
        <StatusDot tone="red" />
        <span className="font-extrabold">SERVER ERROR</span>
      </Badge>
    );
  }
  return (
    <Badge tone="slate" className="px-3 py-1 font-mono text-xs sm:text-sm">
      <StatusDot tone="slate" />
      <span className="font-extrabold">RECEIVER OFFLINE</span>
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
  useEffect(() => {
    // Ensure clean light theme by default
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    localStorage.removeItem("fastshare-theme");
  }, []);

  return (
    <header className="border-b-2 border-slate-200 bg-white/95 backdrop-blur-md sticky top-0 z-30 shadow-xs">
      <div className="w-full flex items-center justify-between px-6 sm:px-10 py-4">
        {/* Brand identity with larger font */}
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-700 to-teal-900 text-white shadow-md shadow-teal-700/25">
            <Network size={26} className="stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <span className="font-display text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
                Fast<span className="text-orange-600">Share</span>
              </span>
              <span className="rounded-lg bg-teal-50 px-2.5 py-0.5 text-xs font-mono font-extrabold text-teal-800 border-2 border-teal-200">
                UDP·ARQ v2
              </span>
            </div>
            <p className="text-xs sm:text-sm font-semibold text-slate-500">
              Reliable Stop-and-Wait Transport Layer Protocol Analyzer
            </p>
          </div>
        </div>

        {/* Right Status & Controls */}
        <div className="flex items-center gap-3">
          {serverPill(status)}

          <div className="hidden sm:flex items-center gap-2 rounded-xl border-2 border-slate-200 bg-slate-50 px-3.5 py-1.5 font-mono text-xs sm:text-sm font-extrabold text-slate-700">
            <span className="text-teal-700">PORT:{status?.server_port ?? 5001}</span>
            <span className="text-slate-300">|</span>
            <span className="text-orange-600">MSS:{status?.config.packet_size ?? 1024}B</span>
            <span className="text-slate-300">|</span>
            <span>WINDOW:1</span>
          </div>

          <button
            onClick={onOpenSettings}
            title="Configure sockets"
            className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-slate-200 bg-slate-50 text-slate-700 hover:border-teal-600 hover:text-teal-700 hover:bg-teal-50 transition-all hover:scale-105 active:scale-95"
          >
            <Settings size={18} className="stroke-[2.2]" />
          </button>
        </div>
      </div>
    </header>
  );
}