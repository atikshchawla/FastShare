"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { TopologySnapshot } from "@/lib/topology";
import type { FeedLine, PacketEntry, Snapshot } from "@/lib/types";

/**
 * Polls the controller every 500ms: status snapshot + packet log + event
 * feed + topology snapshot. Owns the "controller unreachable" error state
 * as well.
 */
export function useStatusPolling() {
  const [status, setStatus] = useState<Snapshot | null>(null);
  const [packets, setPackets] = useState<PacketEntry[]>([]);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [topology, setTopology] = useState<TopologySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [s, p, tp] = await Promise.all([
          api.status(),
          api.transferPackets(200),
          api.topology(),
        ]);
        if (cancelled) return;
        setStatus(s);
        setPackets(p.packets);
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

  return { status, packets, feed, topology, error, setError, refreshStatus };
}
