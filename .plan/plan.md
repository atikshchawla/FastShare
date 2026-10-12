# FastShare UI Revamp — Canvas Dashboard, Packet Animation, Per-Node Config

Plan mode document. Decisions locked with the user (2026-10-05):

| # | Decision | Choice |
|---|---|---|
| 1 | Packet visualization | **Event-driven dots on canvas** (DATA travels forward, ACK back, TIMEOUT kills the dot, RETRANSMITTED respawns) derived from the existing 500 ms poll — no new backend event stream |
| 2 | Per-node config | **UI + small backend endpoint** (`POST /api/topology/node/config` patching existing forwarder fields) |
| 3 | Cleanup | **All** — remove educational fluff, duplicate telemetry, duplicate controls |
| 4 | Flag vs canvas | **Canvas is always the dashboard**; flag picks 2-node (off) vs 7-node preset (on) |
| 5 | Style | **Polish the existing neo-brutalist language** + shared primitives |

---

## 1. Target layout (Figma-like shell)

```
┌──────────────────────────────────────────────────────────────────────┐
│ TOPBAR  brand · server pill · file chip · progress · START/CANCEL ·  │
│         ⚙ / panel-toggle buttons                      (h-14, fixed) │
├──────────────────────────────────────────────────────────────┬───────┤
│                                                              │ SIDE  │
│   CANVAS (fills viewport, bg grid)                           │ PANEL │
│   ┌ node ── link ── node ── link ── node ┐                   │ tabs: │
│   │  · packet dots animate along route   │  floating legend   │ STATS │
│   │  · route highlight + link badges      │  floating buttons  │PACKETS│
│   │  · click node → NodeInspector card   │                    │  LAB  │
│   └───────────────────────────────────────┘                   │CONFIG │
│   drop-a-file-onto-canvas also starts selection               │ NODE* │
└──────────────────────────────────────────────────────────────┴───────┘
* NODE tab appears only when a node is selected (inspector also floats
  next to the node on the canvas).
```

- **Flag OFF** → canvas renders exactly two nodes (CLIENT, SERVER) and one link — the classic demo, now animated on the same engine.
- **Flag ON** → 7-node extended star (existing preset), route from source/dest pickers.
- No page scroll: `h-screen` shell, side panel scrollable, canvas scales to fit (`viewBox` + preserveAspectRatio).
- Route pickers (source/dest selects + hop summary) move into the **topbar** (compact) when flag ON; hidden when OFF.

## 2. Packet animation engine (canvas)

New `components/PacketLayer.tsx` rendered inside the canvas SVG.

**Event source (already available, no backend change):** 500 ms poll →
`packets[]` (`seq`, `type`, `status`, `retries`, `rtt_ms`), `current_sequence`,
`transfer_status`, `feed[]`.

**Model (respects Stop-and-Wait: max 1 DATA + 1 ACK in flight):**
1. New `seq` seen with status `SENT`/`WAITING` → spawn DATA dot at source node.
2. Dot travels the route polyline; **segment durations proportional to each
   link's `latency_ms`** (from `/api/topology`), normalized to a total of
   ~700–1200 ms so it stays legible.
3. When that `seq` flips to `ACKED` → dot completes, an ACK dot spawns at the
   destination and travels back; cyan→green color coding, short glow trail
   (3 fading circles).
4. Status `TIMEOUT` → dot turns red and fades in place; `RETRANSMITTED`
   spawns a fresh DATA dot (retry counter shown next to it, e.g. `#42 ×2`).
5. `START`/`END` animate like DATA (handshake + finalize visible).
6. `transfer_status != transferring` → dots drain and the layer idles.
7. Dedupe key `seq + status` across polls so a 500 ms poll can't double-spawn.
8. Loss/`checksum` events additionally flash a red `✕` at the link where the
   feed line implies it (best-effort from `last_loss_seq` / `logClassify`).

**Clarity fixes vs the old hero** (why the current one was unclear):
- Real travel between node positions (not text arrows shimmying in place).
- One direction live at a time is obvious by dot position (not stacked rows
  with opacity).
- Timing tied to actual ACK events, not a decorative 600 ms timer.
- Works identically on 2-node and 7-node canvases.

The old `TransferVisualization` (hero + embedded trace terminal) is deleted.

## 3. Per-node configuration

