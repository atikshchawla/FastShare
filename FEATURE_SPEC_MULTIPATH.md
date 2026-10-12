# Feature Spec — Multi-Path UDP (per-PC isolation, tri-path, adaptive scheduler)

## 1. Goal

Extend the multi-server topology teaching tool with **multiple alternative
source → destination paths** and a **source-side adaptive scheduler**:

- the preset graph offers three node-disjoint lanes (paths A/B/C),
- every forwarder ("hop") runs as **its own OS process** — a per-PC
  simulation with per-node logs,
- the sender spreads Stop-and-Wait transmissions across the lanes and
  **shifts traffic away from a lane whose rolling loss crosses a
  threshold**, keeping a small probe share so the lane can recover,
- the dashboard shows lanes, lane health and the node log consoles.

Reliability stays end-to-end (no per-hop ARQ) and the 13-byte wire format
does not change: ACKs simply mirror back on the same lane the DATA took,
and lane attribution comes from the sender's own path choice.

## 2. Locked decisions (from review)

1. **Source-side scheduler** — the client picks the lane per transmission:
   explore round-robin → rolling 100-attempt window per lane → flag a lane
   at ≥ 20 % window loss → weighted shift to healthier lanes with a ~10 %
   probe share on flagged ones; recovery below 10 % (hysteresis).
2. **Tri preset = 3 lanes × 2 routers** — node-disjoint except at the
   endpoints, ports **6201–6208** (disjoint from the star's 6101–6107 so
   both graphs coexist with a receiver bound on either side).
3. **Presets are switchable in CONFIG** — `star` ↔ `tri` at runtime,
   refused while a transfer is running (the forwarder processes are torn
   down and rebuilt).
4. **Each hop = its own OS process + per-node logs API/UI** —
   `topology_isolated` config (default **True** in the controller;
   tests force in-process for speed), JSON-lines stdin/stdout protocol,
   `GET /api/topology/node/{id}/logs` + a console in the NODE tab.

## 3. Architecture

```
 Next.js dashboard ──HTTP/JSON── FastAPI controller ──┬── UDPClient (lanes: A/B/C)
   ConfigTab: preset + policy                        │        │ sendto(lane entry)
   StatsTab:  path scheduler panel                   │        │ ACK mirrors same lane
   NODE tab:  per-node log console                   │        ▼
                                                      │   child proc: src      (6201)
                                                      ├── child proc: a1/a2/b1/b2/c1/c2
                                                      └── child proc: dst      (6208)
                                                          one `python -m transfer.topology.node_main`
                                                          per node — real UDP socket, per-link
                                                          latency/loss/counters, log_sink events
```

### New/changed backend modules

| Module | Role |
| --- | --- |
| `transfer/topology/node_main.py` | child entry: one `Forwarder` per process; JSON-lines stdin (`configure/route/clear_route/reset_stats/stats/shutdown`, tagged) → stdout (`ready/log/stats/ack/error`); stats pushed every 250 ms; exits on shutdown or stdin EOF |
| `transfer/topology/process_node.py` | `ProcessHandle` duck-types the `Forwarder` surface (start/stop/set_route/link_stats/…), spawns + reaps the child, request-reply with tags, caches config+route for respawn, dispatches `log` lines into the parent ring |
| `transfer/topology/forwarder.py` | `log_sink` hook + `_handle` log lines (forward, drop, stranger, loss, CRC) |
| `transfer/topology/manager.py` | `_ensure_handles()` (in-process vs isolated, keyed by preset+flag), parallel spawn in `start_all()`, per-node 1000-line log rings, `node_logs()`, `set_preset()`, `paths_for()`, `preset_catalog()`, `multipath_config()`, exact stats refresh in `snapshot()` |
| `transfer/topology/graph.py` | `PRESET_TRI_PATH`, `all_paths()` (DFS, sorted by length → lanes A, B, C), `PRESETS` registry |
| `udp/scheduler.py` | `PathScheduler` (pure stdlib, no cycles) |
| `udp/client.py` | `lanes` + `multipath` params; unconnected socket + `sendto()` per attempt when >1 lane and policy on; scheduler pick/record around every START/DATA attempt; `_mark(..., lane=)` entries; `PATH A flagged …` feed lines |
| `transfer/manager.py` | passes `lanes`/`multipath` into the client; `status_snapshot()["scheduler"]` |

