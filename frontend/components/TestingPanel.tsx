"use client";

import { useEffect, useState } from "react";
import { ArrowDown, Check, FlaskConical, Play, X } from "lucide-react";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import type { Snapshot, TestingConfig } from "@/lib/types";

interface Scenario {
  id: string;
  label: string;
  prob: number;
  expected: string;
  tone: "green" | "amber" | "red";
}

const SCENARIOS: Scenario[] = [
  {
    id: "normal",
    label: "TEST 1 · 0% LOSS (IDEAL)",
    prob: 0,
    expected: "Stop-and-Wait clean transfer · 0 retransmissions",
    tone: "green",
  },
  {
    id: "loss10",
    label: "TEST 2 · 10% LOSS (MODERATE)",
    prob: 0.1,
    expected: "Demonstrates Timeout & Retransmission · 100% data integrity preserved",
    tone: "amber",
  },
  {
    id: "loss30",
    label: "TEST 3 · 30% LOSS (STRESS)",
    prob: 0.3,
    expected: "Heavy loss recovery · Proves ARQ correctness under adversarial conditions",
    tone: "red",
  },
];

export function TestingPanel({
  status,
  busy,
  hasFile,
  serverRunning,
  onApply,
  onRunTest,
}: {
  status: Snapshot | null;
  busy: boolean;
  hasFile: boolean;
  serverRunning: boolean;
  onApply: (cfg: TestingConfig) => void;
  onRunTest: (cfg: TestingConfig) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [prob, setProb] = useState(0.1);
  const [active, setActive] = useState("loss10");

  useEffect(() => {
    setEnabled(status?.testing.loss_enabled ?? false);
    setProb(status?.testing.loss_probability ?? 0.1);
  }, [status?.testing.loss_enabled, status?.testing.loss_probability]);

  const transferring = status?.transfer_status === "transferring";

  const pick = (s: Scenario) => {
    setActive(s.id);
    setEnabled(s.prob > 0);
    setProb(s.prob);
    onApply({ loss_enabled: s.prob > 0, loss_probability: s.prob });
  };

  const sampleLossSeq = status?.last_loss_seq ?? 42;

  return (
    <Panel>
      <PanelHeader
        title="🧪 PACKET LOSS LAB"
        icon={<FlaskConical size={15} />}
        right={
          <Badge tone={enabled ? "amber" : "slate"}>
            SIMULATION: {enabled ? `ACTIVE (${Math.round(prob * 100)}% DROP)` : "OFF"}
          </Badge>
        }
      />

      <div className="p-4 space-y-4">
        <p className="font-mono text-xs text-neutral-300">
          Simulate unreliable network conditions to demonstrate{" "}
          <span className="text-cyan-400 font-bold">Stop-and-Wait ARQ timeout</span>,{" "}
          <span className="text-amber-400 font-bold">retransmission</span>, and{" "}
          <span className="text-green-400 font-bold">duplicate avoidance</span>.
        </p>

        {/* 2-Column Lab Controls & Visual Concept Flow */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Controls Column */}
          <div className="space-y-3 border-2 border-neutral-700 bg-neutral-950 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-neutral-300">
                LOSS SIMULATION
              </span>
              <button
                role="switch"
                aria-checked={enabled}
                onClick={() => {
                  const next = !enabled;
                  setEnabled(next);
                  onApply({ loss_enabled: next, loss_probability: prob });
                }}
                className={`border-2 px-3 py-1 font-mono text-xs font-black uppercase transition active:translate-x-0.5 active:translate-y-0.5 ${
                  enabled
                    ? "border-amber-500 bg-amber-500 text-black shadow-[2px_2px_0px_#000]"
                    : "border-neutral-700 bg-neutral-800 text-neutral-400"
                }`}
              >
                [ {enabled ? "ON" : "OFF"} ]
              </button>
            </div>

            <div className="flex items-center justify-between border-t-2 border-neutral-800 pt-3">
              <span className="text-xs font-black uppercase tracking-wider text-neutral-300">
                DROP PROBABILITY
              </span>
              <select
                value={prob}
                disabled={!enabled}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setProb(val);
                  onApply({ loss_enabled: enabled, loss_probability: val });
                }}
                className="border-2 border-neutral-700 bg-neutral-900 px-3 py-1.5 font-mono text-xs font-black text-white outline-none focus:border-amber-400 disabled:opacity-50"
              >
                {[0, 0.05, 0.1, 0.2, 0.3, 0.5].map((p) => (
                  <option key={p} value={p}>
                    {Math.round(p * 100)}% PROBABILITY
                  </option>
                ))}
              </select>
            </div>

            {/* Test Scenarios */}
            <div className="space-y-1.5 pt-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-neutral-500">
                DEMO PRESETS
              </p>
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => pick(s)}
                  className={`w-full border-2 p-2 text-left font-mono transition ${
                    active === s.id && enabled === (s.prob > 0)
                      ? "border-cyan-400 bg-cyan-950/40 text-cyan-200 shadow-[2px_2px_0px_#000]"
                      : "border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-600 hover:text-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black">{s.label}</span>
                    <span className="text-[10px] font-bold text-neutral-500">
                      {s.prob * 100}%
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-neutral-500 line-clamp-1">{s.expected}</p>
                </button>
              ))}
            </div>

            <button
              onClick={() => onRunTest({ loss_enabled: enabled, loss_probability: prob })}
              disabled={busy || !hasFile || !serverRunning || transferring}
              className={`flex w-full items-center justify-center gap-2 border-2 py-2.5 font-mono text-xs font-black uppercase tracking-widest transition active:translate-x-0.5 active:translate-y-0.5 ${
                !serverRunning || !hasFile || transferring
                  ? "border-neutral-700 bg-neutral-800 text-neutral-500 cursor-not-allowed"
                  : "border-amber-400 bg-amber-400 text-black shadow-[3px_3px_0px_#000] hover:bg-amber-300 cursor-pointer"
              }`}
            >
              <Play size={14} />
              [ RUN LAB TEST ]
            </button>
          </div>

          {/* Educational Visual Flow Column (Direct requirement from Prompt 8) */}
          <div className="border-2 border-neutral-700 bg-neutral-950 p-4 flex flex-col justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">
                STOP-AND-WAIT ARQ FAULT RECOVERY CYCLE
              </p>
              <p className="mt-1 font-mono text-[11px] text-neutral-400">
                When a packet or ACK is dropped by the simulated channel:
              </p>
            </div>

            <div className="my-3 flex flex-col items-center gap-1 font-mono text-xs font-black">
              {/* STEP 1 */}
              <div className="flex w-full max-w-[240px] items-center justify-between border-2 border-cyan-500 bg-cyan-950/40 px-3 py-1.5 text-cyan-300">
                <span>DATA #{sampleLossSeq}</span>
                <span className="text-[10px] text-neutral-400">SENT</span>
              </div>
              
              <ArrowDown size={14} className="text-neutral-500" />
              
              {/* STEP 2 */}
              <div className="flex w-full max-w-[240px] items-center justify-between border-2 border-red-500 bg-red-950/50 px-3 py-1.5 text-red-400">
                <span>LOST IN TRANSIT</span>
                <X size={14} className="text-red-500" />
              </div>
              
              <ArrowDown size={14} className="text-neutral-500" />
              
              {/* STEP 3 */}
              <div className="flex w-full max-w-[240px] items-center justify-between border-2 border-amber-500 bg-amber-950/40 px-3 py-1.5 text-amber-300">
                <span>TIMER EXPIRES</span>
                <span className="text-[10px] text-neutral-400">{status?.config.timeout_ms ?? 500}ms</span>
              </div>
              
              <ArrowDown size={14} className="text-neutral-500" />
              
              {/* STEP 4 */}
              <div className="flex w-full max-w-[240px] items-center justify-between border-2 border-amber-400 bg-amber-950/40 px-3 py-1.5 text-amber-200">
                <span>RETRANSMIT #{sampleLossSeq}</span>
                <span className="text-[10px] text-neutral-400">RETRY #1</span>
              </div>
              
              <ArrowDown size={14} className="text-neutral-500" />
              
              {/* STEP 5 */}
              <div className="flex w-full max-w-[240px] items-center justify-between border-2 border-green-500 bg-green-950/50 px-3 py-1.5 text-green-300">
                <span>ACK #{sampleLossSeq}</span>
                <Check size={14} className="text-green-400" />
              </div>
            </div>

            <div className="border-t-2 border-neutral-800 pt-2 font-mono text-[10px] text-neutral-500">
              ⚡ Verified with real UDP drops at socket layer in Python backend.
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}