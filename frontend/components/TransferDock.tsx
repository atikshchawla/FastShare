"use client";

import { useRef, useState } from "react";
import { FileUp, History, Power, Send, X, XOctagon } from "lucide-react";
import { Badge, Button, StatusDot } from "@/components/ui";
import { formatBytes } from "@/lib/format";
import type { ResumeInfo, Snapshot } from "@/lib/types";

/**
 * Floating island (bottom-center of the canvas): the single place for file
 * selection, transfer state (idle / streaming / paused / done / failed),
 * progress, resume affordance and the primary action. The top bar stays
 * chrome-only.
 */
export function TransferDock({
  status,
  hasFile,
  fileName,
  fileSize,
  busy,
  resumeInfo,
  onSelectFile,
  onStart,
  onCancel,
  onStartServer,
}: {
  status: Snapshot | null;
  hasFile: boolean;
  fileName: string | null;
  fileSize: number;
  busy: boolean;
  resumeInfo?: ResumeInfo | null;
  onSelectFile: (file: File | null) => void;
  onStart: (resume: boolean) => void;
  onCancel: () => void;
  onStartServer: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dismissedSeq, setDismissedSeq] = useState<number | null>(null);

  const s = status;
  const serverRunning = s?.server_status === "running";
  const serverError = s?.server_status === "error";
  const transferring = s?.transfer_status === "transferring";
  const completed = s?.transfer_status === "completed";
  const failed = s?.transfer_status === "failed";
  const cancelled = s?.transfer_status === "cancelled";

  const total = s?.total_packets ?? 0;
  const pct =
    total > 0 ? Math.min(100, ((s?.packets_acked ?? 0) / total) * 100) : 0;
  const showProgress = total > 0 && !failed;

  const resumable =
    !!resumeInfo?.available && !transferring && hasFile && !completed;
  const resumeVisible =
    resumable && resumeInfo != null && dismissedSeq !== resumeInfo.resumed_seq;

  const stateLabel = transferring
    ? "Streaming"
    : completed
      ? "Done"
      : failed
        ? "Failed"
        : cancelled
          ? "Paused"
          : serverRunning
            ? "Ready"
            : "Idle";
  const stateTone = transferring
    ? "cyan"
    : completed
      ? "green"
      : failed
        ? "red"
        : cancelled || resumable
          ? "amber"
          : "slate";

  return (
    <div className="fixed bottom-4 left-1/2 z-[45] w-[min(52rem,calc(100vw-1.5rem))] -translate-x-1/2 border-2 border-neutral-700 bg-neutral-900/97 shadow-[4px_4px_0px_#000] backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2">
        {/* receiver chip (click to start when offline) */}
        <button
          type="button"
          disabled={busy || serverRunning}
          onClick={onStartServer}
          title={
            serverError && s?.server_error
              ? s.server_error
              : serverRunning
                ? `UDP receiver on ${s?.config.server_ip ?? "127.0.0.1"}:${s?.server_port ?? 5001}`
                : "Start the UDP receiver"
          }
          className={`flex shrink-0 items-center gap-1.5 border-2 px-2 py-1 transition ${
            serverRunning
              ? "cursor-default border-green-500 bg-green-500/10"
              : serverError
                ? "cursor-pointer border-red-500 bg-red-500/10"
                : "cursor-pointer border-neutral-700 bg-neutral-800 hover:border-neutral-500"
          } ${busy || serverRunning ? "cursor-default" : ""}`}
        >
          <StatusDot
            tone={serverRunning ? "green" : serverError ? "red" : "slate"}
            pulse={serverRunning}
          />
          <span
            className={`font-mono text-[10px] font-black uppercase ${
              serverRunning
                ? "text-green-400"
                : serverError
                  ? "text-red-400"
                  : "text-neutral-400"
            }`}
          >
            {serverRunning ? "Online" : serverError ? "Error" : "Offline"}
          </span>
          <span className="hidden font-mono text-[10px] font-bold text-neutral-500 sm:inline">
            :{s?.server_port ?? 5001}
          </span>
        </button>

        {/* file chip */}
        <div
          className={`flex min-w-0 shrink-0 items-center border-2 ${
            hasFile
              ? "border-cyan-500/60 bg-cyan-500/10"
              : "border-neutral-700 bg-neutral-800"
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            disabled={transferring}
            onChange={(e) => {
              onSelectFile(e.target.files?.[0] ?? null);
              if (fileRef.current) fileRef.current.value = "";
            }}
          />
          <button
            type="button"
            disabled={transferring}
            onClick={() => fileRef.current?.click()}
            title={hasFile ? fileName ?? "" : "Select a file to transfer"}
            className="flex min-w-0 cursor-pointer items-center gap-1.5 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileUp
              size={12}
              className={
                hasFile ? "shrink-0 text-cyan-400" : "shrink-0 text-neutral-500"
              }
            />
            <span
              className={`max-w-[9rem] truncate font-mono text-[11px] font-bold sm:max-w-[14rem] ${
                hasFile ? "text-cyan-200" : "text-neutral-400"
              }`}
            >
              {hasFile ? (fileName ?? "file") : "SELECT FILE"}
            </span>
            {hasFile && (
              <span className="hidden shrink-0 font-mono text-[10px] text-neutral-400 sm:inline">
                {formatBytes(fileSize)}
              </span>
            )}
          </button>
          {hasFile && (
            <button
              type="button"
              disabled={transferring}
              onClick={() => onSelectFile(null)}
              title="Clear selected file"
              className="shrink-0 cursor-pointer border-l-2 border-cyan-500/30 px-1.5 py-1 text-neutral-400 transition hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* progress + frames */}
        {showProgress && (
          <div className="flex shrink-0 items-center gap-2">
            <div className="h-3 w-24 border-2 border-neutral-700 bg-neutral-950 p-0.5 sm:w-32">
              <div
                className={`h-full transition-all duration-300 ${
                  completed
                    ? "bg-green-500"
                    : transferring
                      ? "bg-cyan-400"
                      : "bg-amber-500"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-[11px] font-black text-cyan-400">
              {Math.round(pct)}%
            </span>
            <span className="hidden font-mono text-[10px] font-bold text-neutral-500 sm:inline">
              {s?.packets_acked ?? 0}/{total}
            </span>
          </div>
        )}

        <Badge tone={stateTone as "cyan" | "green" | "red" | "amber" | "slate"}>
          {stateLabel}
        </Badge>

        {/* primary action */}
        {resumeVisible && resumeInfo ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="amber"
              size="sm"
              onClick={() => onStart(true)}
              disabled={busy || !serverRunning}
              title={`${resumeInfo.percent}% already on the receiver`}
            >
              <History size={13} />
              Resume #{resumeInfo.resumed_seq + 1}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onStart(false)}
              disabled={busy || !serverRunning}
            >
              Start over
            </Button>
            <button
              type="button"
              onClick={() => setDismissedSeq(resumeInfo.resumed_seq)}
              title="Dismiss resume offer"
              aria-label="Dismiss resume offer"
              className="cursor-pointer px-1 text-neutral-500 transition hover:text-white"
            >
              <X size={13} />
            </button>
          </div>
        ) : transferring ? (
          <Button variant="danger" size="sm" onClick={onCancel} disabled={busy}>
            <XOctagon size={13} />
            <span className="hidden sm:inline">Cancel</span>
          </Button>
        ) : !serverRunning ? (
          <Button
            variant="success"
            size="sm"
            onClick={onStartServer}
            disabled={busy}
            title={
              serverError && s?.server_error
                ? s.server_error
                : "Start the UDP receiver first"
            }
          >
            <Power size={13} />
            <span className="hidden sm:inline">Start Server</span>
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={() => onStart(true)}
            disabled={busy || !hasFile}
            title={hasFile ? "Start the transfer" : "Select a file first"}
          >
            <Send size={13} />
            <span className="hidden sm:inline">Start</span>
          </Button>
        )}
      </div>
    </div>
  );
}
