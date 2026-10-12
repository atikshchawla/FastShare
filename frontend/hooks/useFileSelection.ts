"use client";

import { useCallback, useState } from "react";
import type { SelectedFile } from "@/lib/types";

/**
 * Local file pick state. The raw `File` is kept alongside its display
 * metadata so uploads send the real bytes (the browser File object cannot
 * be reconstructed later).
 */
export function useFileSelection() {
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);

  const selectFile = useCallback((file: File | null) => {
    if (!file) {
      setSelectedFile(null);
      setRawFile(null);
      return;
    }
    setRawFile(file);
    setSelectedFile({ name: file.name, size: file.size });
  }, []);

  return { selectedFile, rawFile, selectFile };
}
