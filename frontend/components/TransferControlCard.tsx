"use client";

import { Check, History, Loader2, Play, Square } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui";
import { formatBytes } from "@/lib/types";
import type { ResumeInfo, Snapshot } from "@/lib/types";

export function TransferControlCard({
  status,
  hasFile,
  busy,
  resumeInfo,
  onStart,
  onCancel,
  onStartServer,
}: {
  status: Snapshot | null;
  hasFile: boolean;
  busy: boolean;
  resumeInfo?: ResumeInfo | null;
  onStart: (resume: boolean) => void;
  onCancel: () => void;
  onStartServer: () => void;
}) {
  const transferring = status?.transfer_status === "transferring";
  const completed = status?.transfer_status === "completed";
  const serverRunning = status?.server_status === "running";

  const canStart = serverRunning && hasFile && !transferring && !busy;
  const resumable = !!resumeInfo?.available && !transferring && hasFile;

  const checks = [
    { id: "server", label: "UDP Receiver Daemon Active (:5001)", ok: serverRunning },
    { id: "file", label: "Source File Loaded & Segmented", ok: hasFile },
    { id: "busy", label: "Socket Channel Available", ok: !transferring },
  ];

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Transfer Execution Controller"
        badgeText="TRANSMISSION CONTROLS"
        icon={<Play size={20} className="stroke-[2.5]" />}
        right={
          <span className="font-mono text-xs sm:text-sm font-bold text-teal-800 bg-teal-50 px-3 py-1 rounded-xl border border-teal-200">
            {transferring ? "STREAMING ACTIVE" : completed ? "TX COMPLETE" : "STANDBY"}
          </span>
        }
      />

      <div className="p-6 font-mono space-y-4">
        {/* Main Action Button (Vibrant Teal / Abort Rose) */}
        {!transferring ? (
          <button
            onClick={() => onStart(true)}
            disabled={!canStart}
            className={`flex w-full items-center justify-center gap-3 rounded-2xl py-4 text-sm sm:text-base font-extrabold uppercase tracking-wider transition-all shadow-md ${
              canStart
                ? "bg-teal-700 text-white hover:bg-teal-600 hover:scale-[1.01] active:scale-[0.99] shadow-teal-700/25 cursor-pointer"
                : "bg-slate-100 text-slate-400 border-2 border-slate-200 cursor-not-allowed shadow-none"
            }`}
          >
            <Play size={18} className="fill-current stroke-none" />
            <span>[ START UDP ARQ TRANSMISSION ]</span>
          </button>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex flex-1 items-center justify-center gap-2.5 rounded-2xl border-2 border-teal-300 bg-teal-50 p-3.5 text-xs sm:text-sm font-bold text-teal-950">
              <Loader2 size={18} className="animate-spin text-teal-700" />
              <span>STREAMING FRAMES OVER UDP WIRE...</span>
            </div>
            <button
              onClick={onCancel}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-2xl bg-rose-600 text-white px-6 py-3.5 text-xs sm:text-sm font-extrabold uppercase hover:bg-rose-500 shadow-md shadow-rose-600/25 transition-all cursor-pointer"
            >
              <Square size={16} className="fill-current stroke-none" />
              <span>ABORT</span>
            </button>
          </div>
        )}

        {/* Resumable Checkpoint Notice (Orange Accent) */}
        {resumable && resumeInfo && (
          <div className="rounded-2xl border-2 border-orange-300 bg-orange-50/90 p-4 text-xs sm:text-sm font-mono text-orange-950 shadow-xs">
            <div className="flex items-center gap-2 font-extrabold">
              <History size={16} className="text-orange-700 shrink-0" />
              <span>PARTIAL DATA FOUND ({resumeInfo.percent}% ON RECEIVER)</span>
            </div>
            <p className="mt-1 text-xs text-orange-900 font-medium">
              {formatBytes(resumeInfo.received_bytes)} of {formatBytes(resumeInfo.file_size)} already on disk. Resuming continues from packet #{resumeInfo.resumed_seq + 1}.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => onStart(true)}
                disabled={!canStart}
                className="flex-1 rounded-xl bg-orange-600 text-white px-3 py-2 text-xs sm:text-sm font-extrabold uppercase hover:bg-orange-500 shadow-xs transition-colors"
              >
                Resume from #{resumeInfo.resumed_seq + 1}
              </button>
              <button
                onClick={() => onStart(false)}
                disabled={!canStart}
                className="rounded-xl border-2 border-orange-300 bg-white text-orange-950 px-3 py-2 text-xs sm:text-sm font-bold uppercase hover:bg-orange-100 transition-colors"
              >
                Start Over
              </button>
            </div>
          </div>
        )}

        {/* Checklist of Pre-Flight Conditions */}
        <div className="rounded-2xl border-2 border-slate-100 bg-slate-50/70 p-4 text-xs sm:text-sm space-y-2.5">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 block mb-1">
            Pre-flight Socket Verification
          </span>
          {checks.map((c) => (
            <div key={c.id} className="flex items-center justify-between">
              <span className={c.ok ? "text-slate-800 font-semibold" : "text-slate-400"}>
                {c.label}
              </span>
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-md font-bold text-xs ${
                  c.ok
                    ? "bg-teal-700 text-white"
                    : "bg-slate-200 text-slate-400"
                }`}
              >
                {c.ok ? <Check size={12} className="stroke-[3]" /> : "·"}
              </span>
            </div>
          ))}
        </div>

        {/* Actionable Prompt if Server is Down */}
        {!serverRunning && (
          <div className="rounded-xl border-2 border-orange-200 bg-orange-50/80 p-3 text-xs sm:text-sm font-medium text-orange-950 flex items-center justify-between">
            <span>Receiver Daemon is offline. Bind socket to enable transfer:</span>
            <button
              onClick={onStartServer}
              disabled={busy}
              className="rounded-lg bg-orange-600 text-white px-3 py-1 text-xs font-bold uppercase hover:bg-orange-500 shadow-xs ml-2 shrink-0"
            >
              Start Daemon
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}