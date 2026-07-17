# Manual Room Probe and Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace recurring prepared-room probes with a serial startup/manual queue, enforce a 60-second manual cooldown, and preserve valid room metadata when Douyin returns a verification page.

**Architecture:** Extend the shared live-status contract with `verification_required`, recognize verification copy before all other page classifications, and make probe persistence merge status-only failures with the previous snapshot. Refocus `ProbeScheduler` as a serial deduplicating queue with a verification circuit breaker; renderer cooldown remains local UI state while the main process enforces the same cooldown authoritatively.

**Tech Stack:** Electron, TypeScript, React, Zod, Vitest, SQLite.

## Global Constraints

- Do not create a branch, commit, or push.
- Startup probes run serially once; prepared rooms do not recur automatically.
- Manual probes for the same room are rejected for 60 seconds.
- Verification pages stop queued probes and never overwrite valid metadata.

---

### Task 1: Verification status and metadata preservation

**Files:**
- Modify: `src/main/rooms/live-probe.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/main.ts`
- Test: `tests/unit/live-probe.test.ts`
- Test: `tests/unit/database.test.ts`

**Interfaces:**
- Produces: `LiveStatus` including `verification_required`.
- Produces: `classifyProbe(evidence)` that prioritizes verification-page evidence.

- [ ] Add failing classifier and snapshot-preservation tests.
- [ ] Run `npm test -- --run tests/unit/live-probe.test.ts tests/unit/database.test.ts` and confirm the new status is unsupported.
- [ ] Add the status to probe/runtime/snapshot schemas and renderer labels.
- [ ] Persist verification, timeout, and page errors as status-only observations so existing metadata remains.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: Serial one-shot probe queue and cooldown

**Files:**
- Modify: `src/main/rooms/probe-scheduler.ts`
- Modify: `src/main/main.ts`
- Test: `tests/unit/probe-scheduler.test.ts`

**Interfaces:**
- Produces: `runNow(roomId, options?)` with room deduplication and 60-second cooldown.
- Produces: `runStartup(roomIds)` for one serial startup pass.
- Produces: verification circuit-breaker behavior that clears queued work.

- [ ] Replace recurring-schedule expectations with failing tests for serial startup execution, deduplication, cooldown, and queue cancellation after verification.
- [ ] Run `npm test -- --run tests/unit/probe-scheduler.test.ts` and confirm failure.
- [ ] Implement the minimal serial queue and injected clock needed for deterministic cooldown tests.
- [ ] Remove recurring prepared-room scheduling from room/settings lifecycle and enqueue one startup pass.
- [ ] Re-run the scheduler tests and confirm they pass.

### Task 3: Manual-probe button feedback

**Files:**
- Modify: `src/renderer/App.tsx`
- Test: `tests/unit/app.test.tsx`

**Interfaces:**
- Consumes: `window.duoduo.rooms.probe(roomId)`.
- Produces: per-room 60-second disabled countdown and `verification_required` copy.

- [ ] Add a failing renderer test for disabled cooldown and verification label.
- [ ] Run the focused renderer test and confirm failure.
- [ ] Implement per-room countdown state with timer cleanup.
- [ ] Re-run the focused renderer test and confirm it passes.

### Task 4: Regression verification

**Files:**
- Verify only.

- [ ] Run all unit and integration tests with `npm test -- --run`.
- [ ] Run `npm run lint` if defined and `npm run make` only if the existing package scripts designate it as the normal build check.
- [ ] Inspect `git diff --check` and `git status --short`; keep all changes uncommitted.
