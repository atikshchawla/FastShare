"use client";

import { useCallback, useEffect, useState } from "react";

/** Width limits (px) for the two resizable sidebars. */
export const PANEL_LIMITS = {
  left: { min: 260, max: 520, def: 320 },
  right: { min: 300, max: 640, def: 440 },
} as const;

const KEYS = {
  leftW: "fastshare:panel-left-w",
  rightW: "fastshare:panel-right-w",
  visible: "fastshare:panels-visible",
};

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/**
 * State for the dual-sidebar canvas shell: widths (persisted, clamped) and
 * visibility toggles. Left = controls (CONFIG / LAB / NODE), right =
 * telemetry (STATS / PACKETS); the canvas always fills the space between.
 */
export function usePanelLayout() {
  const [leftW, setLeftW] = useState<number>(PANEL_LIMITS.left.def);
  const [rightW, setRightW] = useState<number>(PANEL_LIMITS.right.def);
  const [leftVisible, setLeftVisible] = useState(true);
  const [rightVisible, setRightVisible] = useState(true);

  // hydrate from localStorage after mount (SSR-safe)
  useEffect(() => {
    try {
      const lw = Number(localStorage.getItem(KEYS.leftW));
      const rw = Number(localStorage.getItem(KEYS.rightW));
      if (lw) setLeftW(clamp(lw, PANEL_LIMITS.left.min, PANEL_LIMITS.left.max));
      if (rw)
        setRightW(clamp(rw, PANEL_LIMITS.right.min, PANEL_LIMITS.right.max));
      const vis = localStorage.getItem(KEYS.visible);
      if (vis) {
        const { l = "1", r = "1" } = JSON.parse(vis) as {
          l?: string;
          r?: string;
        };
        setLeftVisible(l === "1");
        setRightVisible(r === "1");
      }
    } catch {
      /* defaults are fine */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEYS.leftW, String(leftW));
      localStorage.setItem(KEYS.rightW, String(rightW));
    } catch {
      /* private mode etc. */
    }
  }, [leftW, rightW]);

  useEffect(() => {
    try {
      localStorage.setItem(
        KEYS.visible,
        JSON.stringify({ l: leftVisible ? "1" : "0", r: rightVisible ? "1" : "0" }),
      );
    } catch {
      /* private mode etc. */
    }
  }, [leftVisible, rightVisible]);

  const toggleLeft = useCallback(() => setLeftVisible((v) => !v), []);
  const toggleRight = useCallback(() => setRightVisible((v) => !v), []);
  const closeAll = useCallback(() => {
    setLeftVisible(false);
    setRightVisible(false);
  }, []);
  const resetLeft = useCallback(
    () => setLeftW(PANEL_LIMITS.left.def),
    [],
  );
  const resetRight = useCallback(
    () => setRightW(PANEL_LIMITS.right.def),
    [],
  );

  return {
    leftW,
    setLeftW: (w: number) => setLeftW(clamp(w, PANEL_LIMITS.left.min, PANEL_LIMITS.left.max)),
    rightW,
    setRightW: (w: number) => setRightW(clamp(w, PANEL_LIMITS.right.min, PANEL_LIMITS.right.max)),
    leftVisible,
    setLeftVisible,
    rightVisible,
    setRightVisible,
    toggleLeft,
    toggleRight,
    closeAll,
    resetLeft,
    resetRight,
  };
}
