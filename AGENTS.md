# AGENTS.md — FastShare master guide for AI agents

Single entry point for working on this repo: project overview, commands,
gates, conventions, file map, current status, doc index, and the **required
work log** every agent must update.

## Project overview

FastShare — a reliable UDP file-transfer teaching tool (academic project):

- **Stop-and-Wait ARQ**: sequence numbers, ACKs, timeout + retransmission,
  duplicate suppression, simulated packet loss / corruption (CRC-32).
- **Multi-server topology**: 7-node extended star (`l1,l2,l3` → `ch1,src…`),
  real UDP forwarders with per-hop latency, per-link stats, per-node config
  (latency / loss / up-down), route selection + resume across hops.
- **Multi-path UDP**: switchable tri-path preset (3 node-disjoint lanes,
  ports 6201–6208), per-hop **OS-process isolation** (`topology_isolated`)
  with per-node log APIs/consoles, source-side `PathScheduler` (explore →
  100-window flag ≥20% loss → weighted shift + 10% probe, hysteresis).
- **Live dashboard**: Next.js canvas with animated packet dots (event-driven,
  not polled), pan/zoom, floating node inspector, telemetry sidebars.
- Neo-brutalist UI: hard 2px borders, solid offset shadows, mono type.

## Stack

- **Backend** `backend/`: Python FastAPI (`main.py`, port 8000) + UDP
  receiver/sender, `transfer/` core (ARQ, CRC, topology). Tests: pytest.
- **Frontend** `frontend/`: Next.js 14 (App Router), React 18, Tailwind 3.4
  (container queries available — use `@container` / `@md:` inside sidebars,
  viewport `sm:/md:` only for page-level chrome), lucide-react, TypeScript.

## Commands & gates (run before finishing any task)

From `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pytest tests -q     # expect: 119 passed
python main.py                                     # FastAPI on :8000
pwsh scripts/smoke_topology.ps1                    # E2E (from repo root) -> SMOKE PASS
```

From `frontend/`:

```powershell
npm run lint        # must be clean
npm run build       # must succeed (runs type check)
npm run dev         # http://localhost:3000
# stricter dead-code check:
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
```

Known flaky: `tests/test_retransmission.py::test_loss_causes_timeout_and_retransmission`
fails only under CPU load; re-run in isolation before blaming your change.
There is no `rg` CLI on this machine — use Grep / `Select-String`.
Windows + PowerShell 7. Backend was last untouched while UI changed; if you
change backend code, re-run pytest **and** the smoke script.

## Architecture (request flow)

1. Dashboard polls `GET /api/status` (~500 ms) for counters + uses SSE-free
   push endpoints for packet events (`PacketLayer` animates them). Status
   also carries `scheduler` (live PathScheduler state).
2. `POST /api/server/start|stop`, `POST /api/transfer/start|cancel`, config
   endpoints (`/api/config`, `/api/topology/node/config`,
   `/api/topology/preset`, `/api/topology/multipath/config`,
   `GET /api/topology/node/{id}/logs`), topology snapshot in
   `/api/topology` (+ preset/paths/multipath fields).
3. Backend `TopologyManager` owns nodes/links/forwarders; precedence:
   per-node overrides > `start_all()` preset > `testing` patch. Handles are
   `Forwarder` (in-process) or `ProcessHandle` children depending on
   `topology_isolated`.

## Frontend file map

