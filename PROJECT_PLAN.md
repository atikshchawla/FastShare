# FastShare — Project Plan & Build Log

Implementation plan for **FastShare — Reliable File Transfer over UDP**
(university Computer Networks project).

## Academic scope (current phase)

> "The implementation and testing phase. UDP client-server communication, file
> packetization, sequence numbers, ACK mechanism, and basic retransmission have
> been completed. Checksum verification, resume functionality, and transfer
> statistics are currently in progress."

**Update — all three roadmap features are now implemented** (see
`IMPLEMENTATION_ROADMAP.md`):

- Checksum verification — CRC-32 in the 13-byte wire header, enforced on
  inbound DATA and ACKs, corruption simulator in both directions
- Resume functionality — `.part` + `.part.meta` sidecar on the receiver,
  START handshake negotiates the resume point, dashboard Resume / Start over
- Transfer statistics — RTT/SRTT (EWMA), goodput, wire throughput, loss %,
  CRC error count, ETA

**Update — multi-server topology is now implemented** (spec + WBS in
`FEATURE_SPEC_MULTI_SERVER_TOPOLOGY.md`, all 5 phases DONE):

- 7-node extended-star preset of real UDP endpoints (ports 6101–6107),
  BFS route selection, per-hop forwarders with configurable latency and the
  existing loss/corruption simulation, end-to-end reliability unchanged
- `GET /api/topology` + `source`/`dest` on `/api/transfer/start`, feature
  flags `topology_enabled` / `topology_latency_ms`
- Dashboard: SVG topology map with highlighted route and live per-link
  counters, source/destination pickers, classic hero when the flag is off
- 42 topology tests + `scripts/smoke_topology.ps1` E2E smoke
  (cancel → resume over 4 hops, SHA-256 identical)

**Update — multi-path UDP is now implemented** (spec + WBS in
`FEATURE_SPEC_MULTIPATH.md`, all 5 phases DONE):

- Per-PC isolation: every forwarder can run as its own OS process
  (`node_main.py` child, JSON-lines control/log protocol) with per-node
  log rings + `GET /api/topology/node/{id}/logs` and a NODE-tab console
- Tri-path preset (ports 6201–6208): three node-disjoint lanes A/B/C,
  switchable presets (`POST /api/topology/preset`), multi-lane route
  preparation in `prepare_transfer`
- Source-side adaptive scheduler (`udp/scheduler.py`): explore → rolling
  100-window → flag ≥ 20 % loss → weighted shift with 10 % probe share,
  hysteresis below 10 %; surfaced as `status.scheduler`
- UI: tri canvas layout with lane-coloured links, lane-aware packet dots,
  CONFIG preset/policy controls, STATS path-scheduler panel, path badges
- 23 new tests (118 total)

**Rule: correctness first.** The reliable-transfer pipeline must be demonstrable
before any of the in-progress features are completed. Nothing unfinished is
shown as finished in the UI.

---

## Phase-by-phase build log

### Phase 1 — Scaffolding
- Next.js + TypeScript + Tailwind frontend (`frontend/`)
- FastAPI controller (`backend/main.py`, `backend/api`)
- Python UDP server + client skeleton (`backend/udp`)

### Phase 2 — UDP communication
- `udp/client.py` — connected UDP socket, send/recv loop
- `udp/server.py` — bound receiver socket, per-transfer session state

### Phase 3 — Packetization & sequence numbers
- Binary wire format (no JSON on UDP): `seq(4) | type(1) | len(4) | crc32(4) | payload`
  (9 bytes originally; +4-byte CRC-32 with the checksum feature → 13-byte header)
- `udp/protocol.py`, `udp/packet.py` — `build_packet` / `parse_packet`
- DATA packets carry monotonic sequence numbers `1..N`

### Phase 4 — ACK mechanism (Stop-and-Wait)
- Server ACKs every valid DATA packet (`ACK #N` for `DATA #N`)
- Client sends the next packet only after the previous ACK arrives
- Window size is locked to `1` (sliding window = future work)

### Phase 5 — Timeout & retransmission
- Per-packet timeout (default 500 ms), `MAX_RETRIES` budget
- Lost packet → `TIMEOUT` → `RETRANSMITTED` → keeps going until ACKed

