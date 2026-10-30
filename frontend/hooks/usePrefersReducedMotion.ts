"use client";

import { useEffect, useState } from "react";

/**
 * Tracks the OS-level `prefers-reduced-motion: reduce` setting (P1-12).
 *
 * Used to default the packet animation to slow-mo for users who asked their
 * OS for less motion; `matchMedia` stays subscribed so flipping the OS
 * setting takes effect without a reload.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    // MediaQueryList.addEventListener is the modern API; guard for older ones
    if (mq.addEventListener) {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    return undefined;
  }, []);

  return reduced;
}
