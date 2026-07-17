# 安全访问收口与头像恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 关闭实时监看导航旁路，增加全局访问节流与预算，并在不访问抖音的情况下恢复已缓存头像及修复离线头像持久化。

**Architecture:** `DouyinAccessCoordinator` 继续作为唯一页面导航边界，并新增可测试的全局 pacing/budget；`RoomSession` 通过注入的导航门启动共享持久 session，不再自行绕过协调器。头像文件缓存和数据库指针分离处理：缓存保持“首次固定”，仓储提供显式的初始绑定和人工替换操作，启动时只做本地一致性修复。

**Tech Stack:** Electron 39、TypeScript、Zod、Node SQLite、Vitest、Electron fixture E2E

## Global Constraints

- 自动导航默认最多 10 次/小时，任意新抖音导航默认至少间隔 60 秒。
- 所有生产抖音导航并发固定为 1。
- 验证码或疑似验证码立即暂停并清空未开始队列；恢复后不重放。
- 头像修复不得访问网络；普通状态更新不得替换已有头像。
- 自动化测试不得访问真实抖音。
- 保留当前未提交变更；不新建分支、不提交、不推送。

---

### Task 1: 可测试的全局导航节流与自动访问预算

**Files:**
- Modify: `src/main/rooms/douyin-access-coordinator.ts`
- Modify: `src/main/rooms/probe-scheduler.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/renderer/components/PreparedRoomHeader.tsx`
- Modify: `tests/unit/douyin-access-coordinator.test.ts`
- Modify: `tests/unit/probe-scheduler.test.ts`
- Modify: `tests/unit/contracts.test.ts`
- Modify: `tests/unit/prepared-room-header.test.tsx`

**Interfaces:**
- Produces: `AccessTask.traffic: "interactive" | "automatic"`。
- Produces: `CoordinatorOptions.minimumGapMs`、`automaticBudgetPerHour`、`sleep`。
- Preserves: `submit()` 去重、优先级、验证码暂停和 60 秒房间操作冷却。

- [ ] **Step 1: Write failing pacing and budget tests**

Add deterministic cases with an injected clock/sleeper:

```ts
it("paces every navigation and limits automatic starts per rolling hour", async () => {
  let now = 0;
  const waits: number[] = [];
  const coordinator = new DouyinAccessCoordinator({
    now: () => now,
    minimumGapMs: 60_000,
    automaticBudgetPerHour: 2,
    sleep: async (ms) => { waits.push(ms); now += ms; },
  });
  const run = vi.fn(async () => ({ value: true }));
  await coordinator.submit({ roomId: "a", type: "startup_probe", traffic: "automatic", run });
  await coordinator.submit({ roomId: "b", type: "startup_probe", traffic: "automatic", run });
  await coordinator.submit({ roomId: "c", type: "startup_probe", traffic: "automatic", run });
  expect(waits).toEqual([60_000, 3_540_000]);
  expect(run).toHaveBeenCalledTimes(3);
});

it("does not start a paced task after verification pause or stop", async () => {
  let release!: () => void;
  const sleep = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  const coordinator = new DouyinAccessCoordinator({ minimumGapMs: 60_000, sleep });
  await coordinator.submit({ roomId: "a", type: "manual_probe", traffic: "interactive", run: async () => ({ value: true }) });
  const queued = coordinator.submit({ roomId: "b", type: "manual_probe", traffic: "interactive", run: async () => ({ value: true }) });
  const stopped = coordinator.stop();
  release();
  await expect(queued).rejects.toThrow("ACCESS_STOPPED");
  await stopped;
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run tests/unit/douyin-access-coordinator.test.ts`

Expected: FAIL because `traffic`, pacing and rolling budget do not exist.

- [ ] **Step 3: Implement rolling pacing without timers in tests**

Extend the task and options:

```ts
export interface AccessTask<T> {
  roomId: string;
  type: DouyinTaskType;
  traffic?: "interactive" | "automatic";
  run(): Promise<{ value: T; verificationRequired?: boolean; protectionReason?: "verification_required" | "suspected_verification" }>;
}

interface CoordinatorOptions {
  initialState?: DouyinAccessState;
  now?: () => number;
  cooldownMs?: number;
  minimumGapMs?: number;
  automaticBudgetPerHour?: number;
  sleep?: (ms: number) => Promise<void>;
  persistState?: (state: DouyinAccessState) => void | Promise<void>;
}
```