### Phase 6 — Duplicates & loss simulation
- Receiver detects `seq < expected` → re-ACK, never writes twice
- Duplicate END after finalize → re-ACK (fixed a real crash here)
- Testing layer drops incoming DATA (server side) and ACKs (client side)

### Phase 7 — Controller wiring
- `transfer/manager.py` is the single source of truth (state, stats, packet log)
- HTTP API: `/api/status`, `/server/start|stop`, `/transfer/start|cancel|status`,
  `/transfer/packets`, `/testing/config`
- Browser uploads the file; manager launches the UDP client in a thread

### Phase 8 — Packet monitor & transfer visualization
- Live table (Sequence / Type / Size / Status / Retries)
- Sender ⇄ Receiver handshake animation driven by real sequence numbers
- Protocol trace with color-coded LOST / TIMEOUT / DUPLICATE / COMPLETE lines

### Phase 9 — Tests
- `tests/test_packet.py` — serialization, START metadata, sanitization
- `tests/test_transfer.py` — packetization, sequence numbers, ACK coverage,
  duplicate handling, SHA-256 file equality (real loopback UDP)
- `tests/test_retransmission.py` — loss → timeout/retransmit, retry limit,
  high-loss survival

### Phase 10 — Polish
- README + this project plan
- Dark, technical dashboard styling

### Phase 11 — Cleanup & multi-server topology
- Controller split: `api/routes.py` → `api/endpoints/*` (+ `uploads.py`);
  frontend `useTransfer` → `useStatusPolling` / `useFileSelection` /
  `useResume` / `useTransferActions`
- `transfer/topology/graph.py` — preset + BFS; `forwarder.py` — real socket
  per node (delay queue, loss/corruption, per-link counters);
  `manager.py` — route config, receiver rebind, `/api/topology` snapshot
- `TopologyView.tsx` + `TopologyRouteCard.tsx` wired into the hero slot
- End-to-end smoke script `scripts/smoke_topology.ps1`

### Phase 12 — UI revamp: canvas dashboard + per-node config
- Shell rewrite: `TopBar` (status/file/progress/START-CANCEL/resume toast),
  always-on `TopologyCanvas` (2-node when `topology_enabled` is off,
  7-node star when on), tabbed `SidePanel` (STATS/PACKETS/LAB/CONFIG);
  shared primitives in `ui.tsx`; ~11 legacy components deleted
  (`Header`, `TransferVisualization`, `TransferControlCard`,
  `FileSelectionCard`, `SettingsModal`, `ConnectionStatusCard`,
  `SetupSteps`, `ProtocolPanel`, `TransferProgress`, `TopologyView`,
  `TopologyRouteCard`)
- `PacketLayer.tsx` — event-driven DATA/ACK sprites animated along the
  route from the existing 500 ms poll (travel/hold/timeout/retransmit,
  segment times proportional to link latency)
- Per-node config: `NodeConfig` model + `POST /api/topology/node/config`,
  `_node_overrides` in `TopologyManager` (precedence over `start_all()` /
  `patch_testing()`), `nodes[].config` in the snapshot, `NodeInspector`
  floating card + NODE tab (`topology` types/API/actions wired)
- Gates: pytest **95 passed** (+7 node-config tests), smoke PASS,
  `npm run lint` + `npm run build` clean

### Phase 13 — Multi-path UDP: per-PC isolation, tri-path, adaptive scheduler
- Per-PC isolation: every forwarder can run as its own OS process
  (`transfer/topology/node_main.py` child entry, JSON-lines stdin/stdout
  protocol) behind `ProcessHandle` (`process_node.py`), which duck-types
  the `Forwarder` surface; `TopologyManager._ensure_handles()` picks the
  flavour from `topology_isolated` (default True in the controller,
  in-process in tests), spawns children in parallel and pulls exact stats
  for the snapshot
- Per-node logs: `Forwarder.log_sink` events → 1000-line ring per node →
  `GET /api/topology/node/{id}/logs` → console in the NODE tab
- Tri-path preset (`graph.py`): 8 nodes on ports 6201–6208, three
  node-disjoint lanes A/B/C from `all_paths()`; `PRESETS` registry +
  `set_preset()` + `POST /api/topology/preset` (refused mid-transfer);
  multi-lane `prepare_transfer` configures every lane's interior hops and
  returns `lanes` entries; snapshot exposes `preset/presets/paths/multipath`
