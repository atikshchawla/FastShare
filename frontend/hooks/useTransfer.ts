"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type {
  Config,
  FeedLine,
  PacketEntry,
  SelectedFile,
  Snapshot,
  StatusResponse,
  TestingConfig,
} from "@/lib/types";

/**
 * Single source of truth for the dashboard. Polls the FastAPI controller
 * and exposes every action the UI needs (server control, transfer control,
 * testing config, local file selection).
 *
 * The raw `File` is kept alongside its display metadata so uploads send the
 * real bytes (the browser File object cannot be reconstructed later).
 */
export function useTransfer() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [packets, setPackets] = useState<PacketEntry[]>([]);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);

  // ---- polling ----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [s, p] = await Promise.all([
          api.status(),
          api.transferPackets(200),
        ]);
        if (cancelled) return;
        setStatus(s);
        setPackets(p.packets);
        setFeed(p.feed);
        setError((prev) =>
          prev && prev.startsWith("controller unreachable") ? null : prev,
        );
      } catch {
        if (cancelled) return;
        setError("controller unreachable — is the Python backend running?");
      }
    };
    void tick();
    const id = setInterval(tick, 500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const runOnce = useCallback(async (fn: () => Promise<unknown>) => {
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
      try {
        const s = await api.status();
        setStatus(s);
      } catch {
        /* ignore */
      }
    }
  }, []);

  // ---- actions ----------------------------------------------------------
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

  const selectFile = useCallback((file: File | null) => {
    if (!file) {
      setSelectedFile(null);
      setRawFile(null);
      return;
    }
    setRawFile(file);
    setSelectedFile({
      name: file.name,
      size: file.size,
      packets: 0, // display computes `packets` from the live packet size
    });
  }, []);

  const startTransfer = useCallback(
    () =>
      runOnce(() => {
        if (!rawFile) throw new Error("no file selected");
        return api.startTransfer(rawFile);
      }),
    [runOnce, rawFile],
  );

  const cancelTransfer = useCallback(
    () => runOnce(() => api.cancelTransfer()),
    [runOnce],
  );

  return {
    status,
    packets,
    feed,
    error,
    busy,
    selectedFile,
    selectFile,
    startServer,
    stopServer,
    saveConfig,
    applyTesting,
    startTransfer,
    cancelTransfer,
  };
}