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
    { n: 1, title: "1. BIND RECEIVER DAEMON", sub: "UDP Socket :5001", done: serverRunning },
    { n: 2, title: "2. SELECT & SEGMENT FILE", sub: "Divide to UDP MSS Chunks", done: hasFile },
    { n: 3, title: "3. EXECUTE ARQ TRANSFER", sub: "Stop-and-Wait Lockstep Loop", done: completed },
  ];

  const hint = failed
    ? "STATUS: TRANSFER FAILED. EXCEEDED MAX RETRY LIMIT. CHECK CHANNEL LOSS CONFIG."
    : cancelled
    ? "STATUS: TRANSFER HALTED BY OPERATOR. SOCKET READY FOR NEW PAYLOAD."
    : !serverRunning
    ? "STEP 1: START UDP RECEIVER (PORT 5001) TO BIND SOCKET BEFORE CLIENT TRANSMITS."
    : !hasFile
    ? "STEP 2: SELECT OR DROP PAYLOAD FILE TO DIVIDE INTO UDP MSS DATAGRAMS."
    : transferring
    ? "STEP 3 ACTIVE: TRANSMITTING DATAGRAMS AND AWAITING STOP-AND-WAIT ACKS."
    : completed
    ? "STEP 3 COMPLETE: ALL PACKETS VERIFIED VIA CRC-32 AND WRITTEN TO RECEIVER."
    : "READY: PRESS [START UDP ARQ TRANSMISSION] TO COMMENCE SOCKET STREAM.";

  return (
    <Panel className="overflow-hidden">
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y-2 sm:divide-y-0 sm:divide-x-2 divide-slate-100 font-mono text-xs sm:text-sm">
        {steps.map((s) => (
          <div
            key={s.n}
            className={`flex items-center gap-3.5 p-4 transition-colors ${
              s.done
                ? "bg-teal-50/70 text-teal-950"
                : nextStep === s.n
                ? "bg-orange-50/70 text-orange-950"
                : "bg-white text-slate-500"
            }`}
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl font-bold text-sm shadow-xs ${
                s.done
                  ? "bg-teal-700 text-white"
                  : nextStep === s.n
                  ? "bg-orange-600 text-white"
                  : "bg-slate-200 text-slate-600"
              }`}
            >
              {s.done ? <Check size={18} className="stroke-[3]" /> : s.n}
            </span>
            <div className="min-w-0">
              <p className="font-extrabold uppercase tracking-tight text-slate-900">{s.title}</p>
              <p className="text-xs text-slate-500 font-semibold">{s.sub}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t-2 border-slate-100 bg-slate-50/90 px-6 py-3 font-mono text-xs sm:text-sm font-bold text-slate-700 flex items-center gap-2">
        <span className="text-teal-700 font-black">&gt;</span>
        <span>{hint}</span>
      </div>
    </Panel>
  );
}