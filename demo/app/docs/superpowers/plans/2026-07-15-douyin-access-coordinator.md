# Douyin Access Coordinator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every Douyin page navigation through one serial coordinator, pause globally on platform verification, let the user complete verification in the triggering session, and preserve reliable room data across unavailable probe results.

**Architecture:** Introduce a main-process `DouyinAccessCoordinator` that owns task priority, deduplication, cooldown, global pause state, and the retained verification browser handle. Keep parsing, persistence, monitoring, playback, and rendering in their existing units, but require each navigation entry point to acquire coordinator access. Extend snapshot semantics so attempt state is separate from last reliable state and metrics.

**Tech Stack:** Electron 39, TypeScript 5.9, React 19, Zod 4, Node SQLite, Vitest 4, Testing Library.

## Global Constraints

- Do not create a branch, commit, or push.
- Preserve all existing uncommitted changes and edit overlapping files narrowly.
- Do not automate, solve, inspect, screenshot, or bypass platform verification.
- All Douyin page navigations use one global coordinator; in-page health inspection does not enqueue navigation.
- Background navigation concurrency is exactly 1.
- Startup probes are capped at 20 rooms with a 3–8 second injected random gap.
- Manual probe and avatar refresh each have an authoritative 60-second per-room cooldown starting when navigation actually begins.
- Offline reconnect backoff is 1, 2, 5, then 10 minutes with jitter; subsequent retries remain at 10 minutes.
- Verification pause survives restart, clears queued background work, and is released only after same-session checking plus explicit user confirmation.
- Canceled work is not automatically replayed after recovery.
- `verification_required`, `timeout`, `page_error`, `login_required`, and `checking` never end a live session or overwrite reliable data.

---

## File Structure

**Create**

- `src/main/rooms/douyin-access-coordinator.ts` — pure queue/state/cooldown coordinator with injected clock and random source.
- `src/main/rooms/verification-window.ts` — retains and exposes the triggering Electron window without reading verification input.
- `tests/unit/douyin-access-coordinator.test.ts` — coordinator behavior and deterministic timing.
- `tests/unit/verification-window.test.ts` — visible-window lifecycle and navigation policy using fakes.
- `tests/electron/verification-recovery-e2e.cjs` — fixture-driven end-to-end recovery flow.
- `docs/superpowers/reports/2026-07-15-douyin-access-coordinator-acceptance.md` — command evidence and phase-two handoff.

**Modify**

- `src/shared/contracts.ts` — access state, reliable snapshot fields, and monitoring settings contract.
- `src/main/storage/settings-store.ts` — persisted verification pause and migration from old monitoring settings.
- `src/main/storage/database.ts` — reliable snapshot columns, merge compatibility, and reliable session rules.
- `src/main/rooms/partitions.ts` — shared persistent Douyin session partition name.
- `src/main/rooms/probe-scheduler.ts` — startup cap/gap and delegation to the coordinator; remove duplicate cooldown ownership.
- `src/main/rooms/room-manager.ts` — injected reconnect gate and 1/2/5/10-minute jittered backoff.
- `src/main/rooms/room-session.ts` — return verification outcome without converting it into an offline result.
- `src/main/main.ts` — construct and wire coordinator, verification window, persistent session, IPC, and every navigation entry point.
- `src/main/playback-controller.ts` — acquire/release navigation permission around user-initiated player loading if needed by its existing boundary.
- `src/preload/api.ts` and `src/renderer/global.d.ts` — expose access-state and recovery APIs.
- `src/renderer/App.tsx` and `src/renderer/styles.css` — persistent verification banner, disabled actions, and remove obsolete prepared frequency UI.
- `src/renderer/components/DataManagement.tsx` — confirmed “clear Douyin session” action.
- Existing unit tests for contracts, settings, database, scheduler, manager, renderer API, app, and data management.

---

### Task 1: Shared access-state and reliable-snapshot contracts

**Files:**
- Modify: `src/shared/contracts.ts`
- Test: `tests/unit/contracts.test.ts`