### Backend (small, honest)
- `api/models.py` → `NodeConfig(BaseModel)`: `id: str`,
  `latency_ms: int|None (1..1000)`, `loss_enabled: bool|None`,
  `loss_probability: float|None (0..0.9)`, `corrupt_enabled: bool|None`,
  `corrupt_probability: float|None (0..0.9)`, `enabled: bool|None`.
- `api/endpoints/topology.py` → `POST /api/topology/node/config`.
- `transfer/topology/manager.py`:
  - `self._node_overrides: dict[str, dict]` (persists for the process).
  - `node_config(id, **fields)` validates node id, stores override, and
    live-patches the forwarder (`fwd.latency_ms`, `fwd.loss_probability`,
    `fwd.corrupt_probability`; `enabled=False` → `fwd.clear_route()` + stop,
    so the node acts down).
  - **`start_all()` and `patch_testing()` must respect overrides** — currently
    they overwrite `fwd.latency_ms`/loss/corrupt from global config on every
    server start and every testing apply (`topology/manager.py:70-79`,
    `:98-102`). Fix: per-node override wins over global.
  - `snapshot()` → each `nodes[]` entry gains
    `config: {latency_ms, loss_probability, corrupt_probability, enabled}`
    (effective values: override ?? global).
- `enabled=False` node: forwarder stopped → `up:false` in snapshot; route
  through it must fail loudly (BFS still routes — receiver/forwarder ports
  refuse: `prepare_transfer` already surfaces bind failures as errors).

### Frontend
- `lib/topology.ts`: `NodeConfigView` type; `nodes[].config`.
- `api.ts`: `saveNodeConfig(cfg)` → POST.
- `components/NodeInspector.tsx`: floating card anchored next to the selected
  node (absolute div over the canvas, clamped to viewport), fields:
  label/port/role (read-only), **hop latency**, **loss toggle + %**,
  **corruption toggle + %**, **node enabled toggle**, SAVE / RESET TO GLOBAL.
  Opens on node click; also mirrored as the side panel `NODE` tab.
- Selection state lives in `page.tsx`; ESC / click-empty-canvas deselects.

## 4. Cleanup — what gets deleted vs merged

### Deleted outright (user confirmed "all")
| Component / element | Reason |
|---|---|
| `page.tsx` core-concept banner (`:59-85`) | static educational fluff |
| `SetupSteps.tsx` | duplicates pre-flight checklist |
| `ProtocolPanel.tsx` | static doc; wire format lives in README/spec |
| `SettingsModal.tsx` | server on/off exists 3×; keep one |
| `ConnectionStatusCard.tsx` | same — one server control in topbar/CONFIG |
| `Header.tsx` | replaced by `TopBar.tsx` |
| `TransferVisualization.tsx` | replaced by canvas + PacketLayer |
| `TransferProgress.tsx` | merged into STATS tab + topbar mini-bar |
| footer tagline (`page.tsx:216-221`) | fluff |
| second event-trace console (hero terminal) | feed rendered twice today |
| `PacketMonitor` "100% WIDTH" badge, `NetworkingStats` ARQ-window cell | meaningless |
| pre-flight checklist + duplicate resume banners | keep ONE resume affordance (floating toast) |
| `TransferControlCard.tsx` / `FileSelectionCard.tsx` as full cards | logic folded into TopBar + canvas dropzone |

### Merged into the side panel (tabs)
| Tab | Source components |
|---|---|
| **STATS** | `NetworkingStats` + `TransferProgress` → one dense grid (primary row, RTT/goodput row, loss/CRC/ETA row) + progress bar |
| **PACKETS** | `PacketMonitor` (TABLE / TRACE sub-views unchanged) + `EventTraceConsole` (single instance) |
| **LAB** | `TestingPanel` restyled with shared primitives (kills the `rounded-lg`/`bg-[#070b12]` drift) |
| **CONFIG** | `TransferConfigCard` fields (global: ip/port/packet/timeout/retries + topology toggle/latency) + server START/STOP row (absorbs ConnectionStatusCard/SettingsModal) |
| **NODE** | new `NodeInspector` (tab form view), only when a node is selected |

### Shared primitives (new, in `ui.tsx`)
`Button` (variants primary/danger/ghost), `Input`, `NumberInput`, `Select`,
`Toggle`, `Field` (label + control + hint), `StatCell`, `Tabs` — kills the
hand-rolled duplicated class strings across ≥8 files and fixes TestingPanel's
style drift.

