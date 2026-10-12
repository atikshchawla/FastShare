"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Inspect, RefreshCcw, RotateCcw, Save, Terminal, X } from "lucide-react";
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
import { api, type NodeConfigPatch } from "@/lib/api";
import type { NodeLogLine, TopologyNode } from "@/lib/topology";

const PROB_OPTIONS = [0.05, 0.1, 0.25, 0.5, 0.9];

interface Form {
  latency: string;
  lossOn: boolean;
  lossProb: number;
  corruptOn: boolean;
  corruptProb: number;
  enabled: boolean;
}

function fromNode(node: TopologyNode): Form {
  const c = node.config;
  return {
    latency: String(c?.latency_ms ?? 10),
    lossOn: c?.loss_enabled ?? false,
    lossProb: c?.loss_probability ?? 0.1,
    corruptOn: c?.corrupt_enabled ?? false,
    corruptProb: c?.corrupt_probability ?? 0.1,
    enabled: c?.enabled ?? true,
  };
}

function probOptions(value: number): number[] {
  return PROB_OPTIONS.includes(value)
    ? PROB_OPTIONS
    : [...PROB_OPTIONS, value].sort((a, b) => a - b);
}

/**
 * Per-node configuration (plan §3/§6): hop latency, loss toggle + %,
 * corruption toggle + % and the node-enabled switch, plus SAVE /
 * RESET TO GLOBAL. Rendered two ways — a floating card anchored next to the
 * node on the canvas, and the side panel's NODE tab.
 */