**Interfaces:**
- Produces: `DouyinAccessStateSchema`, `DouyinAccessState`, and reliable fields on `RoomSnapshotSchema`.
- Produces: `MonitoringSettingsSchema` containing only `monitoredCheckSeconds`; old stored `preparedCheckMinutes` remains readable through settings migration, not the public contract.

- [ ] **Step 1: Add failing contract tests**

```ts
expect(DouyinAccessStateSchema.parse({ mode: "verification_paused", roomId: "123", taskType: "manual_probe", triggeredAt: now })).toMatchObject({ mode: "verification_paused" });
expect(RoomSnapshotSchema.parse({ roomId: "123", status: "timeout", checkedAt: now, lastReliableStatus: "live", lastReliableStatusAt: old, metricsObservedAt: old, viewerCount: 42 }).viewerCount).toBe(42);
expect(MonitoringSettingsSchema.parse({ monitoredCheckSeconds: 30 })).toEqual({ monitoredCheckSeconds: 30 });
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npm test -- --run tests/unit/contracts.test.ts`

Expected: FAIL because `DouyinAccessStateSchema` and reliable fields do not exist and the monitoring schema still requires `preparedCheckMinutes`.

- [ ] **Step 3: Add exact schemas and exported types**

```ts
export const DouyinTaskTypeSchema = z.enum(["verification_recovery_check", "user_play", "manual_probe", "avatar_refresh", "monitor_reconnect", "startup_probe"]);
export const DouyinAccessStateSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("normal") }),
  z.object({ mode: z.literal("verification_paused"), roomId: z.string(), taskType: DouyinTaskTypeSchema, triggeredAt: z.string().datetime(), reason: z.literal("verification_required") }),
  z.object({ mode: z.literal("recovery_checking"), roomId: z.string(), taskType: DouyinTaskTypeSchema, triggeredAt: z.string().datetime() }),
  z.object({ mode: z.literal("recovery_ready"), roomId: z.string(), taskType: DouyinTaskTypeSchema, triggeredAt: z.string().datetime() }),
]);
export type DouyinAccessState = z.infer<typeof DouyinAccessStateSchema>;
```

Extend `RoomSnapshotSchema` with optional `lastReliableStatus`, `lastReliableStatusAt`, and `metricsObservedAt`. Change monitoring settings to `{ monitoredCheckSeconds }` only.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `npm test -- --run tests/unit/contracts.test.ts`

Expected: PASS.

---

### Task 2: Pure global access coordinator

**Files:**
- Create: `src/main/rooms/douyin-access-coordinator.ts`
- Create: `tests/unit/douyin-access-coordinator.test.ts`

**Interfaces:**
- Consumes: `DouyinAccessState`, `DouyinTaskType`.
- Produces:

```ts
interface AccessTask<T> { roomId: string; type: DouyinTaskType; run(): Promise<{ value: T; verificationRequired?: boolean }> }
class DouyinAccessCoordinator {
  submit<T>(task: AccessTask<T>): Promise<T>;
  getState(): DouyinAccessState;
  subscribe(listener: (state: DouyinAccessState) => void): () => void;
  beginRecoveryCheck(check: () => Promise<boolean>): Promise<boolean>;
  confirmRecovery(): void;
  stop(): Promise<void>;
}
```

- [ ] **Step 1: Write failing tests for serial execution, priority, deduplication, cooldown, and pause**

Tests must assert: maximum active count is 1; recovery/player/manual/avatar/reconnect/startup priority order for waiting tasks; identical room/type returns the same promise; manual and avatar cooldown begins only when `run` starts; verification clears waiting tasks with `ACCESS_CANCELED_BY_VERIFICATION`; paused submissions fail with `ACCESS_VERIFICATION_PAUSED`; recovery check must pass before `confirmRecovery`; recovery never replays canceled work.

- [ ] **Step 2: Run the coordinator test and confirm RED**