| Path | Role |
|---|---|
| `app/page.tsx` | Shell: chrome-only TopBar, left drawer (CONFIG/LAB/NODE), `<main>` canvas, right drawer (STATS/PACKETS), resize handles, backdrop, floating RoutePicker island, bottom `TransferDock` |
| `components/TopologyCanvas.tsx` | SVG canvas: pan/zoom view state, letterbox metrics, node/link rendering with the **path-state colour language** (green optimal / blue candidate / red dashed restricted, weight→width, flag flash banner, state-coloured tri router borders), overlays, zoom controls, legend+mode chips, `topLeftExtra` slot |
| `components/PacketLayer.tsx` | Animated packet dots (state-coloured per lane + lane letters, white ACK mirrors the DATA lane, `speed` prop for slow-mo) |
| `components/PathSwitchHud.tsx` | Canvas top-left HUD: anim speed (¼×/½×/1×, `fastshare:anim-speed`), scheduler mode, state-coloured per-lane share/loss bars, pick-timeline strip with flag/recover carets |
| `components/TopBar.tsx` | Brand + settings + sidebar toggles only |
| `components/TransferDock.tsx` | Bottom-center island: server chip, file chip, progress, state badge, resume/start/cancel actions |
| `components/RoutePicker.tsx` | Source/destination pickers (floats top-center of canvas when flag ON) + `N paths` badge |
| `components/NodeInspector.tsx` | Floating per-node config card (latency/loss/up) + NODE tab variant with polled log console |
| `components/SidePanel.tsx` | Drawer body: header + scroll area (`@container`) + vertical tab rail (`railSide` mirrors rail outward) |
| `components/PanelResizeHandle.tsx` | Pointer drag resize, double-click reset |
| `components/{NetworkingStats,PacketMonitor,TestingPanel,TransferConfigCard,EventTraceConsole}.tsx` | Telemetry / lab / config panels |
| `components/tabs/ConfigTab.tsx` | Receiver row + Topology panel (preset selector, multipath toggle/flag/probe/window) + transfer settings |
| `components/tabs/StatsTab.tsx` | Progress + Path scheduler panel (per-lane loss bars, weights, FLAG) |
| `components/tabs/{LabTab,PacketsTab}.tsx` | Tab contents |
| `components/ui.tsx` | Primitives: Button/Select/Toggle/Field/StatCell/Tabs/Badge/Panel/PanelHeader/StatusDot — style everything through these |
| `hooks/usePanelLayout.ts` | Panel widths/visibility, localStorage (`fastshare:panel-*`), `PANEL_LIMITS`, `isDesktop()` |
| `hooks/{useTransfer,useStatusPolling,useTransferActions,useNodeSelection,useFileSelection,useResume}.ts` | State hooks |
| `lib/{topology,api,canvas,types,format,logClassify,testingScenarios,cn}.ts` | Pure logic / API client (`canvas.ts` also owns `laneStates` + the green/blue/red path-state palette) |

### UI conventions

- Z-order: backdrop z-30 < drawers z-40 < TransferDock z-[45] < TopBar z-50 <
  resume toast z-[60].
- Breakpoint `lg` (1024px): sidebars docked; below it they are overlay
  drawers; opening one closes the other.
- All structural boxes: `border-2 border-neutral-700` + `shadow-[Npx_Npx_0_#000]`.
- Keep TopBar chrome-only — transfer state belongs in TransferDock.

## Current status (2026-10-08)

Multi-path feature **DONE** end-to-end: backend **119 tests** passing,
`smoke_topology.ps1` PASS, frontend lint/build/strict-tsc clean. Delivered:
per-PC isolation + node log consoles, tri-path preset (**now the default
topology**), source-side `PathScheduler` + client multipath, path-state
colour language (green optimal / blue candidate / red dashed restricted)
on links/nodes/dots, slow-mo + `PathSwitchHud` timeline + flag flash.
Docs: new `FEATURE_SPEC_MULTIPATH.md`, README, PROJECT_PLAN Phases 13–14.

## Documentation index

| Doc | Use it for |
|---|---|
| `README.md` | User-facing overview, run/demo steps, testing, project layout, future work |
| `PROJECT_PLAN.md` | Phase-by-phase build log, Definition of Done, test inventory (119) |
| `FEATURE_SPEC_MULTI_SERVER_TOPOLOGY.md` | Topology spec, locked decisions, API contract, phase log |
| `FEATURE_SPEC_MULTIPATH.md` | Multi-path spec: isolation, tri preset, scheduler, API, UI, phase log |
| `IMPLEMENTATION_ROADMAP.md` | Design notes for CRC/stats/resume (historical — implemented) |
| `CODE_AUDIT.md` | 2026-10-09 code audit: backend/frontend findings with file:line refs + prioritized P0–P2 action list |
| `Reliable UDP File Transfer - Implementation Plan.md` | Original academic plan |
| `.plan/plan.md` | Approved 8-step UI-revamp plan (completed) |

