# FastShare — Code Audit Report

**Date:** 2026-10-09
**Scope:** full read-only review of `backend/` (22 production modules,
~3,040 LOC + 15 test modules, ~2,080 LOC / 119 tests), `frontend/` (44
files, ~5,960 LOC) and the planning docs.
**Method:** manual source review of every production file; no source was
changed and no git commands were run. Line numbers refer to the working
tree as of this date — re-verify before editing.

This is a point-in-time quality/reliability audit. It does **not** change
any behaviour; it is the input for deciding what to fix next.

---

## 1. Executive summary

The project is in good shape for its purpose: layering, documentation and
test philosophy are well above the typical university project. The real
risks are concentrated in three places:

1. **Receiver-loop error handling** — a disk error can silently kill the
   UDP receiver thread while the controller still reports `running`, and
   the END packet finalizes without verifying completeness.
2. **Lock-held-during-join stalls** — starting/stopping the isolated
   (per-PC) topology nodes happens *inside* the TransferManager lock, so
   the 500 ms status poll can freeze for seconds exactly when a demo
   starts or stops.
3. **Frontend render churn** — no memoization anywhere; the canvas graph
   is rebuilt and `getBoundingClientRect()` is called during render on
   every poll tick *and* every pan pixel.

Secondary themes: one structurally flaky test (not CPU-load flaky — it has
a ~1.5 % inherent failure chance), zero frontend tests, and a handful of
accessibility gaps.

**Strengths worth preserving** (do not regress these):

- Real-loopback-UDP test philosophy, no mocks; SHA-256 file equality as
  the end-to-end oracle.
- Clean dependency direction: `topology` reaches the controller only via
  an injected `TransferManager` (`transfer/topology/manager.py:37-40`).
- Documented locking rules and deliberate deadlock avoidance
  (`transfer/manager.py:200-211`, `397-412`).
- Zero `any` in the frontend; strict `tsconfig` on.
- Effect/listener cleanup discipline throughout the frontend (wheel
  listener `{passive:false}`, `ResizeObserver.disconnect`, rAF cancel,
  interval cleanup) — better than average.
- Pure, testable `lib/` modules (`canvas.ts`, `logClassify.ts`,
  `format.ts`, `topology.ts`, `testingScenarios.ts`).
- Bounded logs/rings everywhere (`transfer/constants.py:15-16`,
  `_MAX_NODE_LOG` at `topology/manager.py:33`, 150-row packet table).

---

## 2. Backend findings

### 2.1 Organization & duplication

Structure is genuinely good: thin HTTP shell (`api/endpoints/*`, 15–71 LOC
each) → singleton `TransferManager` → `udp/` wire layer →
`transfer/topology/`. Biggest files are all < 600 lines
(`transfer/manager.py` 584, `topology/manager.py` 573).

Duplication / maintainability:

| Issue | Location |
|---|---|
| `_send_control` and `_send_data_packet` are ~80 % the same retry/mark/retransmit loop | `udp/client.py:220-257` vs `:259-297` |
| "resolve `enabled` flag + probability" copy-pasted ~6× | `transfer/manager.py:162-164, 244-245, 323-325`; `topology/manager.py:189-193, 218-235, 365-376` |
| `_reset_transfer_state` hand-repeats the 25-field list from `__init__` — adding a field in one place silently misses the other | `transfer/manager.py:69-97` vs `:414-441` |
| `_effective_config` and `_effective_probs` overlap heavily | `topology/manager.py:196`, `:218` |
| Test helpers duplicated across files (`_wait_finished`, `_received_bytes`) | `tests/test_multipath.py:81`, `test_topology_transfer.py:49`, `test_stats.py:38` |
| Five near-identical save/restore fixtures for the global singleton | `topo_env`, `tri_env` ×2, `stats_env`, `resume_env`, `isolated_nodes`, `restored_preset` |

Dead / vestigial:

- `main.py:2` — stray keystroke fragment **`cd f`** in the module
  docstring (first thing anyone opens).
- `graph.py:69` `bfs_route`, `graph.py:59` `node_ids_except` — used only
  by tests; production routing always uses `all_paths`
  (`topology/manager.py:405`). Fine as teaching material; label as such.
