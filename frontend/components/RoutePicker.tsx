"use client";

import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui";
import type { TopologySnapshot } from "@/lib/topology";

/** Client-side BFS hop count for the pick (the graph is tiny). */
function hops(links: { a: string; b: string }[], from: string, to: string): number | null {
  if (from === to) return null;
  const adj = new Map<string, string[]>();
  for (const l of links) {
    if (!adj.has(l.a)) adj.set(l.a, []);
    if (!adj.has(l.b)) adj.set(l.b, []);
    adj.get(l.a)!.push(l.b);
    adj.get(l.b)!.push(l.a);
  }
  const seen = new Set([from]);
  const queue: [string, number][] = [[from, 0]];
  while (queue.length) {
    const [cur, d] = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (next === to) return d + 1;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push([next, d + 1]);
      }
    }
  }
  return null;
}

/**
 * Compact source/destination pickers for the multi-server topology — floats
 * as a small island at the top-center of the canvas while the flag is ON.
 */
export function RoutePicker({
  topology,
  source,
  dest,
  onPick,
  disabled,
}: {
  topology: TopologySnapshot;
  source: string;
  dest: string;
  onPick: (source: string, dest: string) => void;
  disabled: boolean;
}) {
  const same = source === dest;
  const hopCount = hops(topology.links, source, dest);
  const upCount = topology.nodes.filter((n) => n.up).length;
  const pathCount = topology.paths.length;

  const selectClass =
    "h-8 w-[6.5rem] cursor-pointer appearance-none border-2 bg-neutral-950 px-1.5 py-0 font-mono text-[11px] font-bold outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 lg:w-[7.5rem]";

  return (
    <div className="hidden shrink-0 items-center gap-1 md:flex">
      <select
        value={source}
        disabled={disabled}
        onChange={(e) => onPick(e.target.value, dest)}
        title="Source node"
        className={`${selectClass} border-cyan-500/60 text-cyan-300 focus:border-cyan-400`}
      >
        {topology.nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.label} · :{n.port}
          </option>
        ))}
      </select>
      <ArrowRight size={12} className="shrink-0 text-cyan-400" />
      <select
        value={dest}
        disabled={disabled}
        onChange={(e) => onPick(source, e.target.value)}
        title="Destination node"
        className={`${selectClass} border-green-500/60 text-green-300 focus:border-green-400`}
      >
        {topology.nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.label} · :{n.port}
          </option>
        ))}
      </select>

      {same ? (
        <Badge tone="amber">Same node</Badge>
      ) : (
        <>
          {pathCount > 1 && (
            <Badge tone={topology.multipath.enabled ? "violet" : "slate"}>
              {pathCount} paths
            </Badge>
          )}
          <Badge tone={hopCount != null ? "cyan" : "slate"}>
            {hopCount != null ? `${hopCount} hop${hopCount === 1 ? "" : "s"} · ` : ""}
            {upCount}/{topology.nodes.length} up
          </Badge>
        </>
      )}
      {disabled && (
        <span className="hidden font-mono text-[10px] font-bold text-neutral-600 xl:inline">
          locked
        </span>
      )}
    </div>
  );
}