- Source-side scheduler (`udp/scheduler.py`): explore round-robin →
  round-robin → rolling 100-window flag ≥ 20 % loss → weighted shift with
  10 % probe share, hysteresis below 10 %; client picks a lane per attempt
  over an unconnected socket, ACKs mirror the DATA lane, `lane` lands on
  packet entries and `state()` in `/api/status.scheduler`
- Policy API: `POST /api/topology/multipath/config` (bounded pydantic patch)
- Frontend: tri layout + lane-coloured links/legend (`canvas.ts`,
  `TopologyCanvas`), lane-aware packet animation (`PacketLayer`),
  CONFIG topology panel (preset selector + flag/probe/window controls),
  STATS path-scheduler panel (per-lane loss bars, FLAG badges),
  NODE log consoles, `N paths` badge in the route picker
- Gates: pytest **118 passed** (+23: isolation 5, presets 8, multipath 10),
  smoke PASS, `npm run lint` + `npm run build` + strict `tsc` clean

### Phase 14 — Tri-first defaults + adaptive colour language + slow-mo viz

- Default preset switched to **tri-path** (`PRESETS["tri"]`,
  `DEFAULT_SOURCE/DEST` → `src`/`dst`); star-oriented test fixtures
  normalize via `set_preset("star")`, smoke pins star then restores tri
- New `test_default_preset_is_tri_path` (fresh manager boots on tri,
  ports 6201–6208, catalog order unchanged)
- Frontend path-state colours (replaces fixed lane hues): **green
  optimal / blue candidate / red dashed restricted** on links, tri router
  borders (down = red), packet dots, HUD timeline strip and scheduler
  panel swatches; ACK dots white; flag/recover flash banner
- Adaptive-switch visuals: slow-mo anim control (`fastshare:anim-speed`,
  ¼×/½×/1×), `PathSwitchHud` (share/loss bars + pick timeline with ▼/▲
  carets), lane letter on DATA dots
- Gates: pytest **119 passed**, smoke PASS, `npm run lint` +
  `npm run build` + strict `tsc` clean

---

## Networking concepts → where implemented

| Concept                 | Location                                     |
| ----------------------- | -------------------------------------------- |
| Packet structure        | `backend/udp/protocol.py`, `udp/packet.py`   |
| Stop-and-Wait state     | `backend/udp/client.py` (`_send_data_packet`)|
| ACK emission            | `backend/udp/server.py`, `_handle`/`_send_ack` |
| Duplicate handling      | `backend/udp/server.py` (`seq < expected`)   |
| Loss simulation         | `server.loss_probability`, `client.ack_loss_probability` |
| Stats / packet log      | `backend/transfer/manager.py`, `stats.py`, `event_log.py` |
| HTTP API                | `backend/api/routes.py` → `api/endpoints/*`   |
| CRC-32 checksum         | `backend/udp/protocol.py` (`checksum`, `parse_packet`) |
| Resume (`.part`/`.meta`)| `backend/udp/server.py`, `udp/resume_fs.py`   |
| Topology preset + BFS   | `backend/transfer/topology/graph.py`          |
| Per-hop forwarding      | `backend/transfer/topology/forwarder.py`      |
| Route/rebind/snapshot   | `backend/transfer/topology/manager.py`        |
| Per-PC isolation        | `transfer/topology/node_main.py`, `process_node.py` (`topology_isolated`) |
| Multi-path lanes        | `graph.py` (`all_paths`), `manager.py` (`prepare_transfer` → `lanes`) |
| Path scheduler          | `backend/udp/scheduler.py` + `udp/client.py` (per-attempt lane pick) |
| Topology API + UI       | `api/endpoints/topology.py`, `components/TopologyCanvas.tsx` + `NodeInspector.tsx` |
| Multipath UI            | `components/tabs/ConfigTab.tsx` (preset/policy), `tabs/StatsTab.tsx` (scheduler), `PacketLayer.tsx` (lane dots) |
| Dashboard               | `frontend/components/*`, `frontend/hooks/useTransfer.ts` |

---

## Definition of Done (current phase)

