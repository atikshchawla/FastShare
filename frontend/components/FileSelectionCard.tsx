"use client";

import { useRef, useState } from "react";
import { FileUp, HardDrive, Trash2 } from "lucide-react";
import { Badge, Panel, PanelHeader } from "@/components/ui";
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
        `FILE EXCEEDS ${MAX_FILE_MB}MB LIMIT FOR DEMO (${(file.size / (1024 * 1024)).toFixed(1)}MB).`,
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
        title="FILE SELECTION"
        icon={<HardDrive size={15} />}
        right={
          selectedFile ? (
            <Badge tone="cyan">READY</Badge>
          ) : (
            <Badge tone="slate">MAX {MAX_FILE_MB}MB</Badge>
          )
        }
      />

      <div className="p-4">
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
            className={`flex w-full flex-col items-center justify-center border-2 border-dashed p-6 text-center transition ${
              dragging
                ? "border-cyan-400 bg-cyan-950/30 text-cyan-300"
                : "border-neutral-700 bg-neutral-950 text-neutral-400 hover:border-neutral-500 hover:text-white"
            } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
          >
            <FileUp size={28} className="mb-2 text-cyan-400" />
            <p className="font-mono text-xs font-black uppercase tracking-wider text-neutral-200">
              DROP FILE OR CLICK TO BROWSE
            </p>
            <p className="mt-1 font-mono text-[10px] text-neutral-500">
              Will be segmented into {packetSize}-byte UDP payloads
            </p>
          </button>
        ) : (
          <div className="border-2 border-cyan-500 bg-cyan-950/20 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
                  SELECTED FILE
                </span>
                <p className="truncate font-mono text-sm font-black text-white">
                  {selectedFile.name}
                </p>
              </div>
              <button
                onClick={() => onSelect(null)}
                disabled={disabled}
                title="Remove file"
                className="flex h-8 w-8 items-center justify-center border-2 border-red-500 bg-red-500/10 text-red-400 shadow-[2px_2px_0px_#000] hover:bg-red-500/20 disabled:opacity-50"
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 border-t-2 border-cyan-500/30 pt-3 font-mono text-xs">
              <div className="border-2 border-neutral-700 bg-neutral-900 p-2">
                <span className="text-[10px] font-bold text-neutral-400 block uppercase">File Size</span>
                <span className="font-black text-white">{formatBytes(selectedFile.size)}</span>
              </div>
              <div className="border-2 border-neutral-700 bg-neutral-900 p-2">
                <span className="text-[10px] font-bold text-neutral-400 block uppercase">Total Packets</span>
                <span className="font-black text-cyan-300">~{packets} packets</span>
              </div>
            </div>
          </div>
        )}

        {warning && (
          <div className="mt-3 border-2 border-red-500 bg-red-500/10 p-2 font-mono text-[11px] font-bold text-red-400">
            {warning}
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          disabled={disabled || !!selectedFile}
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
    </Panel>
  );
}