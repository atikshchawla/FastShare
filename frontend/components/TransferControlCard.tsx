"use client";

import { Check, History, Loader2, Send, X, XOctagon } from "lucide-react";
import { Badge, Panel, PanelHeader } from "@/components/ui";
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
  const failed = status?.transfer_status === "failed";
  const cancelled = status?.transfer_status === "cancelled";
  const serverRunning = status?.server_status === "running";

  const canStart = serverRunning && hasFile && !transferring && !busy;
  const resumable = !!resumeInfo?.available && !transferring && hasFile;

  const checks = [
    { id: "server", label: "UDP Receiver Online", ok: serverRunning },
    { id: "file", label: "File Selected & Segmented", ok: hasFile },
    { id: "busy", label: "Channel Available", ok: !transferring },
  ];

  return (
    <Panel>
      <PanelHeader
        title="TRANSFER EXECUTION"
        icon={<Send size={15} />}
        right={
          transferring ? (
            <Badge tone="cyan">ACTIVE</Badge>
          ) : completed ? (
            <Badge tone="green">COMPLETED</Badge>
          ) : (
            <Badge tone="slate">STANDBY</Badge>
          )
        }
      />

      <div className="p-4">
        {/* Main Action Button */}
        {!transferring ? (
          <button
            onClick={() => onStart(true)}
            disabled={!canStart}
            className={`flex w-full items-center justify-center gap-3 border-2 border-green-500 py-3.5 text-sm font-black uppercase tracking-widest transition active:translate-x-0.5 active:translate-y-0.5 ${
              canStart
                ? "bg-green-500 text-black shadow-[4px_4px_0px_#000] hover:bg-green-400 cursor-pointer"
                : "bg-neutral-800 text-neutral-500 border-neutral-700 cursor-not-allowed opacity-60"
            }`}
          >
            <Send size={16} />
            [ START TRANSFER ]
          </button>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex flex-1 items-center justify-center gap-2 border-2 border-cyan-500 bg-cyan-950/30 py-3 font-mono text-xs font-black uppercase tracking-wider text-cyan-300 shadow-[3px_3px_0px_#000]">
              <Loader2 size={15} className="animate-spin text-cyan-400" />
              TRANSMITTING VIA UDP...
            </div>
            <button
              onClick={onCancel}
              disabled={busy}
              className="flex items-center justify-center gap-2 border-2 border-red-500 bg-red-500/20 px-6 py-3 font-mono text-xs font-black uppercase tracking-wider text-red-300 shadow-[3px_3px_0px_#000] transition active:translate-x-0.5 active:translate-y-0.5 hover:bg-red-500/30 disabled:opacity-50 cursor-pointer"
            >
              <XOctagon size={15} />
              CANCEL
            </button>
          </div>
        )}

        {/* Resume banner: an interrupted copy of THIS file is on the receiver */}
        {resumable && resumeInfo && (
          <div className="mt-3 border-2 border-amber-500 bg-amber-950/20 p-3 font-mono text-xs">
            <div className="flex items-center gap-2">
              <History size={14} className="text-amber-400 shrink-0" />
              <p className="font-black text-amber-400">
                PARTIAL TRANSFER FOUND — {resumeInfo.percent}% ALREADY RECEIVED
              </p>
            </div>
            <p className="mt-1 text-[11px] text-neutral-400">
              {formatBytes(resumeInfo.received_bytes)} of{" "}
              {formatBytes(resumeInfo.file_size)} sit on the receiver; resuming
              continues at packet #{resumeInfo.resumed_seq + 1} of{" "}
              {resumeInfo.total_packets}.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => onStart(true)}
                disabled={!canStart}
                className="flex flex-1 items-center justify-center gap-2 border-2 border-amber-500 bg-amber-500 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-black shadow-[3px_3px_0px_#000] transition active:translate-x-0.5 active:translate-y-0.5 hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
              >
                ▶ RESUME FROM PACKET #{resumeInfo.resumed_seq + 1}
              </button>
              <button
                onClick={() => onStart(false)}
                disabled={!canStart}
                className="flex items-center justify-center gap-2 border-2 border-neutral-600 bg-neutral-900 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-neutral-300 shadow-[3px_3px_0px_#000] transition active:translate-x-0.5 active:translate-y-0.5 hover:bg-neutral-800 disabled:opacity-50 cursor-pointer"
              >
                START OVER
              </button>
            </div>
          </div>
        )}

        {/* Status result alert */}
        {completed && (
          <div className="mt-3 border-2 border-green-500 bg-green-950/20 p-3 font-mono text-xs">
            <p className="font-black text-green-400">✓ FILE TRANSFER COMPLETED SUCCESSFULLY</p>
            {status?.received_path && (
              <p className="mt-1 truncate text-[11px] text-neutral-400" title={status.received_path}>
                Destination: {status.received_path}
              </p>
            )}
          </div>
        )}
        {failed && (
          <div className="mt-3 border-2 border-red-500 bg-red-950/20 p-3 font-mono text-xs">
            <p className="font-black text-red-400">✕ TRANSFER FAILED</p>
            {status?.transfer_error && (
              <p className="mt-1 text-[11px] text-neutral-400">{status.transfer_error}</p>
            )}
          </div>
        )}
        {cancelled && (
          <div className="mt-3 border-2 border-amber-500 bg-amber-950/20 p-3 font-mono text-xs text-amber-400 font-bold">
            ⚠ TRANSFER ABORTED BY USER
          </div>
        )}

        {/* Readiness Pre-flight Checklist */}
        <div className="mt-4 border-t-2 border-neutral-700 pt-3">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-500 mb-2">
            PRE-FLIGHT READINESS
          </p>
          <div className="space-y-1.5 font-mono text-xs">
            {checks.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between border-2 border-neutral-800 bg-neutral-950 px-3 py-1.5"
              >
                <div className="flex items-center gap-2">
                  {c.ok ? (
                    <Check size={14} className="text-green-400" />
                  ) : (
                    <X size={14} className="text-red-400" />
                  )}
                  <span className={c.ok ? "text-neutral-200" : "text-neutral-500"}>
                    {c.label}
                  </span>
                </div>
                {!c.ok && c.id === "server" && (
                  <button
                    onClick={onStartServer}
                    disabled={busy}
                    className="border border-green-500 bg-green-500/20 px-2 py-0.5 text-[10px] font-black uppercase text-green-300 hover:bg-green-500/30"
                  >
                    Start Server
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}