# Campus Nexus: A Distributed Event-Driven Platform for Intelligent Campus Networking and Collaboration

> **One-line pitch:** Campus Nexus is an intelligent distributed campus networking platform that transforms files, messages, alerts, and network activity into synchronized events, enabling offline-first collaboration, adaptive communication, intelligent synchronization, and real-time campus connectivity.

---

## Framing

Campus Nexus is not "file sync + messaging" — it is a **distributed event-driven campus infrastructure**.

---

## Problem Statement

### Campus Nexus: A Distributed Event-Driven Platform for Intelligent Campus Networking and Collaboration

Modern campus collaboration depends heavily on cloud platforms, internet connectivity, and disconnected applications for communication, file sharing, notifications, and activity tracking. This creates several challenges: communication may be delayed or fragmented, large files may need to be repeatedly uploaded and downloaded, users lack a unified view of ongoing activities, and collaboration can be disrupted when internet connectivity is poor or unavailable.

At the same time, existing local-network solutions are often limited to either file sharing or messaging and do not provide a unified mechanism to intelligently synchronize resources, deliver events, maintain distributed consistency, and manage network resources.

**The problem is to design and implement an intelligent, distributed, event-driven platform that enables devices connected within a campus or local network to communicate, synchronize files, exchange messages and alerts, and collaboratively share resources without depending entirely on external cloud infrastructure.**

The system should treat every significant activity — such as file creation, modification, deletion, synchronization, message transmission, acknowledgements, and network events — as a structured **event**. These events are distributed across the participating devices, allowing the system to maintain a shared and consistent view of collaboration activities.

The platform will further explore intelligent techniques for optimizing synchronization, prioritizing important events and alerts, detecting abnormal network or file-system behaviour, and making adaptive decisions based on device and network conditions.

---

## In Simple Words: What Are We Actually Making?

### We are building a **private campus collaboration network**

Imagine combining:

* **Dropbox/Google Drive** → Local distributed file synchronization
* **Slack/Discord** → Real-time messaging
* **Notification/alert system** → Important campus announcements
* **Git-style activity history** → Track what happened and when
* **A network monitoring system** → Know the health of connected nodes

But instead of building five separate applications, **Campus Nexus connects all of them through one distributed event system**.

---

## The Core Idea

Every device runs a lightweight **Campus Nexus Node/Agent**.

```text
              ┌──────────────────┐
              │   CAMPUS NEXUS   │
              │   Web Dashboard  │
              └────────┬─────────┘
                       │
              ┌────────▼─────────┐
              │ Distributed Event │
              │       Layer       │
              └─────┬───────┬────┘
                    │       │
          ┌─────────▼──┐ ┌──▼──────────┐
          │  Node A    │ │   Node B    │
          │  Laptop    │ │  Laboratory │
          └─────────┬──┘ └──┬──────────┘
                    │       │
                 Files    Messages
                 Events   Sync Data
                    │       │
                 ┌──▼───────▼──┐
                 │   Node C    │
                 │    Server   │
                 └─────────────┘
```

Whenever something happens, the device generates an event.

For example:

```text
Student modifies Assignment.pdf
              │
              ▼
       FILE_MODIFIED event
              │
              ├──► Version history updated
              ├──► Synchronization initiated
              ├──► Relevant users notified
              ├──► Event stored
              └──► Dashboard updated
```

Similarly:

```text
Professor sends urgent announcement
              │
              ▼
         ALERT event
              │
              ├──► Distributed to nodes
              ├──► Priority calculated
              ├──► Notification delivered
              └──► Acknowledgement tracked
```

**This event-driven architecture is the heart of the project.**

---

## What Will the Final System Contain?

### 1. Distributed Local File Synchronization

Users or departments can share specific folders across multiple machines.

```text
Computer Science Department
         │
         ├── Student Lab
         │
         ├── Faculty PC
         │
         └── Department Server
```

When a file changes:

```text
File Change
    ↓
File Watcher detects change
    ↓
Event generated
    ↓
Version calculated
    ↓
Changed data synchronized
    ↓
Peers receive update
```

#### Features

* Automatic file synchronization
* Folder-based sharing
* Peer discovery
* Version tracking
* Chunked file transfer
* Resume interrupted transfers
* Conflict detection
* File integrity verification using hashing
* Selective synchronization