- `protocol.py:33` `PACKET_TYPE_ERROR` reserved but never sent/received.
- `manager.py:48` `window_size` frozen at 1 (documented future work).

Unclear abstractions:

- `Forwarder` and `ProcessHandle` are duck-typed siblings with no shared
  base/Protocol — visible as `getattr(fwd, "refresh_stats", None)`
  (`topology/manager.py:505`) and `isinstance` checks
  (`topology/manager.py:326`). The contract is currently spelled out in
  prose at `process_node.py:1-17`.
- `emit_packet` derives counters from status **strings** mixed with
  constants (`transfer/manager.py:123-145`); the `prev.get("size")` trick
  (`manager.py:135` + `event_log.py:30-46`) is subtle — a named helper
  would be safer.
- `TransferManager` carries 30+ scalar attributes; grouping into
  `Counters` / `SessionState` dataclasses would make reset and snapshot
  trivial.

### 2.2 Concurrency

Thread inventory per demo: FastAPI threadpool workers; `UDPServer` 1
daemon thread (`server.py:81`); 2 threads per in-process forwarder
(`forwarder.py:157-162`); per isolated node 1 child process + 1 reader
thread in the parent (`process_node.py:177`) + rx/tx/stats threads in the
child; 1 client thread per transfer (`manager.py:343`). All daemon-
threaded; children die on stdin EOF (`node_main.py:25-26`) — nothing
outlives the controller.

Documented deadlock avoidance and re-check-after-yield patterns
(`manager.py:276→299`, ghost-receiver guard at
`topology/manager.py:445-449`) are above-average touches. Remaining
issues, ranked by impact:

1. **Multi-second holds of the TransferManager lock during node
   lifecycle.** `start_server` calls `topology.start_all()` *inside*
   `with self._lock` (`transfer/manager.py:149-196`), `stop_server`
   likewise (`:204-210`). With isolated nodes, `ProcessHandle.start()`
   can block up to 5 s (`process_node.py:31`) and `stop()` ~1.8 s per node
   (`process_node.py:126-142`); `start_all`'s parallel boot joins with
   **no timeout** (`topology/manager.py:341-344`). Eight nodes ⇒
   `/api/status` (500 ms poll) can stall for many seconds right when the
   demo starts/stops. Not a deadlock (forwarders never call back) — a
   visible dashboard freeze.
2. **`snapshot()` does sequential blocking IPC** — `refresh_stats`
   per handle, one at a time, up to 8 × 0.25 s = 2 s per
   `GET /api/topology` (`topology/manager.py:501-507`).
3. **TOCTOU on `set_preset`** — the "no transfer running" check
   (`topology/manager.py:138`) sits outside both the lock and the handles
   guard; likewise two concurrent `POST /transfer/start` calls both run
   `prepare_transfer` (`manager.py:299-302`). Self-healing on next start
   limits damage; a cheap topology lock makes it airtight.
4. **`PathScheduler` is not thread-safe** — client thread mutates
   (`pick`/`record`) while the HTTP thread reads `state()`
   (`manager.py:508-511`). CPython mostly saves it, but `sum()` over a
   `maxlen` deque while it's being appended/evicted
   (`scheduler.py:44, 88-92`) is a "fine until the demo freezes" race.
5. **`_on_resume` replays one ACK event per resumed packet under the
   manager lock** (`manager.py:365-381`) — a large resume means ~100k
   `emit_packet` iterations under the lock; status polls stall.
6. **Unbounded `PriorityQueue`** in `Forwarder` (`forwarder.py:82`) —
   safe today (Stop-and-Wait ⇒ 1–2 items), not future-proof.
7. **Minor:** `ProcessHandle._set_cfg` can raise `OSError` → 500 from
   `POST /topology/node/config` when a child just died
   (`process_node.py:84-89`, `topology/manager.py:269-292` catches
   `OSError` only around `start()`); `config` dicts mutated without the
   lock (`api/endpoints/server.py:40`).

No event-loop blocking per se — endpoints are plain `def` and run in
FastAPI's threadpool; the risk is threadpool-worker starvation, not the
loop.

### 2.3 Error handling

