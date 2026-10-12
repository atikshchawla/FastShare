"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ResumeInfo, TransferStatus } from "@/lib/types";

/**
 * Resume banner state for the selected file:
 * - re-checks whenever a different file is picked,
 * - re-checks when a run ends unfinished (failed/cancelled) — the receiver
 *   may now hold a resumable partial of exactly this file,
 * - clears while a transfer is running (that run owns the partial now).
 */
export function useResume({
  transferStatus,
  rawFile,
}: {
  transferStatus: TransferStatus | null;
  rawFile: File | null;
}) {
  const [resumeInfo, setResumeInfo] = useState<ResumeInfo | null>(null);

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

  // New file picked -> look for an interrupted copy right away.
  useEffect(() => {
    void refreshResume(rawFile);
  }, [rawFile, refreshResume]);

  const prevTransferStatus = useRef<TransferStatus | null>(null);
  useEffect(() => {
    const current = transferStatus;
    const prev = prevTransferStatus.current;
    prevTransferStatus.current = current;
    if (current === "transferring") {
      setResumeInfo(null); // this run owns the partial now
      return;
    }
    if ((current === "failed" || current === "cancelled") && prev !== current) {
      void refreshResume(rawFile);
    }
  }, [transferStatus, rawFile, refreshResume]);

  return { resumeInfo };
}