### IPC protocol (controller ⇄ node child)

stdin (one JSON object per line, `tag` echoed back):

```json
{"cmd": "configure", "tag": 7, "latency_ms": 10, "loss": 0.05, "corrupt": 0.0}
{"cmd": "route", "tag": 8, "route": ["src", "a1", "a2", "dst"]}
{"cmd": "stats", "tag": 9}
{"cmd": "shutdown"}
```

stdout: `{"event": "ready"}` on bind, `{"event": "log", "text": "…"}`,
`{"event": "stats", "data": {...}}` (periodic + on request),
`{"event": "ack", "tag": 7}` / `{"event": "error", ...}` for replies.

## 4. Preset: tri-path (8 nodes, ports 6201–6208)

```
        ┌── PATH A ── a1 ── a2 ──┐
 src ───┼── PATH B ── b1 ── b2 ──┼─── dst
        └── PATH C ── c1 ── c2 ──┘
```

- Nodes: `src` (source), `a1,a2,b1,b2,c1,c2` (router), `dst` (dest).
- Lanes = all simple paths src → dst, sorted by hop count → A, B, C
  (3 hops each, node-disjoint except the endpoints).
- **Tri-path (`tri`) is the default preset** — a fresh controller boots on
  it (`DEFAULT_SOURCE/DEST = src/dst`), making it the flagship topology.
  The extended star (`star`, l1..l4/ch1/ch2/hub) stays one `set_preset`
  away; `all_paths` yields exactly one lane for star picks.

## 5. Scheduler policy (source-side, per transfer)

| Mode | When | Behaviour |
| --- | --- | --- |
| `explore` | first `explore_per_lane` (10) attempts **per lane** | round-robin — fresh view before judging |
| `round_robin` | no lane flagged | even split while the rolling windows fill |
| `weighted` | any lane flagged | flagged lanes share `probe_share` (10 %) of attempts; healthy lanes split the rest weighted by `1 - window_loss` |
| `single` | one lane only (star picks) | always that lane |
| `disabled` | policy off | lane 0 / route only |

- Rolling window: last **100** attempts per lane (`window`, 4–10000).
- Flag: `window_loss ≥ 0.20` after `min_samples` (default `window/4`, ≥ 2)
  → **FLAGGED** (feed line `PATH A flagged at 21% loss → shifting traffic…`).
- Hysteresis: recovery only below `window_loss < 0.10` → no flapping.
- Every attempt is recorded (`record(lane, acked)`), including retransmits —
  each retransmission re-picks a lane, so recovery is immediate.
- The policy is read when the transfer starts (client construction).

## 6. API contract

### `GET /api/topology` (extended)

```json
{
  "enabled": true, "nodes": [...], "links": [...], "route": ["src","a1","a2","dst"],
  "source": "src", "dest": "dst", "link_stats": {...},
  "preset": "tri",
  "presets": [{"id": "star", "label": "Extended star", "source": "l1", "dest": "hub"},
              {"id": "tri",  "label": "Tri-path (3 lanes)", "source": "src", "dest": "dst"}],
  "paths": [["src","a1","a2","dst"], ["src","b1","b2","dst"], ["src","c1","c2","dst"]],
  "multipath": {"enabled": true, "window": 100, "flag_loss": 0.2, "recover_loss": 0.1,
                "probe_share": 0.1, "explore_per_lane": 10, "min_samples": 25}
}
```

`nodes[].role` gains `source | dest | router` for the tri preset.

