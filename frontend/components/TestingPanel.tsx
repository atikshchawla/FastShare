"use client";

import { useEffect, useState } from "react";
import { FlaskConical, Play } from "lucide-react";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
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
    label: "Test 1 · Normal",
    prob: 0,
    expected: "All packets ACKed · 0 retransmissions",
    tone: "green",
  },
  {
    id: "loss10",
    label: "Test 2 · 10% Loss",
    prob: 0.1,
    expected: "Some timeouts → retransmission → still completes",
    tone: "amber",
  },
  {
    id: "loss50",
    label: "Test 3 · 50% Loss",
    prob: 0.5,
    expected: "Heavy retransmission · may hit retry limit",
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
  };

  return (
    <Panel>
      <PanelHeader
        title="Testing — Packet Loss Simulation"
        icon={<FlaskConical size={14} />}
        right={
          <Badge tone={enabled ? "amber" : "slate"}>
            {enabled
              ? `drop ${Math.round(prob * 100)}%`
              : "OFF"}
          </Badge>
        }
      />

      <div className="p-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-[#070b12] px-3 py-2.5">
            <button
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((e) => !e)}
              className={cn(
                "relative h-5 w-10 rounded-full transition",
                enabled ? "bg-amber-500/70" : "bg-slate-700",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
                  enabled ? "left-[22px]" : "left-0.5",
                )}
              />
            </button>
            <div>
              <p className="text-[12px] font-semibold text-slate-200">
                Packet Loss
              </p>
              <p className="font-mono text-[10px] text-slate-500">
                drop incoming packets / ACKs
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#070b12] px-3 py-2.5">
            <span className="text-[12px] text-slate-300">Loss Probability</span>
            <select
              value={prob}
              onChange={(e) => setProb(Number(e.target.value))}
              className="rounded-md border border-slate-700 bg-[#0a0f1a] px-2 py-1.5 font-mono text-[12px] text-slate-100 outline-none focus:border-amber-500/60"
            >
              {[0, 0.05, 0.1, 0.25, 0.5].map((p) => (
                <option key={p} value={p}>
                  {Math.round(p * 100)}%
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              onClick={() => pick(s)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition",
                active === s.id
                  ? "border-cyan-500/60 bg-cyan-500/[0.07]"
                  : "border-slate-800 bg-[#070b12] hover:border-slate-600",
              )}
            >
              <span className="text-[12px] font-semibold text-slate-200">
                {s.label}
              </span>
              <span className="truncate text-right text-[11px] text-slate-500">
                {s.expected}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => onApply({ loss_enabled: enabled, loss_probability: prob })}
            disabled={busy}
            className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-[12px] font-semibold text-slate-200 transition hover:bg-slate-700/60 disabled:opacity-50"
          >
            Apply to Server
          </button>
          <button
            onClick={() => onRunTest({ loss_enabled: enabled, loss_probability: prob })}
            disabled={busy || !hasFile || !serverRunning || transferring}
            title={
              !serverRunning
                ? "start the UDP receiver first"
                : !hasFile
                  ? "select a file first"
                  : "apply loss, then start"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50",
              "bg-emerald-500/15 px-3 py-2 text-[12px] font-semibold text-emerald-300",
              "transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            <Play size={13} /> Run Test
          </button>
          <span className="ml-auto text-[10px] text-slate-600">
            Loss sim lives inside Python — real UDP packets, dropped at random
          </span>
        </div>
      </div>
    </Panel>
  );
}