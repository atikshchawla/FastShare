"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { api, type NodeConfigPatch } from "@/lib/api";
import type { MultipathPolicy } from "@/lib/topology";
import type { Config, TestingConfig } from "@/lib/types";

/**
 * Every controller action the UI exposes (server control, transfer control,
 * testing config). Each action runs through `runOnce`: busy flag, error
 * capture, then a status refresh so the dashboard reflects the new state
 * immediately.
 */
export function useTransferActions({
  setError,
  refreshStatus,
  rawFile,
}: {
  setError: Dispatch<SetStateAction<string | null>>;
  refreshStatus: () => Promise<void>;
  rawFile: File | null;
}) {
  const [busy, setBusy] = useState(false);

  const runOnce = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
        await refreshStatus();
      }
    },
    [setError, refreshStatus],
  );

  const startServer = useCallback(
    () => runOnce(() => api.startServer()),
    [runOnce],
  );
  const stopServer = useCallback(
    () => runOnce(() => api.stopServer()),
    [runOnce],
  );
  const saveConfig = useCallback(
    (cfg: Config) => runOnce(() => api.saveConfig(cfg)),
    [runOnce],
  );
  const applyTesting = useCallback(
    (cfg: TestingConfig) => runOnce(() => api.testingConfig(cfg)),
    [runOnce],
  );

  /** Patch one topology node's latency/loss/corruption/enabled override. */
  const saveNodeConfig = useCallback(
    (cfg: NodeConfigPatch) => runOnce(() => api.saveNodeConfig(cfg)),
    [runOnce],
  );

  /** Drop a node's override so it follows the global config again. */
  const resetNodeConfig = useCallback(
    (id: string) => runOnce(() => api.saveNodeConfig({ id, reset: true })),
    [runOnce],
  );

  /** Switch the active preset graph (star <-> tri-path). */
  const setPreset = useCallback(
    (name: string) => runOnce(() => api.setPreset(name)),
    [runOnce],
  );

  /** Patch the source-side multipath policy (scheduler thresholds). */
  const setMultipath = useCallback(
    (patch: Partial<MultipathPolicy>) =>
      runOnce(() => api.multipathConfig(patch)),
    [runOnce],
  );

  /**
   * Start the transfer. ``resume=true`` (default) continues an interrupted
   * copy of the same file on the receiver; ``false`` discards it and
   * re-sends every packet from #1. ``source``/``dest`` pick the topology
   * nodes (only used while ``topology_enabled``).
   */
  const startTransfer = useCallback(
    (resume: boolean = true, source?: string, dest?: string) =>
      runOnce(() => {
        if (!rawFile) throw new Error("no file selected");
        return api.startTransfer(rawFile, resume, source, dest);
      }),
    [runOnce, rawFile],
  );

  const cancelTransfer = useCallback(
    () => runOnce(() => api.cancelTransfer()),
    [runOnce],
  );

  return {
    busy,
    startServer,
    stopServer,
    saveConfig,
    applyTesting,
    saveNodeConfig,
    resetNodeConfig,
    setPreset,
    setMultipath,
    startTransfer,
    cancelTransfer,
  };
}