### `POST /api/topology/preset` — `{"name": "tri"}`

→ `{"ok": true, "preset": "tri", "source": "src", "dest": "dst", "nodes": [...]}`.
400 for an unknown name or while a transfer is running.

### `POST /api/topology/multipath/config` — partial patch

Fields: `enabled, window (4–10000), flag_loss (0.05–0.90),
recover_loss (0–0.5), probe_share (0–0.5), explore_per_lane, min_samples`;
omitted/`null` = keep. → `{"ok": true, "config": {...full policy...}}`.

### `GET /api/topology/node/{id}/logs?limit=200`

→ `{"node": "a1", "lines": [{"t": 1728.4, "text": "…"}]}` (oldest first,
ring of 1000). 400 for an unknown node id.

### `GET /api/status` (extended)

- `scheduler`: `null` before the first transfer, else
  `{mode, enabled, window, flag_loss, recover_loss, probe_share,
  lanes: [{lane, name, sent, lost, attempts, window_loss, flagged, weight}]}`.
- packet entries gain `lane` (0-based, absent when single-path) and
  `rtt_ms` on ACKED.

## 7. Frontend

| Piece | Where |
| --- | --- |
| Types (`TopologyRole` + source/dest/router, preset/presets/paths/multipath, `SchedulerState`, `NodeLogsResponse`, `PacketEntry.lane`) | `lib/topology.ts`, `lib/types.ts` |
| API: `setPreset`, `multipathConfig`, `nodeLogs` | `lib/api.ts` |
| Tri layout (`TRI_POS`), lane→link map, `laneIds`/`lanePath`, **path-state colour language** (green optimal / blue candidate / red restricted, `laneStates`) | `lib/canvas.ts` |
| State-coloured links (weight → width, flagged → red dashed + flash banner), state-coloured tri router borders, preset mode chip, state legend | `components/TopologyCanvas.tsx` |
| Packet dots follow their path's state colour (lane letter next to each DATA dot; white ACK returns on the same lane) | `components/PacketLayer.tsx` |
| Slow-mo animation speed (`speed` prop: ¼×/½×/1×, visual only, capped DATA sprites while slow) | `components/PacketLayer.tsx` |
| Path-switching HUD: anim speed control, mode badge, state-coloured per-lane share/loss bars, pick-timeline strip with flag/recover carets | `components/PathSwitchHud.tsx` |
| Preset selector + multipath policy controls (toggle, flag %, probe %, window) | `components/tabs/ConfigTab.tsx` |
| Path scheduler panel (state-coloured swatches, loss bars, weight, FLAG badge, mode hint) | `components/tabs/StatsTab.tsx` |
| Per-node log console (2 s poll + manual refresh) | `components/NodeInspector.tsx` (NODE tab variant) |
| `N paths` badge (violet = scheduler on) | `components/RoutePicker.tsx` |

## 8. Non-goals (later phases)

Per-hop ARQ, dynamic/adaptive probe rates, congestion control, reordering of
out-of-order delivery (Stop-and-Wait keeps it in order), user-defined
graphs, cross-flow scheduling, bandwidth-based weights.

## 9. Definition of done

- [x] Each hop runs as its own OS process when `topology_isolated` (no
      orphan children or leaked ports after `stop_all`/`set_preset`)
- [x] Per-node logs: ring buffer + `GET .../node/{id}/logs` + NODE console
- [x] Tri preset with 3 node-disjoint lanes; presets switchable via API/UI
- [x] All lanes prepared (route + per-hop latency/loss), snapshot exposes
      `paths`/`presets`/`multipath`
- [x] Source-side scheduler: explore → round-robin → flag ≥ 20 % → weighted
      + 10 % probe, hysteresis at 10 %; `state()` surfaced in `/api/status`
- [x] Client multipath: unconnected socket, per-attempt lane pick, ACK
      mirrors the DATA lane, `lane` on packet entries, feed lines