- [x] Next.js dashboard works
- [x] Python UDP server works
- [x] Python UDP client works
- [x] Files can be packetized
- [x] Sequence numbers are attached
- [x] Server recognizes sequence numbers
- [x] Server sends ACKs
- [x] Client waits for ACK
- [x] Timeout is implemented
- [x] Lost packets are retransmitted
- [x] Duplicate packets are handled
- [x] Packet loss can be simulated
- [x] UI displays actual transfer progress (ACK-driven)
- [x] UI displays packet activity
- [x] UI displays ACK activity
- [x] UI displays retransmissions
- [x] A transferred file matches the original (SHA-256 verified)
- [x] Testing scenarios can be demonstrated
- [x] README explains architecture and implementation
- [x] No unfinished feature is falsely shown as completed
- [x] CRC-32 checksum verification (drop corrupted packets, retransmit)
- [x] Resume of interrupted transfers (`.part` + `.meta`, survives restart)
- [x] Advanced statistics (RTT/SRTT, goodput, throughput, loss %, ETA)
- [x] Multi-server topology: fixed 7-node extended star, BFS route, per-hop
      forwarders (latency + loss, no per-hop ARQ), end-to-end reliability
- [x] Topology UI: route highlighting + live per-link stats; flag off renders
      the two-node canvas, flag ON the 7-node star (canvas is always on)
- [x] Topology E2E smoke: 4-hop cancel → resume → SHA-256 identical
      (`scripts/smoke_topology.ps1`)
- [x] Canvas-first dashboard: always-on topology canvas, animated packet
      dots from the 500 ms poll, tabbed side panel (no page scroll)
- [x] Per-node config: node inspector + NODE tab →
      `POST /api/topology/node/config` (latency/loss/corruption/enabled,
      override wins over later global applies)
- [x] Per-PC isolation: each hop runs in its own OS process with a
      JSON-lines control/log protocol; per-node log API + NODE console
      (`topology_isolated`, default on in the controller)
- [x] Multi-path: tri preset with 3 node-disjoint lanes, runtime preset
      switching, source-side scheduler (explore → flag ≥ 20 % loss →
      weighted shift + 10 % probe, hysteresis), lane-aware UI

## Not in scope yet (do not implement now)

Authentication, accounts, databases, cloud deployment, Redis, encryption, P2P,
multi-user, sliding window, congestion control, user-defined topologies /
graph editor, per-hop ARQ, advanced analytics, mobile app.

---

## Test inventory (current: 119 passing)

Run from `backend/`: `python -m pytest tests -q`

| File                            | Verifies                                              |
| ------------------------------- | ----------------------------------------------------- |
| `tests/test_packet.py`          | wire format, 13-byte header, CRC-32, START/RESUME metadata, filename safety |
| `tests/test_transfer.py`        | packetization, sequence numbers, ACK coverage, duplicates, end-to-end SHA-256 |
| `tests/test_retransmission.py`  | loss → timeout/retransmit, 30%/50% loss survival, retry limit, size integrity |
| `tests/test_checksum.py`        | corruption on DATA/ACK/START → CRC drop → retransmit, hash still matches |
| `tests/test_stats.py`           | RTT/SRTT/goodput/throughput/loss/ETA from real transfers |
| `tests/test_resume.py`          | cancel → resume at #K+1, restart survival, start-over, manager resume API |
| `tests/test_api.py`             | controller JSON contract incl. testing + resume endpoints |
| `tests/test_topology_graph.py`  | preset integrity, BFS routes (1/2/4 hops), same-node/unknown-id rejection |
| `tests/test_topology_forwarder.py` | forwarder latency/loss/counters on loopback, route-less drop, port release |
| `tests/test_topology_api.py`    | `/api/topology` shape, flags, node validation, applied-latency reporting, per-node config (patch/precedence/reset/400) |
| `tests/test_topology_transfer.py` | 4-hop `l1→l3` byte equality, resume across hops, topology-off regression |
| `tests/test_topology_isolation.py` | isolated child spawn/ready/stop (no orphan ports), config visible in child node logs, logs endpoint, child death → self-heal, E2E over isolated hops |
| `tests/test_topology_presets.py`  | preset catalog/paths in snapshot, default-preset-is-tri, `POST /topology/preset` switch/400, all 9 tri links carry traffic, mid-transfer refusal |
| `tests/test_multipath.py`         | PathScheduler unit (seeded explore/flag/shift/hysteresis), multipath config endpoint, lossy-lane flag → shift → byte-identical E2E, multipath-off regression, star single-mode E2E |