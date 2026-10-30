"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Minus, Plus, Scan } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  PATH_STATE_STROKE,
  VIEWBOX,
  buildCanvasGraph,
  laneStates,
  type CanvasLink,
  type PathState,
} from "@/lib/canvas";
import type { TopologySnapshot } from "@/lib/topology";
import type { Snapshot } from "@/lib/types";

const NODE_W = 96;
const NODE_H = 54;
const MIN_K = 0.4;
const MAX_K = 3;

type View = { tx: number; ty: number; k: number };

function linkBadge(link: CanvasLink): string | null {
  if (!link.onRoute || !link.stats) return null;
  const s = link.stats;
  return `Δ ${s.latency_ms}ms · ${s.data + s.ack} pkt · ${s.dropped} ✕`;
}

/**
 * The dashboard's centrepiece: an interactive SVG canvas that always renders
 * — two nodes + one link while the topology flag is off, the 7-node star
 * while it is on. Drag the background to pan, wheel to zoom (double-click
 * resets), click a node to select it (inspector / NODE tab), drop a file to
 * select it. `children` renders inside the transformed group (PacketLayer
 * rides the view); `renderOverlay` gets the selected node's on-screen anchor
 * plus canvas bounds so the floating inspector can clamp to the viewport.
 */
export function TopologyCanvas({
  topology,
  status,
  selectedNode,
  onSelectNode,
  onDropFile,
  renderOverlay,
  topLeftExtra,
  children,
}: {
  topology: TopologySnapshot | null;
  status: Snapshot | null;
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
  onDropFile?: (file: File) => void;
  renderOverlay?: (ctx: {
    anchor: { x: number; y: number } | null;
    bounds: { width: number; height: number };
  }) => ReactNode;
  /** Extra floating content stacked under the top-left legend (e.g. the
   *  path-switching HUD). Its root must opt into pointer events itself. */
  topLeftExtra?: ReactNode;
  children?: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<View>({ tx: 0, ty: 0, k: 1 });
  const [panning, setPanning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{
    sx: number;
    sy: number;
    tx: number;
    ty: number;
    scale: number;
    moved: boolean;
  } | null>(null);
  // P1-7: layout metrics live in state (ResizeObserver-driven) so render never
  // calls getBoundingClientRect — no forced layout on every render/pan frame.
  const [layout, setLayout] = useState<{
    scale: number;
    ox: number;
    oy: number;
    /** svg rect offset inside the container (for the inspector anchor). */
    dx: number;
    dy: number;
    width: number;
    height: number;
  } | null>(null);
  // P1-7: the graph is only rebuilt when the polled snapshots change — not on
  // every pointer-move frame while panning (setView re-renders ~60×/s).
  const graph = useMemo(
    () => buildCanvasGraph(topology, status),
    [topology, status],
  );

  const sched = status?.scheduler ?? null;
  // lane health only while the source-side scheduler is live on the tri lanes
  const laneMeta =
    sched?.enabled && sched.lanes.length > 1 ? sched.lanes : null;

  // path colour language: green optimal / blue candidate / red restricted
  const states = useMemo(() => laneStates(sched, graph), [sched, graph]);
  // tri routers inherit their lane's state (lanes are node-disjoint)
  const nodeState = useMemo(() => {
    const map: Record<string, PathState> = {};
    if (graph.mode === "tri") {
      graph.paths.forEach((ids, i) =>
        ids.forEach((id) => {
          if (id !== graph.source && id !== graph.dest && !(id in map))
            map[id] = states[i] ?? "candidate";
        }),
      );
    }
    return map;
  }, [graph, states]);

  // transient flag/recover banner (top-right of the canvas)
  const [notice, setNotice] = useState<{
    text: string;
    kind: "flag" | "recover";
  } | null>(null);
  const flagsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sched) {
      flagsRef.current = null;
      return;
    }
    const key = sched.lanes.map((l) => (l.flagged ? "1" : "0")).join("");
    const prev = flagsRef.current;
    flagsRef.current = key;
    if (prev === null || prev === key) return;
    const changed = sched.lanes.find(
      (l, i) => l.flagged !== (prev[i] === "1"),
    );
    if (!changed) return;
    setNotice(
      changed.flagged
        ? {
            kind: "flag",
            text: `PATH ${changed.name} flagged — shifting traffic to healthier paths`,
          }
        : {
            kind: "recover",
            text: `PATH ${changed.name} recovered — back in the schedule`,
          },
    );
  }, [sched]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const svgMetrics = () => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const scale = Math.min(r.width / VIEWBOX.w, r.height / VIEWBOX.h);
    const ox = (r.width - VIEWBOX.w * scale) / 2;
    const oy = (r.height - VIEWBOX.h * scale) / 2;
    return { r, scale, ox, oy };
  };

  // Measure the canvas into `layout` state (resize + mount): render and the
  // inspector anchor then work off plain numbers, never a layout read.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const svg = svgRef.current;
      const cr = el.getBoundingClientRect();
      if (!svg) return;
      const r = svg.getBoundingClientRect();
      const scale = Math.min(r.width / VIEWBOX.w, r.height / VIEWBOX.h);
      const next = {
        scale,
        ox: (r.width - VIEWBOX.w * scale) / 2,
        oy: (r.height - VIEWBOX.h * scale) / 2,
        dx: r.left - cr.left,
        dy: r.top - cr.top,
        width: cr.width,
        height: cr.height,
      };
      setLayout((prev) =>
        prev &&
        prev.scale === next.scale &&
        prev.ox === next.ox &&
        prev.oy === next.oy &&
        prev.dx === next.dx &&
        prev.dy === next.dy &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // wheel zoom around the cursor (native listener: React's wheel is passive)
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const m = svgMetrics();
      if (!m) return;
      const px = (e.clientX - m.r.left - m.ox) / m.scale;
      const py = (e.clientY - m.r.top - m.oy) / m.scale;
      setView((v) => {
        const k = Math.min(MAX_K, Math.max(MIN_K, v.k * Math.exp(-e.deltaY * 0.0018)));
        const ratio = k / v.k;
        return { k, tx: px - ratio * (px - v.tx), ty: py - ratio * (py - v.ty) };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) =>
    setView((v) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, v.k * factor));
      const ratio = k / v.k;
      const cx = VIEWBOX.w / 2;
      const cy = VIEWBOX.h / 2;
      return { k, tx: cx - ratio * (cx - v.tx), ty: cy - ratio * (cy - v.ty) };
    });

  // pointer pan on the background; a press without movement = deselect click
  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const m = svgMetrics();
    if (!m) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      tx: view.tx,
      ty: view.ty,
      scale: m.scale,
      moved: false,
    };
    setPanning(true);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = panRef.current;
    if (!p) return;
    if (!p.moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 4)
      p.moved = true;
    if (p.moved)
      setView((v) => ({
        ...v,
        tx: p.tx + (e.clientX - p.sx) / p.scale,
        ty: p.ty + (e.clientY - p.sy) / p.scale,
      }));
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = panRef.current;
    panRef.current = null;
    setPanning(false);
    if (!p) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (!p.moved) onSelectNode(null);
  };

  // selected node anchor in container coordinates (viewBox → screen + view).
  // Off `layout` state — no getBoundingClientRect during render (P1-7).
  let anchor: { x: number; y: number } | null = null;
  let bounds = { width: 0, height: 0 };
  if (layout) {
    bounds = { width: layout.width, height: layout.height };
    const node = selectedNode ? graph.byId[selectedNode] : null;
    if (node) {
      const gx = node.x * view.k + view.tx;
      const gy = node.y * view.k + view.ty;
      anchor = {
        x: layout.dx + layout.ox + gx * layout.scale,
        y: layout.dy + layout.oy + gy * layout.scale,
      };
    }
  }

  const transferring = status?.transfer_status === "transferring";
  const completed = status?.transfer_status === "completed";
  const failed = status?.transfer_status === "failed";

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && onDropFile) onDropFile(file);
  };

  return (
    <div
      ref={containerRef}
      className="relative flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-neutral-950"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {/* floating top-left: mode+route chip, legend stacked under it */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[70%] flex-col items-start gap-1.5">
        <div className="flex flex-wrap items-stretch border-2 border-neutral-700 bg-neutral-900/95 font-mono text-[10px] shadow-[2px_2px_0px_#000]">
          <span className="flex items-center border-r-2 border-neutral-700 px-2.5 py-1 font-black uppercase tracking-[0.2em] text-neutral-300">
            {graph.mode === "direct"
              ? "Direct · 2 nodes"
              : `${graph.presetLabel} · ${graph.nodes.length} nodes`}
          </span>
          {graph.route && (
            <span className="flex flex-wrap items-center gap-1 px-2 py-1 font-bold text-cyan-300">
              {graph.route.map((id, i) => (
                <span key={id} className="flex items-center gap-1">
                  {i > 0 && <span className="text-neutral-600">→</span>}
                  <span
                    className={cn(
                      "px-1",
                      id === graph.dest
                        ? "bg-green-500/15 text-green-300"
                        : id === graph.source
                          ? "bg-cyan-500/15 text-cyan-300"
                          : "text-neutral-300",
                    )}
                  >
                    {graph.byId[id]?.label ?? id}
                  </span>
                </span>
              ))}
              <span className="text-neutral-500">
                · {graph.route.length - 1} hops
              </span>
            </span>
          )}
        </div>
        <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 border-2 border-neutral-700 bg-neutral-900/95 px-2.5 py-1 font-mono text-[9px] font-bold uppercase text-neutral-500 shadow-[2px_2px_0px_#000] md:flex">
          {graph.mode === "tri" ? (
            <>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 bg-green-500" /> Optimal
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 bg-blue-500" /> Candidate
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0 w-4 border-t-2 border-dashed border-red-500" />
                Restricted
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 bg-green-500" /> Route
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4 bg-neutral-700" /> Idle
              </span>
            </>
          )}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" /> Up
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-neutral-600" /> Down
          </span>
          <span className="text-neutral-600">Click node to inspect</span>
        </div>
        {topLeftExtra}
      </div>

      {/* floating: live transfer state */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5">
        {transferring && (
          <span className="border-2 border-cyan-500 bg-cyan-500/15 px-2 py-1 font-mono text-[10px] font-black uppercase text-cyan-300 shadow-[2px_2px_0px_#000]">
            ▲ streaming · #{status?.current_sequence ?? 0}
          </span>
        )}
        {completed && (
          <span className="border-2 border-green-500 bg-green-500/15 px-2 py-1 font-mono text-[10px] font-black uppercase text-green-300 shadow-[2px_2px_0px_#000]">
            ✓ complete
          </span>
        )}
        {failed && (
          <span className="border-2 border-red-500 bg-red-500/15 px-2 py-1 font-mono text-[10px] font-black uppercase text-red-300 shadow-[2px_2px_0px_#000]">
            ✕ failed
          </span>
        )}
      </div>

      {/* transient scheduler transition banner */}
      {notice && (
        <div className="pointer-events-none absolute right-3 top-12 z-10 max-w-[60%]">
          <span
            className={cn(
              "block border-2 px-2 py-1 font-mono text-[10px] font-black uppercase shadow-[2px_2px_0px_#000]",
              notice.kind === "flag"
                ? "border-red-500 bg-red-500/15 text-red-300"
                : "border-green-500 bg-green-500/15 text-green-300",
            )}
          >
            {notice.kind === "flag" ? "⚠ " : "✓ "}
            {notice.text}
          </span>
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX.w} ${VIEWBOX.h}`}
        preserveAspectRatio="xMidYMid meet"
        className={cn(
          "min-h-0 w-full flex-1 touch-none select-none",
          panning ? "cursor-grabbing" : "cursor-grab",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget)
            setView({ tx: 0, ty: 0, k: 1 });
        }}
        // NOT role="img": that tells AT the whole canvas is one picture and
        // hides the interactive nodes. It is a group of focusable controls.
        role="group"
        aria-label="Topology canvas — pan with the pointer, inspect a node"
      >
        <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
          {/* LINKS */}
          {graph.links.map((link) => {
            const badge = linkBadge(link);
            const horizontal = link.y1 === link.y2;
            const midX = (link.x1 + link.x2) / 2;
            const midY = (link.y1 + link.y2) / 2;
            const badgeW = badge ? badge.length * 5.8 + 14 : 0;
            const bx = midX;
            const by = horizontal ? midY - 18 : midY;
            // active = carries traffic without a lane state (star leftovers)
            const active =
              link.onRoute || (graph.multipathOn && link.lane !== null);
            // green optimal / blue candidate / red dashed restricted;
            // scheduler weight still drives width while it is live
            const state =
              link.lane !== null ? states[link.lane] ?? null : null;
            const meta =
              link.lane !== null && laneMeta && link.lane < laneMeta.length
                ? laneMeta[link.lane]
                : null;
            let strokeWidth: number;
            let opacity: number;
            if (state === "restricted") {
              strokeWidth = 3.5;
              opacity = 1;
            } else if (meta) {
              strokeWidth = 2 + Math.round(meta.weight * 3);
              opacity = state === "optimal" ? 1 : 0.5 + meta.weight * 0.5;
            } else if (state) {
              strokeWidth = 3;
              opacity = state === "optimal" ? 1 : 0.5;
            } else {
              strokeWidth = active ? 3 : 2;
              opacity = active ? 1 : 0.4;
            }
            return (
              <g key={link.id}>
                <line
                  x1={link.x1}
                  y1={link.y1}
                  x2={link.x2}
                  y2={link.y2}
                  className={
                    state
                      ? PATH_STATE_STROKE[state]
                      : link.onRoute
                        ? "stroke-green-500"
                        : "stroke-neutral-700"
                  }
                  strokeWidth={strokeWidth}
                  strokeDasharray={state === "restricted" ? "6 4" : undefined}
                  opacity={opacity}
                />
                {badge && (
                  <g>
                    <rect
                      x={bx - badgeW / 2}
                      y={by - 9}
                      width={badgeW}
                      height={18}
                      className="fill-neutral-900 stroke-neutral-700"
                      strokeWidth={1}
                    />
                    <text
                      x={bx}
                      y={by + 4}
                      textAnchor="middle"
                      className="fill-cyan-300 font-mono text-[10px] font-bold"
                    >
                      {badge}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* PACKET ANIMATION RIDES THE VIEW */}
          {children}

          {/* NODES */}
          {graph.nodes.map((node) => {
            const selected = node.id === selectedNode;
            // tri routers carry their lane's state (down nodes go red);
            // source keeps the cyan identity, dest is the green goal
            const laneState = nodeState[node.id];
            const stroke = laneState
              ? !node.up
                ? "stroke-red-500"
                : PATH_STATE_STROKE[laneState]
              : node.isDest
                ? "stroke-green-500"
                : node.isSource || node.onRoute
                  ? "stroke-cyan-400"
                  : "stroke-neutral-600";
            return (
              <g
                key={node.id}
                className="cursor-pointer"
                tabIndex={0}
                role="button"
                aria-label={`Node ${node.label}, ${
                  node.up ? "up" : "down"
                }, ${selected ? "selected" : "not selected"}`}
                aria-pressed={selected}
                onKeyDown={(e) => {
                  // keyboard parity with the click handler (P1-12)
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectNode(selected ? null : node.id);
                  }
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(selected ? null : node.id);
                }}
              >
                <title>{`${node.label} (${node.up ? "up" : "down"})`}</title>
                {selected && (
                  <rect
                    x={node.x - NODE_W / 2 - 4}
                    y={node.y - NODE_H / 2 - 4}
                    width={NODE_W + 8}
                    height={NODE_H + 8}
                    className="fill-none stroke-cyan-400"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                  />
                )}
                <rect
                  x={node.x - NODE_W / 2}
                  y={node.y - NODE_H / 2}
                  width={NODE_W}
                  height={NODE_H}
                  className={cn(
                    stroke,
                    node.up ? "fill-neutral-900" : "fill-neutral-900/60",
                    "transition-opacity hover:opacity-80",
                  )}
                  strokeWidth={2}
                />
                <text
                  x={node.x}
                  y={node.y - 4}
                  textAnchor="middle"
                  className={cn(
                    "text-[11px] font-black uppercase",
                    node.up ? "fill-neutral-100" : "fill-neutral-500",
                  )}
                >
                  {node.label}
                </text>
                <text
                  x={node.x}
                  y={node.y + 13}
                  textAnchor="middle"
                  className="fill-neutral-500 font-mono text-[9px]"
                >
                  {node.sub}
                </text>
                <circle
                  cx={node.x + NODE_W / 2 - 7}
                  cy={node.y - NODE_H / 2 + 7}
                  r={4}
                  className={node.up ? "fill-green-400" : "fill-neutral-600"}
                />
              </g>
            );
          })}
        </g>
      </svg>

      {/* floating zoom controls */}
      <div className="absolute bottom-3 right-3 z-10 hidden items-center gap-1 md:flex">
        <button
          type="button"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.3)}
          className="flex h-7 w-7 cursor-pointer items-center justify-center border-2 border-neutral-700 bg-neutral-900/95 text-neutral-400 shadow-[2px_2px_0px_#000] transition hover:border-cyan-500/60 hover:text-cyan-300"
        >
          <Minus size={13} />
        </button>
        <button
          type="button"
          title="Reset view (double-click background does this too)"
          aria-label="Reset canvas view"
          onClick={() => setView({ tx: 0, ty: 0, k: 1 })}
          className="flex h-7 w-7 cursor-pointer items-center justify-center border-2 border-neutral-700 bg-neutral-900/95 text-neutral-400 shadow-[2px_2px_0px_#000] transition hover:border-cyan-500/60 hover:text-cyan-300"
        >
          <Scan size={13} />
        </button>
        <button
          type="button"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => zoomBy(1.3)}
          className="flex h-7 w-7 cursor-pointer items-center justify-center border-2 border-neutral-700 bg-neutral-900/95 text-neutral-400 shadow-[2px_2px_0px_#000] transition hover:border-cyan-500/60 hover:text-cyan-300"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* drop-a-file highlight */}
      {dragging && (
        <div className="absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-cyan-400 bg-cyan-500/10">
          <span className="border-2 border-cyan-400 bg-neutral-900 px-4 py-2 font-mono text-xs font-black uppercase tracking-widest text-cyan-300 shadow-[3px_3px_0px_#000]">
            Drop file to select
          </span>
        </div>
      )}

      {/* floating node inspector (anchored to the selected node) */}
      {renderOverlay?.({ anchor, bounds })}
    </div>
  );
}
