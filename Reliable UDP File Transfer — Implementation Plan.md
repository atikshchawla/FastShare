# Reliable UDP File Transfer System

## 1. Project Overview

Build a university-level Computer Networks project that implements a **reliable file transfer protocol over UDP**.

The project should demonstrate how reliability can be built on top of UDP using:

- UDP client-server communication
- File packetization
- Sequence numbers
- ACK mechanism
- Basic retransmission
- Checksum verification — **in progress**
- Resume functionality — **in progress**
- Transfer statistics — **in progress**

### Current academic scope

For the current submission, the project only needs to reach the following state:

> "The implementation and testing phase. UDP client-server communication, file packetization, sequence numbers, ACK mechanism, and basic retransmission have been completed. Checksum verification, resume functionality, and transfer statistics are currently in progress."

Therefore, **do not over-engineer or fully implement the features marked as in progress yet**.

The completed features must be polished, demonstrable, and easy to test.

---

# 2. Recommended Technology Stack

## Frontend

Use:

- Next.js
- React
- TypeScript
- Tailwind CSS
- Lucide React icons

The frontend should provide a clean dashboard for controlling and visualizing the file transfer.

## Backend

Use:

- Python 3
- UDP sockets
- `socket`
- `threading`
- `struct`
- `time`
- `os`

The actual networking logic MUST be implemented using Python UDP sockets.

Do not attempt to implement the UDP protocol itself inside Next.js.

## Communication Architecture

```text
                ┌─────────────────────────┐
                │       Next.js UI        │
                │                         │
                │  File Selection         │
                │  Server Configuration   │
                │  Transfer Controls      │
                │  Live Statistics        │
                └───────────┬─────────────┘
                            │
                            │ HTTP / WebSocket
                            │
                ┌───────────▼─────────────┐
                │    Python Controller    │
                │                         │
                │ Starts / stops transfer │
                │ Exposes transfer state  │
                └───────────┬─────────────┘
                            │
                            │ UDP
                            │
              ┌─────────────▼─────────────┐
              │      UDP File Server      │
              │                           │
              │ Receive packets           │
              │ Validate sequence         │
              │ Send ACKs                 │
              │ Reconstruct file          │
              └───────────────────────────┘
```

For the initial version, the Python controller may expose simple HTTP endpoints to the Next.js frontend.

WebSockets/SSE may be added if useful for live statistics, but do not make the project unnecessarily complex.

---

# 3. Main Application

Create a professional dashboard called:

## FastShare

### Subtitle

**Reliable File Transfer over UDP**

The application should look like a real networking tool rather than a generic CRUD website.

Avoid making it look like a normal file-upload website.

The UI should visually communicate:

- packets
- transmission
- ACKs
- retransmissions
- sender
- receiver
- network status

---

# 4. UI Requirements

The UI is an important part of the project.

It should be:

- Clean
- Modern
- Technical
- Easy to understand
- Suitable for a university project demonstration
- Responsive
- Dark-mode oriented or use a professional dark/light hybrid
- Not overloaded with unnecessary animations

Use cards, badges, icons, progress indicators, and small visualizations.

---

# 5. Dashboard Layout

The main page should contain the following sections.

## Header

Display:

```text
FastShare
Reliable File Transfer over UDP

● Server Connected
```

Also show:

```text
UDP
PORT 5001
```

and a settings button.

---

# 6. Connection Status Card

Create a prominent card:

```text
NETWORK STATUS

● Connected

Server
192.168.1.10

UDP Port
5001

Protocol
UDP / Custom Reliable Transfer
```

Possible statuses:

- Connected
- Connecting
- Disconnected
- Error

Use clear visual indicators.

---

# 7. File Selection Card

Create a large drag-and-drop area.

Example:

```text
┌──────────────────────────────────────────────┐
│                                              │
│                    ↑                         │
│                                              │
│              Drop your file here             │
│                                              │
│              or browse files                 │
│                                              │
│         Maximum size: configurable           │
│                                              │
└──────────────────────────────────────────────┘
```

After selecting:

```text
Selected File

📄 example.zip

Size
12.4 MB

Packets
~812

[ Remove ]
```

The packet count should be calculated based on the configured payload size.

---

# 8. Transfer Configuration

