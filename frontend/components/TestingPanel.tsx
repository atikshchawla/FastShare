"use client";

import { useEffect, useState } from "react";
import { FlaskConical, Play, ShieldAlert, Zap } from "lucide-react";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Snapshot, TestingConfig } from "@/lib/types";

interface Scenario {
  id: string;
  label: string;
  loss: number;
  corrupt: number;
  expected: string;
  tone: "green" | "amber" | "red" | "violet";
}

const SCENARIOS: Scenario[] = [
  {
    id: "normal",
    label: "Test 1 · Normal",
    loss: 0,
    corrupt: 0,
    expected: "All packets ACKed · 0 retransmissions",
    tone: "green",
  },
  {
    id: "loss10",
    label: "Test 2 · 10% Loss",
    loss: 0.1,
    corrupt: 0,
    expected: "Some timeouts → retransmission → still completes",
    tone: "amber",
  },
  {
    id: "loss50",
    label: "Test 3 · 50% Loss",
    loss: 0.5,
    corrupt: 0,
    expected: "Heavy retransmission · may hit retry limit",
    tone: "red",
  },
  {
    id: "corrupt10",
    label: "Test 4 · 10% Corruption",
    loss: 0,
    corrupt: 0.1,
    expected: "CRC-32 catches bit flips → dropped → retransmit",
    tone: "violet",
  },
];

const TONES: Record<Scenario["tone"], "green" | "amber" | "red" | "violet"> = {
  green: "green",
  amber: "amber",
  red: "red",
  violet: "violet",
};

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
  const [lossOn, setLossOn] = useState(false);
  const [lossProb, setLossProb] = useState(0.1);
  const [corruptOn, setCorruptOn] = useState(false);
  const [corruptProb, setCorruptProb] = useState(0.1);
  const [active, setActive] = useState("loss10");

  useEffect(() => {
    setLossOn(status?.testing.loss_enabled ?? false);
    setLossProb(status?.testing.loss_probability ?? 0.1);
    setCorruptOn(status?.testing.corrupt_enabled ?? false);
    setCorruptProb(status?.testing.corrupt_probability ?? 0.1);
  }, [
    status?.testing.loss_enabled,
    status?.testing.loss_probability,
    status?.testing.corrupt_enabled,
    status?.testing.corrupt_probability,
  ]);

  const transferring = status?.transfer_status === "transferring";
  const crcErrors = status?.checksum_errors ?? 0;

  const pick = (s: Scenario) => {
    setActive(s.id);
    setLossOn(s.loss > 0);
    setLossProb(s.loss);
    setCorruptOn(s.corrupt > 0);
    setCorruptProb(s.corrupt);
  };

  const cfg = (): TestingConfig => ({
    loss_enabled: lossOn,
    loss_probability: lossProb,
    corrupt_enabled: corruptOn,
    corrupt_probability: corruptProb,
  });

  const simBadge = () => {
    const parts: string[] = [];
    if (lossOn) parts.push(`drop ${Math.round(lossProb * 100)}%`);
    if (corruptOn) parts.push(`corrupt ${Math.round(corruptProb * 100)}%`);
    return parts.length ? parts.join(" · ") : "OFF";
  };

  const simToggle = (
    on: boolean,
    onToggle: () => void,
    title: string,
    sub: string,
    icon: React.ReactNode,
  ) => (
    <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-[#070b12] px-3 py-2.5">
      <button
        role="switch"
        aria-checked={on}
        onClick={onToggle}
        className={cn(
          "relative h-5 w-10 shrink-0 rounded-full transition",
          on ? "bg-amber-500/70" : "bg-slate-700",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
            on ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
      <span className="shrink-0 text-amber-400/80">{icon}</span>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-slate-200">{title}</p>
        <p className="truncate font-mono text-[10px] text-slate-500">{sub}</p>
      </div>
    </div>
  );

  const probSelect = (label: string, value: number, onChange: (v: number) => void) => (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#070b12] px-3 py-2.5">
      <span className="text-[12px] text-slate-300">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-slate-700 bg-[#0a0f1a] px-2 py-1.5 font-mono text-[12px] text-slate-100 outline-none focus:border-amber-500/60"
      >
        {[0, 0.05, 0.1, 0.25, 0.5].map((p) => (
          <option key={p} value={p}>
            {Math.round(p * 100)}%
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <Panel>
      <PanelHeader
        title="Testing — Network Fault Simulation"
        icon={<FlaskConical size={14} />}
        right={
          <div className="flex items-center gap-2">
            {crcErrors > 0 && (
              <Badge tone="violet" className="font-mono">
                CRC {crcErrors}
              </Badge>
            )}
            <Badge tone={lossOn || corruptOn ? "amber" : "slate"}>
              {simBadge()}
            </Badge>
          </div>
        }
      />

      <div className="p-4">
        <div className="grid grid-cols-2 gap-3">
          {simToggle(
            lossOn,
            () => setLossOn((e) => !e),
            "Packet Loss",
            "drop incoming packets / ACKs",
            <Zap size={14} />,
          )}
          {probSelect("Loss Probability", lossProb, setLossProb)}
          {simToggle(
            corruptOn,
            () => setCorruptOn((e) => !e),
            "Corruption (CRC-32)",
            "flip a bit in transit — CRC catches it",
            <ShieldAlert size={14} />,
          )}
          {probSelect("Corruption Rate", corruptProb, setCorruptProb)}
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
              <span className="flex items-center gap-2 text-[12px] font-semibold text-slate-200">
                <Badge tone={TONES[s.tone]} className="font-mono text-[9px]">
                  {s.tone === "violet" ? "CRC" : s.tone === "green" ? "OK" : s.tone === "amber" ? "ARQ" : "MAX"}
                </Badge>
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
            onClick={() => onApply(cfg())}
            disabled={busy}
            className="rounded-md border border-slate-700 bg-slate-800/60 px-3 py-2 text-[12px] font-semibold text-slate-200 transition hover:bg-slate-700/60 disabled:opacity-50"
          >
            Apply
          </button>
          <button
            onClick={() => onRunTest(cfg())}
            disabled={busy || !hasFile || !serverRunning || transferring}
            title={
              !serverRunning
                ? "start the UDP receiver first"
                : !hasFile
                  ? "select a file first"
                  : "apply the selected faults, then start"
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border border-emerald-500/50",
              "bg-emerald-500/15 px-3 py-2 text-[12px] font-semibold text-emerald-300",
              "transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            <Play size={13} /> Run Test
          </button>
          <span className="ml-auto text-right text-[10px] leading-tight text-slate-600">
            Simulations run inside Python on real UDP packets
          </span>
        </div>
      </div>
    </Panel>
  );
}