#### Advanced Aspect

Rather than blindly sending an entire file again:

```text
2 GB File
     ↓
Only 20 MB changed
     ↓
Detect changed blocks
     ↓
Transfer only required chunks
```

This gives you a genuine systems/networking component.

---

### 2. Event-Based Messaging System

This is not just "chat."

Messages themselves are events.

```text
MESSAGE_SENT
FILE_SHARED
FILE_MODIFIED
USER_MENTIONED
ALERT_CREATED
ALERT_ACKNOWLEDGED
DEVICE_OFFLINE
```

Users can have:

* Direct messages
* Project/group channels
* Department channels
* File-specific discussions
* Message delivery status
* Read acknowledgements

A particularly interesting feature:

#### **Files and messages are connected.**

For example:

```text
Project Folder
│
├── ML_Model.py
│
├── Dataset.csv
│
└── Discussion
     ├── Rahul: I updated the model.
     ├── Priya: Accuracy decreased.
     └── Prathmesh: Check version 4.
```

Instead of communication existing separately from the files, every resource has its own **activity stream**.

---

### 3. Campus Alert and Emergency Notification System

This gives the project a genuine campus use case.

Examples:

```text
URGENT
Network maintenance in Laboratory 3.
Requires acknowledgement.
```

```text
CRITICAL
Fire emergency.
Evacuate Building B.
```

The system distributes alerts through the local network and records:

* Who received it
* Who acknowledged it
* Who is offline
* Delivery latency

Priority levels:

```text
Critical
   ↓
Urgent
   ↓
Important
   ↓
Normal
   ↓
Informational
```

This is where your system becomes more than a collaboration platform.

---

### 4. Distributed Event Log

This is probably one of the coolest architectural parts.

Every major event becomes part of a persistent event history.

```text
10:30  FILE_CREATED
10:32  FILE_SHARED
10:35  MESSAGE_SENT
10:40  FILE_MODIFIED
10:41  SYNC_COMPLETED
10:45  ALERT_GENERATED
```

You can reconstruct the history of any resource.

Example:

```text
Thesis.pdf
Created
   ↓
Shared with Team
   ↓
Edited
   ↓
Version 2 created
   ↓
Reviewed
   ↓
Approved
```

This creates an **audit trail and time-travel capability**.

---

### 5. Intelligent Event and Sync Engine 🧠

Now comes the ML part.

Instead of adding ML randomly, use it to solve actual problems.

#### A. Notification Prioritization

The system learns:

```text
User ignores
"README updated"
→ Low relevance
```

but:

```text
User immediately opens
"Project Dataset Updated"
→ High relevance
```

A model can rank notifications based on:

* Event type
* Sender
* Project
* Time
* Previous interaction
* File importance

---

#### B. Anomaly Detection

The system learns normal behaviour.

Example:

```text
Normal:
10–50 files modified per hour
```

Suddenly:

```text
8,000 files modified in 2 minutes
```

Possible:

* Ransomware
* Faulty synchronization
* Accidental mass deletion

The anomaly engine detects it and can automatically:

```text
Suspend synchronization
      ↓
Generate critical alert
      ↓
Preserve file versions
      ↓
Allow recovery
```

This is a **much more meaningful ML component**.

---

#### C. Predictive Synchronization

The system can predict:

> "These devices frequently access this project together."

So it can prioritize those files.

Or:

> "Network bandwidth is currently low."

So large synchronization jobs are delayed while urgent messages continue.

---

### 6. Network-Aware Synchronization

This is where the networking syllabus becomes important.

The system continuously monitors:

* Latency
* Available bandwidth
* Packet loss
* Connected peers
* Network availability

Then the sync engine decides:

```text
High-priority alert
        ↓
Send immediately
```

```text
Large media file
        ↓
Network congested
        ↓
Queue or throttle transfer
```

You could use a priority queue:

```text
Priority Queue
Critical Alert       Priority 100
Direct Message        Priority 80
File Metadata         Priority 60
File Synchronization  Priority 40
Large Backup          Priority 10
```

That directly brings **DSA into the core system**, rather than just adding a graph algorithm for presentation.

---

### 7. Optional Distributed Networking Layer

