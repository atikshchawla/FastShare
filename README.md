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
                |  File Selection / Config |
                |  Live Packet Monitor     |
                |  Transfer Visualization  |
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
- Live dashboard: progress, packet monitor, statistics, protocol trace
- Automated tests (46) over real loopback UDP

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
2. Click **Start UDP Server** (or the header ⚙ → Start). The Network Status
   card turns **Connected**.
3. Drag a file into the **File Selection** card.
4. Click **Start Transfer** and watch:
   - Live `DATA #N →` / `← ACK #N` handshakes in the visualization,
   - the packet monitor filling with `ACKED` rows,
   - progress (% and bytes) driven by **actual ACKs**, not a timer.
5. For retransmission, open **Testing → Packet Loss Simulation**, pick
   `Test 2 · 10% Loss`, click **Run Test**. Watch rows turn `TIMEOUT` →
   `RETRANSMITTED` → `ACKED` and the protocol trace show
   `lost -> timeout` / `DUPLICATE` (from ACK loss).

Received files are saved to `transfers/received/` as `<timestamp>_<name>`.

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

---

## Project layout

```
fastshare/
├── frontend/            Next.js dashboard (TypeScript + Tailwind)
│   ├── app/             routes + root layout/page
│   ├── components/      All UI cards (status, file drop, monitor, ...)
│   ├── hooks/           useTransfer (polling + actions)
│   └── lib/             api client + shared types
├── backend/
│   ├── main.py          FastAPI entry (uvicorn on :8000)
│   ├── api/             routes.py + models.py (HTTP control plane)
│   ├── udp/             packet.py, protocol.py, client.py, server.py
│   ├── transfer/        manager.py (state, stats, packet log)
│   └── tests/           test_packet, test_transfer, test_retransmission,
│                        test_checksum, test_stats, test_resume, test_api
├── transfers/           uploads/ + received/ (demo staging)
├── README.md
├── PROJECT_PLAN.md
└── IMPLEMENTATION_ROADMAP.md
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