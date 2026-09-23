"use client";

import { Check } from "lucide-react";
import { Panel } from "@/components/ui";

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
    { n: 1, title: "1. START UDP RECEIVER", done: serverRunning },
    { n: 2, title: "2. SELECT SOURCE FILE", done: hasFile },
    { n: 3, title: "3. EXECUTE ARQ TRANSFER", done: completed },
  ];

  const hint = failed
    ? "STATUS: TRANSFER FAILED. CHECK NETWORK STATUS AND RETRY."
    : cancelled
    ? "STATUS: TRANSFER CANCELLED. READY FOR NEW JOB."
    : !serverRunning
    ? "STEP 1 REQUIRED: START UDP SERVER (PORT 5001) TO BIND SOCKET."
    : !hasFile
    ? "STEP 2 REQUIRED: SELECT A FILE TO SEGMENT INTO UDP PACKETS."
    : transferring
    ? "STEP 3 ACTIVE: TRANSMITTING PACKETS AND AWAITING STOP-AND-WAIT ACKS."
    : completed
    ? "STEP 3 COMPLETE: ALL PACKETS DELIVERED AND INTEGRITY VERIFIED."
    : "READY: PRESS [ START TRANSFER ] TO TRANSMIT OVER UDP.";

  return (
    <Panel>
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y-2 sm:divide-y-0 sm:divide-x-2 divide-neutral-700">
        {steps.map((s) => (
          <div
            key={s.n}
            className={`flex items-center gap-3 p-3 font-mono text-xs ${
              s.done
                ? "bg-green-950/30 text-green-300"
                : nextStep === s.n
                ? "bg-cyan-950/30 text-cyan-300"
                : "bg-neutral-900 text-neutral-500"
            }`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center border-2 text-[11px] font-black ${
                s.done
                  ? "border-green-500 bg-green-500 text-black"
                  : nextStep === s.n
                  ? "border-cyan-400 bg-cyan-400 text-black"
                  : "border-neutral-700 bg-neutral-800 text-neutral-500"
              }`}
            >
              {s.done ? <Check size={14} /> : s.n}
            </span>
            <span className="font-black uppercase tracking-wider">{s.title}</span>
          </div>
        ))}
      </div>
      <div className="border-t-2 border-neutral-700 bg-neutral-950 px-4 py-2 font-mono text-[11px] font-bold text-neutral-400">
        &gt; {hint}
      </div>
    </Panel>
  );
}