Run: `npm test -- --run tests/unit/douyin-access-coordinator.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal coordinator**

Use injected `{ now, random, setTimer, clearTimer, persistState }`, a priority-sorted pending array, a `Map<string, Promise<unknown>>` keyed by `${type}:${roomId}`, and separate cooldown maps for `manual_probe` and `avatar_refresh`. Resolve canceled queued promises with typed errors; never interrupt the active task.

- [ ] **Step 4: Run the coordinator test and confirm GREEN**

Run: `npm test -- --run tests/unit/douyin-access-coordinator.test.ts`

Expected: PASS with no real timers or network use.

---

### Task 3: Persisted pause state and shared session lifecycle

**Files:**
- Modify: `src/main/storage/settings-store.ts`
- Modify: `src/main/rooms/partitions.ts`
- Test: `tests/unit/settings-store.test.ts`
- Test: `tests/unit/room-partition.test.ts`

**Interfaces:**
- Produces: `getDouyinAccessState()`, `saveDouyinAccessState(state)`, and `douyinPlatformPartitionName = "persist:duoduo-douyin"`.

- [ ] **Step 1: Add failing persistence and migration tests**

```ts
await store.saveDouyinAccessState(paused);
expect(await recreated.getDouyinAccessState()).toEqual(paused);
expect(await oldSettingsStore.getMonitoringSettings()).toEqual({ monitoredCheckSeconds: 30 });
expect(douyinPlatformPartitionName).toBe("persist:duoduo-douyin");
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- --run tests/unit/settings-store.test.ts tests/unit/room-partition.test.ts`

Expected: FAIL for missing access-state methods and partition constant.

- [ ] **Step 3: Implement settings migration and partition constant**

Parse a stored paused/checking/ready state as paused on restart; normal or missing state becomes `{ mode: "normal" }`. Ignore legacy `preparedCheckMinutes` while preserving the rest of the settings file. Do not store cookies or session data in settings.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- --run tests/unit/settings-store.test.ts tests/unit/room-partition.test.ts`

Expected: PASS.

---

### Task 4: Reliable snapshot and live-session semantics

**Files:**
- Modify: `src/main/storage/database.ts`
- Test: `tests/unit/database.test.ts`
- Test: `tests/unit/backup-service.test.ts`

**Interfaces:**
- Consumes: reliable snapshot contract from Task 1.
- Produces: migrated `room_snapshots` columns and merge-safe backup behavior.

- [ ] **Step 1: Add failing database tests**

Create a live snapshot with metrics, then record each unavailable status. Assert attempt status/time changes while title, paths, metrics, reliable status, and `metricsObservedAt` remain unchanged. Assert the active `live_sessions` row stays active. Then record trusted offline and assert it ends at that observation time.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- --run tests/unit/database.test.ts tests/unit/backup-service.test.ts`

Expected: FAIL because timeout/page error clear metrics and unavailable states mutate the session uncertainty state.

- [ ] **Step 3: Add idempotent columns and rewrite persistence rules**

Add `last_reliable_status`, `last_reliable_status_at`, and `metrics_observed_at` columns. For `live`, update reliable state and only replace metrics that are present. For `offline`, update reliable status but retain last live metrics. For unavailable/checking statuses, only update attempt status, checked time, and error. Change `updateSession` to return immediately for every non-`live`, non-`offline` status.

- [ ] **Step 4: Make backup merge column-explicit**

Replace `INSERT ... SELECT *` for `room_snapshots` with explicit common columns so old backups remain importable; map missing reliable columns from imported status/checked time only when status is `live` or `offline`.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `npm test -- --run tests/unit/database.test.ts tests/unit/backup-service.test.ts`

Expected: PASS.

---

### Task 5: Verification-window controller

**Files:**
- Create: `src/main/rooms/verification-window.ts`
- Create: `tests/unit/verification-window.test.ts`

**Interfaces:**
- Produces:

```ts
interface VerificationBrowserHandle {
  show(): void;
  isDestroyed(): boolean;
  currentUrl(): string;
  inspectBlockedState(): Promise<"verification_required" | "login_required" | "clear">;
  destroy(): void;
}
class VerificationWindowController {
  retain(handle: VerificationBrowserHandle, context: { roomId: string; taskType: DouyinTaskType; triggeredAt: string }): void;
  show(): void;
  check(): Promise<boolean>;
  release(): void;
}
```

- [ ] **Step 1: Add failing fake-handle tests**

Assert retain/show reuses the same handle; closing/destroying it keeps the system paused and makes `check()` fail with `VERIFICATION_WINDOW_LOST`; `check()` only calls `inspectBlockedState`; blocked states return false; `clear` returns true; disallowed navigation is rejected by the Electron adapter without inspecting page inputs.

- [ ] **Step 2: Run focused test and confirm RED**

Run: `npm test -- --run tests/unit/verification-window.test.ts`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement controller and centralized hostname policy**

Allow exact `douyin.com` subdomains and only additional official hostnames observed in the fixture/real redirect chain and explicitly listed in one constant. Block popups, downloads, and non-allowlisted in-window navigation. The controller must not expose `executeJavaScript` beyond the dedicated blocked-state classifier.

- [ ] **Step 4: Run focused test and confirm GREEN**

Run: `npm test -- --run tests/unit/verification-window.test.ts`

Expected: PASS.

---

### Task 6: Startup scheduling and monitored reconnect backoff

**Files:**
- Modify: `src/main/rooms/probe-scheduler.ts`
- Modify: `src/main/rooms/room-manager.ts`
- Test: `tests/unit/probe-scheduler.test.ts`
- Test: `tests/unit/room-manager.test.ts`

**Interfaces:**
- Consumes: coordinator `submit` for actual page starts.
- Produces: capped/gapped startup enumeration and reconnect callback gated by coordinator.

- [ ] **Step 1: Add failing deterministic timing tests**

Scheduler tests assert only the first 20 ordered rooms execute and starts occur after injected 3–8 second gaps. Manager tests inject a backoff calculator and assert 1/2/5/10/10-minute attempts, jitter use, no pending accumulation while verification-paused, and bounded technical retry.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- --run tests/unit/probe-scheduler.test.ts tests/unit/room-manager.test.ts`

