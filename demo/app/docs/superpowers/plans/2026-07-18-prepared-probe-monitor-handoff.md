# Prepared Probe Monitor Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse a recently detected live page when monitoring starts so ASR begins without a second navigation or probe.

**Architecture:** A focused lease pool owns capture-ready prepared pages until a RoomSession consumes one. RoomSession accepts an optional page and falls back to its existing gated navigation when the page is unavailable. Renderer state separates trusted live status from ASR connection progress.

**Tech Stack:** Electron, TypeScript, React, Vitest

## Global Constraints

- Lease duration is exactly 3 minutes.
- Only live probe pages may be leased.
- A BrowserWindow has exactly one owner and is destroyed once.
- Do not create a branch or push code.

---

### Task 1: Prepared page lease pool

**Files:**
- Create: `src/main/rooms/prepared-page-lease.ts`
- Test: `tests/unit/prepared-page-lease.test.ts`

**Interfaces:**
- Produces: `PreparedRoomPage`, `PreparedPageLeasePool.put(roomId, page)`, `take(roomId)`, `remove(roomId)`, and `dispose()`.

- [x] Write tests for one-time consumption, expiry disposal, replacement disposal and invalid-page rejection.
- [x] Run the focused test and confirm it fails because the module is absent.
- [x] Implement the minimal lease pool with a 180,000 ms default TTL.
- [x] Run the focused test and confirm it passes.

### Task 2: RoomSession page adoption

**Files:**
- Modify: `src/main/rooms/room-session.ts`
- Modify: `tests/unit/room-session.test.ts`

**Interfaces:**
- Consumes: `PreparedRoomPage`.
- Produces: an optional final constructor argument used only on the first `start()`.

- [x] Add a failing test asserting an adopted live page skips BrowserWindow construction, the navigation gate and `probeRoom`, then opens ASR.
- [x] Verify missing or invalid prepared pages continue through the existing gated navigation path.
- [x] Implement page adoption and shared event wiring without duplicating ownership.
- [x] Run RoomSession tests and confirm they pass.

### Task 3: Main-process handoff integration

**Files:**
- Modify: `src/main/main.ts`
- Test through: `tests/unit/prepared-page-lease.test.ts`, `tests/unit/room-session.test.ts`

**Interfaces:**
- Prepared probes create capture-ready pages and put live results in the pool.
- User-start RoomSessions consume a lease; reconnect sessions do not.

- [x] Create prepared probe windows with capture preload and tokens.
- [x] Retain live windows in the pool and destroy all non-live windows.
- [x] Consume leases for user starts, remove leases when rooms are removed, and dispose the pool during shutdown.
- [x] Run main-process unit tests and typecheck.

### Task 4: Renderer state semantics

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/LiveRoomWorkspace.tsx`
- Modify: `tests/unit/app-room-form.test.tsx`

**Interfaces:**
- A starting runtime cannot overwrite an existing trusted snapshot status.
- `starting` maps to “正在连接 ASR”; `monitoring` maps to “ASR 识别中”.

- [x] Add a failing renderer test for a live snapshot with a starting runtime.
- [x] Implement stable snapshot display and user-facing ASR labels.
- [x] Run the focused renderer test and confirm it passes.

### Task 5: Full verification

**Files:**
- Verify all modified files.

- [x] Run `npm run typecheck`.
- [x] Run the full Vitest suite.
- [x] Run the Electron build.
- [x] Run `git diff --check` and inspect the final diff without staging unrelated changes.
