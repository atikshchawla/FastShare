"use client";

import { Check } from "lucide-react";
import { Panel } from "@/components/ui";
import { cn } from "@/lib/cn";

export function SetupSteps({
  serverRunning,
  hasFile,
  transferring,
  completed,
  failed,
  cancelled,
}: {
  serverRunning: boolean;
  hasFile: boolean;
  transferring: boolean;
  completed: boolean;
  failed: boolean;
  cancelled: boolean;
}) {
  const nextStep = !serverRunning ? 1 : !hasFile ? 2 : 3;

  const steps = [
    { n: 1, title: "Start UDP receiver", done: serverRunning },
    { n: 2, title: "Select a file", done: hasFile },
    { n: 3, title: "Run the transfer", done: completed },
  ];

  const hint = failed
    ? "Last transfer failed. Re-select a file and press Start Transfer to retry."
    : cancelled
      ? "Last transfer was cancelled. You can start a new one anytime."
      : !serverRunning
        ? "Next: start the UDP receiver — use Start Server in the Network card."
        : !hasFile
          ? "Next: drop a file into the File Selection card below."
          : transferring
            ? "Transfer in progress — watch the packet monitor and protocol trace."
            : completed
              ? "Transfer complete. Run another one, or open Testing for packet-loss demos."
              : "Ready — press Start Transfer below when you are ready.";

  return (
    <Panel className="overflow-hidden">
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        {steps.map((s) => (
          <div
            key={s.n}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2.5",
              s.done
                ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                : nextStep === s.n
                  ? "border-cyan-500/40 bg-cyan-500/[0.07]"
                  : "border-slate-800 bg-[#070b12]",
            )}
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                s.done
                  ? "bg-emerald-500/20 text-emerald-300"
                  : nextStep === s.n
                    ? "bg-cyan-500/20 text-cyan-300"
                    : "bg-slate-800 text-slate-500",
              )}
            >
              {s.done ? <Check size={13} /> : s.n}
            </span>
            <span
              className={cn(
                "text-[12px] font-semibold",
                s.done
                  ? "text-emerald-300"
                  : nextStep === s.n
                    ? "text-cyan-300"
                    : "text-slate-400",
              )}
            >
              {s.title}
            </span>
          </div>
        ))}
      </div>
      <p className="border-t border-slate-800/70 px-4 py-2 font-mono text-[11px] text-slate-400">
        {hint}
      </p>
    </Panel>
  );
}