export function NodeInspector({
  node,
  busy,
  onSave,
  onReset,
  onClose,
  variant = "panel",
  anchor,
  bounds,
}: {
  node: TopologyNode;
  busy: boolean;
  onSave: (cfg: NodeConfigPatch) => Promise<boolean>;
  onReset: () => Promise<boolean>;
  onClose?: () => void;
  variant?: "panel" | "floating";
  anchor?: { x: number; y: number } | null;
  bounds?: { width: number; height: number };
}) {
  const [form, setForm] = useState<Form>(() => fromNode(node));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // per-PC console (multi-path Phase 1): poll GET .../node/{id}/logs while
  // the NODE tab is open; the floating card stays config-only
  const [logs, setLogs] = useState<NodeLogLine[]>([]);
  const [logErr, setLogErr] = useState<string | null>(null);
  const logsBoxRef = useRef<HTMLDivElement>(null);

  const pullLogs = useCallback(async () => {
    try {
      const res = await api.nodeLogs(node.id, 200);
      setLogs(res.lines);
      setLogErr(null);
    } catch (e) {
      setLogErr(e instanceof Error ? e.message : String(e));
    }
  }, [node.id]);

  useEffect(() => {
    if (variant !== "panel") return;
    let alive = true;
    setLogs([]);
    const pull = async () => {
      try {
        const res = await api.nodeLogs(node.id, 200);
        if (!alive) return;
        setLogs(res.lines);
        setLogErr(null);
      } catch (e) {
        if (!alive) return;
        setLogErr(e instanceof Error ? e.message : String(e));
      }
    };
    void pull();
    const iv = setInterval(() => void pull(), 2000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [node.id, variant]);

  // pin the console to the newest line
  useEffect(() => {
    const box = logsBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!dirty) setForm(fromNode(node));
  }, [node, dirty]);

  const touch = () => {
    setDirty(true);
    setError(null);
  };

  const validate = (): string | null => {
    const latency = Number(form.latency);
    if (!Number.isInteger(latency) || latency < 1 || latency > 1000)
      return "Hop latency must be 1–1000 ms.";
    return null;
  };

  const save = async () => {
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }
    const ok = await onSave({
      id: node.id,
      latency_ms: Number(form.latency),
      loss_enabled: form.lossOn,
      loss_probability: form.lossProb,
      corrupt_enabled: form.corruptOn,
      corrupt_probability: form.corruptProb,
      enabled: form.enabled,
    });
    if (ok) {
      setDirty(false);
      setError(null);
    }
  };

  const reset = async () => {
    const ok = await onReset();
    if (ok) {
      setDirty(false);
      setError(null);
    }
  };

  const content = (
    <>
      <div className="grid grid-cols-2 gap-2">
        <StatCell label="Role" value={node.role.toUpperCase()} tone="cyan" />
        <StatCell label="Port" value={`:${node.port}`} />
      </div>

      <Field label="Hop latency" hint="simulated delay on this node's links">
        <NumberInput
          value={form.latency}
          onChange={(v) => {
            touch();
            setForm((f) => ({ ...f, latency: v }));
          }}
          suffix="ms"
          disabled={busy}
        />
      </Field>

      <Field
        label="Packet loss"
        hint="drops frames on the links this node forwards"
      >
        <div className="flex items-center gap-2">
          <Toggle
            checked={form.lossOn}
            disabled={busy}
            onChange={(v) => {
              touch();
              setForm((f) => ({ ...f, lossOn: v }));
            }}
            onLabel="Loss on"
            offLabel="Loss off"
            className="flex-1"
          />
          <Select
            value={String(form.lossProb)}
            disabled={busy || !form.lossOn}
            onChange={(e) => {
              touch();
              setForm((f) => ({ ...f, lossProb: Number(e.target.value) }));
            }}
            className="w-20"
          >
            {probOptions(form.lossProb).map((p) => (
              <option key={p} value={p}>
                {Math.round(p * 100)}%
              </option>
            ))}
          </Select>
        </div>
      </Field>

      <Field
        label="Corruption"
        hint="CRC-32 rejects the corrupted frame here"
      >
        <div className="flex items-center gap-2">
          <Toggle
            checked={form.corruptOn}
            disabled={busy}
            onChange={(v) => {
              touch();
              setForm((f) => ({ ...f, corruptOn: v }));
            }}
            onLabel="Corrupt on"
            offLabel="Corrupt off"
            className="flex-1"
          />
          <Select
            value={String(form.corruptProb)}
            disabled={busy || !form.corruptOn}
            onChange={(e) => {
              touch();
              setForm((f) => ({ ...f, corruptProb: Number(e.target.value) }));
            }}
            className="w-20"
          >
            {probOptions(form.corruptProb).map((p) => (
              <option key={p} value={p}>
                {Math.round(p * 100)}%
              </option>
            ))}
          </Select>
        </div>
      </Field>

      <Field label="Node" hint="down = forwarder stopped, route through it fails">
        <Toggle
          checked={form.enabled}
          disabled={busy}
          onChange={(v) => {
            touch();
            setForm((f) => ({ ...f, enabled: v }));
          }}
          onLabel="Node up"
          offLabel="Node down"
        />
      </Field>

      {error && (
        <p className="border-2 border-red-500 bg-red-500/10 p-2 font-mono text-[11px] font-bold text-red-400">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          className="flex-1"
          onClick={() => void save()}
          disabled={busy || !dirty}
        >
          <Save size={13} />
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void reset()}
          disabled={busy}
          title="Drop this node's override"
        >
          <RotateCcw size={13} />
          Reset
        </Button>
      </div>
      {dirty && (
        <Badge tone="amber" className="justify-center">
          Unsaved changes
        </Badge>
      )}

      {variant === "panel" && (
        <div className="border-2 border-neutral-800 bg-neutral-950">
          <div className="flex items-center justify-between border-b-2 border-neutral-800 px-2 py-1">
            <span className="flex items-center gap-1.5 font-mono text-[10px] font-black uppercase tracking-wider text-neutral-500">
              <Terminal size={11} />
              node log · {logs.length}
            </span>
            <button
              type="button"
              title="Refresh log now"
              onClick={() => void pullLogs()}
              className="cursor-pointer text-neutral-500 transition hover:text-cyan-300"
            >
              <RefreshCcw size={11} />
            </button>
          </div>
          <div
            ref={logsBoxRef}
            className="h-40 overflow-y-auto whitespace-pre-wrap break-all p-2 font-mono text-[10px] leading-relaxed"
          >
            {logErr ? (
              <p className="text-red-400">{logErr}</p>
            ) : logs.length === 0 ? (
              <p className="text-neutral-600">
                no lines yet — start the receiver and run a transfer
              </p>
            ) : (
              logs.map((l, i) => (
                <p key={`${l.t}-${i}`} className="text-neutral-400">
                  <span className="text-neutral-600">
                    {new Date(l.t * 1000).toLocaleTimeString([], {
                      hour12: false,
                    })}
                  </span>{" "}
                  {l.text}
                </p>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );

  if (variant === "floating") {
    if (!anchor || !bounds || bounds.width === 0) return null;
    const CARD_W = 272;
    const CARD_H = 430;
    const gap = 14;
    let left = anchor.x + 48 + gap;
    if (left + CARD_W > bounds.width - 8)
      left = anchor.x - 48 - gap - CARD_W;
    left = Math.max(8, Math.min(left, bounds.width - CARD_W - 8));
    let top = anchor.y - 160;
    top = Math.max(8, Math.min(top, bounds.height - CARD_H - 8));

    return (
      <div
        className="absolute z-30 w-[17rem] border-2 border-cyan-500/70 bg-neutral-900 shadow-[4px_4px_0px_#000]"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-2 border-neutral-700 bg-neutral-800 px-3 py-2">
          <span className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-neutral-200">
            <Inspect size={13} className="text-cyan-400" />
            {node.label}
            <Badge tone={node.up ? "green" : "slate"}>
              {node.up ? "up" : "down"}
            </Badge>
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="cursor-pointer text-neutral-500 transition hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="space-y-2.5 p-3">{content}</div>
      </div>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title={`Node · ${node.label}`}
        icon={<Inspect size={15} />}
        right={
          <div className="flex items-center gap-2">
            <Badge tone={node.up ? "green" : "slate"}>
              {node.up ? "up" : "down"}
            </Badge>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                title="Deselect node"
                className="cursor-pointer text-neutral-500 transition hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>
        }
      />
      <div className="space-y-2.5 p-3">{content}</div>
    </Panel>
  );
}