Provide a configuration card.

Fields:

```text
Server IP
[ 127.0.0.1 ]

UDP Port
[ 5001 ]

Packet Size
[ 1024 ]

Timeout
[ 500 ms ]

Window Size
[ 1 ]
```

For the current implementation, keep the window size at `1`.

This means the implementation can use **Stop-and-Wait ARQ**.

Do not implement a sliding window yet.

---

# 9. Transfer Control

Provide:

```text
[ Start Transfer ]
```

During transfer:

```text
[ Transfering... ]

[ Cancel ]
```

After completion:

```text
✓ Transfer Complete
```

The frontend should prevent invalid states.

For example:

- Don't allow transfer without selecting a file.
- Don't allow multiple transfers simultaneously.
- Don't allow Start while already transferring.

---

# 10. Main Transfer Visualization

This is one of the most important UI components.

Show a visual representation of:

```text
SENDER                                      RECEIVER

┌──────────────┐                         ┌──────────────┐
│              │                         │              │
│    CLIENT    │ ───── DATA #001 ─────> │    SERVER    │
│              │                         │              │
│              │ <──────── ACK #001 ──── │              │
│              │                         │              │
└──────────────┘                         └──────────────┘
```

During transfer, animate or highlight the current packet.

Example:

```text
Packet #127
      │
      ├────────────── DATA ──────────────►
      │
      ◄────────────── ACK ────────────────
      │
      ✓ Confirmed
```

This is much more useful for the professor than simply showing a progress bar.

---

# 11. Packet Monitor

Create a live packet table.

Columns:

| Sequence | Type | Size | Status | Retries |
|---|---|---:|---|---:|
| 1 | DATA | 1024 B | ACKED | 0 |
| 2 | DATA | 1024 B | ACKED | 0 |
| 3 | DATA | 1024 B | RETRANSMITTED | 1 |
| 4 | DATA | 1024 B | SENT | 0 |

Statuses:

- SENT
- WAITING
- ACKED
- TIMEOUT
- RETRANSMITTED
- FAILED

This table should update during transfer.

Only keep a reasonable number of recent packets in the UI to avoid rendering thousands of rows.

---

# 12. Transfer Progress

Create a prominent progress section.

Example:

```text
TRANSFER PROGRESS

████████████████████░░░░░░░░░░

67%

8.4 MB / 12.4 MB

Packet 682 / 1000
```

The progress should be based on actual packets acknowledged, not just a frontend timer.

---

# 13. Networking Statistics

For the current phase, show the statistics that are already available.

Example:

```text
PACKETS SENT       682
PACKETS ACKED      681
RETRANSMISSIONS      4
PACKETS LOST         1
CURRENT SEQUENCE   682
```

If some statistics are not fully implemented yet, display:

```text
Checksum
Coming Soon

Resume Transfer
Coming Soon
```

Do NOT fake values.

---

# 14. Protocol Information Panel

Create a small expandable section:

```text
Protocol Details

Transport Layer
UDP

Reliability
Stop-and-Wait ARQ

Packet Size
1024 bytes

Sequence Numbers
Enabled

Acknowledgements
Enabled

Retransmission
Enabled
```

This makes the networking concepts immediately visible during the demo.

---

# 15. Packet Structure

Implement a simple custom packet format.

Recommended structure:

```text
+------------------+
| Sequence Number  |
+------------------+
| Packet Type      |
+------------------+
| Payload Length   |
+------------------+
| Payload          |
+------------------+
```

For example:

```text
Sequence Number : 4 bytes
Packet Type     : 1 byte
Payload Length  : 4 bytes
Payload         : variable
```

Use Python's `struct` module for serialization/deserialization.

Do not use JSON for the actual UDP data packets.

JSON may be used for communication between the Next.js UI and Python controller.

---

# 16. Packet Types

Define basic packet types.

For example:

```text
START
DATA
ACK
END
```

Optional:

```text
ERROR
```

The implementation should be simple and clearly documented.

---

# 17. UDP Client

Create a Python UDP client.

Responsibilities:

1. Open UDP socket.
2. Connect to server IP and port.
3. Read selected file.
4. Divide file into packets.
5. Assign sequence numbers.
6. Send packets.
7. Wait for ACK.
8. Handle timeout.
9. Retransmit packet when required.
10. Continue until all packets are acknowledged.
11. Send END packet.

