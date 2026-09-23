"use client";

import { Check, Loader2, Send, X, XCircle } from "lucide-react";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Snapshot } from "@/lib/types";

export function TransferControlCard({
  status,
  hasFile,
  busy,
  onStart,
  onCancel,
  onStartServer,
}: {
  status: Snapshot | null;
  hasFile: boolean;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
  onStartServer: () => void;
}) {
  const transferring = status?.transfer_status === "transferring";
  const completed = status?.transfer_status === "completed";
  const failed = status?.transfer_status === "failed";
  const cancelled = status?.transfer_status === "cancelled";
  const serverRunning = status?.server_status === "running";

  const canStart = serverRunning && hasFile && !transferring && !busy;

  const checks = [
    { id: "server", label: "UDP receiver running", ok: serverRunning },
    { id: "file", label: "A file is selected", ok: hasFile },
    { id: "busy", label: "No transfer in progress", ok: !transferring },
  ];

  const blockReason = !serverRunning
    ? "Start the UDP receiver (above) to enable transfers."
    : !hasFile
      ? "Select a file to enable Start Transfer."
      : "Wait for the current action to finish.";

  return (
    <Panel>
      <PanelHeader title="3 · Transfer Control" icon={<Send size={14} />} />
      <div className="flex flex-wrap items-center gap-3 p-4">
        {!transferring ? (
          <button
            onClick={onStart}
            disabled={!canStart}
            title={!canStart ? blockReason : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg border border-emerald-500/50",
              "bg-emerald-500/15 px-5 py-2.5 text-sm font-semibold text-emerald-300",
              "transition hover:bg-emerald-500/25",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            <Send size={16} /> Start Transfer
          </button>
        ) : (
          <>
            <span className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-5 py-2.5 text-sm font-semibold text-cyan-300">
              <Loader2 size={16} className="animate-spin" />
              Transferring...
            </span>
            <button
              onClick={onCancel}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border border-rose-500/50",
                "bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-300",
                "transition hover:bg-rose-500/20 disabled:opacity-50",
              )}
            >
              <XCircle size={16} /> Cancel
            </button>
          </>
        )}

        <div className="ml-auto text-right">
          {completed && (
            <div>
              <Badge tone="green" className="px-2.5 py-1 text-[12px]">
                ✓ Transfer Complete
              </Badge>
              {status?.received_path && (
                <p
                  className="mt-1 max-w-[320px] truncate font-mono text-[10px] text-slate-500"
                  title={status.received_path}
                >
                  {status.received_path}
                </p>
              )}
            </div>
          )}
          {failed && (
            <div>
              <Badge tone="red" className="px-2.5 py-1 text-[12px]">
                ✕ Transfer Failed
              </Badge>
              {status?.transfer_error && (
                <p className="mt-1 max-w-[320px] truncate font-mono text-[10px] text-rose-400">
                  {status.transfer_error}
                </p>
              )}
            </div>
          )}
          {cancelled && (
            <Badge tone="amber" className="px-2.5 py-1 text-[12px]">
              Aborted
            </Badge>
          )}
        </div>
      </div>

      <div className="border-t border-slate-800/70 px-4 py-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Ready to start?
        </p>
        <div className="space-y-1.5">
          {checks.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-md px-1 py-0.5"
            >
              <span className="flex items-center gap-2 text-[12px] text-slate-300">
                {c.ok ? (
                  <Check size={13} className="text-emerald-400" />
                ) : (
                  <X size={13} className="text-rose-400" />
                )}
                {c.label}
              </span>
              {!c.ok && c.id === "server" && (
                <button
                  onClick={onStartServer}
                  disabled={busy}
                  className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Start Server
                </button>
              )}
              {!c.ok && c.id === "file" && (
                <span className="text-[11px] text-slate-500">
                  add one below
                </span>
              )}
            </div>
          ))}
        </div>
        {!canStart && !transferring && (
          <p className="mt-2 font-mono text-[11px] text-amber-400/80">
            {blockReason}
          </p>
        )}
      </div>
    </Panel>
  );
}