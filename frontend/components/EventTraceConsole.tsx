"use client";

import { useStickToBottom } from "@/hooks/useStickToBottom";
import { classifyLogLine, type LogTone } from "@/lib/logClassify";
import type { FeedLine } from "@/lib/types";

function timestamp(t: number): string {
  return new Date(t * 1000).toLocaleTimeString(undefined, { hour12: false });
}

/** Bordered event rows (Packet Monitor trace view). */
export const ROW_TONE_CLASSES: Record<LogTone, string> = {
  loss: "border-red-500 text-red-400 bg-red-950/10 font-bold",
  duplicate: "border-amber-500 text-amber-300 bg-amber-950/20 font-bold",
  retransmit: "border-amber-500 text-amber-400 bg-amber-950/10 font-bold",
  ack: "border-green-500 text-green-400 bg-green-950/10",
  serverData: "border-emerald-500 text-emerald-300 bg-emerald-950/10",
  clientData: "border-cyan-500 text-cyan-300 bg-cyan-950/10",
  lifecycle: "border-green-500 text-green-400 bg-green-950/10 font-bold",
  sent: "border-cyan-500 text-cyan-300 bg-cyan-950/10",
  neutral: "border-neutral-700 text-neutral-300",
};

/** Plain colored lines (hero terminal trace). */
export const TERMINAL_TONE_CLASSES: Record<LogTone, string> = {
  loss: "text-red-400 font-bold",
  duplicate: "text-amber-400 font-bold",
  retransmit: "text-amber-300 font-bold",
  ack: "text-green-400 font-medium",
  serverData: "text-emerald-300",
  clientData: "text-cyan-300",
  lifecycle: "text-green-400 font-bold",
  sent: "text-cyan-300",
  neutral: "text-neutral-300",
};

/**
 * Shared scrollable feed renderer used by both the Packet Monitor trace
 * view and the hero protocol terminal. The caller supplies the height,
 * container classes, empty-state text and its tone->class map so each
 * console keeps its own look.
 */
export function EventTraceConsole({
  feed,
  variant,
  toneClasses,
  heightClass,
  containerClass,
  emptyText,
  emptyClass = "text-neutral-600",
}: {
  feed: FeedLine[];
  variant: "rows" | "terminal";
  toneClasses: Record<LogTone, string>;
  heightClass: string;
  containerClass: string;
  emptyText: string;
  emptyClass?: string;
}) {
  const { ref, onScroll, onWheel } = useStickToBottom<HTMLDivElement>();

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      onWheel={onWheel}
      className={`${heightClass} ${containerClass} overflow-y-auto`}
    >
      {feed.length === 0 ? (
        <p className={emptyClass}>{emptyText}</p>
      ) : (
        feed.map((line, i) => {
          const cls = toneClasses[classifyLogLine(line.text)];
          const key = `${line.t}-${i}`;
          return variant === "rows" ? (
            <div
              key={key}
              className={`flex items-start gap-3 border-l-2 pl-3 ${cls}`}
            >
              <span className="shrink-0 text-[11px] font-bold text-neutral-600">
                [{timestamp(line.t)}]
              </span>
              <span className="font-bold">{line.text}</span>
            </div>
          ) : (
            <p key={key} className={cls}>
              <span className="text-neutral-600">[{timestamp(line.t)}]</span>{" "}
              {line.text}
            </p>
          );
        })
      )}
    </div>
  );
}