## 5. File change list

**Frontend — new:** `TopBar.tsx`, `TopologyCanvas.tsx` (evolved from
`TopologyView.tsx`: fit-to-view, click-to-select, dropzone, legend, floating
buttons), `PacketLayer.tsx`, `NodeInspector.tsx`, `SidePanel.tsx`,
`components/tabs/{StatsTab,PacketsTab,LabTab,ConfigTab}.tsx`,
`hooks/useNodeSelection.ts`.

**Frontend — modified:** `app/page.tsx` (shell rewrite), `ui.tsx`
(primitives), `lib/topology.ts`, `lib/api.ts` (node config),
`hooks/useTransferActions.ts` (+`saveNodeConfig`), `hooks/useTransfer.ts`,
`lib/types.ts`, `globals.css` (retire `flow-data`/`flow-ack` keyframes, add
dot-glow keyframes).

**Frontend — deleted:** `TransferVisualization`, `TransferProgress`,
`SetupSteps`, `ProtocolPanel`, `SettingsModal`, `ConnectionStatusCard`,
`Header`, `TransferControlCard`, `FileSelectionCard`, `NetworkingStats`
(as standalone), `TopologyRouteCard` (folded into TopBar),
`TopologyView` (superseded by TopologyCanvas).

**Backend:** `transfer/topology/manager.py`, `api/endpoints/topology.py`,
`api/models.py`; tests: extend `tests/test_topology_api.py` (+3–4 cases:
patch applied to forwarder, overrides survive `start_all`/`patch_testing`,
snapshot exposes effective config, unknown node → 400).

**Docs:** `FEATURE_SPEC_MULTI_SERVER_TOPOLOGY.md` — §6 `nodes[].config` +
`POST /api/topology/node/config`; §8 non-goals must drop "animated packet
sprites on links" (now built) and "dynamic link latency" (per-node latency
now exists); README UI/demo sections; PROJECT_PLAN build log.

## 6. Execution order (each step leaves the app runnable)

1. **Primitives + side panel shell** — add `ui.tsx` primitives; build
   `SidePanel` with STATS/PACKETS/LAB/CONFIG tabs by moving existing
   components in (no behavior change yet); `page.tsx` gains the shell.
2. **TopBar** — brand/status/file/progress/START-CANCEL/resume toast;
   delete Header, TransferControlCard, FileSelectionCard, SetupSteps,
   core banner, footer, SettingsModal, ConnectionStatusCard,
   TransferProgress, ProtocolPanel.
3. **Canvas** — `TopologyCanvas` (always on; 2-node when flag off), route
   pickers into topbar, link badges kept, delete old hero.
4. **PacketLayer** — animation engine + state machine; verify on 2-node and
   7-node with and without loss.
5. **Per-node config backend** — model/endpoint/overrides + tests (gate:
   pytest green).
6. **NodeInspector + NODE tab** — click-to-configure, save/reset; snapshot
   wiring.
7. **Polish pass** — consistency, responsive canvas sizing, drift fixes.
8. **Gates + docs** — pytest, lint, build, `smoke_topology.ps1`, browser
   checks, spec/README/PROJECT_PLAN updates.

## 7. Verification

- `cd backend && .venv\Scripts\python.exe -m pytest tests -q` → 88 + new
  node-config tests green.
- `npm run lint`, `npm run build` clean.
- `pwsh scripts/smoke_topology.ps1` → PASS (backend contract unchanged
  apart from additive endpoint).
- **Browser matrix:** flag OFF → 2-node canvas animates DATA/ACK; flag ON →
  7-node, route highlight, dots hop-by-hop; timeout/retransmit visual under
  25 % loss; node click → inspector → change latency/loss → badge/`up` and
  `/api/topology` reflect it; panel tabs all populated; resume toast works;
  layout fits 1080p without scrolling.

## 8. Risks / notes

- 500 ms poll granularity: animation is a faithful *representation* of events,
  not millisecond-accurate positions (accepted — option 1 trade-off).
- Removing ~9 components: `npm run build` type-check is the safety net for
  broken imports.
- `start_all`/`patch_testing` override precedence is the one behavioral
  backend change — covered by new tests; smoke re-run guards regressions.
- Spec §8 previously forbade packet sprites / dynamic latency → doc updated
  in the same PR as the feature (§9.5 rule: docs only when working).
