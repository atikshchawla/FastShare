# Feature Spec — Multi-Server Network Topology (Extended Star)

Status: **IMPLEMENTED — Phases 1–5 complete, UI revamp + per-node config
landed**. Verified: `pytest tests -q` → **95 passed** (46-test baseline +
49 topology tests), `scripts/smoke_topology.ps1` → PASS (l1→l3,
cancel→resume, SHA-256 identical), `npm run build` and `npm run lint` clean.

## 1. Goal

Replace the current single-link CLIENT ⇄ SERVER animation with an
**endpoint-to-endpoint path view**: the user picks a **source computer** and a
**destination computer** inside a fixed extended-star topology of real UDP
endpoints, and the dashboard visualizes the entire route between them —
highlighted links plus **live per-hop statistics** — while the existing
Stop-and-Wait transfer runs end-to-end across the hops.

## 2. Locked decisions (from review)

| Question | Decision |
|---|---|
| Node execution | **Real UDP sockets on one machine.** Every node binds its own port on `127.0.0.1`; links are real sockets with simulated per-link latency. |
| Reliability scope | **End-to-end only.** One Stop-and-Wait session source→destination (existing protocol unchanged). Intermediate nodes forward packets/ACKs; they do **not** run their own ARQ. |
| Visualization | **Highlighted active route + per-hop live stats + packet sprites** (canvas `PacketLayer`, driven by the 500 ms poll). No per-hop event log. |
| Topology | **Fixed preset: extended star** (hub of stars — see §4). No user-defined graph in this phase. |

## 3. Architecture

```
 UI (source/dest pickers + TopologyView)
   │  HTTP (existing FastAPI controller)
   ▼
 TopologyManager ── computes route (BFS), pushes per-hop config
   │                  collects per-link stats
   ▼
 UDPClient (unchanged) ──sends──► hop ──► hop ──► ... ──► destination node
      ▲  (real socket per node: forwarder with latency + counters)
      └──ACKs flow back hop by hop──────────────────────────────┘
```

* **Source endpoint** = the existing `UDPClient` (its socket is the source
  node's identity for this session).
* **Destination endpoint** = the existing `UDPServer`, **re-bound to the
  destination node's port** for the run (rebinding closes the handle only —
  `.part`/`.meta` resume files survive, so resume keeps working across hops).
* **Intermediate nodes** = new `Forwarder` objects: one real UDP socket each,
  forwarding every datagram between their two route neighbours after
  `latency_ms` delay, applying the **existing global testing loss/corruption
  config** (so the TestingPanel scenarios drop packets anywhere on the path),
  and counting traffic per link.
* Protocol untouched: START/DATA/ACK/END, 13-byte CRC header, resume
  handshake — hops are transparent. Hop loss is absorbed by the end-to-end
  retransmission timeout, which is exactly the teaching point.

### New backend modules

```
backend/transfer/topology/
  __init__.py
  graph.py       Node/Link dataclasses, PRESET_EXTENDED_STAR, bfs_route()
  forwarder.py   Forwarder: socket thread, delayed send, loss, link counters
  manager.py     TopologyManager: start/stop all nodes, configure route,
                 rebind receiver to dest port, aggregate stats snapshot
backend/api/endpoints/topology.py   GET /api/topology
```

Existing `udp/client.py`, `udp/server.py`, `transfer/manager.py` stay
behaviour-compatible (the 46-test baseline must keep passing; the only
permitted edits to it are behaviour-preserving ones — the cleanup removed a
dead constant, dropped the now-negotiated `packet_size` argument and made the
probabilistic CRC assertions retry instead of flake).

## 4. Preset: extended star (7 nodes, ports 6101–6107)

```
        L1        L2                    L3        L4
         \        /                      \        /
          CH1 (6103)                   CH2 (6105)
                 \                      /
                  \                    /
                   HUB (6101) — central server
```

* `hub` — 127.0.0.1:6101, role `hub`
* `ch1`, `ch2` — cluster heads (6103, 6105), role `cluster`
* `l1`, `l2` — leaves under CH1 (6102, 6104); `l3`, `l4` — under CH2 (6106, 6107), role `leaf`
* Links: `l1–ch1`, `l2–ch1`, `ch1–hub`, `hub–ch2`, `l3–ch2`, `l4–ch2`
* Each link has `latency_ms` (default **10 ms**, configurable in preset)