Before `task.run()`, compute the later of the global gap deadline and the rolling-hour automatic budget deadline. Await the injected sleeper, re-check `stopped` and `state.mode`, then record the actual start time. Use `traffic ?? "interactive"` to preserve old callers. Production values are supplied explicitly by `main.ts`; test defaults remain zero-delay.

- [ ] **Step 4: Run coordinator tests and typecheck**

Run: `npm test -- --run tests/unit/douyin-access-coordinator.test.ts && npm run typecheck`

Expected: PASS and exit 0.

- [ ] **Step 5: Write failing safe-batch ETA tests**

Extend `PreparedProbeStateSchema` expectations and the header test:

```ts
expect(scheduler.state().estimatedCompletionAt).toBe(
  new Date(now + estimateSafeBatchDurationMs(18, 60_000, 10)).toISOString(),
);
expect(screen.getByText(/按照安全节流，预计最早/)).toBeVisible();
```

For 11 remaining starts, assert the estimate reaches the next rolling-hour window rather than reporting only 11 minutes.

- [ ] **Step 6: Implement and display a conservative ETA**

Add optional `estimatedCompletionAt` to `PreparedProbeStateSchema`. Export the pure helper:

```ts
export function estimateSafeBatchDurationMs(remaining: number, gapMs: number, budgetPerHour: number): number {
  if (remaining <= 1) return 0;
  const transitions = remaining - 1;
  const fullBudgetBoundaries = Math.floor(transitions / budgetPerHour);
  return transitions * gapMs + fullBudgetBoundaries * Math.max(0, 3_600_000 - budgetPerHour * gapMs);
}
```

The scheduler populates the estimate only for startup/manual batches. `PreparedRoomHeader` renders “按照安全节流，预计最早 HH:mm 完成”；it is an earliest estimate, not a promise.

- [ ] **Step 7: Run the pacing, scheduler and header tests**

Run:

```bash
npm test -- --run tests/unit/douyin-access-coordinator.test.ts tests/unit/probe-scheduler.test.ts tests/unit/contracts.test.ts tests/unit/prepared-room-header.test.tsx
npm run typecheck
```

Expected: PASS and the 18-room batch no longer implies an immediate burst.

---

