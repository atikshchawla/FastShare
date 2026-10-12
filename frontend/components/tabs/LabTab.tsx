"use client";

import { TestingPanel } from "@/components/TestingPanel";
import type { Snapshot, TestingConfig } from "@/lib/types";

export function LabTab({
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
  return (
    <TestingPanel
      status={status}
      busy={busy}
      hasFile={hasFile}
      serverRunning={serverRunning}
      onApply={onApply}
      onRunTest={onRunTest}
    />
  );
}
