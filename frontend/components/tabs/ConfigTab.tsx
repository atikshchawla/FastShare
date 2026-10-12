"use client";

import { useEffect, useState } from "react";
import { Network, Power } from "lucide-react";
import { TransferConfigCard } from "@/components/TransferConfigCard";
import {
  Badge,
  Button,
  Field,
  NumberInput,
  Panel,
  PanelHeader,
  Select,
  StatCell,
  Toggle,
} from "@/components/ui";
import type { MultipathPolicy, TopologySnapshot } from "@/lib/topology";
import type { Config, Snapshot } from "@/lib/types";

const FLAG_OPTIONS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5];
const PROBE_OPTIONS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];

function withCurrent(options: number[], value: number): number[] {
  return options.includes(value)
    ? options
    : [...options, value].sort((a, b) => a - b);
}

/**
 * Preset graph switcher + source-side multipath policy (multi-path Phases
 * 2–3). The scheduler policy is read when a transfer starts, so edits land
 * on the next run; the preset switch rebuilds every forwarder node and is
 * refused by the backend while a transfer is running.
 */
function TopologyPanel({
  topology,
  busy,
  transferring,
  onSetPreset,
  onSetMultipath,
}: {
  topology: TopologySnapshot;
  busy: boolean;
  transferring: boolean;
  onSetPreset: (name: string) => void;
  onSetMultipath: (patch: Partial<MultipathPolicy>) => void;
}) {
  const mp = topology.multipath;
  const multi = topology.paths.length > 1;
  const locked = busy || transferring;
  const presetLabel =
    topology.presets.find((p) => p.id === topology.preset)?.label ??
    topology.preset;

  const [windowDraft, setWindowDraft] = useState(String(mp.window));
  useEffect(() => setWindowDraft(String(mp.window)), [mp.window]);

  const commitWindow = () => {
    const n = Number(windowDraft);
    if (Number.isFinite(n) && n >= 4 && n <= 10000 && n !== mp.window) {
      onSetMultipath({ window: n });
    } else {
      setWindowDraft(String(mp.window));
    }
  };

  return (
    <Panel>
      <PanelHeader
        title="Topology"
        icon={<Network size={15} />}
        right={
          <Badge tone={multi && mp.enabled ? "green" : "slate"}>
            {multi ? `${topology.paths.length} paths` : "single path"}
          </Badge>
        }
      />
      <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <StatCell label="Graph" value={presetLabel} tone="cyan" />
          <StatCell
            label="Scheduler"
            value={
              !multi ? "single" : mp.enabled ? "multipath on" : "lane A only"
            }
            sub={multi ? `${topology.nodes.length} nodes` : "star default"}
          />
        </div>

        <Field label="Preset graph" hint="switch rebuilds every forwarder node">
          <Select
            value={topology.preset}
            disabled={locked}
            onChange={(e) => onSetPreset(e.target.value)}
          >
            {topology.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Multipath scheduler"
          hint={
            multi
              ? "source spreads frames across paths; loss ≥ threshold shifts traffic"
              : "needs a preset with ≥2 paths (switch to tri-path)"
          }
        >
          <Toggle
            checked={mp.enabled}
            disabled={locked || !multi}
            onChange={(v) => onSetMultipath({ enabled: v })}
            onLabel="Scheduler on"
            offLabel="Scheduler off"
          />
        </Field>

        {mp.enabled && multi && (
          <>
            <Field
              label="Flag threshold"
              hint="lane flagged once its rolling window loss ≥ this"
            >
              <Select
                value={String(mp.flag_loss)}
                disabled={locked}
                onChange={(e) =>
                  onSetMultipath({ flag_loss: Number(e.target.value) })
                }
              >
                {withCurrent(FLAG_OPTIONS, mp.flag_loss).map((v) => (
                  <option key={v} value={v}>
                    {Math.round(v * 100)}%
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Probe share"
              hint="traffic kept on flagged lanes so they can recover"
            >
              <Select
                value={String(mp.probe_share)}
                disabled={locked}
                onChange={(e) =>
                  onSetMultipath({ probe_share: Number(e.target.value) })
                }
              >
                {withCurrent(PROBE_OPTIONS, mp.probe_share).map((v) => (
                  <option key={v} value={v}>
                    {Math.round(v * 100)}%
                  </option>
                ))}
              </Select>
            </Field>

            <div onBlur={commitWindow}>
              <Field
                label="Window"
                hint="attempts per lane in the rolling view (4–10000)"
              >
                <NumberInput
                  value={windowDraft}
                  onChange={setWindowDraft}
                  suffix="attempts"
                  disabled={locked}
                  className="max-w-[9rem]"
                />
              </Field>
            </div>
          </>
        )}

        <p className="font-mono text-[10px] text-neutral-600">
          * Policy applies on the next transfer start; preset switching is
          refused while a transfer is running.
        </p>
      </div>
    </Panel>
  );
}

/**
 * CONFIG tab: the single server-control row (receiver start/stop + address
 * readout — absorbs ConnectionStatusCard and SettingsModal), the topology
 * preset / multipath controls, plus the global transfer settings form.
 */
export function ConfigTab({
  config,
  status,
  busy,
  topology,
  onSave,
  onStartServer,
  onStopServer,
  onSetPreset,
  onSetMultipath,
}: {
  config: Config;
  status: Snapshot | null;
  busy: boolean;
  topology: TopologySnapshot | null;
  onSave: (cfg: Config) => Promise<boolean>;
  onStartServer: () => void;
  onStopServer: () => void;
  onSetPreset: (name: string) => void;
  onSetMultipath: (patch: Partial<MultipathPolicy>) => void;
}) {
  const running = status?.server_status === "running";
  const error = status?.server_status === "error";
  const transferring = status?.transfer_status === "transferring";

  return (
    <>
      <Panel>
        <PanelHeader
          title="Receiver"
          icon={<Power size={15} />}
          right={
            <span
              className={`font-mono text-[11px] font-black uppercase ${
                running ? "text-green-400" : error ? "text-red-400" : "text-neutral-500"
              }`}
            >
              {running ? "Active" : error ? "Error" : "Offline"}
            </span>
          }
        />
        <div className="space-y-3 p-3">
          <div className="grid grid-cols-2 gap-2">
            <StatCell
              label="Bound Address"
              value={`${config.server_ip}:${status?.server_port ?? config.udp_port}`}
              tone="cyan"
            />
            <StatCell
              label="Active Sessions"
              value={status?.server_sessions ?? 0}
            />
          </div>

          {error && status?.server_error && (
            <p className="border-2 border-red-500 bg-red-500/10 p-2 font-mono text-[11px] font-bold text-red-400">
              {status.server_error}
            </p>
          )}

          {running ? (
            <Button
              variant="danger"
              className="w-full"
              onClick={onStopServer}
              disabled={busy}
            >
              Stop Receiver
            </Button>
          ) : (
            <Button
              variant="success"
              className="w-full"
              onClick={onStartServer}
              disabled={busy}
            >
              Start Receiver
            </Button>
          )}

          <p className="font-mono text-[10px] text-neutral-600">
            * Port changes take effect after a receiver restart.
          </p>
        </div>
      </Panel>

      {topology && (
        <TopologyPanel
          topology={topology}
          busy={busy}
          transferring={transferring}
          onSetPreset={onSetPreset}
          onSetMultipath={onSetMultipath}
        />
      )}

      <TransferConfigCard
        config={config}
        serverRunning={running}
        busy={busy}
        onSave={onSave}
      />
    </>
  );
}
