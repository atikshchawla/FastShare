"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Header } from "@/components/Header";
import { ConnectionStatusCard } from "@/components/ConnectionStatusCard";
import { FileSelectionCard } from "@/components/FileSelectionCard";
import { TransferConfigCard } from "@/components/TransferConfigCard";
import { TransferControlCard } from "@/components/TransferControlCard";
import { TransferVisualization } from "@/components/TransferVisualization";
import { TransferProgress } from "@/components/TransferProgress";
import { NetworkingStats } from "@/components/NetworkingStats";
import { PacketMonitor } from "@/components/PacketMonitor";
import { ProtocolPanel } from "@/components/ProtocolPanel";
import { TestingPanel } from "@/components/TestingPanel";
import { SettingsModal } from "@/components/SettingsModal";
import { SetupSteps } from "@/components/SetupSteps";
import { useTransfer } from "@/hooks/useTransfer";

export default function Home() {
  const t = useTransfer();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const s = t.status;
  const serverRunning = s?.server_status === "running";
  const transferring = s?.transfer_status === "transferring";

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-neutral-100 pb-16">
      {/* 1. TOP HEADER */}
      <Header status={s} onOpenSettings={() => setSettingsOpen(true)} />

      {/* ERROR ALERT BANNER */}
      {t.error && (
        <div className="mx-auto mt-4 max-w-7xl px-4">
          <div className="flex items-center gap-3 border-2 border-red-500 bg-red-950/40 p-3 font-mono text-xs font-bold text-red-300 shadow-[3px_3px_0px_#000]">
            <AlertTriangle size={16} className="text-red-400 shrink-0" />
            <span>{t.error}</span>
          </div>
        </div>
      )}

      <main className="mx-auto mt-6 max-w-7xl space-y-6 px-4">
        {/* EDUCATIONAL PROTOCOL BANNER (Instant Professor Comprehension) */}
        <div className="border-2 border-neutral-700 bg-neutral-900 p-3 shadow-[4px_4px_0px_#000]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b-2 border-neutral-800 pb-2 mb-2">
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">
              CORE CONCEPT: RELIABLE FILE TRANSFER OVER UDP VIA STOP-AND-WAIT ARQ
            </span>
            <span className="font-mono text-[10px] text-neutral-500 font-bold">
              WINDOW SIZE = 1 · TIMEOUT RETRANSMISSION · DUPLICATE AVOIDANCE
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1.5 font-mono text-[11px] font-bold text-neutral-300">
            <span className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-white">FILE</span>
            <ArrowRight size={13} className="text-cyan-400 shrink-0" />
            <span className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-cyan-300">PACKETIZATION</span>
            <ArrowRight size={13} className="text-cyan-400 shrink-0" />
            <span className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-cyan-300">SEQ NUMBER</span>
            <ArrowRight size={13} className="text-cyan-400 shrink-0" />
            <span className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-cyan-400">UDP TRANSMISSION</span>
            <ArrowRight size={13} className="text-cyan-400 shrink-0" />
            <span className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-green-300">SERVER RECEIVES</span>
            <ArrowRight size={13} className="text-green-400 shrink-0" />
            <span className="border border-green-500 bg-green-950/40 px-2 py-1 text-green-300">ACK RETURNED</span>
            <ArrowRight size={13} className="text-green-400 shrink-0" />
            <span className="border border-green-500 bg-green-500 text-black px-2 py-1 font-black">NEXT PACKET</span>
          </div>
        </div>

        {/* 2. HERO SECTION: LIVE UDP TRANSFER VISUALIZATION */}
        <section>
          <TransferVisualization status={s} feed={t.feed} />
        </section>

        {/* 3. PROMINENT METRICS (SENT | ACKED | RETRIES | SEQUENCE) */}
        <section>
          <NetworkingStats status={s} />
        </section>

        {/* 4. PROGRESS BAR */}
        <section>
          <TransferProgress status={s} />
        </section>

        {/* SETUP GUIDANCE STEPS */}
        <SetupSteps
          serverRunning={serverRunning}
          hasFile={!!t.selectedFile}
          transferring={transferring}
          completed={s?.transfer_status === "completed"}
          failed={s?.transfer_status === "failed"}
          cancelled={s?.transfer_status === "cancelled"}
        />

        {/* 5. MIDDLE ROW: FILE & EXECUTION (LEFT) | NETWORK & CONFIG (RIGHT) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: File + Control */}
          <div className="space-y-6">
            <FileSelectionCard
              selectedFile={t.selectedFile}
              onSelect={t.selectFile}
              packetSize={s?.config.packet_size ?? 1024}
              disabled={transferring}
            />

            <TransferControlCard
              status={s}
              hasFile={!!t.selectedFile}
              busy={t.busy}
              onStart={t.startTransfer}
              onCancel={t.cancelTransfer}
              onStartServer={t.startServer}
            />
          </div>

          {/* Right Column: Network Status + Settings */}
          <div className="space-y-6">
            <ConnectionStatusCard
              status={s}
              busy={t.busy}
              onStart={t.startServer}
              onStop={t.stopServer}
            />

            <TransferConfigCard
              config={s?.config ?? {
                server_ip: "127.0.0.1",
                udp_port: 5001,
                packet_size: 1024,
                timeout_ms: 500,
                window_size: 1,
                max_retries: 5,
              }}
              serverRunning={serverRunning}
              busy={t.busy}
              onSave={t.saveConfig}
            />
          </div>
        </div>

        {/* 6. PACKET MONITOR & EVENT TRACE */}
        <section>
          <PacketMonitor packets={t.packets} feed={t.feed} />
        </section>

        {/* 7. PACKET LOSS LAB */}
        <section>
          <TestingPanel
            status={s}
            busy={t.busy}
            hasFile={!!t.selectedFile}
            serverRunning={serverRunning}
            onApply={t.applyTesting}
            onRunTest={(cfg) => {
              void t.applyTesting(cfg).then((ok) => {
                if (ok) void t.startTransfer();
              });
            }}
          />
        </section>

        {/* 8. PROTOCOL SPECIFICATION & IMPLEMENTATION STATUS */}
        <section>
          <ProtocolPanel status={s} />
        </section>

        {/* FOOTER */}
        <footer className="border-t-2 border-neutral-800 pt-4 flex flex-col sm:flex-row items-center justify-between text-[11px] font-mono text-neutral-500">
          <span>FASTSHARE — COMPUTER NETWORKS LAB DEMONSTRATION</span>
          <span className="text-cyan-400 font-bold">
            REAL UDP SOCKETS IN PYTHON (PORT {s?.server_port ?? 5001}) · ARQ STOP-AND-WAIT
          </span>
        </footer>
      </main>

      {/* SETTINGS MODAL */}
      <SettingsModal
        open={settingsOpen}
        status={s}
        busy={t.busy}
        onClose={() => setSettingsOpen(false)}
        onStart={t.startServer}
        onStop={t.stopServer}
      />
    </div>
  );
}