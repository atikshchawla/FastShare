"use client";

import { useRef, useState } from "react";
import { AlertCircle, ArrowRight, ShieldCheck } from "lucide-react";
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
  const visualizerSectionRef = useRef<HTMLElement>(null);
  const s = t.status;
  const serverRunning = s?.server_status === "running";
  const transferring = s?.transfer_status === "transferring";

  const handleStartTransfer = (resume: boolean = true) => {
    // Initiate transfer
    void t.startTransfer(resume);
    // Smoothly scroll to the live animation conduit at the top
    visualizerSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="min-h-screen text-slate-900 pb-20 font-sans pleasant-pattern antialiased selection:bg-teal-100 selection:text-teal-900">
      {/* 1. TOP APPARATUS HEADER (FULL BLEED) */}
      <Header status={s} onOpenSettings={() => setSettingsOpen(true)} />

      {/* SOCKET ALERT BANNER */}
      {t.error && (
        <div className="w-full px-6 sm:px-10 lg:px-12 pt-4">
          <div className="flex items-center gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50/95 p-4 text-sm font-semibold text-rose-950 shadow-sm">
            <AlertCircle size={20} className="text-rose-600 shrink-0" />
            <div className="flex-1">
              <span className="font-extrabold uppercase font-mono tracking-wide text-rose-700">SOCKET ALERT: </span>
              <span>{t.error}</span>
            </div>
          </div>
        </div>
      )}

      {/* MAIN WIDE CANVAS (EXPANDED TO FULL SCREEN WIDTH) */}
      <main className="w-full px-6 sm:px-10 lg:px-12 pt-6 space-y-6 max-w-[1780px] mx-auto">
        {/* PROTOCOL ARCHITECTURE BANNER (CLEAN LIGHT CARD) */}
        <section className="rounded-2xl border-2 border-slate-200/90 bg-white p-5 sm:p-6 shadow-card transition-all">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b-2 border-slate-100 pb-3.5 mb-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-3 w-3 rounded-full bg-teal-600 ring-4 ring-teal-100" />
              <span className="font-display text-sm sm:text-base font-extrabold uppercase tracking-wide text-slate-900">
                Stop-and-Wait ARQ Pipeline Architecture over Raw UDP
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs sm:text-sm font-bold text-slate-600">
              <span className="rounded-lg bg-teal-50 px-2.5 py-1 text-teal-800 border border-teal-200">
                ARQ WINDOW: 1
              </span>
              <span className="text-slate-300">·</span>
              <span className="rounded-lg bg-orange-50 px-2.5 py-1 text-orange-800 border border-orange-200">
                CRC-32 INTEGRITY
              </span>
              <span className="text-slate-300">·</span>
              <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-slate-800 border border-slate-200">
                TIMEOUT RETRANSMIT
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-bold font-mono">
            <span className="rounded-xl border-2 border-slate-200 bg-slate-50 px-3.5 py-1.5 text-slate-800 shadow-xs">
              1. Source File
            </span>
            <ArrowRight size={16} className="text-teal-600 shrink-0" />
            <span className="rounded-xl border-2 border-teal-200 bg-teal-50/80 px-3.5 py-1.5 text-teal-900 shadow-xs">
              2. MSS Chunks
            </span>
            <ArrowRight size={16} className="text-teal-600 shrink-0" />
            <span className="rounded-xl border-2 border-teal-200 bg-teal-50/80 px-3.5 py-1.5 text-teal-900 shadow-xs">
              3. SEQ #N Frame
            </span>
            <ArrowRight size={16} className="text-orange-500 shrink-0" />
            <span className="rounded-xl border-2 border-orange-200 bg-orange-50/80 px-3.5 py-1.5 text-orange-900 shadow-xs">
              4. UDP Wire
            </span>
            <ArrowRight size={16} className="text-orange-500 shrink-0" />
            <span className="rounded-xl border-2 border-orange-200 bg-orange-50/80 px-3.5 py-1.5 text-orange-900 shadow-xs">
              5. CRC-32 Check
            </span>
            <ArrowRight size={16} className="text-emerald-500 shrink-0" />
            <span className="rounded-xl border-2 border-emerald-200 bg-emerald-50/80 px-3.5 py-1.5 text-emerald-900 shadow-xs">
              6. ACK #N Return
            </span>
            <ArrowRight size={16} className="text-teal-600 shrink-0" />
            <span className="rounded-xl bg-teal-800 px-4 py-1.5 text-white font-extrabold shadow-sm">
              7. Next SEQ (N+1)
            </span>
          </div>
        </section>

        {/* 2. LIVE OSCILLOSCOPE CONDUIT & STREAM LOG */}
        <section ref={visualizerSectionRef} id="transmission-oscilloscope" className="scroll-mt-24">
          <TransferVisualization status={s} feed={t.feed} />
        </section>

        {/* 3. PHYSICAL TELEMETRY MATRIX */}
        <section>
          <NetworkingStats status={s} />
        </section>

        {/* 4. PROGRESS BUFFER */}
        <section>
          <TransferProgress status={s} />
        </section>

        {/* 5. WORKBENCH CHECKLIST STRIP */}
        <SetupSteps
          serverRunning={serverRunning}
          hasFile={!!t.selectedFile}
          transferring={transferring}
          completed={s?.transfer_status === "completed"}
          failed={s?.transfer_status === "failed"}
          cancelled={s?.transfer_status === "cancelled"}
        />

        {/* 6. OPERATIONAL WORKBENCH: 2-COLUMN BALANCED WIDE TILES */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: File Input + Execution Controller */}
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
              resumeInfo={t.resumeInfo}
              onStart={handleStartTransfer}
              onCancel={t.cancelTransfer}
              onStartServer={t.startServer}
            />
          </div>

          {/* Right Column: Receiver Daemon + Socket Tuning Deck */}
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

        {/* 7. TRANSMISSION FRAME REGISTER & EVENT TERMINAL */}
        <section>
          <PacketMonitor packets={t.packets} feed={t.feed} />
        </section>

        {/* 8. ACADEMIC FAULT INJECTION DECK */}
        <section>
          <TestingPanel
            status={s}
            busy={t.busy}
            hasFile={!!t.selectedFile}
            serverRunning={serverRunning}
            onApply={t.applyTesting}
            onRunTest={(cfg) => {
              void t.applyTesting(cfg).then((ok) => {
                if (ok) handleStartTransfer();
              });
            }}
          />
        </section>

        {/* 9. FASTSHARE PROTOCOL SPECIFICATION SHEET */}
        <section>
          <ProtocolPanel status={s} />
        </section>

        {/* FOOTER */}
        <footer className="border-t-2 border-slate-200 pt-6 pb-4 flex flex-col sm:flex-row items-center justify-between text-xs sm:text-sm font-mono text-slate-500 gap-2">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-800">FASTSHARE PROTOCOL LAB</span>
            <span>·</span>
            <span>COMPUTER NETWORKS COURSE PROJECT</span>
          </div>
          <div className="flex items-center gap-2 font-bold text-teal-800">
            <ShieldCheck size={16} className="text-teal-600" />
            <span>PYTHON AF_INET SOCK_DGRAM (PORT {s?.server_port ?? 5001}) · ARQ STOP-AND-WAIT</span>
          </div>
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