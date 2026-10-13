"use client";

import { useRef, useState } from "react";
import { FileUp, HardDrive, Trash2, FileText, CheckCircle2 } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui";
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
        `File exceeds ${MAX_FILE_MB}MB safety limit for lab demo (${(file.size / (1024 * 1024)).toFixed(1)}MB).`,
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
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Source File & Datagram Segmentation"
        badgeText="INPUT CHANNEL"
        icon={<HardDrive size={20} className="stroke-[2.5]" />}
        right={
          selectedFile ? (
            <div className="flex items-center gap-1.5 rounded-lg bg-teal-50 border border-teal-300 px-3 py-1 text-xs font-mono font-extrabold text-teal-900 shadow-xs">
              <CheckCircle2 size={14} className="text-teal-600" />
              <span>SEGMENTED</span>
            </div>
          ) : (
            <span className="rounded-lg bg-slate-100 border border-slate-200 px-3 py-1 text-xs font-mono font-bold text-slate-700">
              MAX {MAX_FILE_MB} MB
            </span>
          )
        }
      />

      <div className="p-6 font-mono">
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
            className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all ${
              dragging
                ? "border-teal-600 bg-teal-50 text-teal-950 scale-[1.01]"
                : "border-slate-300 bg-slate-50/70 hover:border-teal-600 hover:bg-teal-50/40"
            } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 border-2 border-teal-200 text-teal-700 mb-3 shadow-xs">
              <FileUp size={28} className="stroke-[2.3]" />
            </div>
            <p className="text-sm sm:text-base font-extrabold text-slate-900 uppercase tracking-tight">
              DROP FILE OR CLICK TO BROWSE
            </p>
            <p className="mt-1 text-xs sm:text-sm text-slate-500 font-medium">
              Segments raw byte stream into {packetSize}-byte UDP payload datagrams
            </p>
          </button>
        ) : (
          <div className="rounded-2xl border-2 border-teal-200 bg-teal-50/50 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white shadow-xs">
                  <FileText size={24} />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-teal-800 block">
                    SELECTED PAYLOAD FILE
                  </span>
                  <p className="truncate text-base font-black text-slate-900 mt-0.5">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs sm:text-sm text-slate-600 font-semibold mt-0.5">
                    {formatBytes(selectedFile.size)} · raw binary
                  </p>
                </div>
              </div>

              {!disabled && (
                <button
                  onClick={() => onSelect(null)}
                  title="Remove selected file"
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-rose-600 hover:border-rose-300 hover:bg-rose-50 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            {/* Segmentation Blueprint Breakdown */}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2.5 border-t-2 border-teal-200/80 pt-3.5 text-xs sm:text-sm">
              <div className="rounded-xl bg-white p-3 border border-teal-100 shadow-2xs">
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Total UDP Datagrams:</span>
                <span className="text-base font-black text-teal-900 block mt-0.5 font-tabular">
                  {packets} packets
                </span>
              </div>
              <div className="rounded-xl bg-white p-3 border border-teal-100 shadow-2xs">
                <span className="text-[10px] uppercase font-bold text-slate-500 block">MSS Chunk Size:</span>
                <span className="text-base font-black text-slate-900 block mt-0.5 font-tabular">
                  {packetSize} Bytes
                </span>
              </div>
              <div className="rounded-xl bg-white p-3 border border-teal-100 shadow-2xs col-span-2 sm:col-span-1">
                <span className="text-[10px] uppercase font-bold text-slate-500 block">Wire Overhead:</span>
                <span className="text-base font-black text-orange-600 block mt-0.5 font-tabular">
                  +{packets * 13} Bytes
                </span>
              </div>
            </div>
          </div>
        )}

        {warning && (
          <p className="mt-3 text-xs sm:text-sm font-bold text-rose-600 bg-rose-50 p-2.5 rounded-xl border border-rose-200">
            {warning}
          </p>
        )}

        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
    </Panel>
  );
}