Expected: FAIL because startup has no cap/gap and manager uses one fixed offline interval.

- [ ] **Step 3: Refactor scheduler and manager minimally**

Remove manual cooldown ownership from `ProbeScheduler`; coordinator owns it. Keep scheduler responsible only for selecting the startup batch and spacing submissions. Add `reconnectAttempt` per manager entry, reset it after a stable live session, and calculate `[60, 120, 300, 600][min(attempt, 3)] * jitter` seconds.

- [ ] **Step 4: Run focused tests and confirm GREEN**

Run: `npm test -- --run tests/unit/probe-scheduler.test.ts tests/unit/room-manager.test.ts`

Expected: PASS.

---

### Task 7: Wire every navigation entry point through the coordinator

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/main/rooms/room-session.ts`
- Modify: `src/main/playback-controller.ts` if required by the existing controller API
- Modify: `src/preload/api.ts`
- Modify: `src/renderer/global.d.ts`
- Test: `tests/unit/renderer-api.test.ts`
- Test: `tests/unit/playback-controller.test.ts`
- Test: `tests/integration/asr-recovery.test.ts`

**Interfaces:**
- Produces IPC: `access:get-state`, `access:show-verification`, `access:check-verification`, `access:confirm-recovery`, `access:subscribe`, and `data:clear-douyin-session`.

- [ ] **Step 1: Add failing API and integration tests**

Assert renderer API invokes exact IPC names. Add integration fakes proving startup probe, manual probe, avatar refresh, monitor initial load/reconnect, and player load all submit their declared task type. Assert verification retains the triggering handle instead of destroying it and no screenshot/persistence occurs for the verification page.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- --run tests/unit/renderer-api.test.ts tests/unit/playback-controller.test.ts tests/integration/asr-recovery.test.ts`

Expected: FAIL for missing access API and direct navigation paths.

- [ ] **Step 3: Construct coordinator and shared session in `main.ts`**

Load persisted access state before restoring rooms. Build all background windows from `session.fromPartition(douyinPlatformPartitionName, { cache: false })`. Wrap every `loadURL(room.canonicalUrl)` path in the proper coordinator task. On verification, retain the handle and return a verification outcome without screenshotting or writing room metadata.

- [ ] **Step 4: Add recovery and session-clear IPC**

`check-verification` delegates only to the retained handle classifier. `confirm-recovery` requires `recovery_ready`. `clear-douyin-session` is rejected while any task/window is active, calls `clearStorageData`, and returns a boolean result.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run: `npm test -- --run tests/unit/renderer-api.test.ts tests/unit/playback-controller.test.ts tests/integration/asr-recovery.test.ts`