---

## Work log (REQUIRED)

Every agent that touches this repo **must** add an entry when it starts
significant work and **update it before finishing**. Never delete other
agents' entries; prepend yours under `### Entries`.

Strict format for each entry (all three fields):

1. **Person** — the human giving the commands (e.g. `Atiksh Chawla`)
2. **Agent** — the AI agent type/model (e.g. `opencode mimo-v2.6-flash-free`,
   `antigravity gemini-2.5-pro`)
3. **Entry** — markdown with exactly three bullets: `**Done**`, `**Pending**`,
   `**Planned**`

```markdown
### <date> — <person> — <agent>
- **Done**: …
- **Pending**: … (in progress right now, with next action)
- **Planned**: … (agreed next steps not yet started)
```

### Entries

### 2026-10-30 — Atiksh Chawla — opencode mimo-v2.6-flash-free (Packages B + C, partial D-free checkpoint)

- **Done**: **Package B (frontend perf)** — P1-7 memoized `buildCanvasMetrics`
  in `lib/canvas.ts` + call-site updates; P1-8/P2-24 `useStatusPolling`
  rewrite (structural `deepEqual`, no state write on no-op ticks, cursor
  kept in a ref); P1-14 event-batched `PacketLayer` ingest. **Package C
  (tests + a11y)** — P1-11 vitest pinned `^2` (2.1.9; v5 fails ERESOLVE vs
  `@types/node@^20`), `vitest.config.ts`, 4 pure-lib test files
  (`canvas`/`logClassify`/`format`/`anim`) = **26/26 pass**; P1-23 a11y:
  canvas `role="group"` + node `tabIndex`/`role="button"`/`aria-pressed`/
  Enter-Space, control `aria-label`s (TopBar/NodeInspector/TransferDock),
  `hooks/usePrefersReducedMotion.ts` (stored `fastshare:anim-speed` wins,
  else ¼×), `globals.css` reduced-motion block. **P2-23 (first half)** —
  `transfer/topology/manager.py` new `_lifecycle` RLock making
  `set_preset`/`start_all`/`stop_all`/`prepare_transfer` atomic vs each
  other (audit §2.2 #3: concurrent preset switch could KeyError inside
  `start_all`'s `self._forwarders[node.id]` or leave ghost forwarders from
  the abandoned graph); split `stop_all`→`_stop_all_unlocked`,
  `start_all`→`_start_all_locked`, `prepare_transfer`→
  `_prepare_transfer_locked` so `_ensure_handles` (which holds
  `_handles_guard`) never re-enters `_lifecycle` — lock order stays
  `_lifecycle` → `_lock`/`_handles_guard`; receiver rebind still holds no
  `_lock` (module-docstring rule preserved). Gates: pytest **119 passed**,
  `smoke_topology.ps1` **SMOKE PASS**, frontend strict-tsc / lint (2
  pre-existing `spawnAck` warnings) / build / `npm run test` 26/26 all
  green.
- **Pending**: P2-23 second half — `tests/test_concurrency.py` (double-
  start, preset-switch-during-start, poll responsiveness during spawn/stop)
  not yet written (the lock fix landed ahead of its tests); P2-21 fixture
  centralization not started; Package D (P1-13 RTT-adaptive timer,
  P2-15…20) and P2-22 (mobile pinch-zoom/route picking) not started;
  AGENTS.md work-log entries for the earlier B/C chunks are folded into
  this entry; uncommitted working tree (user decides commits); manual
  browser check never run.
- **Planned**: Await user go-ahead — next: write `test_concurrency.py`,
  then P2-21 dedup, then Package D + P2-22, re-running full gates each time.

### 2026-10-30 — Atiksh Chawla — opencode mimo-v2.6-flash-free (Package A backend reliability)

