# FastShare — Reliable File Transfer over UDP

**FastShare** is a university-level Computer Networks project that implements a
**reliable file transfer protocol on top of UDP**. UDP gives us speed and low
overhead but no guarantees, so the project layers reliability on top the same
way classic textbooks do:

```
FILE -> PACKETIZATION -> SEQUENCE NUMBERS -> UDP -> SERVER -> ACK -> NEXT PACKET

PACKET LOST -> TIMEOUT -> RETRANSMISSION -> ACK -> CONTINUE
```

Everything is controlled and visualized from a professional dark-mode
dashboard (Next.js), while the **actual networking runs on real Python UDP
sockets** — no simulated animation on the frontend.

---

## Abstract

FastShare implements a custom, reliable file-transfer protocol over UDP by
adding:

- **Packetization** — files are split into fixed-size datagrams.
- **Sequence numbers** — every DATA packet carries a unique, monotonic id.
- **Acknowledgements (ACKs)** — the receiver ACKs every valid packet.
- **Stop-and-Wait ARQ** — the sender sends the next packet only after the
  previous one is acknowledged.
- **Timeout-based retransmission** — lost packets are re-sent up to a retry
  limit.
- **Duplicate-packet handling** — retransmissions that "arrive twice" are
  detected and never written twice.
- **CRC-32 checksums** — every datagram carries a CRC-32 over its payload;
  corrupted packets are dropped without an ACK and recovered by
  retransmission.
- **Resume** — interrupted transfers keep a `.part` file + `.meta` sidecar
  on the receiver and continue from the first missing packet.
- **Statistics** — RTT/SRTT, goodput, wire throughput, loss % and ETA are
  measured live from the packet event stream.
- **Multi-server topology** — a fixed 7-node extended-star of real UDP
  endpoints (hub, 2 cluster heads, 4 leaves on ports 6101–6107). The user
  picks source and destination, BFS picks the route, intermediate nodes
  forward packets after a configurable per-link delay with **no ARQ of
  their own** (reliability stays end-to-end), and the dashboard highlights
  the active path with live per-link packet/drop counters.
- **Multi-path UDP** — a switchable **tri-path preset** (8 nodes, ports
  6201–6208) offers three node-disjoint source→destination lanes. The
  sender runs a **source-side adaptive scheduler**: explore every lane,
  keep a rolling 100-attempt loss window, flag a lane at ≥ 20 % loss and
  shift traffic to healthier lanes while a 10 % probe share keeps flagged
  lanes visible (hysteresis below 10 %). Each hop can run as its **own OS
  process** ("per-PC") with per-node log consoles in the dashboard.
- **Packet-loss simulation** — a testing/debug mode drops packets
  probabilistically so retransmission can be *demonstrated* during the viva.

A FastAPI controller exposes the UDP client/server as HTTP endpoints so the
Next.js dashboard can start transfers, stream live packet/ACK activity, and
show real statistics.

---

## Architecture

```
                +--------------------------+
                |       Next.js UI         |
                |  TopBar (status, START)  |
                |  Canvas + packet dots    |
                |  Side panel (tabbed)     |
                +------------+-------------+
                             |  HTTP / JSON
                             v
                +--------------------------+
                |   Python Controller      |
                |   (FastAPI + Manager)    |
                |  starts/stops transfer   |
                +------------+-------------+
                             |  UDP (real sockets)
                             v
                +--------------------------+
                |      UDP File Server     |
                |  validate seq, save, ACK |
                +--------------------------+
```

| Layer          | Technology                                   |
| -------------- | -------------------------------------------- |
| Frontend       | Next.js, React, TypeScript, Tailwind CSS, Lucide |
| Controller     | Python 3, FastAPI (HTTP control plane)       |
| Transport      | Python UDP sockets (`socket`, `struct`)       |

The frontend **never** implements UDP. Binary datagrams (START/DATA/ACK/END)
are built with Python's `struct` and travel over real UDP; JSON is used only
between the browser and the controller.

With the topology flag on, the UDP path is stretched over the extended-star
preset — still a single end-to-end Stop-and-Wait session:

```
 UDPClient ──► l1.forwarder ──► ch1.forwarder ──► hub.forwarder ──► ch2.forwarder ──► UDPServer
     ▲              (each hop: real socket, per-link latency, loss/corruption
     └────ACKs──────────────── simulation, packet counters — no per-hop ARQ)◄─────────┘
```

With the **tri-path preset** the same forwarders form three node-disjoint
lanes (`src→a1→a2→dst`, `src→b1→b2→dst`, `src→c1→c2→dst`); the scheduler
in `UDPClient` picks the lane per transmission and each hop normally runs
as its own OS process (per-PC simulation), controlled over a JSON-lines
pipe and streaming per-node logs back to the dashboard.