---

# 18. File Packetization

Read the file in chunks.

Example:

```python
PACKET_SIZE = 1024
```

For a 5000-byte file:

```text
Packet 0 → bytes 0–1023
Packet 1 → bytes 1024–2047
Packet 2 → bytes 2048–3071
Packet 3 → bytes 3072–4095
Packet 4 → bytes 4096–4999
```

Every packet must have a unique sequence number.

---

# 19. Sequence Numbers

Start from:

```text
0
```

or

```text
1
```

and increment for every DATA packet.

Example:

```text
DATA #001
DATA #002
DATA #003
DATA #004
```

The receiver must use sequence numbers to identify packets.

It should not simply append packets blindly.

---

# 20. ACK Mechanism

After receiving a valid DATA packet:

```text
Client                         Server

DATA #12 ────────────────────►

       ◄──────────────────── ACK #12
```

The client should not send the next packet until the ACK is received.

This creates a basic Stop-and-Wait ARQ mechanism.

---

# 21. Retransmission

Implement a timeout.

Example:

```text
Timeout = 500 ms
```

Flow:

```text
Send DATA #15
        │
        ▼
Wait for ACK
        │
        ├── ACK received
        │       ↓
        │   Send #16
        │
        └── Timeout
                ↓
          Retransmit #15
```

Track:

```text
retry_count
```

Add a maximum retry limit.

Example:

```text
MAX_RETRIES = 5
```

If the maximum number of retries is exceeded:

```text
Transfer Failed
```

---

# 22. Testing Packet Loss

This is extremely important for the project demonstration.

The system should have a **testing/debug mode** that allows artificial packet loss.

Example setting:

```text
Packet Loss Simulation

[ OFF ]

or

Loss Probability
[ 10% ]
```

When enabled, randomly drop selected packets on the server/client test layer.

Then demonstrate:

```text
DATA #24
      ↓
   LOST

Timeout

DATA #24
      ↓
RETRANSMITTED

ACK #24
```

This allows the professor to actually see retransmission working.

Do not implement complicated network manipulation.

Simply simulate packet loss inside the application for testing.

---

# 23. Testing Modes

Provide a small testing panel.

```text
TESTING

Packet Loss
[ OFF ▼ ]

Loss Probability
[ 10% ]

[ Run Test ]
```

Test scenarios:

### Test 1 — Normal Transfer

```text
Packet Loss = 0%
```

Expected:

```text
All packets ACKed
0 retransmissions
File successfully reconstructed
```

### Test 2 — Packet Loss

```text
Packet Loss = 10%
```

Expected:

```text
Some packets timeout
Retransmissions occur
Eventually file transfer succeeds
```

### Test 3 — High Packet Loss

```text
Packet Loss = 50%
```

Expected:

```text
Multiple retransmissions
Possible transfer failure after retry limit
```

---

# 24. Receiver

The Python UDP server should:

1. Bind to UDP port.
2. Wait for START.
3. Create/prepare destination file.
4. Receive DATA packets.
5. Read sequence number.
6. Validate sequence.
7. Write payload.
8. Send ACK.
9. Detect duplicate packets.
10. Handle END.
11. Close the transfer.

---

# 25. Duplicate Packet Handling

This is important because retransmission can cause duplicate packets.

Example:

```text
Client                 Server

DATA #5 ──────────────►
                        │
                        ├── Save #5
                        │
ACK #5 ◄───────────────┘

ACK gets lost

DATA #5 ──────────────►

Server recognizes:
"Already received #5"

Do NOT write it twice.

ACK #5 ◄───────────────
```

This should be implemented and demonstrated.

---

# 26. Current Scope: Checksum

Checksum functionality is **NOT required to be fully completed in this phase**.

However, structure the packet format so checksum can be added later.

Future packet:

```text
+------------------+
| Sequence Number  |
+------------------+
| Packet Type      |
+------------------+
| Payload Length   |
+------------------+
| Checksum         |
+------------------+
| Payload          |
+------------------+
```

For now:

```text
Checksum: NOT IMPLEMENTED
```