- **Done**: Implemented Package A from `CODE_AUDIT.md` (P0-1..6 + P1-9/10),
  backend-only. **P0-1** `udp/server.py` `_serve` wraps `_handle` in
  `try/except OSError` (disk error logs + keeps serving instead of killing
  the listener into a zombie "running" receiver); `resume_fs.discard_partial`
  now returns False when a remove fails (Windows-locked) and the stale-
  partial discard loop breaks instead of spinning. **P0-2** END handling
  ignores END while `expected_seq <= total_packets` (a forged/stale END can
  no longer finalize a truncated file — the *peer-address pinning half was
  deliberately DEFERRED*: multipath last-hop source addresses vary per lane,
  pinning would risk breaking the demo). **P0-3** `transfer/manager.py`
  `start_all` topology boot and `stop_all`+`clear_route` moved OUTSIDE the
  manager lock (status poll no longer freezes for seconds exactly when a
  demo starts; ghost-forwarder guard if `stop_server` races the boot);
  `topology/manager.py` parallel child boot joins are bounded by the new
  `_BOOT_JOIN_TIMEOUT=8.0` (wedged child reported as failed, not hung
  forever). **P0-4** `snapshot()` refreshes per-child stats in parallel
  (thread per handle, 0.4 s join) instead of sequential request/reply.
  **P0-5** `tests/test_retransmission.py::test_loss_causes_timeout_and_retransmission`
  seeds `random` (kills the structural ~1.5% 0.9^40 flake; 5/5 isolated
  reruns deterministic). **P0-6** `main.py` FastAPI `lifespan` hook calls
  `manager.stop_server()` on shutdown (no orphaned forwarders/children on
  Ctrl-C); removed the stray `cd f` docstring line. **P1-9** `udp/scheduler.py`
  `PathScheduler` guarded by an internal `threading.Lock` on
  `pick/record/state` with `on_event` fired AFTER release (lock order is
  strictly manager → scheduler, no AB-BA with `status_snapshot`);
  `udp/client.py` ACK-origin validation — `_ack_ports` allowlist built from
  lane `entry_port`s in `__init__`, `_wait_ack` switched to `recvfrom` and
  drops ACKs from non-lane source ports (single-path keeps an empty set →
  kernel-filtered, behaviour unchanged). **P1-10** `_RESUME_REPLAY_LIMIT=1000`
  in `transfer/manager.py`: larger resumes record a counter summary instead
  of replaying one ACK event per packet. Verified by a new probe
  (`probe_package_a.py`: forged END ignored + partial survives + real END
  finalizes exact bytes; injected OSError keeps listener alive + transfer
  completes; wrong-origin ACK ignored / lane-origin accepted / wrong-only
  times out → ALL CHECKS PASS) and re-ran the dot-fidelity probe (ALL CHECKS
  PASS, no regression). Gates: pytest **119 passed** (x2), `smoke_topology.ps1`
  **SMOKE PASS** (x2), strict tsc / `npm run lint` (2 pre-existing warnings)
  / `npm run build` clean.
- **Pending**: Uncommitted working tree (user decides commits — suggested
  split: Package A backend vs the earlier event-stream work); manual browser
  check never run (no browser automation here); stale `stash@{0}` still
  parked; `_send_control` re-marks `SENT` on every retransmit attempt
  (control-packet double-count, left as-is — noted in the dot-fidelity
  entry).
- **Planned**: Await user direction — remaining audit packages (B frontend
  perf / C tests+a11y / D demo polish), or cherry-pick from `CODE_AUDIT.md`.

### 2026-10-09 — Atiksh Chawla — opencode mimo-v2.6-flash-free (dot-fidelity event stream)