This is where you can make the project technically more ambitious.

#### Peer Discovery

Devices automatically discover each other.

Potential approach:

```text
UDP Broadcast / Multicast
"Who is running Campus Nexus?"
            ↓
Peers respond
            ↓
Network membership established
```

#### Reliable Delivery

Use:

* UDP → Discovery
* TCP → File transfer
* WebSockets → Real-time dashboard
* HTTP/REST → Application APIs

---

### 8. Conflict Resolution

Suppose:

```text
Device A edits Report.docx
```

while:

```text
Device B edits Report.docx
```

at the same time.

The system needs to detect:

```text
VERSION CONFLICT
```

Possible solution:

* Version vectors
* Lamport timestamps
* Vector clocks
* Last-write-wins as fallback

This is an actual **distributed systems problem**, not just a UI feature.

---

### 9. The DSA Component

Don't artificially add "we used BFS" just because you need DSA.

Use DSA in the actual architecture.

#### Priority Queue

For network-aware event scheduling.

#### Hashing

For file integrity and deduplication.

```text
SHA-256
Same hash
→ Don't transfer duplicate data
```

#### Content-defined chunking

For efficient delta synchronization.

#### Graph

Represent devices and connections:

```text
Laptop ─── Switch ─── Server
   │                     │
   └──── WiFi AP ────────┘
```

Possible uses:

* Shortest network path
* Identify central nodes
* Detect isolated nodes
* Analyze communication relationships

#### Consistent Hashing

Potentially for distributing events or files across nodes.

---

## Final Architecture

```text
                    CAMPUS NEXUS

 ┌───────────────────────────────────────────┐
 │              REACT WEB APP                │
 │                                           │
 │ Dashboard │ Files │ Chat │ Alerts │ Admin │
 └─────────────────────┬─────────────────────┘
                       │
               REST / WebSocket
                       │
 ┌─────────────────────▼─────────────────────┐
 │           APPLICATION BACKEND             │
 │                                           │
 │ Authentication                            │
 │ Event Management                          │
 │ Message Service                           │
 │ Alert Service                             │
 │ Sync Coordinator                          │
 │ ML Intelligence Engine                    │
 └─────────────────────┬─────────────────────┘
                       │
             Distributed Event Bus
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
   ┌────────┐      ┌────────┐      ┌────────┐
   │ Node A │      │ Node B │      │ Node C │
   │ Agent  │      │ Agent  │      │ Agent  │
   └───┬────┘      └───┬────┘      └───┬────┘
       │               │               │
 File Watcher      File Watcher      File Watcher
 Sync Engine       Sync Engine       Sync Engine
 Network Agent     Network Agent     Network Agent
 Event Client      Event Client      Event Client
```

---

## What Makes This Different?

The project is **not**:

> ❌ Local Dropbox + Discord

It is:

> **A distributed event-driven system where file synchronization, messaging, notifications, network events, and intelligent decision-making are all coordinated through a unified event architecture.**

The key technical contribution is the idea that:

```text
FILE EVENT
MESSAGE EVENT
NETWORK EVENT
ALERT EVENT
SYSTEM EVENT
```

are handled by the same underlying distributed infrastructure.

---

## Final One-Line Pitch

**Campus Nexus is an intelligent distributed campus networking platform that transforms files, messages, alerts, and network activity into synchronized events, enabling offline-first collaboration, adaptive communication, intelligent synchronization, and real-time campus connectivity.**

---

## Recommendation for 3-Week, 3-Member Semester Project (MVP)

### Must Build

* Local node/peer discovery
* File watcher + synchronization
* Event-based backend
* Real-time messaging
* Alert system with acknowledgements
* React dashboard
* Persistent event log
* Conflict detection
* Priority-based network scheduling

### Strong ML Feature

**Anomaly detection for suspicious mass file modification/deletion and ransomware-like behaviour.**

### Stretch Goals

* Version vectors
* Predictive synchronization
* ML-based notification ranking
* Fully decentralized operation if the server fails

> The core system itself is already technically substantial; don't bury it under unnecessary "AI features." The anomaly-detection angle gives you the ML uniqueness, while the **event-driven distributed synchronization architecture** remains the actual research-worthy centre of the project.
