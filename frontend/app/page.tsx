"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { NodeInspector } from "@/components/NodeInspector";
import { PacketLayer } from "@/components/PacketLayer";
import { ANIM_SPEEDS, PathSwitchHud } from "@/components/PathSwitchHud";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { RoutePicker } from "@/components/RoutePicker";
import { SidePanel } from "@/components/SidePanel";
import { TopBar } from "@/components/TopBar";
import { TopologyCanvas } from "@/components/TopologyCanvas";
import { TransferDock } from "@/components/TransferDock";
import { ConfigTab } from "@/components/tabs/ConfigTab";
import { LabTab } from "@/components/tabs/LabTab";
import { PacketsTab } from "@/components/tabs/PacketsTab";
import { StatsTab } from "@/components/tabs/StatsTab";
import type { TabItem } from "@/components/ui";
import { useNodeSelection } from "@/hooks/useNodeSelection";
import { usePanelLayout, PANEL_LIMITS } from "@/hooks/usePanelLayout";
import { useTransfer } from "@/hooks/useTransfer";
import { cn } from "@/lib/cn";

type LeftTab = "config" | "lab" | "node";
type RightTab = "stats" | "packets";

const RIGHT_TABS: TabItem[] = [
  { id: "stats", label: "Stats" },
  { id: "packets", label: "Packets" },
];

const DEFAULT_CONFIG = {
  server_ip: "127.0.0.1",
  udp_port: 5001,
  packet_size: 1024,
  timeout_ms: 500,
  window_size: 1,
  max_retries: 5,
  topology_enabled: false,
  topology_latency_ms: 10,
};

/**
 * Canvas-first shell: the simulation fills the center edge-to-edge, flanked
 * by a LEFT controls sidebar (CONFIG / LAB / NODE) and a RIGHT telemetry
 * sidebar (STATS / PACKETS). Both are resizable (drag, double-click reset,
 * persisted) and collapsible from the top bar; below `lg` they become
 * overlay drawers with a backdrop.
 */
