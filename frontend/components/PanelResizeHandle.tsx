"use client";

import { cn } from "@/lib/cn";

/**
 * Vertical drag handle between a sidebar and the canvas: pointer-drag to
 * resize (width is clamped by the caller), double-click to reset. The
 * handle hides when its sidebar is closed (the caller simply unmounts it).
 */
export function PanelResizeHandle({
  side,
  width,
  onChange,
  min,
  max,
  onReset,
}: {
  side: "left" | "right";
  width: number;
  onChange: (w: number) => void;
  min: number;
  max: number;
  onReset: () => void;
}) {
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const startX = e.clientX;
    const startW = width;
    el.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      const delta = side === "left" ? ev.clientX - startX : startX - ev.clientX;
      onChange(Math.min(max, Math.max(min, startW + delta)));
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* already released */
      }
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} panel`}
      title="Drag to resize · double-click to reset"
      onPointerDown={handlePointerDown}
      onDoubleClick={onReset}
      className={cn(
        "group relative z-10 h-full w-1.5 shrink-0 touch-none cursor-col-resize",
        "bg-neutral-900 hover:bg-cyan-500/50 active:bg-cyan-500",
        side === "left"
          ? "border-r-2 border-neutral-800"
          : "border-l-2 border-neutral-800",
      )}
    >
      <span className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-neutral-600 group-hover:bg-neutral-900" />
    </div>
  );
}
