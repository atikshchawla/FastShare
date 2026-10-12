/** Preset fault scenarios offered by the Testing panel. */

export type ScenarioTone = "green" | "amber" | "red" | "violet";

export interface Scenario {
  id: string;
  label: string;
  loss: number;
  corrupt: number;
  expected: string;
  tone: ScenarioTone;
}

export const SCENARIOS: Scenario[] = [
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
