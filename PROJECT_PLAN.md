# FastShare — Project Plan & Build Log

Implementation plan for **FastShare — Reliable File Transfer over UDP**
(university Computer Networks project).

## Academic scope (current phase)

> "The implementation and testing phase. UDP client-server communication, file
> packetization, sequence numbers, ACK mechanism, and basic retransmission have
> been completed. Checksum verification, resume functionality, and transfer
> statistics are currently in progress."

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
- Binary wire format (no JSON on UDP): `seq(4) | type(1) | len(4) | payload`
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

---

## Networking concepts → where implemented

| Concept                 | Location                                     |
| ----------------------- | -------------------------------------------- |
| Packet structure        | `backend/udp/protocol.py`, `udp/packet.py`   |
| Stop-and-Wait state     | `backend/udp/client.py` (`_send_data_packet`)|
| ACK emission            | `backend/udp/server.py`, `_handle`/`_send_ack` |
| Duplicate handling      | `backend/udp/server.py` (`seq < expected`)   |
| Loss simulation         | `server.loss_probability`, `client.ack_loss_probability` |
| Stats / packet log      | `backend/transfer/manager.py`                |
| HTTP API                | `backend/api/routes.py`                      |
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

## Not in scope yet (do not implement now)

Authentication, accounts, databases, cloud deployment, Redis, encryption, P2P,
multi-user, sliding window, congestion control, complex routing, advanced
analytics, mobile app.

---

## Test inventory (current: 23 passing)

| File                            | Verifies                                              |
| ------------------------------- | ----------------------------------------------------- |
| `tests/test_packet.py`          | wire format, header size, START metadata, filename safety |
| `tests/test_transfer.py`        | packetization, sequence numbers, ACK coverage, duplicates, end-to-end SHA-256 |
| `tests/test_retransmission.py`  | loss → timeout/retransmit, 30%/50% loss survival, retry limit, size integrity |