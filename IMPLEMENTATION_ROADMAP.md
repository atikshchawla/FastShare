# FastShare — Implementation Plan: Remaining Features

This plan details the architecture and step-by-step implementation for the three remaining features of the **FastShare Reliable UDP File Transfer Protocol**:
1. **Checksum Verification (Data Integrity via CRC-32)**
2. **Advanced Transfer Statistics (RTT, Throughput/Goodput, Packet Loss %, ETA)**
3. **Resume Interrupted Transfer (Partial .part state continuity)**

---

## 1. Feature 1: Checksum Verification (Data Integrity)

### Architectural Design
In computer networking, transport datagrams can suffer bit-level corruption. While UDP provides an optional 16-bit checksum, application-level reliable protocols often incorporate explicit checksum fields to ensure end-to-end data integrity before data is written to disk.

### Wire Header Update
The FastShare binary wire format is expanded from 9 bytes to **13 bytes**:
```text
+-----------------+-------------+----------------+----------------+------------------+
| Sequence Number | Packet Type | Payload Length |    Checksum    |     Payload      |
|     4 bytes     |   1 byte    |    4 bytes     |    4 bytes     |     variable     |
+-----------------+-------------+----------------+----------------+------------------+
```
- **Format**: `>I B I I` (big-endian: 4-byte uint seq, 1-byte uchar type, 4-byte uint len, 4-byte uint checksum).
- **Algorithm**: Standard `zlib.crc32(payload) & 0xffffffff`. For control packets without payloads (ACK), checksum is `0`.

### Sender Behavior (`udp/client.py`)
- For each packet (`START`, `DATA`, `END`), computes `checksum = zlib.crc32(payload) & 0xffffffff`.
- Encodes the checksum into the 13-byte header.

### Receiver Behavior (`udp/server.py`)
- Parses the 13-byte header, extracting `(seq, ptype, plen, checksum)`.
- Validates: `zlib.crc32(payload) & 0xffffffff == checksum`.
- **On Checksum Mismatch**:
  - Drops the packet immediately without writing to disk.
  - Logs: `CHECKSUM MISMATCH on packet #{seq} (expected {checksum}, calculated {computed}) -- dropped`.
  - Does NOT send an ACK.
  - Sender times out and retransmits the packet.

### Corruption Simulation (`udp/server.py` & testing panel)
- Add `corrupt_probability: float` (0.0 to 1.0) to simulate bit flips/packet corruption on the server receiver to demonstrate checksum verification in vivas.

---

## 2. Feature 2: Advanced Transfer Statistics

### Metrics Specification
1. **Round-Trip Time (RTT)**:
   - Measured per packet: duration between `DATA #N sent` and matching `ACK #N received`.
   - **Current RTT**: Latest sample in milliseconds.
   - **Min / Max RTT**: Extremes encountered during the transfer.
   - **Smoothed RTT (SRTT)**: RFC 6298 EWMA filter:
     $$\text{SRTT} = (0.875 \cdot \text{SRTT}) + (0.125 \cdot \text{RTT}_{\text{sample}})$$
2. **Throughput vs. Goodput**:
   - **Goodput (KB/s)**: Application-layer confirmed file bytes divided by elapsed transfer time.
   - **Wire Throughput (KB/s)**: Total network bytes transferred over the socket (headers + payload + retransmissions) divided by elapsed transfer time.
3. **Packet Loss Rate (%)**:
   - Calculated as: $(\text{retransmissions} / \max(\text{packets\_sent}, 1)) \times 100\%$.
4. **Estimated Time Remaining (ETA)**:
   - $\text{ETA} = \frac{\text{remaining\_bytes}}{\max(\text{goodput\_bytes\_per\_sec}, 1)}$.

### Implementation Plan
- Track per-packet timestamps in `UDPClient` and record metrics in `TransferManager`.
- Expose RTT, Goodput, Throughput, Loss Rate, and ETA in `/api/status` and `/api/transfer/status`.
- Update `NetworkingStats.tsx` with dedicated cards for RTT, Goodput, and Loss Rate.

---

## 3. Feature 3: Resume Interrupted Transfer

### Architectural Design
If a file transfer is interrupted (network disconnection or user cancel), the receiver keeps the partially transferred file (`<filename>.part`). When resuming, the client queries the receiver for the last acknowledged sequence and resumes transmission from packet $K + 1$ instead of restarting from byte 0.

### Protocol Handshake for Resume
1. **Client Resume Check**:
   - Client sends a `START` packet with filename and size.
   - If the server has an existing `.part` file for this file name with matching size and valid contiguous data:
     - Server determines `resumed_seq = os.path.getsize(part_path) // packet_size`.
     - Server responds with an ACK containing `resumed_seq` in the sequence field (or metadata payload).
2. **Client Seek & Fast-Forward**:
   - Client reads the server's ACK.
   - Client seeks in file: `fh.seek(resumed_seq * packet_size)`.
   - Client sets start sequence `seq = resumed_seq + 1` and marks preceding packets $1 \dots \text{resumed\_seq}$ as already ACKed.
   - Live progress indicator immediately starts from the resumed percentage (e.g., 60% $\rightarrow$ 100%).
3. **Server File Append**:
   - Server opens `.part` in `"ab"` (append binary) mode at `resumed_seq * packet_size`.
   - Continues validating `expected_seq = resumed_seq + 1`.

---

## 4. Execution Phases

- **Phase 1**: Checksum Verification (wire format update to 13 bytes, CRC-32 computation, receiver validation, tests).
- **Phase 2**: Advanced Transfer Statistics (RTT tracking, SRTT, Goodput vs. Wire Throughput, ETA, UI telemetry cards).
- **Phase 3**: Resume Functionality (partial file preservation, resume handshake, seek forward, UI resume button).
- **Phase 4**: Verification & Documentation (automated tests for CRC corruption and resume; updating `ProtocolPanel.tsx` and README).
