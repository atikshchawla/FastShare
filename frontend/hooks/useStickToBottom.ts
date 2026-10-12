"use client";

import { useEffect, useRef, type WheelEvent as ReactWheelEvent } from "react";

/**
 * Auto-scroll for the dashboard's log/trace containers.
 *
 * Follows the bottom after every render while the user is at the bottom;
 * stops following as soon as the user scrolls (or wheels) upward so they
 * can inspect history, and resumes once they are back at the bottom.
 */
export function useStickToBottom<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const atBottomRef = useRef(true);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= 15;
  };

  const onWheel = (e: ReactWheelEvent<T>) => {
    if (e.deltaY < 0) {
      atBottomRef.current = false;
    }
  };

  useEffect(() => {
    const el = ref.current;
    if (el && atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  });

  return { ref, onScroll, onWheel };
}