export default function Home() {
  const t = useTransfer();
  const layout = usePanelLayout();
  const [leftState, setLeftState] = useState<LeftTab>("config");
  const [rightTab, setRightTab] = useState<RightTab>("stats");
  const { selectedNode, setSelectedNode } = useNodeSelection();
  const [routePick, setRoutePick] = useState<{
    source: string;
    dest: string;
  } | null>(null);

  // packet-dot animation speed (slow-mo for demos), persisted
  const [animSpeed, setAnimSpeed] = useState(1);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem("fastshare:anim-speed"));
      if ((ANIM_SPEEDS as readonly number[]).includes(v)) setAnimSpeed(v);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const changeAnimSpeed = (v: number) => {
    setAnimSpeed(v);
    try {
      localStorage.setItem("fastshare:anim-speed", String(v));
    } catch {
      /* storage unavailable */
    }
  };
  const s = t.status;
  const serverRunning = s?.server_status === "running";
  const transferring = s?.transfer_status === "transferring";

  const topology = t.topology;
  const topologyOn = s?.config.topology_enabled === true && topology != null;
  const activePick =
    routePick ??
    (topology ? { source: topology.source, dest: topology.dest } : null);
  const topologyPick =
    topologyOn && activePick
      ? { source: activePick.source, dest: activePick.dest }
      : null;

  // selected preset node (direct 2-node mode has no configurable preset nodes)
  const selectedTopologyNode =
    topology?.nodes.find((n) => n.id === selectedNode) ?? null;

  // the NODE tab only exists while a node is selected; fall back if it closes
  const leftTab: LeftTab =
    leftState === "node" && !selectedTopologyNode ? "config" : leftState;
  const leftTabs: TabItem[] = [
    { id: "config", label: "Config" },
    { id: "lab", label: "Lab" },
    ...(selectedTopologyNode ? [{ id: "node", label: "Node" }] : []),
  ];

  const isDesktop = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(min-width: 1024px)").matches;

  /** Open the controls sidebar (on mobile it replaces the other drawer). */
  const openLeft = (tab?: LeftTab) => {
    if (tab) setLeftState(tab);
    if (!isDesktop()) layout.setRightVisible(false);
    layout.setLeftVisible(true);
  };

  const toggleLeft = () => {
    if (!layout.leftVisible && !isDesktop()) layout.setRightVisible(false);
    layout.toggleLeft();
  };

  const toggleRight = () => {
    if (!layout.rightVisible && !isDesktop()) layout.setLeftVisible(false);
    layout.toggleRight();
  };

  const openConfig = () => {
    openLeft("config");
  };

  const handleSelectNode = (id: string | null) => {
    setSelectedNode(id);
    if (id) openLeft("node");
  };

  const drawerSide = (side: "left" | "right", width: number) => ({
    style: { "--fs-w": `${width}px` } as React.CSSProperties,
    className: cn(
      "fixed top-14 bottom-0 z-40 bg-neutral-950 border-neutral-700",
      side === "left"
        ? "left-0 w-[min(20rem,86vw)] border-r-2 shadow-[6px_0_0px_rgba(0,0,0,0.45)] lg:border-r-0"
        : "right-0 w-[min(24rem,86vw)] border-l-2 shadow-[-6px_0_0px_rgba(0,0,0,0.45)] lg:border-l-0",
      "lg:static lg:z-auto lg:w-[var(--fs-w)] lg:shrink-0 lg:shadow-none",
    ),
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0a0a0a] text-neutral-100">
      <TopBar
        leftOpen={layout.leftVisible}
        rightOpen={layout.rightVisible}
        onToggleLeft={toggleLeft}
        onToggleRight={toggleRight}
        onOpenConfig={openConfig}
      />

      {/* ERROR ALERT BANNER */}
      {t.error && (
        <div className="shrink-0 px-4 pt-3">
          <div className="flex items-center gap-3 border-2 border-red-500 bg-red-950/40 p-3 font-mono text-xs font-bold text-red-300 shadow-[3px_3px_0px_#000]">
            <AlertTriangle size={16} className="text-red-400 shrink-0" />
            <span>{t.error}</span>
          </div>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* LEFT — CONTROLS (CONFIG / LAB / NODE) */}
        {layout.leftVisible && (
          <div {...drawerSide("left", layout.leftW)}>
            <SidePanel
              railSide="start"
              tabs={leftTabs}
              value={leftTab}
              onChange={(id) => setLeftState(id as LeftTab)}
              className="h-full border-r-0 border-neutral-700"
            >
              {leftTab === "config" && (
                <ConfigTab
                  config={s?.config ?? DEFAULT_CONFIG}
                  status={s}
                  busy={t.busy}
                  topology={topology}
                  onSave={t.saveConfig}
                  onStartServer={t.startServer}
                  onStopServer={t.stopServer}
                  onSetPreset={(name) => {
                    // a preset switch invalidates the current source/dest
                    // pick (different node ids) — fall back to its defaults
                    void t.setPreset(name).then((ok) => {
                      if (ok) setRoutePick(null);
                    });
                  }}
                  onSetMultipath={(patch) => void t.setMultipath(patch)}
                />
              )}
              {leftTab === "lab" && (
                <LabTab
                  status={s}
                  busy={t.busy}
                  hasFile={!!t.selectedFile}
                  serverRunning={serverRunning}
                  onApply={t.applyTesting}
                  onRunTest={(cfg) => {
                    void t.applyTesting(cfg).then((ok) => {
                      if (ok)
                        void t.startTransfer(
                          true,
                          topologyPick?.source,
                          topologyPick?.dest,
                        );
                    });
                  }}
                />
              )}
              {leftTab === "node" && selectedTopologyNode && (
                <NodeInspector
                  node={selectedTopologyNode}
                  busy={t.busy}
                  onSave={t.saveNodeConfig}
                  onReset={() => t.resetNodeConfig(selectedTopologyNode.id)}
                  onClose={() => setSelectedNode(null)}
                />
              )}
            </SidePanel>
          </div>
        )}
        {layout.leftVisible && (
          <div className="hidden lg:flex">
            <PanelResizeHandle
              side="left"
              width={layout.leftW}
              onChange={layout.setLeftW}
              min={PANEL_LIMITS.left.min}
              max={PANEL_LIMITS.left.max}
              onReset={layout.resetLeft}
            />
          </div>
        )}

        {/* CENTER — SIMULATION CANVAS (always fills the remaining space) */}
        <main className="relative flex min-w-0 flex-1">
          <TopologyCanvas
            topology={topology}
            status={s}
            selectedNode={selectedNode}
            onSelectNode={handleSelectNode}
            onDropFile={(file) => t.selectFile(file)}
            renderOverlay={({ anchor, bounds }) =>
              selectedTopologyNode ? (
                <NodeInspector
                  variant="floating"
                  node={selectedTopologyNode}
                  anchor={anchor}
                  bounds={bounds}
                  busy={t.busy}
                  onSave={t.saveNodeConfig}
                  onReset={() => t.resetNodeConfig(selectedTopologyNode.id)}
                  onClose={() => setSelectedNode(null)}
                />
              ) : null
            }
            topLeftExtra={
              <PathSwitchHud
                status={s}
                packets={t.packets}
                speed={animSpeed}
                onSpeedChange={changeAnimSpeed}
              />
            }
          >
            <PacketLayer
              topology={topology}
              status={s}
              events={t.events}
              speed={animSpeed}
            />
          </TopologyCanvas>

          {/* route picker island (top-center of the canvas, flag ON only) */}
          {topologyOn && topology && activePick && (
            <div className="absolute left-1/2 top-3 z-10 hidden -translate-x-1/2 border-2 border-neutral-700 bg-neutral-900/95 px-2 py-1.5 shadow-[2px_2px_0px_#000] md:block">
              <RoutePicker
                topology={topology}
                source={activePick.source}
                dest={activePick.dest}
                onPick={(source, dest) => setRoutePick({ source, dest })}
                disabled={transferring || t.busy}
              />
            </div>
          )}
        </main>

        {/* RIGHT — TELEMETRY (STATS / PACKETS) */}
        {layout.rightVisible && (
          <div className="hidden lg:flex">
            <PanelResizeHandle
              side="right"
              width={layout.rightW}
              onChange={layout.setRightW}
              min={PANEL_LIMITS.right.min}
              max={PANEL_LIMITS.right.max}
              onReset={layout.resetRight}
            />
          </div>
        )}
        {layout.rightVisible && (
          <div {...drawerSide("right", layout.rightW)}>
            <SidePanel
              railSide="end"
              tabs={RIGHT_TABS}
              value={rightTab}
              onChange={(id) => setRightTab(id as RightTab)}
              className="h-full border-l-0 border-neutral-700"
            >
              {rightTab === "stats" && <StatsTab status={s} />}
              {rightTab === "packets" && (
                <PacketsTab packets={t.packets} feed={t.feed} />
              )}
            </SidePanel>
          </div>
        )}

        {/* mobile: tap the backdrop to close both drawers */}
        {(layout.leftVisible || layout.rightVisible) && (
          <button
            type="button"
            aria-label="Close sidebars"
            onClick={layout.closeAll}
            className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          />
        )}
      </div>

      {/* floating island: file · state · progress · resume · primary action */}
      <TransferDock
        status={s}
        hasFile={!!t.selectedFile}
        fileName={t.selectedFile?.name ?? null}
        fileSize={t.selectedFile?.size ?? 0}
        busy={t.busy}
        resumeInfo={t.resumeInfo}
        onSelectFile={t.selectFile}
        onStart={(resume) =>
          void t.startTransfer(
            resume,
            topologyPick?.source,
            topologyPick?.dest,
          )
        }
        onCancel={t.cancelTransfer}
        onStartServer={t.startServer}
      />
    </div>
  );
}