Do not pretend checksum verification is complete.

---

# 27. Current Scope: Resume

Resume functionality is also **not required to be completed now**.

Prepare the architecture so that later the server can determine:

```text
Last successfully received sequence
```

and the client can continue from that packet.

UI should simply show:

```text
Resume Transfer
Coming Soon
```

or place it under:

```text
Planned Features
```

---

# 28. Current Scope: Transfer Statistics

Basic live counters should be implemented where data is already available.

Do not build an elaborate analytics system yet.

Current useful statistics:

```text
Packets Sent
Packets ACKed
Retransmissions
Current Sequence
Bytes Sent
Transfer Progress
```

Advanced statistics can remain planned:

```text
Average RTT
Packet Loss %
Average Throughput
Checksum Failures
```

---

# 29. Backend API

Create a small Python API/controller layer.

Possible endpoints:

```text
GET /api/status

POST /api/server/start

POST /api/server/stop

POST /api/transfer/start

POST /api/transfer/cancel

GET /api/transfer/status

GET /api/transfer/packets

POST /api/testing/config
```

The exact implementation can use Flask or FastAPI.

Prefer **FastAPI** if convenient.

---

# 30. Frontend API Integration

Next.js should communicate with the Python controller.

The frontend should never directly implement UDP.

Architecture:

```text
Next.js
   │
   │ HTTP
   ▼
FastAPI Controller
   │
   │ Python functions
   ▼
UDP Client / UDP Server
```

---

# 31. Project Structure

Use a clean monorepo structure.

```text
fastshare/
│
├── frontend/
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── hooks/
│   └── public/
│
├── backend/
│   ├── main.py
│   ├── api/
│   │   ├── routes.py
│   │   └── models.py
│   │
│   ├── udp/
│   │   ├── client.py
│   │   ├── server.py
│   │   ├── packet.py
│   │   └── protocol.py
│   │
│   ├── transfer/
│   │   └── manager.py
│   │
│   └── tests/
│       ├── test_packet.py
│       ├── test_transfer.py
│       └── test_retransmission.py
│
├── transfers/
│
├── README.md
└── PROJECT_PLAN.md
```

---

# 32. Code Quality Requirements

Keep networking logic separate from UI.

Do NOT put all logic into one Python file.

Use separate modules for:

- Packet creation
- Packet parsing
- UDP communication
- Transfer management
- API
- Testing

Use clear names.

Add comments around networking logic.

Avoid unnecessary abstractions.

The project should be understandable by a student during viva.

---

# 33. Testing Requirements

Create automated/basic tests for:

### Packetization

Verify:

```text
File → packets → reconstructed file
```

produces exactly the original file.

### Sequence Numbers

Verify every DATA packet receives the expected sequence number.

### ACK

Verify:

```text
DATA #N
ACK #N
```

### Retransmission

Simulate packet loss.

Verify that a timeout causes retransmission.

### Duplicate Handling

Send the same packet twice.

Verify that the receiver does not duplicate its payload.

### Complete Transfer

Transfer a test file and compare:

```text
Original file
       ==
Received file
```

Use hashes such as SHA-256 for testing file equality.

---

# 34. Demonstration Flow

The final demo should follow this sequence.

## Demo 1 — Server

Start the UDP server.

Show:

```text
Server Running
IP: 127.0.0.1
Port: 5001
Status: Listening
```

---

## Demo 2 — Normal Transfer

Select a file.

Example:

```text
sample.pdf
2.4 MB
```

Click:

```text
Start Transfer
```

Show:

```text
DATA #1 → ACK #1
DATA #2 → ACK #2
DATA #3 → ACK #3
...
```

Eventually:

```text
✓ Transfer Complete
```

---

## Demo 3 — Packet Loss

Enable:

```text
Packet Loss: 10%
```

Start transfer.

Demonstrate:

```text
DATA #17 → LOST

TIMEOUT

DATA #17 → RETRANSMITTED

ACK #17
```

This should be clearly visible in the UI.

---

## Demo 4 — Duplicate Packet

Demonstrate a duplicate packet.

Show:

```text
DATA #25
ACK #25

DATA #25
DUPLICATE

ACK #25
```

Explain that the server does not write the same payload twice.

---

