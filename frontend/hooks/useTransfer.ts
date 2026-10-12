"use client";

import { useFileSelection } from "./useFileSelection";
import { useResume } from "./useResume";
import { useStatusPolling } from "./useStatusPolling";
import { useTransferActions } from "./useTransferActions";

/**
 * Single source of truth for the dashboard. Composes the polling loop,
 * local file selection, resume-banner state and the controller actions
 * (server control, transfer control, testing config).
 */
export function useTransfer() {
  const { status, packets, feed, topology, error, setError, refreshStatus } =
    useStatusPolling();
  const { selectedFile, rawFile, selectFile } = useFileSelection();
  const { resumeInfo } = useResume({
    transferStatus: status?.transfer_status ?? null,
    rawFile,
  });
  const actions = useTransferActions({ setError, refreshStatus, rawFile });

  return {
    status,
    packets,
    feed,
    topology,
    error,
    ...actions,
    selectedFile,
    resumeInfo,
    selectFile,
  };
}
