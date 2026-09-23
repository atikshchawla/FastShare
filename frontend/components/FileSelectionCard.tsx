"use client";

import { useRef, useState } from "react";
import { CloudUpload, FileText, Trash2 } from "lucide-react";
import { Badge, Panel, PanelHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/types";
import type { SelectedFile } from "@/lib/types";

const MAX_FILE_MB = 15;

export function FileSelectionCard({
  selectedFile,
  onSelect,
  packetSize,
  disabled,
}: {
  selectedFile: SelectedFile | null;
  onSelect: (file: File | null) => void;
  packetSize: number;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const pick = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setWarning(
        `File exceeds the ${MAX_FILE_MB} MB limit for this demo (${
          (file.size / (1024 * 1024)).toFixed(1)
        } MB).`,
      );
      return;
    }
    setWarning(null);
    onSelect(file);
  };

  const packets =
    selectedFile && packetSize > 0
      ? Math.max(1, Math.ceil(selectedFile.size / packetSize))
      : 0;

  return (
    <Panel>
      <PanelHeader
        title="2 · File Selection"
        icon={<FileText size={14} />}
        right={
          selectedFile && (
            <Badge tone="cyan">max {MAX_FILE_MB} MB</Badge>
          )
        }
      />

      {!selectedFile ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex w-full flex-col items-center gap-3 px-6 py-10 text-center transition",
            "border-2 border-dashed rounded-xl m-3 bg-slate-900/30",
            dragging
              ? "border-cyan-400/70 text-cyan-300"
              : "border-slate-800 text-slate-400 hover:border-slate-600",
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <CloudUpload size={28} className={dragging ? "text-cyan-300" : ""} />
          <div>
            <p className="text-sm font-medium text-slate-200">
              Drop your file here
            </p>
            <p className="mt-1 text-xs text-slate-500">or browse files</p>
          </div>
          <p className="font-mono text-[11px] text-slate-600">
            Maximum size: {MAX_FILE_MB} MB · split into {packetSize}-byte payloads
          </p>
        </button>
      ) : (
        <div className="p-4">
          <div className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
            <FileText size={26} className="mt-0.5 shrink-0 text-cyan-400" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-100">
                {selectedFile.name}
              </p>
              <p className="mt-2 grid grid-cols-2 gap-1 font-mono text-[12px] text-slate-400">
                <span>
                  Size <span className="text-slate-200">
                    {formatBytes(selectedFile.size)}
                  </span>
                </span>
                <span>
                  Packets{" "}
                  <span className="text-slate-200">
                    ~{packets}
                  </span>
                </span>
              </p>
            </div>
            <button
              onClick={() => onSelect(null)}
              title="Remove file"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-800 text-slate-500 transition hover:border-rose-500/50 hover:text-rose-400"
            >
              <Trash2 size={15} />
            </button>
          </div>
          {warning && (
            <p className="mt-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-mono text-[11px] text-rose-400">
              {warning}
            </p>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        disabled={disabled || !!selectedFile}
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </Panel>
  );
}