- [x] E2E: lossy lane flagged → traffic shifts → file byte-identical;
      multipath-off keeps the route; star behaves as before
- [x] UI: tri layout, lane colours, lane-aware packet animation, preset +
      policy controls, scheduler panel, node consoles, path badge
- [x] Gates: pytest **119 passed**, `smoke_topology.ps1` PASS,
      `npm run lint` + `npm run build` + strict `tsc` clean

## 10. Work breakdown (step-by-step)

### Phase 1 — Per-PC isolation + logs — DONE (100 passed, SMOKE PASS)

`Forwarder.log_sink` + `_handle` log lines; `node_main.py`; `ProcessHandle`
(config attrs → pipe, tagged request/reply, respawn re-apply, reader-thread
log dispatch); `TopologyManager._ensure_handles()` / log rings /
`node_logs()` / parallel spawn / `refresh_stats()`; `topology_isolated`
default True (missing key ⇒ in-process); conftest forces in-process;
`GET /api/topology/node/{id}/logs`; `tests/test_topology_isolation.py` (5).

### Phase 2 — Tri preset + multi-route plumbing — DONE (108 passed, SMOKE PASS)

`PRESET_TRI_PATH` + `PRESETS` + `all_paths()`; `set_preset()` with
mid-transfer/unknown guard; multi-lane `prepare_transfer` (`lanes` return,
interior hops of every lane configured); snapshot `preset/presets/paths`;
`POST /api/topology/preset`; `tests/test_topology_presets.py` (8).

### Phase 3 — Scheduler + client multipath — DONE (118 passed, SMOKE PASS)

`udp/scheduler.py`; client `lanes`/`multipath` (unconnected socket,
pick/record per attempt, `lane` entries, feed lines); topology `multipath`
policy + `multipath_config()`; `MultipathConfig` model + endpoint;
`status_snapshot()["scheduler"]`; `tests/test_multipath.py` (10: seeded
unit, endpoint roundtrip, lossy-lane shift E2E, off/still-works regression).

### Phase 4 — Frontend — DONE (lint + build + strict tsc clean)

Types/API/layout/lane graph; lane-coloured canvas + legend + preset chip;
lane-aware `PacketLayer`; CONFIG topology panel (preset + policy); STATS
path scheduler panel; NODE log consoles; RoutePicker path badge.

### Phase 5 — E2E, gates, docs — DONE (118 passed, SMOKE PASS)

Full gate run (pytest, smoke, lint, build, strict tsc), this spec,
README + PROJECT_PLAN + AGENTS.md updates.

### Phase 6 — Visualizing the adaptation — DONE (lint + build + strict tsc clean)

Frontend-only follow-up making the adaptive shift visible: slow-mo
anim control (`fastshare:anim-speed`, ¼×/½×/1×, transport unaffected),
lane health rendered on the paths (weight → width/opacity, flagged →
red dashed), flag/recover flash banner, and the `PathSwitchHud`
(share/loss bars + tick-per-frame pick timeline with ▼ flag carets).
Data comes from the already-polled `status.scheduler` + `t.packets` —
no backend change.

### Phase 7 — Tri-first defaults + state colours — DONE (119 passed, SMOKE PASS)

Backend: `tri` becomes the default preset (`PRESETS["tri"]`,
`DEFAULT_SOURCE/DEST` → `src`/`dst`); star-oriented test fixtures
normalize with `set_preset("star")`, new `test_default_preset_is_tri_path`
(+1 → 119), smoke pins star for its 4-hop scenario then restores tri.
Frontend: fixed lane hues replaced by a path-state colour language —
**green = optimal** (lowest rolling loss), **blue = candidate** (healthy
but not best), **red dashed = restricted** (flagged) — applied to links,
tri router borders (down nodes go red), packet dots, the HUD strip and
the scheduler panel; ACK dots are now white so green stays reserved for
"optimal".