# 35. What NOT to Implement Yet

Do not spend time implementing these unless the core requirements are finished:

- Authentication
- User accounts
- Database
- Cloud deployment
- Redis
- Encryption
- P2P networking
- Multi-user transfers
- Sliding Window
- Congestion control
- Complex routing
- Advanced analytics
- Mobile application

These are outside the current academic scope.

---

# 36. Future Work

Mention these in the README/report as future improvements:

1. Checksum verification
2. Resume interrupted transfers
3. Transfer statistics
4. Sliding Window ARQ
5. Congestion control
6. Multiple simultaneous transfers
7. Encryption
8. Authentication
9. Persistent transfer history

Do not claim these are implemented.

---

# 37. README Requirements

The README should contain:

## Project Title

**FastShare — Reliable File Transfer over UDP**

## Abstract

Briefly explain that the project implements a reliable file transfer mechanism over UDP by adding sequence numbers, acknowledgements, timeout-based retransmission, and packetization.

## Architecture

Include a diagram.

## Features

Clearly separate:

### Completed

- UDP Client-Server Communication
- File Packetization
- Sequence Numbers
- ACK Mechanism
- Basic Retransmission
- Duplicate Packet Handling
- Packet Loss Simulation

### In Progress

- Checksum Verification
- Resume Functionality
- Transfer Statistics

## Technologies

```text
Next.js
React
TypeScript
Tailwind CSS
Python
FastAPI
UDP Sockets
```

## How to Run

Give exact commands for:

```bash
cd backend
pip install -r requirements.txt
python main.py
```

and:

```bash
cd frontend
npm install
npm run dev
```

## Testing

Explain the three major test cases:

1. Normal transfer
2. Packet loss/retransmission
3. Duplicate packet handling

---

# 38. Development Priority

Implement in this exact order.

### Phase 1

Set up:

- Next.js
- Tailwind
- FastAPI
- Python UDP server
- Python UDP client

### Phase 2

Implement:

- UDP communication
- Basic file transfer

### Phase 3

Implement:

- Packetization
- Sequence numbers

### Phase 4

Implement:

- ACK mechanism
- Stop-and-Wait

### Phase 5

Implement:

- Timeout
- Retransmission

### Phase 6

Implement:

- Duplicate packet handling
- Packet loss simulation

### Phase 7

Connect everything to the Next.js UI.

### Phase 8

Build the packet monitor and transfer visualization.

### Phase 9

Add tests.

### Phase 10

Polish the UI and README.

Only after all of these are stable should work begin on:

- Checksum
- Resume
- Advanced statistics

---

# 39. Definition of Done

The current project phase is considered complete when:

- [ ] Next.js dashboard works
- [ ] Python UDP server works
- [ ] Python UDP client works
- [ ] Files can be packetized
- [ ] Sequence numbers are attached
- [ ] Server recognizes sequence numbers
- [ ] Server sends ACKs
- [ ] Client waits for ACK
- [ ] Timeout is implemented
- [ ] Lost packets are retransmitted
- [ ] Duplicate packets are handled
- [ ] Packet loss can be simulated
- [ ] UI displays actual transfer progress
- [ ] UI displays packet activity
- [ ] UI displays ACK activity
- [ ] UI displays retransmissions
- [ ] A transferred file matches the original
- [ ] Testing scenarios can be demonstrated
- [ ] README explains architecture and implementation
- [ ] No unfinished feature is falsely shown as completed

---

# 40. Important Development Principle

**Prioritize correctness over features.**

The project should be able to clearly demonstrate:

```text
FILE
  ↓
PACKETIZATION
  ↓
SEQUENCE NUMBER
  ↓
UDP
  ↓
SERVER
  ↓
ACK
  ↓
NEXT PACKET
```

and when a packet is lost:

```text
PACKET
   ↓
LOST
   ↓
TIMEOUT
   ↓
RETRANSMISSION
   ↓
ACK
   ↓
CONTINUE
```

The professor should be able to see these mechanisms happening through the UI rather than having to trust console logs.

The frontend is a visualization/control layer. The **actual networking implementation must remain genuine UDP socket communication**, not a simulated frontend animation.

Build the smallest correct implementation first, then progressively improve the UI and testing experience.