Routes (BFS shortest path): leaf→own CH = 1 hop; sibling leaf in the same
cluster = 2 hops (`leaf→ch→leaf`); leaf→hub = 2 hops (`leaf→ch→hub`);
leaf→leaf across clusters = 4 hops (`leaf→ch→hub→ch→leaf`);
any node→itself = rejected (source ≠ destination).

All nodes are selectable as source or destination, including the hub.

## 5. Live per-link statistics

Maintained by forwarders, aggregated by `TopologyManager` per link id:

| Field | Meaning |
|---|---|
| `data_packets` | DATA/START/END packets forwarded toward the destination on this link |
| `ack_packets` | ACK packets forwarded back toward the source |
| `dropped` | datagrams discarded by the simulated loss at this link |
| `latency_ms` | configured one-way delay for this link |

End-to-end numbers (RTT, goodput, loss %, retransmissions…) keep coming from
the existing `status_snapshot()` — the topology view complements, not replaces,
the telemetry panel.

## 6. API contract

`GET /api/topology` →

```jsonc
{
  "enabled": true,                 // config.topology_enabled
  "nodes": [{"id": "hub", "label": "HUB", "role": "hub",
             "host": "127.0.0.1", "port": 6101, "up": true,
             "config": {"latency_ms": 10,          // effective values:
                        "loss_enabled": false,     // per-node override if set,
                        "loss_probability": 0.10,  // else the global config
                        "corrupt_enabled": false,
                        "corrupt_probability": 0.10,
                        "enabled": true}}],
  "links": [{"id": "l1-ch1", "a": "l1", "b": "ch1", "latency_ms": 10}],
  "route": ["l1", "ch1", "hub", "ch2", "l3"],   // null when idle
  "source": "l1", "dest": "hub",   // last/current pick (defaults l1 → hub);
                                   // the route card seeds its selectors from
                                   // these two fields
  "link_stats": {"l1-ch1": {"data_packets": 0, "ack_packets": 0,
                             "dropped": 0, "latency_ms": 10}}
}
```

* `latency_ms` (in `links[]` and `link_stats[]`) is the **applied** delay —
  the effective per-node value (`nodes[].config.latency_ms`: override ?? global
  `config.topology_latency_ms`) pushed to the forwarders — so the badge never
  reports a delay that is not being simulated.

* `POST /api/topology/node/config` — patch one node's override. Body:

  ```jsonc
  {"id": "ch1",                    // required; unknown id → 400
   "reset": false,                 // true → drop the override entirely
   "latency_ms": 25,               // 1..1000, null/omitted → keep
   "loss_enabled": true,           // null/omitted → keep
   "loss_probability": 0.25,       // 0..0.90, null/omitted → keep
   "corrupt_enabled": false,       // null/omitted → keep
   "corrupt_probability": 0.10,    // 0..0.90, null/omitted → keep
   "enabled": true}                // false → forwarder stops (node acts down)
  ```

  Response: `{"ok": true, "id": "ch1", "config": {…effective values…}}`.
  The override is applied live (forwarder fields patched in place) and wins
  over subsequent `start_all()` / testing applies for the process lifetime;
  `enabled=false` stops that node's forwarder (`up: false` in the snapshot),
  and re-enabling restarts it when the server is running. UI: the canvas
  node inspector (`NodeInspector`).

* `POST /api/server/start|stop` — when `topology_enabled`, starts/stops **all
  forwarders** plus the receiver (receiver binds the default destination node
  port; see below). Per-node overrides are respected: a node with
  `enabled=false` stays down.
* `POST /api/transfer/start?resume=…&source=l1&dest=l3` — new optional
  `source`/`dest` node-id query params (only used when topology is enabled).
  Manager: BFS route → configure each hop's neighbours → **rebind receiver to
  the dest node's port** if needed → start the existing client against the
  first hop.
* Resume check/discard and cancel keep working unchanged (they are
  destination-side concerns).

`config` gains: `topology_enabled: bool = false`, `topology_latency_ms: int = 10`
(defaults keep every existing test/demo behaviour identical when off).

## 7. Frontend

* `lib/topology.ts` — `TopologySnapshot`, `TopologyNode` (+ `config`),
  `TopologyLink`, `LinkStats` types; `api.topology()` added to the existing
  500 ms poll in `useStatusPolling`.