Strengths: `ChecksumError` vs framing errors kept distinguishable
(`packet.py:27-32`); socket-close races anticipated (`server.py:116`,
`forwarder.py:196-201, 287-288`); uniform defensive `stop()` with
shutdown→terminate→kill escalation (`process_node.py:120-151`); client
exceptions become `failed`, never a zombie "transferring"
(`manager.py:349-356`); rejected uploads deleted
(`api/endpoints/transfer.py:29-33`).

Gaps:

- **Receiver thread can die silently on disk errors.** `_serve` catches
  only `socket.timeout`/`OSError` around `recvfrom`
  (`udp/server.py:111-117`); `_handle_start`'s `open()`/`truncate`
  (`:234, :265`) and `_finalize`'s `os.replace`/flush (`:271-280`) can
  raise straight out of `_serve`, **skipping** `reset_session()`
  (`:134`) and leaving `server_status == "running"` while nothing is
  listening. Fix: wrap `self._handle(...)` in `try/except OSError` like
  `forwarder.py:198-201`.
- **`find_partial` discard loop can spin forever** — `server.py:218-221`
  loops `find_partial` → `discard_partial`, but `discard_partial` swallows
  `OSError` (`resume_fs.py:66-72`); on Windows a locked file means the
  same candidate is returned forever, holding the session lock.
- **No FastAPI shutdown/lifespan hook** in `main.py`; child cleanup
  relies on implicit stdin EOF (`manager.py:584` builds the singleton at
  import).
- `start_all` rollback silently ignores a second bind failure when
  restoring the old port (`topology/manager.py:433-436`) — the user never
  learns the receiver is now down.
- `os.path.getsize(upload_path)` unguarded under the lock
  (`manager.py:311`) → unhandled 500 if the temp file vanished.
- `_on_transfer_finished` uses wall-clock `time.time()`
  (`manager.py:385-386`) — a clock step yields negative `elapsed`;
  `time.monotonic()` (already used in `client.py`) would be correct.

### 2.4 Protocol / wire-format robustness

Strong: documented, bounds-checked header (`protocol.py:109-124` — min
length, declared-vs-actual payload length, CRC over exactly the payload);
oversize payloads refused; corruption simulator's empty-payload fallback
(`protocol.py:136-139`) verified by tests; `safe_filename` applied on
both upload (`uploads.py:27`) and resume APIs (`manager.py:547, 567`);
textbook Stop-and-Wait retry semantics; duplicate DATA/START/END re-ACK
paths; resume math including torn-tail truncation
(`server.py:233-236`, `resume_fs.py:48-63`).

Weaknesses (each is something a curious examiner could probe):

1. **END does not verify completeness.** The END branch
   (`udp/server.py:172-184`) finalizes whatever is on disk regardless of
   `expected_seq`/`total_packets`, ignores the END packet's `seq`, and
   the receiver never pins the session to the client's `addr` — a stale
   or forged (but CRC-valid) END from any source finalizes a truncated
   file and ACKs success. One-line guard:
   `if session["expected_seq"] <= session["total_packets"]: ignore + log`.
2. **DATA/END accepted from any source address** — same root cause
   (`server.py:138-184`). Fine on loopback; note the multipath demo
   deliberately varies source addresses per lane, so the fix must allow
   the known last-hop addresses.
3. **Multipath ACKs unvalidated for origin** — client socket is
   unconnected in multipath (`udp/client.py:142-143`) and `_wait_ack`
   uses `recv()` (`:315`); any host can deliver a CRC-valid ACK for the
   awaited sequence. Fix: `recvfrom` + membership check against known
   last-hop addresses.