- **Done**: Made the animated packet dots correlate 1:1 with real packet
  processing (previously a 500 ms poll sampled a latest-status-only table →
  0/24 timeout flashes, 0/24 retransmit respawns, 35/150 data dots, 36% of
  transitions observable). **Backend** — `transfer/constants.py`
  `MAX_EVENT_STREAM=2000`; `transfer/event_log.py` new append-only `stream`
  ring (`record()` now also appends every START/DATA/END transition with a
  monotonic `id`; `next_id` deliberately NOT reset in `reset()` so a stale
  frontend cursor can never alias onto a new transfer) +
  `packet_events(since,limit)`/`current_cursor()` returning
  `(events, cursor, gap)`; `transfer/manager.py` locked `packet_events()`
  accessor; `GET /api/transfer/packets` gains a `since` cursor →
  `{packets, feed, events, cursor, gap}`; `udp/client.py` fixed the
  TIMEOUT-lane mislabel in `_send_data_packet`/`_send_control` (TIMEOUT now
  carries the *failed* attempt's lane via `prev_lane`, not the retransmit's
  newly-picked lane — only became visible once TIMEOUT renders). **Frontend**
  — `lib/types.ts` `PacketEvent` + extended `PacketResponse`;
  `lib/api.ts` `transferPackets(limit, since)`; `useStatusPolling` keeps a
  `cursorRef` and stores the event delta; `useTransfer`/`page.tsx` thread
  `events`; `PacketLayer` ingest rewritten to consume the id-ordered stream
  (`lastIdRef` single-draw dedupe; spawn on SENT/WAITING, ack on ACKED,
  flash on TIMEOUT, respawn on RETRANSMITTED) — dropped the table sampling,
  the `seq:status:retries` key, and the now-unused `packets` prop. Verified
  by probe (tri, 35% loss): timeout/retransmit flashes **N/N**, data-dot
  coverage **150/150**, ack **152/152**, **0** duplicate draws, **100%**
  event delivery (was 36%). Gates: pytest **119**, `smoke_topology.ps1`
  **SMOKE PASS**, strict tsc / `npm run lint` / `npm run build` clean.
- **Pending**: Uncommitted working tree (user decides commits); the other
  CODE_AUDIT P0–P2 fixes not yet started; manual browser check of the new
  dot behaviour never run (no browser automation here); stale `stash@{0}`
  still parked. Minor known quirk left as-is: `_send_control` re-marks
  `SENT` on every retransmit attempt (control-packet double-count; the
  canvas correctly doesn't double-spawn, but the `packets_sent` stat
  over-counts START/END retries).
- **Planned**: List the remaining possible fixes (from `CODE_AUDIT.md`)
  for the user to choose from, then implement the chosen package and
  re-run the full gate set.

### 2026-10-09 — Atiksh Chawla — opencode mimo-v2.6-flash-free (repo audit)

- **Done**: Full read-only scan of the repo — backend (22 prod modules
  ~3,040 LOC + 15 test files / 119 tests), frontend (44 files ~5,960 LOC)
  and all planning docs; produced `CODE_AUDIT.md` (consolidated findings
  with file:line refs, P0–P2 prioritized action list, 4 shippable work
  packages) and indexed it in the Documentation index. No source changed,
  no git commands run.
- **Pending**: Awaiting user decision on which work package to implement
  (A backend reliability / B frontend perf / C tests+a11y / D demo
  polish) — next action starts on their pick.
- **Planned**: Once a package is chosen, implement it and run the full
  gate set (pytest 119, smoke, lint/build/strict-tsc).

### 2026-10-09 — Atiksh Chawla — opencode mimo-v2.6-flash-free (tri-first + state colours)