### Custom packet format (on the wire)

```
+-----------------+--------------+----------------+-----------+------------------+
| Sequence Number | Packet Type  | Payload Length |  CRC-32   |     Payload      |
|   4 bytes       |   1 byte     |   4 bytes      |  4 bytes  |    variable      |
+-----------------+--------------+----------------+-----------+------------------+
```

Types: `START` (0), `DATA` (1), `ACK` (2), `END` (3), `ERROR` (4).
The header is **13 bytes**: the CRC-32 is computed over the payload and
validated on *every* inbound datagram (DATA at the receiver, ACKs at the
sender). A corrupted packet is dropped without an ACK, so the sender's
timeout retransmits a clean copy. The payload length is bounded so a packet
always fits a single UDP datagram.

START metadata (`START` payload) additionally carries the file name, size,
total packets, packet size and a *resume flag*; the receiver answers with
resume metadata in the START-ACK payload when a partial copy exists.

---

## Features

### Completed

- UDP client–server communication (real sockets)
- File packetization (`FILE -> packets -> identical FILE`)
- Sequence numbers (1..N, monotonic)
- ACK mechanism (DATA #N <-> ACK #N)
- Stop-and-Wait ARQ (window size = 1)
- Timeout-based retransmission with a retry limit
- Duplicate-packet handling (retransmitted data never written twice)
- Packet-loss simulation (sender→receiver data loss **and** receiver→sender
  ACK loss) for testing/demo
- **CRC-32 checksum verification** on the wire, plus a corruption simulator
  for both directions (DATA at the receiver, ACKs at the sender); corrupted
  packets are rejected with a visible `CHECKSUM MISMATCH` log and recovered
  through the normal retransmission path
- **Resume of interrupted transfers** — the receiver writes `<file>.part`
  plus a `<file>.part.meta` sidecar (JSON: name, size, packet size, total
  packets, final path); after a cancel, a crash or a full receiver restart
  the next START for the same file negotiates a resume point and the sender
  continues at the first missing packet. The dashboard shows a
  *Partial transfer found* banner with **Resume** / **Start over** actions.
- **Advanced transfer statistics** — per-packet RTT samples, current/min/max
  and smoothed RTT (EWMA 0.875/0.125, RFC 6298 style), goodput (bytes moved
  this session, excluding reused resume bytes), wire throughput, loss %,
  CRC error count and ETA
- Live dashboard: canvas-first shell — a chrome-only top bar, an always-on
  pan/zoom topology canvas with animated packet dots, a bottom transfer dock
  (file, progress, state, START/CANCEL/resume) and dual side panels
  (controls left: Config / Lab / Node; telemetry right: Stats / Packets)
- **Multi-server topology** — feature-flagged (`topology_enabled`); the flag
  picks between a two-node CLIENT ⇄ SERVER canvas and the 7-node preset star.
  Route pickers float at the top-center of the canvas, the active route is
  highlighted with
  per-link live badges (`Δ <latency>ms · <n> pkt · <drops> ✕`), and packet
  dots travel link-by-link with segment times proportional to each link's
  latency — all derived from the existing 500 ms poll
- **Per-node configuration** — click a node for an inspector (side panel
  NODE tab mirrors it): hop latency (1–1000 ms), packet-loss toggle + %,
  corruption toggle + %, node up/down; `POST /api/topology/node/config`
  patches the live forwarder and wins over later global applies
- **Per-PC isolation + node logs** — `topology_isolated` (default on)
  runs every forwarder as its own OS process behind a JSON-lines
  control/log protocol; each node keeps a 1000-line ring exposed via
  `GET /api/topology/node/{id}/logs` and rendered as a live console in
  the NODE tab
- **Switchable presets + multi-path** — CONFIG → Topology switches
  `Tri-path (3 lanes)` (**default**) ↔ `Extended star` at runtime
  (refused mid-transfer, node ids/default picks follow the preset); the
  snapshot reports every lane (`paths`) and the multipath policy
- **Source-side path scheduler** — per-attempt lane choice over an
  unconnected socket (ACKs mirror the DATA lane): explore → round-robin →
  flag ≥ 20 % rolling loss → weighted shift with 10 % probe share,
  hysteresis below 10 %; live lane health (loss bars, weights, FLAG) in
  the STATS *Path scheduler* panel, policy controls in CONFIG
- Automated tests (119) over real loopback UDP, including graph/BFS,
  forwarder, topology-API, per-node-config, isolation, preset, multipath
  and 4-hop integration tests

No unfinished feature is presented as complete; the UI and README only
describe what is active in the current build.

---

## Technologies

```
Frontend     Next.js · React · TypeScript · Tailwind CSS · Lucide React
Backend      Python 3 · FastAPI · Uvicorn · pydantic
Network      Python UDP sockets · struct (binary packets) · threading
Testing      pytest · SHA-256 file equality checks
```

---

## How to Run

### 1. Backend (Python controller + UDP receiver)

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows   (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
python main.py                # FastAPI on http://127.0.0.1:8000
```

> `main.py` runs uvicorn itself; you can also do `python -m uvicorn main:app --port 8000`.

### 2. Frontend (Next.js dashboard)

```bash
cd frontend
npm install
npm run dev                   # http://localhost:3000
```

### 3. Demo

1. Open `http://localhost:3000`.
2. Press **START SERVER** in the bottom dock. The chip turns **online**.
3. Drag a file onto the canvas (or use the file chip in the bottom dock).
4. Click **START** and watch:
   - packet dots travel the canvas link (DATA forward, ACK back),
   - the packet monitor filling with `ACKED` rows,
   - progress (% and bytes) driven by **actual ACKs**, not a timer.
5. For retransmission, open the **LAB** tab, pick `Test 2 · 10% Loss`, click
   **Run Test**. Watch dots fade red on TIMEOUT and respawn on retransmit,
   rows turn `TIMEOUT` → `RETRANSMITTED` → `ACKED`, and the trace show
   `lost -> timeout` / `DUPLICATE` (from ACK loss).

Received files are saved to `transfers/received/` as `<timestamp>_<name>`.

### 4. Multi-server topology demo

1. In the **CONFIG** tab → Multi-Server Topology, switch the feature on
   (optionally set the global per-link latency, default 10 ms) and restart
   the server — all 7 nodes come up (green dots on the canvas).
2. The canvas now shows    the preset star; pick a source and a destination in the floating route
   picker at the top-center of the canvas (e.g. `l1` → `l3`).
3. Start a transfer. The route lights up (`l1 → ch1 → hub → ch2 → l3 ·
   4 hops`), each active link shows a live badge `Δ 10ms · 604 pkt · 0 ✕`,
   and packet dots hop node-to-node along the path.
4. Click any node to open its inspector: change **hop latency** (the link
   badges and dot timing follow), raise **packet loss** on one hop only, or
   toggle the node **down** — the snapshot reports `up: false` and the route
   must route around or fail loudly.
5. Combine it with the LAB panel: per-link loss drops datagrams anywhere on
   the path, and the *end-to-end* Stop-and-Wait retransmits — exactly the
   teaching point of the feature.
6. Cancel mid-flight and resume: the receiver rebinds to the destination
   node's port but the `.part` / `.meta` files survive, so resume works
   across hops too.

Switching the flag **off** restores the two-node demo (same canvas,
same animation engine).

### 5. Multi-path demo (tri-path + adaptive scheduler)

The tri-path graph is the **default topology** (8 nodes, ports 6201–6208);
the extended star remains one preset switch away in **CONFIG → Topology**.
Colour language on the canvas: **green = optimal** (lowest rolling loss),
**blue = candidate** (healthy but not the best right now),
**red dashed = restricted** (flagged — the scheduler avoids it).

**Phase A — clean network, every lane optimal**

1. Turn the topology flag on and start the receiver: all three lanes
   render green (their routers get green borders) and the route picker
   reads `SOURCE → DEST`.
2. Start a transfer with the multipath scheduler **on**: dots spread
   across the lanes — each dot is painted with its lane's state colour
   and carries its lane letter (A/B/C) — the STATS *Path scheduler*
   panel fills with per-lane sent/lost, and the canvas **Path switching**
   HUD shows each lane's share of picks plus a tick-per-frame timeline.

**Phase B — add loss on one node, watch the lane get avoided**

3. Open `PATH A R1` (NODE tab) and raise **packet loss** to 50–85 %.
   While lane A's rolling window climbs it drops from green to **blue
   (candidate)**; once the window crosses the flag threshold the event
   trace prints `PATH A flagged at … loss → shifting traffic to healthier
   lanes`, lane A's links turn **red and dashed**, both `PATH A` routers
   get red borders, a banner flashes `PATH A flagged — shifting traffic…`,
   and the HUD timeline gains a red ▼ at the exact frame where traffic
   moved. Almost no dots use lane A afterwards — only the 10 % probe
   share peeks in (the odd red dot), while B/C carry the traffic.

**Phase C — remove the loss, the lane comes back**

4. Set `PATH A R1` loss back to 0: once lane A's window drops below the
   recovery threshold it rejoins the weighted schedule (green ▲ on the
   timeline; path and borders return red → blue → green, no flapping).
5. Optional: the HUD's **Anim ¼× / ½×** buttons run the dots in slow-mo —
   the transport keeps going at full speed, only the animation crawls.
6. The delivered file still matches the source hash (reliability remains
   end-to-end Stop-and-Wait), and the node console in the NODE tab keeps
   streaming each process's own log lines — every hop is a separate "PC".

---

## Testing

```bash
cd backend
python -m pytest tests -v
```

UDP tests run over real loopback sockets on an ephemeral port — no mocks.

1. **Normal transfer** — losses off; asserts every packet is ACKed, zero
   retransmissions, and the reconstructed file is **SHA-256-identical** to the
   source.
   (`tests/test_transfer.py`)
2. **Packet loss / retransmission** — `loss=10..50%`; asserts `TIMEOUT` and
   `RETRANSMITTED` events occurred, the retry limit stops cleanly at 100%
   loss, and the final file is byte-identical.
   (`tests/test_retransmission.py`)
3. **Duplicate packets** — ACK loss makes the sender retransmit; asserts the
   receiver logs `DUPLICATE` for the sequence numbers and the file hash proves
   nothing was written twice.
   (`tests/test_transfer.py::test_duplicate_packets_are_not_written_twice`)
4. **Checksum / corruption** — bit flips are injected on inbound DATA,
   inbound ACKs and the START handshake; asserts CRC-32 rejects them with a
   visible `CHECKSUM MISMATCH`, retransmission recovers, and the final hash
   still matches.
   (`tests/test_checksum.py`, `tests/test_packet.py`)
5. **Resume** — a transfer is cancelled mid-flight, the partial `.part` +
   `.meta` are found by the next run, the sender continues at packet #K+1
   (never re-sends 1..K), and the file hash matches; also covers restart
   survival, `resume=False` start-over, the manager's
   `/api/resume/check` and `/api/resume/discard`.
   (`tests/test_resume.py`, `tests/test_api.py`)
6. **Statistics** — real RTT/SRTT/goodput/throughput/loss numbers are
   asserted against a clean and a lossy run through the controller.
   (`tests/test_stats.py`)
7. **Multi-server topology** — preset integrity and BFS routing (1/2/4-hop
   routes, same-node rejected, unknown id rejected), forwarder behaviour on
   loopback (latency honoured, loss=1.0 counted, DATA/ACK classification,
   route-less nodes drop), `/api/topology` shape and config-flag handling,
   plus a real 4-hop `l1 → l3` transfer and cancel→resume across hops with
   byte-identical files and a topology-off regression check.
   (`tests/test_topology_graph.py`, `test_topology_forwarder.py`,
   `test_topology_api.py`, `test_topology_transfer.py`)
8. **Per-PC isolation** — isolated children spawn/stop without leaking
   ports or processes, config changes are observable in the child's node
   log, the logs endpoint serves the ring, a dead child self-heals on the
   next snapshot, and a 4-hop transfer is byte-identical over isolated
   hops. (`tests/test_topology_isolation.py`)
9. **Presets** — snapshot exposes the preset catalog/paths, the preset
   endpoint switches graphs (400 on unknown/mid-transfer), all 9 tri-path
   links carry traffic after a transfer. (`tests/test_topology_presets.py`)
10. **Multipath scheduler** — deterministic unit tests (seeded explore,
    flag at 20 %, weighted shift, hysteresis), the config endpoint
    roundtrip, a lossy-lane E2E that flags lane A → shifts to B/C → file
    byte-identical, plus multipath-off and star regressions.
    (`tests/test_multipath.py`)

### End-to-end smoke (topology)

```powershell
pwsh scripts/smoke_topology.ps1     # exit 0 = PASS
```

Starts the controller if needed, then runs §9.3 of
`FEATURE_SPEC_MULTI_SERVER_TOPOLOGY.md`: topology on, `l1 → l3` (4 hops,
`topology_latency_ms=2`), 1 MB payload, 5 % per-link loss, cancel
mid-flight → resume → SHA-256 identical → partial cleaned → final per-link
stats verified, and finally restores the default (topology off, loss off)
configuration.

---

## Demo flow (viva-ready)

1. **Server** — start the receiver; Network Status → Connected.
2. **Normal transfer** — select `sample.pdf`, Start; watch `DATA #1 -> ACK #1`,
   `DATA #2 -> ACK #2`, ... then ✓ Transfer Complete.
3. **Packet loss** — enable 10% loss; watch
   `DATA #17 -> LOST -> TIMEOUT -> RETRANSMITTED -> ACK #17`.
4. **Duplicate packet** — with ACK-loss simulation, watch the trace show
   `DUPLICATE packet #N ignored (already written)` and re-ACK, proving the
   payload is not saved twice.
5. **Checksum** — Testing → `Test 4 · 10% Corruption`, Run; watch
   `CHECKSUM MISMATCH on packet #N ... -- dropped` (no ACK) followed by a
   clean retransmission; Networking stats show the CRC error count, and the
   delivered file still matches the source hash.
6. **Resume** — start a transfer, press **Cancel** mid-flight; re-select the
   same file. The control card shows *Partial transfer found — X% already
   received*; press **Resume from packet #K+1** and watch the packet monitor
   jump straight to packet #K+1 (packets 1..K are not re-sent). A receiver
   restart in between works too: the state lives in the `.part.meta` file.
7. **Multi-server topology** — enable the topology toggle, restart the
   server, pick `l1 → l3`, and start a transfer with 10% loss enabled:
   the map highlights the 4-hop route, per-link badges count forwarded and
   dropped packets on every hop, while the statistics panel shows the
   *end-to-end* retransmissions absorbing that hop loss. Cancel and resume
   to prove the path is transparent to the reliability layer.
8. **Multi-path** — the tri-path preset is the default; raise packet loss
   on `PATH A R1/R2` and start a transfer: the scheduler panel flags lane
   A once its rolling loss crosses 20 %, the trace shows `PATH A flagged
   → shifting traffic`, lane A's links turn red-dashed while dots move to
   lanes B/C (green = optimal, blue = candidate) with a small probe share
   still testing A — and the file still arrives SHA-256-identical over
   whichever lane each frame took.

---

## Project layout

```
fastshare/
├── frontend/            Next.js dashboard (TypeScript + Tailwind)
│   ├── app/             routes + root layout/page
│   ├── components/      UI cards (status, file drop, monitor, testing,
│   │                    TopologyView, TopologyRouteCard, EventTraceConsole, ...)
│   ├── hooks/           useTransfer composes useStatusPolling (500 ms),
│   │                    useFileSelection, useResume, useTransferActions
│   └── lib/             api client, types, topology types, format/log helpers
├── backend/
│   ├── main.py          FastAPI entry (uvicorn on :8000)
│   ├── api/
│   │   ├── routes.py    assembles the endpoint groups
│   │   ├── models.py    request/response models
│   │   ├── uploads.py   multipart upload -> transfers/uploads/
│   │   └── endpoints/   status, server, transfer, resume, testing, topology
│   ├── udp/             packet.py, protocol.py (wire format + CRC-32),
│   │                    client.py (lanes + PathScheduler), server.py,
│   │                    scheduler.py (source-side multipath),
│   │                    resume_fs.py (.part/.meta)
│   ├── transfer/        manager.py (state machine), stats.py (RTT/goodput),
│   │   │                event_log.py (bounded packet table + feed)
│   │   └── topology/    graph.py (presets + all_paths), forwarder.py (real
│   │                    socket per node: latency, loss, counters, log_sink),
│   │                    node_main.py (per-PC child entry),
│   │                    process_node.py (ProcessHandle),
│   │                    manager.py (handles, presets, routes, snapshot)
│   └── tests/           test_packet, test_transfer, test_retransmission,
│                        test_checksum, test_stats, test_resume, test_api,
│                        test_topology_graph, test_topology_forwarder,
│                        test_topology_api, test_topology_transfer,
│                        test_topology_isolation, test_topology_presets,
│                        test_multipath
├── scripts/
│   └── smoke_topology.ps1   end-to-end topology smoke (§9.3)
├── transfers/           uploads/ + received/ (demo staging, git-ignored)
├── README.md
├── PROJECT_PLAN.md
├── IMPLEMENTATION_ROADMAP.md
├── FEATURE_SPEC_MULTI_SERVER_TOPOLOGY.md
└── FEATURE_SPEC_MULTIPATH.md
```

---

## Future work (planned, not implemented)

1. Sliding-window ARQ (Go-Back-N / Selective Repeat)
2. Congestion control
3. Multiple simultaneous transfers
4. Encryption
5. Authentication
6. Persistent transfer history

See `PROJECT_PLAN.md` for the phase-by-phase roadmap and Definition of Done,
and `IMPLEMENTATION_ROADMAP.md` for the checksum / statistics / resume plan
that produced the current build.