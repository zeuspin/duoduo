# Monitoring Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make monitored rooms survive broadcaster stop/resume cycles without renderer churn, resource growth, or a permanent white main window.

**Architecture:** `RoomManager` owns the explicit monitoring state machine and wait timers; `RoomSession` owns one complete capture resource lifecycle. Offline is a normal wait state, while technical failures use a cross-cycle circuit breaker. Main-window recovery and persistent diagnostics provide containment and evidence for independent renderer failures.

**Tech Stack:** Electron 39, TypeScript 5.9, React 19, Vitest 4.

## Global Constraints

- Do not create a Git branch or push code.
- Only one active start, recovery, or offline probe may exist per room.
- Broadcaster offline must not be reported as `page_error`.
- All timers and Electron resources must be released by stop and shutdown.

---

### Task 1: Offline wait and automatic resumption

**Files:**
- Modify: `src/main/rooms/room-manager.ts`
- Modify: `src/shared/contracts.ts`
- Test: `tests/unit/room-manager.test.ts`

**Interfaces:**
- Consume `MonitorSession.start()` failures and `subscribeFailure()` events.
- Produce the `waiting_for_live` runtime state, a single delayed restart, and cancellation through `stopMonitoring()`.

- [ ] Add failing tests for offline classification, one scheduled retry, successful resumption, and cancellation.
- [ ] Run the focused tests and verify they fail for missing waiting behavior.
- [ ] Implement failure classification and a per-entry waiting timer/task with configurable test delay.
- [ ] Run focused tests and verify they pass.

### Task 2: Cross-cycle technical recovery circuit breaker

**Files:**
- Modify: `src/main/rooms/room-manager.ts`
- Test: `tests/unit/room-manager.test.ts`

**Interfaces:**
- Consume technical session failures.
- Produce bounded recovery whose budget does not reset after a very short successful session.

- [ ] Add a failing test that repeatedly fails immediately after each nominal recovery.
- [ ] Verify the test demonstrates unbounded current behavior.
- [ ] Add a stability window and cooldown probe without concurrent recovery.
- [ ] Verify focused tests pass.

### Task 3: Complete RoomSession cleanup

**Files:**
- Modify: `src/main/rooms/room-session.ts`
- Test: `tests/unit/room-session-lifecycle.test.ts`

**Interfaces:**
- Consume Electron window/session resources through injectable lifecycle helpers where needed.
- Produce idempotent cleanup on normal close and partial startup failure.

- [ ] Add failing lifecycle tests for startup failure and repeated close.
- [ ] Verify resource cleanup expectations fail.
- [ ] Retain the partition and clean all partially initialized resources in `start()` failure and `close()`.
- [ ] Verify focused tests pass.

### Task 4: Persistent diagnostics and main-renderer containment

**Files:**
- Create: `src/main/diagnostics.ts`
- Modify: `src/main/main.ts`
- Test: `tests/unit/diagnostics.test.ts`

**Interfaces:**
- Consume monitoring state transitions and Electron `render-process-gone` events.
- Produce a bounded local log and one controlled main-window reload per cooldown.

- [ ] Add failing tests for redaction/rotation and reload throttling policy.
- [ ] Implement focused pure helpers, wire diagnostics, and handle main Renderer failure.
- [ ] Run focused tests and verify they pass.

### Task 5: Verification and soak coverage

**Files:**
- Modify: `tests/electron/resource-soak.cjs`
- Modify: `reports/resource-soak.json` only when the soak test runs successfully.

- [ ] Add a live/offline cycling fixture with a bounded process-count assertion.
- [ ] Run unit tests, typecheck, package build, and the resource soak.
- [ ] Inspect final process count and macOS crash reports for new Renderer failures.