* `components/TopologyCanvas.tsx` — the always-on SVG dashboard: two nodes +
  one link while the flag is off, the preset graph while it is on
  (tri-path by default; extended star one preset switch away). Active
  route links rendered green (optimal) and fully opaque; candidate links
  blue, idle links dimmed, flagged lanes red-dashed (tri + scheduler).
  Active links show a stat badge (`Δ 10ms · 128 pkt · 3 ✕`). Nodes
  show label + port + `up` dot and are click-to-select.
* `components/PacketLayer.tsx` — event-driven DATA/ACK packet sprites
  animated along the route polyline, derived from the 500 ms poll (Travel →
  hold → ACK handoff; TIMEOUT fades red, RETRANSMITTED respawns with a retry
  counter).
* Route pickers (source/dest selects + hop count) live compactly in the
  `TopBar`; `startTransfer` receives `source`/`dest`.
* `components/NodeInspector.tsx` — per-node config (latency, loss %,
  corruption %, enabled) as a floating card anchored next to the selected
  node, mirrored in the side panel's NODE tab; writes
  `POST /api/topology/node/config` (§6).
* When `enabled: false`, the canvas still renders (two nodes, one link) —
  the flag only picks the topology, never hides the dashboard.

## 8. Non-goals (later phases)

User-defined topologies/graph editor; per-hop ARQ (hop-by-hop ACKs);
real multi-machine deployment; per-hop event log.

*(Removed from this list once built: animated packet sprites on links — the
canvas `PacketLayer` renders DATA/ACK dots from the 500 ms poll; per-node
latency — `nodes[].config.latency_ms` + `POST /api/topology/node/config`.)*

## 9. Definition of done

1. `pytest tests -q` → existing **46 + new** topology tests all pass
   (graph/BFS unit tests, forwarder latency+loss tests, route stats
   aggregation, integration transfer through 4 hops with file equality,
   resume across hops, `/api/topology` shape, topology-off regression).
2. `npm run build` and `npm run lint` clean.
3. E2E smoke (`scripts/smoke_topology.ps1`) with topology on: `l1 → l3` (4
   hops), `topology_latency_ms=2`, 1 MB, per-link loss 5 %, `max_retries≈20`,
   cancel mid-flight → resume → SHA-256 identical, partial cleaned,
   `/api/topology` final link stats sane. (Loss compounds across 4 hops, so
   the parameters must stay modest or the smoke flakes — tune once, not 10 %.)
4. UI: pick source/dest → route highlights → per-link stats update live during
   the transfer; feature flag off reproduces the current behaviour exactly.
5. README/PROJECT_PLAN updated only when the feature is actually working.

## 10. Work breakdown (step-by-step)

Phases are strictly sequential; each ends with a **gate** that must pass
before the next begins. Nothing is committed mid-phase without its gate green.

### Phase 1 — Graph & routing (pure logic, no sockets) — DONE ✅ (64 passed)
1. Create `transfer/topology/graph.py`: `Node`, `Link` dataclasses.
2. Encode `PRESET_EXTENDED_STAR` (7 nodes, ports 6101–6107, 6 links, 10 ms).
3. Implement `bfs_route(src, dst) -> list[str] | None` (shortest path,
   `src == dst` → `None`/error, unreachable → `None`).
4. Unit tests: every node pair's route (same-cluster sibling = 2 hops,
   cross-cluster leaf = 4 hops, leaf→hub = 2 hops), same-node rejected
   (`None`), unknown id → `KeyError`, preset integrity (7 unique ids/ports,
   6 links, endpoints exist).
   **Gate:** `pytest tests -q` → 46 + graph tests green.

### Phase 2 — Forwarder (real socket, latency, counters) — DONE ✅ (77 passed)
1. Create `transfer/topology/forwarder.py`: bind `127.0.0.1:<node.port>`,
   recv thread, forward datagram between configured neighbours after
   `latency_ms` delay (queued worker so ordering is preserved).
2. Apply the existing global testing `loss_probability`/`corrupt_probability`
   at each forwarder (same fields the server/client already use).
3. Per-link counters: `data_packets`, `ack_packets`, `dropped` (classify by
   parsed packet type via existing `udp.packet.parse_packet`).