Expected: PASS.

- [ ] **Step 6: Audit navigation entry points**

Run: `rg -n "loadURL\(|new BrowserWindow|new WebContentsView" src/main`

Expected: Every Douyin-targeting navigation is visibly enclosed by or delegated through `DouyinAccessCoordinator`; application window and fixture-only paths are documented exceptions.

---

### Task 8: Verification banner, disabled actions, and session clearing UI

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/components/DataManagement.tsx`
- Test: `tests/unit/app-room-form.test.tsx`
- Test: `tests/unit/data-management.test.tsx`

**Interfaces:**
- Consumes: access IPC from Task 7.
- Produces: persistent banner and explicit user recovery workflow.

- [ ] **Step 1: Add failing UI tests**

Render each access mode and assert: paused banner includes room/time and three actions; navigation buttons are disabled with a reason; closing the verification window does not hide the banner; checking false remains paused; checking true shows `恢复访问`; only explicit confirmation removes the banner; obsolete prepared-frequency select is absent; data management requires confirmation before clearing the session.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- --run tests/unit/app-room-form.test.tsx tests/unit/data-management.test.tsx`

Expected: FAIL because access UI and clear-session controls do not exist.

- [ ] **Step 3: Implement the persistent banner and action gating**

Subscribe once to access state. Disable only actions that create new Douyin navigation; keep stop, edit, delete, data management, and local detail interactions available. Display reliable metric age for unavailable snapshots and never label retained metrics as current.

- [ ] **Step 4: Remove obsolete prepared-frequency UI and state**

Monitoring settings retain only the existing page-health interval. Replace the removed select with static copy explaining one startup batch plus manual detection.

- [ ] **Step 5: Add confirmed session clearing**

Use a two-step local confirmation in `DataManagement`; on success report that login/verification state was removed and may be requested again.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run: `npm test -- --run tests/unit/app-room-form.test.tsx tests/unit/data-management.test.tsx`

Expected: PASS.

---

### Task 9: Fixture E2E, regression verification, and phase-two handoff

**Files:**
- Create: `tests/electron/verification-recovery-e2e.cjs`
- Modify: `package.json`
- Create: `docs/superpowers/reports/2026-07-15-douyin-access-coordinator-acceptance.md`

**Interfaces:**
- Consumes: completed first-stage application.
- Produces: repeatable acceptance evidence and durable second-stage inputs.

- [ ] **Step 1: Add a fixture E2E flow**

Serve local routes for live, offline, verification, and verification-cleared states. Launch the app with a fixture-only environment switch. Assert one active navigation, persistent pause, retained verification window, no metadata overwrite, failed check stays paused, successful check requires confirmation, recovery does not replay canceled work, and restart preserves pause.

- [ ] **Step 2: Run E2E and confirm GREEN**

Run: `npm run test:e2e-verification`

Expected: exit 0 with a summary of all recovery assertions; no real Douyin request is made.

- [ ] **Step 3: Run the complete regression suite**

Run:

```bash
npm test -- --run
npm run typecheck
npm run build
npm run scan:secrets
git diff --check
```

Expected: every command exits 0. Existing unit, integration, player, monitoring, ASR, backup, and data-management behavior remains green.

- [ ] **Step 4: Perform a low-frequency real smoke check only if the user explicitly authorizes it**

Use at most one prepared room, one manual probe, one avatar refresh, and one monitored room. Do not manufacture verification through repeated requests. Record observed task order and window count without including page text, cookies, or personal inputs.

- [ ] **Step 5: Write the acceptance and handoff report**

Record exact command outputs, fixture E2E results, any authorized smoke result, known limitations, database fields, IPC interfaces, reliable-state semantics, and the accepted phase-two card/detail requirements. End with the trigger phrase: `第一阶段验收通过，开始第二阶段卡片与详情设计。`

- [ ] **Step 6: Inspect final workspace state**

Run: `git status --short`

Expected: all pre-existing user changes remain present; first-stage files are uncommitted; no branch was created and nothing was pushed.