- **Done**: Tri-path becomes the default topology + path-state colour
  language across the UI. **Backend** — `transfer/topology/manager.py`
  `PRESETS["tri"]` default (`DEFAULT_SOURCE/DEST` → `src`/`dst`, ports
  6201–6208); star-oriented test fixtures normalize via
  `set_preset("star")` with save/restore (`test_topology_api`,
  `test_topology_transfer`, `test_topology_isolation`); new
  `test_default_preset_is_tri_path` (+1 → **119 passed**);
  `scripts/smoke_topology.ps1` pins star for the 4-hop resume scenario
  and restores tri on cleanup (**SMOKE PASS**). **Frontend** —
  `lib/canvas.ts` new `PathState` (`optimal`/`candidate`/`restricted`) +
  `PATH_STATE_STROKE/FILL/HEX` + `schedulerLaneStates()`/`laneStates()`
  (replaces fixed A-cyan/B-amber/C-fuchsia lane hues); `TopologyCanvas`
  state-coloured links (weight→width, flagged → red dashed + flash
  banner) and state-coloured tri router borders (down → red) + updated
  legend; `PacketLayer` dots painted by path state (ACK now white, green
  reserved for "optimal"); `PathSwitchHud` + `StatsTab` share bars,
  timeline ticks and swatches all state-coloured. **Docs** — spec §4/§7
  + Phase 7 log (119), README §5 rewritten as a 3-phase walkthrough
  (clean → add loss → remove loss), PROJECT_PLAN Phase 14 + inventory
  119, multi-server spec §7, this file (gates 119, file map, status).
  Gates: pytest **119**, `smoke_topology.ps1` PASS, strict tsc /
  `npm run lint` / `npm run build` all clean.
- **Pending**: Uncommitted working tree (user decides commits — suggested
  split: tri-default backend+tests vs frontend state-colours vs docs);
  manual browser check of the new colour semantics never run (no browser
  automation here); stale `stash@{0}` still parked.
- **Planned**: Await user direction — commit split, or next feature from
  `README.md` §Future work.

### 2026-10-08 — Atiksh Chawla — opencode mimo-v2.6-flash-free (adaptation viz)

- **Done**: Frontend-only "visualize the adaptive switch" pass: new
  `components/PathSwitchHud.tsx` (canvas top-left HUD — slow-mo anim
  control ¼×/½×/1× persisted at `fastshare:anim-speed`, scheduler mode
  badge, per-lane share/loss bars with FLAG chip, pick-timeline strip of
  recent frames coloured by lane + ▼/▲ flag/recover carets anchored to
  the exact seq); `page.tsx` speed state + `topLeftExtra` wiring;
  `TopologyCanvas` lane-health rendering (scheduler weight → stroke
  width/opacity, flagged lane → red dashed, legend "Flagged" key, transient
  flag/recover flash banner top-right); `PacketLayer` `speed` prop (all
  timings/fades/trails/hold-pulse scaled by 1/speed, DATA sprites capped
  at 5 while slow, lane letter drawn next to each DATA dot on tri lanes).
  Docs: README §5 steps 2–6, spec §7 table + Phase 6 log, AGENTS file map
  + status. Gates: strict `tsc`, `npm run lint` (2 pre-existing
  exhaustive-deps warnings only), `npm run build` all clean; backend
  untouched → pytest/smoke not re-run.
- **Pending**: Uncommitted working tree (user decides commits); manual
  browser check of the HUD/slow-mo visuals never run (no browser
  automation here); stale `stash@{0}` still parked.
- **Planned**: Await user direction — commit split, or next feature from
  `README.md` §Future work.

### 2026-10-08 — Atiksh Chawla — opencode mimo-v2.6-flash-free

