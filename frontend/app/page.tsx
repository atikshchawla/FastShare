"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
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
import { StatusDot } from "@/components/ui";

export default function Home() {
  const t = useTransfer();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const s = t.status;
  const serverRunning = s?.server_status === "running";
  const transferring = s?.transfer_status === "transferring";

  return (
    <div className="min-h-screen pb-12">
      <Header status={s} onOpenSettings={() => setSettingsOpen(true)} />

      {t.error && (
        <div className="mx-auto mt-4 flex max-w-7xl items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 font-mono text-[12px] text-rose-300">
          <AlertTriangle size={14} />
          {t.error}
        </div>
      )}

      <main className="mx-auto mt-5 grid max-w-7xl grid-cols-1 gap-4 px-4 lg:grid-cols-3">
        {/* left rail */}
        <div className="flex flex-col gap-4">
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
          <ProtocolPanel status={s} />
        </div>

        {/* main column */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <SetupSteps
            serverRunning={serverRunning}
            hasFile={!!t.selectedFile}
            transferring={transferring}
            completed={s?.transfer_status === "completed"}
            failed={s?.transfer_status === "failed"}
            cancelled={s?.transfer_status === "cancelled"}
          />

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

          <TransferVisualization status={s} feed={t.feed} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <TransferProgress status={s} />
            <NetworkingStats status={s} />
          </div>

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

          <PacketMonitor packets={t.packets} />

          <p className="flex items-center gap-2 px-1 text-[11px] text-slate-600">
            <StatusDot tone="cyan" className="h-1.5 w-1.5" />
            Networking runs on real UDP sockets in the Python controller — this
            dashboard is a control &amp; visualization layer only.
          </p>
        </div>
      </main>

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