### Task 2: 实时监看启动与重连接入协调器

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/rooms/room-manager.ts`
- Modify: `src/main/rooms/room-session.ts`
- Modify: `src/main/main.ts`
- Modify: `tests/unit/contracts.test.ts`
- Modify: `tests/unit/room-manager.test.ts`
- Create: `tests/unit/room-session.test.ts`

**Interfaces:**
- Produces: task types `monitor_start` and existing `monitor_reconnect`。
- Produces: `SessionStartReason = "user_start" | "offline_retry" | "technical_retry"`。
- Produces: injected `RoomNavigationGate` that returns the probe result through the coordinator before ASR startup.
- Consumes: Task 1 `AccessTask.traffic` and pacing.

- [ ] **Step 1: Write failing manager source tests**

Change the manager factory type and assert reasons:

```ts
it("identifies user starts and automatic retries", async () => {
  const reasons: string[] = [];
  const sessions = [offlineSession(), liveSession()];
  const manager = new RoomManager(async (_roomId, _signal, reason) => {
    reasons.push(reason);
    return sessions.shift()!;
  }, { offlineRetryDelayMs: 1 });
  await manager.startMonitoring("123");
  await vi.waitFor(() => expect(reasons).toEqual(["user_start", "offline_retry"]));
});
```

Add a case proving `ACCESS_VERIFICATION_PAUSED` does not create a rapid retry loop and leaves the room in a paused/waiting state until a later legitimate trigger.

- [ ] **Step 2: Run manager tests and verify RED**

Run: `npm test -- --run tests/unit/room-manager.test.ts`

Expected: FAIL because the session factory receives no reason.

- [ ] **Step 3: Pass explicit start reasons through RoomManager**

Define:

```ts
export type SessionStartReason = "user_start" | "offline_retry" | "technical_retry";
type SessionFactory = (roomId: string, signal: AbortSignal, reason: SessionStartReason) => Promise<MonitorSession>;
```

Use `user_start` in `startMonitoring`, `offline_retry` in `retryOfflineRoom`, and `technical_retry` in `recover`. Treat `ACCESS_VERIFICATION_PAUSED` and `ACCESS_CANCELED_BY_VERIFICATION` as access-paused outcomes that do not schedule short technical retries.

- [ ] **Step 4: Write failing RoomSession navigation-gate tests**

Construct `RoomSession` with a fake browser surface/session and gate. Assert:

```ts
expect(gate).toHaveBeenCalledTimes(1);
expect(events).toEqual(["gate:start", "window:create", "probe", "gate:end", "asr:open"]);
```

Add a verification result case asserting the gate reports `verificationRequired: true`, ASR never opens, and the room page closes after the coordinator has observed the result.

- [ ] **Step 5: Run RoomSession tests and verify RED**

Run: `npm test -- --run tests/unit/room-session.test.ts`

Expected: FAIL because `RoomSession` creates and navigates without a gate.

- [ ] **Step 6: Split page navigation from ASR startup**

Introduce:

```ts
export type RoomNavigationGate = (
  run: () => Promise<{ value: RoomProbeResult; verificationRequired?: boolean }>,
) => Promise<RoomProbeResult>;
```

`RoomSession.start()` must call the gate around window creation, `probeRoom`, screenshot persistence and probe classification. Only after a trusted `live` result returns from the gate may it open ASR and install capture. Inject the shared persistent Electron `Session`; remove the internal `session.fromPartition()` call and do not clear shared storage on close.

- [ ] **Step 7: Wire monitoring reasons to coordinator in main**

In `main.ts`, construct the gate as:

```ts
const type = reason === "user_start" ? "monitor_start" : "monitor_reconnect";
const traffic = reason === "user_start" ? "interactive" : "automatic";
const gate: RoomNavigationGate = (run) => coordinator.submit({ roomId, type, traffic, run });
```

Pass `platformSession` and `gate` to `RoomSession`. Configure the coordinator with `minimumGapMs: 60_000` and `automaticBudgetPerHour: 10`. Mark startup/scheduled probes and monitor retries automatic; mark card probe, avatar refresh, player and monitor user start interactive.

- [ ] **Step 8: Static audit and focused verification**

Run:

```bash
rg -n "\.loadURL\(|probeRoom\(" src/main
npm test -- --run tests/unit/room-manager.test.ts tests/unit/room-session.test.ts tests/unit/douyin-access-coordinator.test.ts
npm run typecheck
```

Expected: every production Douyin navigation is visibly inside a coordinator task or is the non-navigating verification inspection; tests pass.

---

### Task 3: 离线头像持久化与本地缓存路径恢复

**Files:**
- Modify: `src/main/rooms/avatar-cache.ts`
- Modify: `src/main/storage/database.ts`
- Modify: `src/main/main.ts`
- Modify: `tests/unit/avatar-cache.test.ts`
- Modify: `tests/unit/database.test.ts`
- Create: `tests/unit/avatar-reconciliation.test.ts`
- Create: `src/main/rooms/avatar-reconciliation.ts`

**Interfaces:**
- Produces: `AvatarCache.existing(roomId): Promise<string | undefined>`。
- Produces: `snapshots.setAvatarIfMissing(roomId, path)` and `snapshots.replaceAvatar(roomId, path)`。
- Produces: `reconcileAvatarPaths(roomIds, cache, snapshots)` pure orchestration.

- [ ] **Step 1: Write failing repository tests**

Add cases:

```ts
it("binds an initial avatar while offline without replacing trusted profile text", () => {
  database.snapshots.upsert({ roomId: "123", status: "offline", checkedAt: now });
  expect(database.snapshots.setAvatarIfMissing("123", "/avatars/123.png")).toBe(true);
  expect(database.snapshots.setAvatarIfMissing("123", "/avatars/new.png")).toBe(false);
  expect(database.snapshots.list()[0].avatarPath).toBe("/avatars/123.png");
});