- **Done**: Multi-path UDP feature, all 5 phases:
  **Phase 1 (per-PC isolation + logs)** — `Forwarder.log_sink`
  (bound/route/drop/fwd/stop lines); new `transfer/topology/node_main.py`
  (child entry: one Forwarder per OS process, JSON-lines stdin/stdout,
  stats push every 250 ms, exits on shutdown/stdin EOF) and
  `process_node.py` (`ProcessHandle` duck-types the Forwarder surface:
  config attrs → pipe, tagged route/stats request-reply, cached
  config+route re-applied on respawn); `TopologyManager._ensure_handles()`
  (flag/preset keyed), per-node 1000-line log rings + `node_logs()`,
  parallel child spawn, exact stats refresh in `snapshot()`;
  `topology_isolated` default True in `TransferManager.config` (missing
  key ⇒ in-process; conftest forces in-process); endpoint
  `GET /api/topology/node/{id}/logs` (400 unknown);
  `tests/test_topology_isolation.py` (5). **Phase 2 (tri preset +
  multi-route)** — `PRESET_TRI_PATH` (ports 6201-6208, roles
  source/router/dest), `all_paths()` lanes A/B/C, `PRESETS` registry +
  `set_preset()` (400 unknown/mid-transfer) + `POST /api/topology/preset`,
  multi-lane `prepare_transfer` (`lanes` entries, interior hops of every
  lane), snapshot `preset/presets/paths`; `tests/test_topology_presets.py`
  (8). **Phase 3 (scheduler + client multipath)** — `udp/scheduler.py`
  `PathScheduler` (explore → round_robin → 100-window flag ≥20% → weighted
  +10% probe, hysteresis <10%, `state()`), client `lanes`/`multipath`
  (unconnected socket, pick/record per attempt, `lane` on packet entries,
  `PATH A flagged…` feed lines), topology `multipath` policy +
  `multipath_config()`, `MultipathConfig` model + endpoint,
  `status.scheduler`; `tests/test_multipath.py` (10, incl. lossy-lane
  flag→shift→byte-identical E2E). **Phase 4 (frontend)** —
  `lib/topology|types|api` extended (roles, preset/paths/multipath,
  `SchedulerState`, `NodeLogsResponse`, `PacketEntry.lane`, `setPreset`/
  `multipathConfig`/`nodeLogs`); `lib/canvas.ts` TRI_POS + lane→link map +
  `laneIds`/`lanePath` + lane palette; lane-coloured links/legend/preset
  chip in `TopologyCanvas`; lane-aware `PacketLayer` (DATA dot colour per
  lane, ACK returns on the same lane); CONFIG Topology panel (preset
  selector, multipath toggle, flag %, probe %, window); STATS *Path
  scheduler* panel (loss bars, weights, FLAG); NODE-tab log console
  (2 s poll + refresh); RoutePicker `N paths` badge; `setPreset`/
  `setMultipath` actions + page wiring (route pick reset on switch).
  **Phase 5 (gates + docs)** — pytest **118 passed**, `smoke_topology.ps1`
  **SMOKE PASS**, `npm run lint` / `npm run build` / strict `tsc` all
  clean; new `FEATURE_SPEC_MULTIPATH.md`, README (abstract/features/
  demos §5/viva §8/testing/layout), PROJECT_PLAN Phase 13 + tables + DoD,
  this AGENTS.md updated (gates 118, file map, status).
- **Pending**: Uncommitted working tree (user decides when/what to commit —
  suggested split: multipath backend+tests vs frontend vs docs); manual
  browser check of the new UI panels never run (no browser automation
  here); stale `stash@{0}` still parked.
- **Planned**: Await user direction — candidate next work: commit split,
  or the next feature from `README.md` §Future work.

### 2026-10-06 — Atiksh Chawla — opencode mimo-v2.6-flash-free

- **Done**: All 8 approved plan steps (`.plan/plan.md`); dual resizable
  sidebar layout (controls left / telemetry right, persisted widths, mobile
  drawers); canvas pan/zoom (wheel zoom to cursor, drag pan, zoom controls,
  double-click reset); chrome-only TopBar + floating `TransferDock`
  (server/file chips, progress, resume, start/cancel) bottom-center;
  RoutePicker moved to canvas top-center island; split packet/trace view as
  default; sidebar sizing pass (container-query grids, denser cells/headers);
  dead-code cleanup (orphan exports, unused param); README demo wording
  synced with the dock/island layout; this master AGENTS.md created; gates
  green: pytest **95 passed**, `npm run lint`, `npm run build`,
  `tsc --noUnused*` all clean, `smoke_topology.ps1` PASS (backend untouched).
- **Pending**: Uncommitted working tree (user decides when/what to commit —
  suggested split: topology backend+tests vs UI revamp); stale `stash@{0}`
  (based on `475b99a`) still parked; manual browser matrix check never run
  (no browser automation available here).
- **Planned**: Await user direction — candidate next work: commit split, or
  the next feature from `README.md` §Future work.