4. `set_route(prev_addr, next_addr)` / `clear_route()` — non-route nodes drop.
5. Unit tests on loopback: latency respected (±tolerance), loss=1.0 → all
   dropped and counted, counters classify DATA vs ACK, route-less node drops.
   **Gate:** pytest green (46 + graph + forwarder).

### Phase 3 — TopologyManager + HTTP wiring — DONE ✅ (87 passed, curl OK)
1. `transfer/topology/manager.py`: start/stop all forwarders, default
   destination = hub, `configure_route(src, dst)` (BFS → push neighbour config
   to each hop), receiver **rebind** to dest node port (stop → set port →
   start; partials survive).
2. Config flags `topology_enabled` (default `false`), `topology_latency_ms`.
3. Wire into `transfer/manager.py`: `start_server` starts forwarders when
   enabled; `start_transfer(..., source, dest)` configures the route and
   points the client at the first hop; snapshot gains no new required fields.
4. `api/endpoints/topology.py`: `GET /api/topology`; add `source`/`dest`
   query params to `/api/transfer/start`; include router in `routes.py`.
5. Tests: `/api/topology` shape, integration transfer `l1→l3` (4 hops,
   `topology_latency_ms=2`) byte-equal, resume across hops, topology-off
   regression (existing 46 untouched and passing).
   **Gate:** full pytest suite green; manual `curl` of `/api/topology`.

### Phase 4 — Frontend (flag ON path only) — DONE ✅ (build + lint clean)
1. `lib/topology.ts` types + `api.topology()`; add to the 500 ms poll.
2. `components/TopologyView.tsx`: fixed-coordinate SVG (hub centre, CHs
   mid-ring, leaves outer), route highlight, per-link stat badges, node
   `up` dots.
3. `components/TopologyRouteCard.tsx`: source/dest selects + route summary;
   extend `startTransfer(resume, source?, dest?)` through
   `useTransferActions` → `api.startTransfer`.
4. Conditional render: `topology_enabled` → TopologyView + route card;
   otherwise today's hero unchanged.
   **Gate:** `npm run build` + `npm run lint` clean; browser check both
   flag states. — Verified in a headless browser with the full stack up:
   flag OFF renders the classic CLIENT ⇄ SERVER hero and no route card;
   flag ON replaces it with the topology map + route card; mid-transfer the
   route is highlighted (`4 HOPS`) and the per-link badges count live
   (505 → 604 pkt across two DOM snapshots, transfer finished 300/300
   over `l1 → ch1 → hub → ch2 → l3`).

### Phase 5 — E2E, hardening, docs — DONE ✅ (§9 fully satisfied)
1. Smoke script written from scratch as `scripts/smoke_topology.ps1` (no
   smoke script existed yet): topology on, `l1→l3`, `topology_latency_ms=2`,
   1 MB, per-link loss 5 %, `max_retries=20`, cancel mid-flight → resume →
   SHA-256 identical → partial cleaned → `/api/topology` shows the final
   per-link stats (route links counted both directions, applied latency
   reported) → default config restored. **Result: PASS.**
2. Re-run all four gates: `pytest tests -q` → **88 passed**; `npm run build`
   clean; `npm run lint` clean; smoke PASS.
3. README (topology architecture + demo steps + testing/smoke sections +
   refreshed project layout) and PROJECT_PLAN (build log, concept table,
   Definition of Done, test inventory) updated — only now, per §9.5.
   **Gate:** §9 checklist fully satisfied → feature may be presented as
   complete.

### Phase 6 — UI revamp + per-node config — DONE ✅ (95 passed)
1. Canvas-first shell: `TopBar` + always-on `TopologyCanvas` (2-node when
   the flag is off, 7-node star when on) + tabbed `SidePanel`
   (STATS/PACKETS/LAB/CONFIG); ~11 legacy components deleted, shared
   primitives added in `ui.tsx`.
2. `PacketLayer`: event-driven DATA/ACK sprites on the canvas, derived from
   the existing 500 ms poll (travel/hold/timeout/retransmit states, segment
   times proportional to link latency).
3. Per-node config: `POST /api/topology/node/config` + `_node_overrides`
   (precedence over `start_all()`/`patch_testing()`), `nodes[].config` in
   the snapshot, `NodeInspector` floating card + NODE tab. **Gate:** full
   pytest suite green (**95 passed**, +7 node-config tests), smoke PASS,
   build + lint clean.
