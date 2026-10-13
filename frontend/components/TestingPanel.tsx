"use client";

import { useEffect, useState } from "react";
import { FlaskConical, Play, ShieldAlert, Zap, AlertTriangle } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui";
import type { Snapshot, TestingConfig } from "@/lib/types";

interface Scenario {
  id: string;
  label: string;
  loss: number;
  corrupt: number;
  expected: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: "normal",
    label: "TEST 1 · ZERO FAULTS (BASELINE)",
    loss: 0,
    corrupt: 0,
    expected: "Reliable transfer · 0 timeouts · Fast completion",
  },
  {
    id: "loss10",
    label: "TEST 2 · 10% CHANNEL PACKET LOSS",
    loss: 0.1,
    corrupt: 0,
    expected: "Timeout ARQ triggers → Retransmissions recover data",
  },
  {
    id: "loss50",
    label: "TEST 3 · 50% HEAVY LOSS STRESS",
    loss: 0.5,
    corrupt: 0,
    expected: "Frequent retries · Exercises max retry threshold",
  },
  {
    id: "corrupt10",
    label: "TEST 4 · 10% CRC-32 BIT CORRUPTION",
    loss: 0,
    corrupt: 0.1,
    expected: "CRC-32 catches bad packet → Silent drop → Retransmit",
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

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Physical Channel Fault Injection & Stress Lab"
        badgeText="FAULT INJECTION DECK"
        icon={<FlaskConical size={20} className="stroke-[2.5]" />}
        right={
          (lossOn || corruptOn) && (
            <div className="flex items-center gap-1.5 rounded-lg bg-orange-50 border border-orange-300 px-3 py-1 text-xs font-mono font-extrabold text-orange-950 animate-pulse">
              <AlertTriangle size={14} className="text-orange-600" />
              <span>SIMULATION ACTIVE</span>
            </div>
          )
        }
      />

      <div className="p-6 font-mono space-y-6">
        {/* Preset Scenarios Grid */}
        <div>
          <span className="text-xs sm:text-sm font-extrabold text-slate-700 uppercase tracking-wide block mb-3">
            Academic Lab Test Scenarios:
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => pick(s)}
                className={`rounded-2xl border-2 p-4 text-left transition-all ${
                  active === s.id
                    ? "border-orange-500 bg-orange-50/70 shadow-xs ring-2 ring-orange-200"
                    : "border-slate-200 bg-slate-50/60 hover:border-slate-300 hover:bg-white"
                }`}
              >
                <span className="block text-xs font-extrabold text-slate-900 uppercase">
                  {s.label}
                </span>
                <span className="mt-1.5 block text-xs text-slate-500 font-medium leading-relaxed">
                  {s.expected}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Manual Sliders & Toggles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Packet Loss Simulation */}
          <div className="rounded-2xl border-2 border-slate-200 bg-slate-50/60 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert size={18} className="text-orange-600" />
                <span className="text-xs sm:text-sm font-extrabold uppercase text-slate-900">
                  Simulated Packet Drop
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={lossOn}
                  onChange={(e) => setLossOn(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600"></div>
              </label>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-600 font-bold">
                <span>Loss Rate Probability:</span>
                <span className="text-orange-700 font-extrabold">{(lossProb * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.01"
                max="0.9"
                step="0.01"
                disabled={!lossOn}
                value={lossProb}
                onChange={(e) => setLossProb(parseFloat(e.target.value))}
                className="w-full accent-orange-600 cursor-pointer"
              />
            </div>
          </div>

          {/* CRC Bitflip Corruption Simulation */}
          <div className="rounded-2xl border-2 border-slate-200 bg-slate-50/60 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap size={18} className="text-teal-700" />
                <span className="text-xs sm:text-sm font-extrabold uppercase text-slate-900">
                  Payload Bitflip Corruption
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={corruptOn}
                  onChange={(e) => setCorruptOn(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-700"></div>
              </label>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-600 font-bold">
                <span>Corruption Probability:</span>
                <span className="text-teal-800 font-extrabold">{(corruptProb * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.01"
                max="0.5"
                step="0.01"
                disabled={!corruptOn}
                value={corruptProb}
                onChange={(e) => setCorruptProb(parseFloat(e.target.value))}
                className="w-full accent-teal-700 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Buttons for Applying and Running Tests */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            onClick={() => onApply(cfg())}
            disabled={busy}
            className="flex-1 rounded-xl border-2 border-slate-300 bg-white py-3 text-xs sm:text-sm font-extrabold uppercase hover:border-slate-400 hover:bg-slate-50 transition-colors shadow-xs"
          >
            Apply Fault Parameters
          </button>
          <button
            onClick={() => onRunTest(cfg())}
            disabled={busy || !hasFile || !serverRunning || transferring}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-orange-600 text-white py-3 text-xs sm:text-sm font-extrabold uppercase hover:bg-orange-500 transition-colors shadow-md shadow-orange-600/25 disabled:opacity-50"
          >
            <Play size={16} className="fill-current stroke-none" />
            <span>Apply &amp; Run Test Transfer</span>
          </button>
        </div>
      </div>
    </Panel>
  );
}