4. **`parse_start_meta` trusts `name_len`** (`protocol.py:154-163`) —
   oversized value yields a silently truncated name instead of an error;
   wire `packet_size` is trusted (guarded only downstream by
   `resume_point`'s `<= 0` check); `file_size` is never cross-checked
   against bytes written before finalize.
5. **No overall deadline in `_wait_ack`** (each `recv` restarts the
   timeout) and a fixed retransmission timeout with **no backoff** despite
   collecting sRTT (`transfer/stats.py:31-34`) — an RTT-adaptive timer is
   an easy, demo-able "RFC 6298 in 10 lines" upgrade.

### 2.5 Test suite health

119 tests over real loopback UDP — the philosophy is a genuine asset.
Well covered: wire format/CRC edges (16 focused tests), Stop-and-Wait
behaviors end-to-end, loss/corruption/ACK-corruption with a deterministic
retry harness, resume in three flavors, stats math, forwarder behavior,
graph/presets/paths, per-node config precedence, isolation, scheduler
units (seeded) + E2E.

Coverage gaps: duplicate-END re-ACK (`server.py:176-179`) and
malformed-START-meta ACK (`server.py:189-194`) untested; empty-file
upload 400 (`uploads.py:40-42`) untested; no test pins the receiver's
reaction to a disk `OSError` (would fail today); **no concurrency tests**
(double-start, preset-switch-during-start — all §2.2 races untested);
scheduler recovery/hysteresis unit-tested but never E2E; nothing asserts
`GET /api/topology` stays responsive while children spawn/stop.

Flaky/slow:

- **Structural flake:** `tests/test_retransmission.py:12`
  `test_loss_causes_timeout_and_retransmission` — with p=0.10 over 40
  packets, P(zero losses) = 0.9⁴⁰ ≈ **1.5 %**, so
  `assert "TIMEOUT" in statuses` legitimately fails whenever the network
  is kind. This, not CPU load, is the "known flaky" note in AGENTS.md.
  Fix: seed `random`, or reuse the retry-until-CRC-fires harness from
  `test_checksum.py:20-32`.
- Timing dependence: fixture `time.sleep(0.3)` teardowns in 6 files;
  `_wait_finished` polls (50 ms steps, 60 s caps); a 256 KB cancel/resume
  E2E with 45 s runway (`test_topology_transfer.py:99`); a window
  assertion `4 <= resumed_seq <= 10` absorbing nondeterminism
  (`test_resume.py:176`).
- **Shared-singleton hazard:** every test mutates the global `manager`
  and correctness rests on ~8 hand-rolled restore fixtures. One forgotten
  restore ⇒ order-dependent suite. Centralize into one autouse fixture.

---

## 3. Frontend findings

### 3.1 Structure, duplication, dead code

File sizes are healthy (largest: `TopologyCanvas.tsx` 603,
`PacketLayer.tsx` 451, `NodeInspector.tsx` 413, `page.tsx` 356). State
management is plain hooks with a clean façade (`hooks/useTransfer.ts`,
34 lines) called once from `app/page.tsx:51` — appropriate, no global
store needed. The canvas↔inspector contract (render-overlay + children
inside the transformed `<g>`, `TopologyCanvas.tsx:479, 600`) is a nice
inversion of control.

Duplication:

| Duplicated thing | Locations |
|---|---|
| "ensure current value is in sorted options" helper | `NodeInspector.tsx:42-46` ≡ `ConfigTab.tsx:23-27` |
| Scheduler-mode maps (label/hint/tone) | `PathSwitchHud.tsx:26-32`, `StatsTab.tsx:11-25` |
| Lane-letter math `String.fromCharCode(65 + lane % 26)` | `PacketLayer.tsx:218`, `PathSwitchHud.tsx:231` |
| Progress % formula + bar markup | `TransferDock.tsx:49-51`, `StatsTab.tsx:27-30` |
| Fault-probability option lists (already diverged) | `NodeInspector.tsx:19` `[.05,.1,.25,.5,.9]` vs `TestingPanel.tsx:108` `[0,.05,.1,.25,.5]` |
| Transfer-status → colour/label mapping | `TransferDock.tsx:59-78`, `TopologyCanvas.tsx:250-252, 346-362`, `StatsTab.tsx:35-36` |
| Flag/recover detection (both keep a bitmask string and diff it) | `TopologyCanvas.tsx:108-133`, `PathSwitchHud.tsx:82-107` |

Dead code (confirmed by grep): `Input` (`ui.tsx:155-157`);
`TERMINAL_TONE_CLASSES` + the `variant="terminal"` branch
(`EventTraceConsole.tsx:25-35, 85-89` — sole caller passes `"rows"`);
`SidePanel` `headerRight` prop (`SidePanel.tsx:18, 26, 45`);
pass-through wrappers `LabTab.tsx` (31 lines) / `PacketsTab.tsx` (14);
unused API-mirror fields `ResumeInfo.received_bytes/total_packets/
file_size` (`types.ts:85-87`), `ApiOk.message` (`types.ts:121`),
`TopologyNode.host` (`topology.ts:25`).

Doc drift: AGENTS.md documents a "resume toast z-[60]" — no toast exists
anywhere; the resume affordance lives in `TransferDock.tsx:209-237`. Real
z-order is backdrop 30 < drawers 40 < TransferDock 45 < TopBar 50.

### 3.2 Performance (ranked)

1. **2 Hz full-tree re-render with zero memoization** — no
   `React.memo`/`useMemo` anywhere in the codebase.
   `useStatusPolling.ts:24-33` calls `setStatus/setPackets/setFeed/
   setTopology` with fresh identities every tick, so everything
   re-renders every 500 ms regardless of change. Consequences:
   - `TopologyCanvas.tsx:83` runs `buildCanvasGraph(topology, status)`
     (maps every node/link, builds a `byId` record) on **every render**,
     including every pointer-move frame while panning (`:205-216` fires
     `setView` per pixel).
   - The render body calls `svgMetrics()` → `getBoundingClientRect()`
     (`:140-148, 235-248`) — forced layout reads *during render*.
   - `/api/topology` is polled every 500 ms even in direct 2-node mode
     where topology is static ⇒ 6 HTTP requests/second total.
2. **`PacketLayer` re-renders at 60 fps** — `PacketLayer.tsx:320`
   `if (changed || sprites.length || blasts.length) tick()` reconciles
   the sprite list every animation frame while any dot is alive (i.e.
   continuously during a transfer). Contained and sprite-capped
   (`:198-203`), so it works; direct SVG attribute writes via refs would
   be cheaper. Note render is technically impure — `performance.now()` in
   the render body (`:328`).
3. **`useStickToBottom` scrolls on every render** (no dep array,
   `useStickToBottom.ts:29-34`) while `EventTraceConsole` re-renders the
   full feed and `PacketMonitor` 150 rows (`PacketMonitor.tsx:63`) twice
   a second. Lists are capped, so virtualization isn't required — but the
   caps deserve a comment.
4. **Sprite keys use array index** — `PacketLayer.tsx:372`
   `` key={`${s.seq}-${s.dir}-${i}`} ``; sprites are spliced mid-list
   (`:261, :287, :298, :305`), so keys shift and React remounts DOM
   nodes unnecessarily. Give each sprite a stable id.
5. Polling never backs off when the backend is down
   (`useStatusPolling.ts:37-43`) and doesn't pause on
   `document.hidden`; `TransferConfigCard.tsx:89` doesn't clear its
   SAVED-flash timeout on unmount (harmless in React 18).

Cleanup discipline is solid everywhere else (wheel listener with
`{passive:false}` `TopologyCanvas.tsx:175-176`, `ResizeObserver` `:156`,
rAF `PacketLayer.tsx:324`, poll `cancelled` flag `useStatusPolling.ts:44-47`,
keydown `useNodeSelection.ts:17-18`, interval `NodeInspector.tsx:110-113`).

### 3.3 Type safety

**Zero `any` in the entire frontend; strict mode on.** Issues:

1. Unsound `as Config` casts store strings into numeric fields while the
   form is dirty (`TransferConfigCard.tsx:39-43`); validation coerces back
   (`:50-67`) so it works — a `ConfigDraft` type with string numerics +
   `toConfig()` would remove the lie.
2. `as LeftTab` / `as RightTab` casts because `TabItem.id: string` erases
   the union (`page.tsx:175, 313`) — a generic `Tabs<T extends string>`
   kills both.
3. Parallel type shapes: `LinkStatsView` (`canvas.ts:12-17`) vs
   `LinkStats` (`topology.ts:38-43`) manually mapped at
   `canvas.ts:299-306`; `NodeLogLine` (`topology.ts:104-107`) ≡
   `FeedLine` (`types.ts:104-107`) byte-identical under two names.
4. `DEFAULT_CONFIG` literal (`page.tsx:32-41`) duplicates backend
   defaults without `satisfies Config` — it can silently drift.
5. `stateTone as "cyan" | …` cast (`TransferDock.tsx:204`);
   `MODE_LABEL: Record<string, string>` untyped
   (`PathSwitchHud.tsx:26`) — should be keyed by
   `SchedulerState["mode"]` as `StatsTab.tsx:11` does correctly.

### 3.4 Accessibility & UX

1. **Canvas is mouse-only** — node `<g>` elements (`TopologyCanvas.tsx:
   497-556`) have `onClick` but no `tabIndex`/`role`/`onKeyDown`, and the
   parent `<svg role="img">` (`:397-398`) tells AT to treat the whole
   canvas as a single image, hiding the interactive children entirely.
   (Escape-to-deselect works: `useNodeSelection.ts:13-19`.)
2. **Icon-only buttons use `title`, not `aria-label`** — zoom controls
   (`TopologyCanvas.tsx:564-587`), TopBar toggles (`TopBar.tsx:39-70`),
   log refresh (`NodeInspector.tsx:308-315`), resume dismiss
   (`TransferDock.tsx:229-236`). Good exceptions: backdrop close
   (`page.tsx:328`), resize handle (`PanelResizeHandle.tsx:53-55`),
   `Toggle` uses `role="switch"` correctly (`ui.tsx:238-239`).
3. **No `prefers-reduced-motion` anywhere** (zero hits) — rAF packet
   animation, hold-pulse SMIL (`PacketLayer.tsx:391-396`) and
   `.status-pulse` (`globals.css:39-52`) all run unconditionally. The
   existing slow-mo control makes a fix small.
4. **Mobile hides key demo controls** — RoutePicker island `hidden
   md:block` (`page.tsx:282`), zoom controls `hidden md:flex`
   (`TopologyCanvas.tsx:563`), legend `:310`; wheel-only zoom
   (`:160-177`, no pinch). On a phone you cannot pick a route or zoom.
5. Tabs use `aria-pressed` rather than `tablist/tab/tabpanel` (`ui.tsx:
   351`); progress bars lack `role="progressbar"`/`aria-valuenow`
   (`TransferDock.tsx:183-194`, `StatsTab.tsx:51-57`).
6. Path-state language is partly colour-only ("optimal vs candidate" is
   pure hue; "restricted" at least also gets a dash pattern, and the
   legend at `TopologyCanvas.tsx:310-333` helps).

### 3.5 Testing

**No frontend test of any kind** — no `*.test.*`/`*.spec.*` files, no
jest/vitest/playwright/cypress in `package.json`. Only gates are
`next lint` and `tsc` via `next build`. Backend has 119 tests; frontend
has 0. Cheap to fix: `lib/canvas.ts`, `lib/logClassify.ts`,
`lib/format.ts`, `lib/topology.ts`, `lib/testingScenarios.ts` are pure
and testable with vitest in minutes, no DOM needed.

---

## 4. Prioritized action list

### P0 — protects the demo (do first)

| # | Item | Where | Effort |
|---|---|---|---|
| 1 | Wrap `self._handle(...)` in `try/except OSError` so disk errors can't leave a zombie `running` receiver; surface `discard_partial` errors instead of spinning | `udp/server.py:109-135, 218-221`; `udp/resume_fs.py:66-72` | S |
| 2 | Verify END completeness + validate END `seq`; pin session peer address (multipath-aware) | `udp/server.py:138-184` | S |
| 3 | Move `topology.start_all()/stop_all()` outside `with self._lock`; add timeouts to child joins | `transfer/manager.py:149-196, 204-210`; `topology/manager.py:341-344` | M |
| 4 | Parallelize per-child `refresh_stats` in `snapshot()` | `topology/manager.py:501-507` | S |
| 5 | Fix the structural flake (seed `random` or adopt the `test_checksum.py` retry harness) | `tests/test_retransmission.py:12` | S |
| 6 | Add FastAPI lifespan/shutdown hook calling `manager.stop_server()` | `main.py` | S |

### P1 — clear quality wins

| # | Item | Where | Effort |
|---|---|---|---|
| 7 | Memoize `buildCanvasGraph`; move `getBoundingClientRect` out of render into effect/ResizeObserver state | `TopologyCanvas.tsx:83, 140-148, 234-248` | M |
| 8 | Skip `/api/topology` poll when the flag is off; shallow-compare before `setState` | `useStatusPolling.ts:24-33` | S |
| 9 | ACK-origin validation (`recvfrom` + known-lane check) and a lock/snapshot for `PathScheduler.state()` | `udp/client.py:315`; `udp/scheduler.py:137-167` | S |
| 10 | De-scope `_on_resume` O(N) replay from the lock (batch, or one summary event above ~1000 packets) | `transfer/manager.py:365-381` | S |
| 11 | Add 5–10 vitest tests for pure lib math (`schedulerLaneStates`, `laneStates`, `buildCanvasGraph` lane mapping, `logClassify`, `format`) | `frontend/lib/*` | S |
| 12 | Fix canvas a11y: drop `role="img"`, `tabIndex` + Enter/Space on nodes; `aria-label` pass on icon buttons; `prefers-reduced-motion` hook defaulting `animSpeed` | `TopologyCanvas.tsx:397-398, 497-556, 564-587`; `TopBar.tsx:39-70`; `app/page.tsx:62-78` | M |
| 13 | RTT-adaptive retransmission timer from the sRTT you already compute (RFC 6298 style) | `transfer/stats.py:13-45` → `udp/client.py:141` | S |
| 14 | Stable sprite keys + extract `posAlong`/`buildTimings` to `lib/anim.ts` (enables #11) | `PacketLayer.tsx:75-119, 372` | S |

### P2 — polish / maintainability

| # | Item | Where | Effort |
|---|---|---|---|
| 15 | Delete finished uploads + sweep `transfers/uploads/`; de-collide received filenames (second-resolution `strftime`) | `api/endpoints/transfer.py:25-36`, `manager.py:383-395`, `server.py:242` | S |
| 16 | Merge the two client retry loops; extract `_resolve_probs(...)`; split `TransferManager` counters into a dataclass | `udp/client.py:220-297`; 6 call sites; `manager.py:69-97, 414-441` | M |
| 17 | `NodeHandle` Protocol/ABC unifying `Forwarder` and `ProcessHandle` | `topology/manager.py:326, 505`; `process_node.py:1-17` | S |
| 18 | Deduplicate frontend helpers (picker options, scheduler-mode maps, `laneLetter`, `percent`, one `useFlagTransitions` hook) | see §3.1 table | M |
| 19 | Remove dead code (`Input`, terminal variant, `headerRight`, tab wrappers) + fix AGENTS.md z-index/toast drift | see §3.1 | S |
| 20 | Type fixes: `ConfigDraft`, generic `Tabs<T>`, `satisfies Config`, typed `MODE_LABEL` | see §3.3 | S |
| 21 | Centralize test save/restore into one autouse fixture; dedupe `_wait_finished`/`_received_bytes` | `backend/tests/*` | M |
| 22 | Mobile route picking + pinch-zoom | `page.tsx:282`; `TopologyCanvas.tsx:160-177` | M |
| 23 | Concurrency tests: double-start, preset-switch-during-start, topology responsiveness during spawn/stop | `backend/tests/` | M |
| 24 | Poll hygiene: stop looping on `document.hidden`, show backend error once until reconnect | `useStatusPolling.ts:37-47` | S |

**Suggested work packages** (each independently shippable, each runs the
full gate set):

- **A. Backend reliability** — P0 items 1–6 (+ P1 #9/#10).
- **B. Frontend performance** — P1 items 7–8, 14.
- **C. Tests + a11y** — P1 items 11–12 (+ P2 #23 for backend concurrency
  tests).
- **D. Demo polish** — P1 #13, P2 items 15–20, 24.

Gates for every package (from `AGENTS.md`):
`pytest tests -q` → 119 passed, `smoke_topology.ps1` → SMOKE PASS,
`npm run lint` / `npm run build` / `tsc --noEmit --noUnusedLocals
--noUnusedParameters` clean. Re-run the flaky retransmission test in
isolation until item 5 is done.
