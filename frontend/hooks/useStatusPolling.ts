"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { TopologySnapshot } from "@/lib/topology";
import type { FeedLine, PacketEntry, PacketEvent, Snapshot } from "@/lib/types";

/**
 * Polls the controller every 500ms: status snapshot + packet log + event
 * feed + topology snapshot. Owns the "controller unreachable" error state
 * as well.
 *
 * The packet fetch doubles as the animated canvas's event source: it passes
 * the running event cursor (`since`) so `events` holds only the NEW packet
 * transitions since the last poll — a monotonic, gap-free stream the canvas
 * can draw 1:1. `packets` (latest status per seq) still feeds the monitor.
 */
export function useStatusPolling() {
  const [status, setStatus] = useState<Snapshot | null>(null);
  const [packets, setPackets] = useState<PacketEntry[]>([]);
  const [events, setEvents] = useState<PacketEvent[]>([]);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [topology, setTopology] = useState<TopologySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef(-1);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [s, p, tp] = await Promise.all([
          api.status(),
          api.transferPackets(200, cursorRef.current),
          api.topology(),
        ]);
        if (cancelled) return;
        setStatus(s);
        setPackets(p.packets);
        cursorRef.current = p.cursor;
        setEvents(p.events);
        setFeed(p.feed);
        setTopology(tp);
        setError((prev) =>
          prev && prev.startsWith("controller unreachable") ? null : prev,
        );
      } catch {
        if (cancelled) return;
        setError("controller unreachable — is the Python backend running?");
      }
    };
    void tick();
    const id = setInterval(tick, 500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  /** One-shot refresh (used after an action, so the UI reflects it fast). */
  const refreshStatus = useCallback(async () => {
    const [s, tp] = await Promise.allSettled([api.status(), api.topology()]);
    if (s.status === "fulfilled") setStatus(s.value);
    if (tp.status === "fulfilled") setTopology(tp.value);
    /* ignore rejects: polling will report connectivity */
  }, []);

  return {
    status,
    packets,
    events,
    feed,
    topology,
    error,
    setError,
    refreshStatus,
  };
}
