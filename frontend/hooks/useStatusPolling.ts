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
 *
 * Poll hygiene (P1-8 / P2-24):
 *  - `/api/topology` is only fetched while the topology flag is on (it is
 *    static in direct 2-node mode) — halves the request rate there; any UI
 *    action already triggers a one-shot `refreshStatus` that fetches it,
 *  - every response is compared before `setState` (JSON payloads parse to
 *    fresh identities each tick, so this is a structural compare) — an
 *    unchanged payload keeps its previous state and re-renders nothing,
 *  - the loop sleeps while the tab is hidden and skips a tick when the
 *    previous one is still in flight (no request pile-up on a slow backend),
 *  - the unreachable error fires once per outage instead of every tick.
 */

/** Structural equality for JSON-shaped state (primitives / arrays / objects). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null)
    return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  const rb = b as Record<string, unknown>;
  return ka.every(
    (k) => deepEqual((a as Record<string, unknown>)[k], rb[k]),
  );
}

/** `setState` that keeps the previous identity when the value is unchanged. */
function setIfChanged<T>(setter: (v: T) => void, prev: T, next: T): void {
  if (!deepEqual(prev, next)) setter(next);
}

export function useStatusPolling() {
  const [status, setStatus] = useState<Snapshot | null>(null);
  const [packets, setPackets] = useState<PacketEntry[]>([]);
  const [events, setEvents] = useState<PacketEvent[]>([]);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [topology, setTopology] = useState<TopologySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef(-1);
  /** Skip a tick while the previous request is still in flight. */
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const UNREACHABLE = "controller unreachable — is the Python backend running?";

    const tick = async () => {
      // sleep while the tab is hidden; never stack overlapping polls
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const s = await api.status();
        if (cancelled) return;
        // topology only while the flag is on (static in direct mode)
        const wantTopology = s.config.topology_enabled === true;
        const p = await api.transferPackets(200, cursorRef.current);
        if (cancelled) return;
        const tp = wantTopology ? await api.topology() : null;
        if (cancelled) return;

        cursorRef.current = p.cursor;
        setIfChanged(setStatus, statusRef.current, s);
        setIfChanged(setPackets, packetsRef.current, p.packets);
        setIfChanged(setEvents, eventsRef.current, p.events);
        setIfChanged(setFeed, feedRef.current, p.feed);
        if (tp) setIfChanged(setTopology, topologyRef.current, tp);
        setError((prev) => (prev === null ? prev : null));
      } catch {
        if (cancelled) return;
        // fire once per outage; the success path above clears it
        setError((prev) => (prev === UNREACHABLE ? prev : UNREACHABLE));
      } finally {
        inFlightRef.current = false;
      }
    };
    void tick();
    const id = setInterval(tick, 500);
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // live mirrors of the state (the effect compares against them without
  // re-subscribing every render)
  const statusRef = useRef<Snapshot | null>(null);
  const packetsRef = useRef<PacketEntry[]>([]);
  const eventsRef = useRef<PacketEvent[]>([]);
  const feedRef = useRef<FeedLine[]>([]);
  const topologyRef = useRef<TopologySnapshot | null>(null);
  statusRef.current = status;
  packetsRef.current = packets;
  eventsRef.current = events;
  feedRef.current = feed;
  topologyRef.current = topology;

  /** One-shot refresh (used after an action, so the UI reflects it fast). */
  const refreshStatus = useCallback(async () => {
    const [s, tp] = await Promise.allSettled([api.status(), api.topology()]);
    if (s.status === "fulfilled")
      setIfChanged(setStatus, statusRef.current, s.value);
    if (tp.status === "fulfilled")
      setIfChanged(setTopology, topologyRef.current, tp.value);
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
