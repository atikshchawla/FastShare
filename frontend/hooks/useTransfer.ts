"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type {
  Config,
  FeedLine,
  PacketEntry,
  ResumeInfo,
  SelectedFile,
  Snapshot,
  StatusResponse,
  TestingConfig,
  TransferStatus,
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
  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null);

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

  // ---- resume -----------------------------------------------------------
  /** Ask the controller whether an interrupted copy of this file exists. */
  const refreshResume = useCallback(async (file: File | null) => {
    if (!file) {
      setResumeInfo(null);
      return;
    }
    try {
      const info = await api.resumeCheck(file.name, file.size);
      setResumeInfo(info.available ? info : null);
    } catch {
      setResumeInfo(null); // backend unreachable: hide, don't block
    }
  }, []);

  // When a run ends unfinished (failed/cancelled), the receiver may now hold
  // a resumable partial of the selected file -> re-check exactly then.
  const prevTransferStatus = useRef<TransferStatus | null>(null);
  useEffect(() => {
    const current = status?.transfer_status ?? null;
    const prev = prevTransferStatus.current;
    prevTransferStatus.current = current;
    if (current === "transferring") {
      setResumeInfo(null); // this run owns the partial now
      return;
    }
    if ((current === "failed" || current === "cancelled") && prev !== current) {
      void refreshResume(rawFile);
    }
  }, [status?.transfer_status, rawFile, refreshResume]);

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

  const selectFile = useCallback(
    (file: File | null) => {
      if (!file) {
        setSelectedFile(null);
        setRawFile(null);
        setResumeInfo(null);
        return;
      }
      setRawFile(file);
      setSelectedFile({
        name: file.name,
        size: file.size,
        packets: 0, // display computes `packets` from the live packet size
      });
      void refreshResume(file);
    },
    [refreshResume],
  );

  /**
   * Start the transfer. ``resume=true`` (default) continues an interrupted
   * copy of the same file on the receiver; ``false`` discards it and
   * re-sends every packet from #1.
   */
  const startTransfer = useCallback(
    (resume: boolean = true) =>
      runOnce(() => {
        if (!rawFile) throw new Error("no file selected");
        return api.startTransfer(rawFile, resume);
      }),
    [runOnce, rawFile],
  );

  /** "Start over": delete the pending partial before the next attempt. */
  const discardResume = useCallback(
    () =>
      runOnce(async () => {
        if (!rawFile) return;
        await api.resumeDiscard(rawFile.name, rawFile.size);
        setResumeInfo(null);
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
    resumeInfo,
    selectFile,
    startServer,
    stopServer,
    saveConfig,
    applyTesting,
    startTransfer,
    discardResume,
    cancelTransfer,
  };
}