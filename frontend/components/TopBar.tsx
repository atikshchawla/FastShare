"use client";

import { PanelLeft, PanelRight, Settings, Zap } from "lucide-react";

/**
 * Minimal top chrome: brand + settings + the two sidebar toggles. Transfer
 * controls (file, progress, state, resume, primary action) live in the
 * floating TransferDock at the bottom-center of the canvas.
 */
export function TopBar({
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
  onOpenConfig,
}: {
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onOpenConfig: () => void;
}) {
  return (
    <header className="relative z-50 flex h-14 shrink-0 items-center gap-2 border-b-2 border-neutral-700 bg-neutral-900 px-3">
      {/* brand */}
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center border-2 border-cyan-500 bg-cyan-500/10">
          <Zap size={16} className="text-cyan-400" />
        </div>
        <span className="hidden text-sm font-black uppercase tracking-wider text-white sm:inline">
          FastShare
        </span>
      </div>

      <div className="flex-1" />

      {/* settings + sidebar toggles */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenConfig}
          title="Settings"
          className="flex h-8 w-8 cursor-pointer items-center justify-center border-2 border-neutral-700 bg-neutral-800 text-neutral-400 transition hover:border-neutral-500 hover:text-white"
        >
          <Settings size={15} />
        </button>
        <button
          type="button"
          onClick={onToggleLeft}
          title={leftOpen ? "Hide controls sidebar" : "Show controls sidebar"}
          className={`flex h-8 w-8 cursor-pointer items-center justify-center border-2 transition ${
            leftOpen
              ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
              : "border-neutral-700 bg-neutral-800 text-neutral-400 hover:border-neutral-500 hover:text-white"
          }`}
        >
          <PanelLeft size={15} />
        </button>
        <button
          type="button"
          onClick={onToggleRight}
          title={rightOpen ? "Hide telemetry sidebar" : "Show telemetry sidebar"}
          className={`flex h-8 w-8 cursor-pointer items-center justify-center border-2 transition ${
            rightOpen
              ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300"
              : "border-neutral-700 bg-neutral-800 text-neutral-400 hover:border-neutral-500 hover:text-white"
          }`}
        >
          <PanelRight size={15} />
        </button>
      </div>
    </header>
  );
}