it("explicitly replaces an avatar independently of live status", () => {
  database.snapshots.replaceAvatar("123", "/avatars/manual.png");
  expect(database.snapshots.list()[0].avatarPath).toBe("/avatars/manual.png");
});
```

- [ ] **Step 2: Run database tests and verify RED**

Run: `npm test -- --run tests/unit/database.test.ts`

Expected: FAIL because explicit avatar repository methods do not exist.

- [ ] **Step 3: Implement field-specific avatar writes**

Use targeted SQL, never the generic profile update gate:

```ts
setAvatarIfMissing(roomId: string, avatarPath: string): boolean {
  return this.database.prepare("UPDATE room_snapshots SET avatar_path=? WHERE room_id=? AND avatar_path IS NULL").run(avatarPath, roomId).changes === 1;
}

replaceAvatar(roomId: string, avatarPath: string): void {
  this.database.prepare("UPDATE room_snapshots SET avatar_path=? WHERE room_id=?").run(avatarPath, roomId);
}
```

- [ ] **Step 4: Write failing local reconciliation tests**

Create valid, missing and empty cached files. Assert only valid existing app-owned paths are bound and the fake fetcher is never called.

```ts
expect(fetcher).not.toHaveBeenCalled();
expect(repaired).toEqual(["134660708044", "3946293708"]);
```

- [ ] **Step 5: Implement cache lookup and reconciliation**

`AvatarCache.existing()` checks readability and non-zero size without fetching. `reconcileAvatarPaths()` loops only known room IDs whose DB snapshot has no avatar, calls `existing`, and binds through `setAvatarIfMissing`. Invalid files are ignored and diagnosed by the caller.

- [ ] **Step 6: Restrict automatic and manual avatar persistence**

In `persistProbeResult`, only call `avatarCache.ensure` for trusted `live`/`offline` results when the snapshot has no avatar. Bind the returned path with `setAvatarIfMissing`. In `rooms:refresh-avatar`, accept only trusted `live`/`offline`, download via `refresh`, then call `replaceAvatar`; verification/login/error results cannot write.

Call reconciliation once after database/cache construction and before the first renderer snapshot. This operation is local-only.

- [ ] **Step 7: Run avatar regression tests**

Run:

```bash
npm test -- --run tests/unit/avatar-cache.test.ts tests/unit/avatar-reconciliation.test.ts tests/unit/database.test.ts tests/unit/app-room-form.test.tsx
npm run typecheck
```

Expected: all pass; offline avatar appears and existing avatar remains stable.

---

### Task 4: 本地验证码恢复 E2E 与第一阶段 1.1 验收

**Files:**
- Create: `tests/electron/verification-recovery-e2e.cjs`
- Modify: `package.json`
- Create: `docs/superpowers/reports/2026-07-17-safe-access-avatar-acceptance.md`

**Interfaces:**
- Produces: `npm run test:e2e-verification`。
- Consumes: Task 1–3 coordinator, monitor navigation and avatar behavior.

- [ ] **Step 1: Add a fixture-only verification flow**

The local server must expose `live`, `offline`, `verification` and `verification-cleared` pages plus an in-memory navigation counter. Launch Electron with `DUODUO_FIXTURE_ORIGIN` and assert:

```js
assert.equal(maxConcurrentNavigations, 1);
assert.equal(realDouyinRequests, 0);
assert.equal(canceledQueueReplayed, false);
assert.equal(metadataAfterVerification.title, metadataBeforeVerification.title);
assert.equal(accessStateAfterRestart.mode, "verification_paused");
```

Exercise a monitor start that receives verification, not only a prepared probe, so the former bypass is covered.

- [ ] **Step 2: Add the package command and verify the fixture E2E**

Add:

```json
"test:e2e-verification": "npm run build --silent && node tests/electron/verification-recovery-e2e.cjs"
```

Run: `npm run test:e2e-verification`

Expected: exit 0, no external network request, verification remains paused until explicit confirmation.

- [ ] **Step 3: Run first-stage regression**

Run:

```bash
npm test -- --run
npm run typecheck
npm run build
npm run scan:secrets
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Write acceptance evidence**

Record exact commands, counts, coordinator configuration, fixture result, local avatar reconciliation result, static navigation audit and known limitations. State explicitly that no real Douyin smoke test was run because the user requested risk avoidance.

- [ ] **Step 5: Inspect workspace preservation**

Run: `git status --short`

Expected: user changes and new work remain uncommitted; no branch was created and nothing was pushed.
