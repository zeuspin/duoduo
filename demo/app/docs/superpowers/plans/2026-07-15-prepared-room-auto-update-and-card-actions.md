# 预备直播间自动更新与卡片操作 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让预备直播间真正按目标频率安全串行更新，并提供可理解的批量进度、卡片操作文字、可靠悬停提示、失败原因和恢复反馈。

**Architecture:** 扩展现有 `ProbeScheduler`，使每项任务带来源、周期定时器可观测，并为启动批次和人工“更新全部”提供进度快照；所有抖音页面访问继续经过 `DouyinAccessCoordinator`，生产并发固定为 1。主进程通过独立 IPC 发布临时队列状态，渲染层使用小型展示组件呈现自动更新、批量进度和卡片操作，不把进度写入数据库。

**Tech Stack:** Electron 39、TypeScript、React 19、Phosphor Icons、Zod、Vitest、Testing Library

## Global Constraints

- 生产环境抖音状态探测最大并发必须保持为 `1`。
- 周期定时继续使用 `20%` 随机抖动，避免多个直播间同步请求。
- “更新全部状态”只加入串行队列，不得并发创建多个抖音页面。
- 发现验证码或疑似验证码时，全局暂停新访问并取消尚未开始的人工批量任务；用户确认恢复前不得继续。
- 被验证码取消的人工批量任务不得自动重放；周期调度只在访问状态回到 `normal` 后继续。
- 失败、超时、登录和验证码结果不得覆盖既有可信主播名、头像、封面和指标。
- 主播头像仍然只在初次获取或用户点击“更新头像”时更新。
- 卡片高频操作必须直接显示文字；纯图标操作必须同时支持鼠标悬停和键盘聚焦提示，不能只依赖原生 `title`。
- 自定义提示延迟为约 `300ms`，卡片操作点击目标不得小于 `36px` 高。
- 不自动点击、识别、代答或绕过验证码。
- 自动化测试不得访问真实抖音；真实页面仅由用户执行最终人工验收。
- 不新建分支、不提交、不推送。

---

### Task 1: 可观测、来源明确的安全探测调度器

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/rooms/probe-scheduler.ts`
- Modify: `tests/unit/contracts.test.ts`
- Modify: `tests/unit/probe-scheduler.test.ts`

**Interfaces:**
- Produces: `PreparedProbeSource`、`PreparedProbeState`、`PreparedProbeStateSchema`。
- Produces: `ProbeScheduler.runNow(roomId, source)`、`runBatch(roomIds, source)`、`cancelManualBatch()`、`state()`、`subscribe(listener)`。
- Consumes: existing `ProbeSchedule.probeIntervalMinutes` and `ProbeOutcome.status`.

- [ ] **Step 1: Write failing shared-contract tests**

Add to `tests/unit/contracts.test.ts`:

```ts
import { PreparedProbeStateSchema } from "../../src/shared/contracts";

it("validates prepared-room probe progress", () => {
  expect(PreparedProbeStateSchema.parse({
    mode: "running",
    currentRoomId: "123",
    queuedRoomIds: ["456"],
    batch: { source: "manual_batch", total: 2, completed: 0 },
  })).toMatchObject({ mode: "running", currentRoomId: "123" });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm test -- --run tests/unit/contracts.test.ts`

Expected: FAIL because `PreparedProbeStateSchema` is not exported.

- [ ] **Step 3: Add the shared queue-state schema**

Add before the exported inferred types in `src/shared/contracts.ts`:

```ts
export const PreparedProbeSourceSchema = z.enum(["startup", "scheduled", "manual", "manual_batch"]);
export const PreparedProbeStateSchema = z.object({
  mode: z.enum(["idle", "running"]),
  currentRoomId: z.string().min(1).optional(),
  queuedRoomIds: z.array(z.string().min(1)),
  batch: z.object({
    source: z.enum(["startup", "manual_batch"]),
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  }).optional(),
  nextRunAt: z.string().datetime().optional(),
  lastCompletedAt: z.string().datetime().optional(),
});

export type PreparedProbeSource = z.infer<typeof PreparedProbeSourceSchema>;
export type PreparedProbeState = z.infer<typeof PreparedProbeStateSchema>;
```

- [ ] **Step 4: Write failing scheduler behavior tests**

Add focused cases to `tests/unit/probe-scheduler.test.ts`:

```ts
it("runs a manual batch serially and publishes progress", async () => {
  const releases: Array<() => void> = [];
  const scheduler = new ProbeScheduler((_roomId, _source) => new Promise((resolve) => {
    releases.push(() => resolve({ status: "offline" }));
  }), { maxConcurrency: 1 });
  const states: PreparedProbeState[] = [];
  scheduler.subscribe((state) => states.push(state));

  const batch = scheduler.runBatch(["a", "b"], "manual_batch");
  expect(scheduler.state()).toMatchObject({
    mode: "running",
    currentRoomId: "a",
    queuedRoomIds: ["b"],
    batch: { source: "manual_batch", total: 2, completed: 0 },
  });
  releases.shift()!();
  await vi.waitFor(() => expect(scheduler.state().currentRoomId).toBe("b"));
  expect(scheduler.state().batch?.completed).toBe(1);
  releases.shift()!();
  await batch;
  expect(scheduler.state().mode).toBe("idle");
  expect(states.length).toBeGreaterThan(2);
});

it("cancels only queued manual-batch rooms and lets the active room finish", async () => {
  let release!: () => void;
  const probe = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
  const scheduler = new ProbeScheduler(probe, { maxConcurrency: 1 });
  const batch = scheduler.runBatch(["a", "b", "c"], "manual_batch");

  scheduler.cancelManualBatch();
  expect(scheduler.state().queuedRoomIds).toEqual([]);
  release();
  await batch;
  expect(probe).toHaveBeenCalledTimes(1);
});

it("records the earliest recurring deadline and uses scheduled source", async () => {
  vi.useFakeTimers();
  const probe = vi.fn(async () => ({ status: "offline" as const }));
  const scheduler = new ProbeScheduler(probe, { now: () => Date.now(), jitterRatio: 0 });
  scheduler.schedule("a", { probeIntervalMinutes: 1 }, 1_000);
  expect(scheduler.state().nextRunAt).toBe(new Date(Date.now() + 1_000).toISOString());
  await vi.advanceTimersByTimeAsync(1_000);
  expect(probe).toHaveBeenCalledWith("a", "scheduled");
});
```

- [ ] **Step 5: Run scheduler tests and verify RED**

Run: `npm test -- --run tests/unit/probe-scheduler.test.ts`

Expected: FAIL because source-aware probing, progress subscription and batch cancellation do not exist.

- [ ] **Step 6: Implement the scheduler interface**

Update `src/main/rooms/probe-scheduler.ts` so the core public surface is exactly:

```ts
import type { PreparedProbeSource, PreparedProbeState } from "../../shared/contracts";

type Probe = (roomId: string, source: PreparedProbeSource) => Promise<ProbeOutcome | void>;
type StateListener = (state: PreparedProbeState) => void;

export class ProbeScheduler {
  constructor(private readonly probe: Probe, options: ProbeSchedulerOptions = {}) {
    this.defaultIntervalMinutes = options.defaultIntervalMinutes ?? 5;
    this.maxConcurrency = options.maxConcurrency ?? 1;
    this.jitterRatio = options.jitterRatio ?? 0.2;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.manualCooldownMs = options.manualCooldownMs ?? 60_000;
  }

  runNow(roomId: string, source: PreparedProbeSource = "manual"): Promise<ProbeOutcome | void>;
  runBatch(roomIds: string[], source: "startup" | "manual_batch"): Promise<void>;
  cancelManualBatch(): void;
  schedule(roomId: string, room: ProbeSchedule, initialDelayMs?: number): void;
  cancel(roomId: string): void;
  setDefaultIntervalMinutes(value: number): void;
  state(): PreparedProbeState;
  subscribe(listener: StateListener): () => void;
  stop(): Promise<void>;
}
```

Implementation requirements:

```ts
interface QueuedProbe {
  roomId: string;
  source: PreparedProbeSource;
  batchId?: number;
  resolve(result: ProbeOutcome | void): void;
  reject(error: unknown): void;
}

// Manual cooldown applies only to a direct card click.
if (source === "manual") this.assertManualCooldown(roomId);

// Recurring timers always identify themselves as scheduled.
void this.runNow(roomId, "scheduled").finally(() => this.schedule(roomId, room));

// Cancellation removes only not-yet-started manual_batch items.
// It must never abort the active WebContents/navigation.
```

Store timer deadlines alongside timer handles and expose the earliest deadline as `nextRunAt`. Emit a structured-cloned state after enqueue, start, completion, cancellation, schedule, pause caused by `verification_required`, and stop. Batch `completed` increments only after a room actually started and settled; canceled queued rooms do not count as completed.

- [ ] **Step 7: Run Task 1 tests**

Run: `npm test -- --run tests/unit/contracts.test.ts tests/unit/probe-scheduler.test.ts && npm run typecheck`

Expected: all focused tests PASS and TypeScript exits with code 0.

---

### Task 2: 周期调度生命周期、批量 IPC 与风控衔接

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/preload/api.ts`
- Modify: `tests/unit/renderer-api.test.ts`
- Modify: `tests/unit/probe-scheduler.test.ts`

**Interfaces:**
- Consumes: Task 1 `ProbeScheduler` source and state APIs.
- Produces renderer APIs: `rooms.getProbeState()`、`rooms.probeAll()`、`rooms.cancelProbeBatch()`、`rooms.subscribeProbeState(listener)`。
- Produces IPC channels: `rooms:get-probe-state`、`rooms:probe-all`、`rooms:cancel-probe-batch`、`rooms:probe-state`。

- [ ] **Step 1: Write failing preload API tests**

Update the expected room API keys in `tests/unit/renderer-api.test.ts`:

```ts
expect(Object.keys(api.rooms)).toEqual([
  "list", "add", "update", "remove", "setMonitoring", "probe",
  "probeAll", "cancelProbeBatch", "getProbeState", "refreshAvatar",
  "subscribe", "subscribeProbeState",
]);
await api.rooms.probeAll();
expect(invoke).toHaveBeenCalledWith("rooms:probe-all");
await api.rooms.cancelProbeBatch();
expect(invoke).toHaveBeenCalledWith("rooms:cancel-probe-batch");
await api.rooms.getProbeState();
expect(invoke).toHaveBeenCalledWith("rooms:get-probe-state");
```

- [ ] **Step 2: Run preload test and verify RED**

Run: `npm test -- --run tests/unit/renderer-api.test.ts`

Expected: FAIL because the four methods are missing.

- [ ] **Step 3: Expose the minimal renderer API**

Add to `rooms` in `src/preload/api.ts`:

```ts
probeAll: () => invoke("rooms:probe-all"),
cancelProbeBatch: () => invoke("rooms:cancel-probe-batch"),
getProbeState: () => invoke("rooms:get-probe-state"),
subscribeProbeState: (listener: (...args: unknown[]) => void) => subscribe("rooms:probe-state", listener),
```

- [ ] **Step 4: Wire source-aware coordination in the main process**

Extract the existing page-probe body into a complete helper, then construct `ProbeScheduler` with the saved global interval:

```ts
const executePreparedProbe = async (roomId: string) => {
  const room = (await rooms.list()).find((item) => item.roomId === roomId);
  if (!room) throw new Error("ROOM_NOT_FOUND");
  database.snapshots.upsert({ roomId, status: "checking", checkedAt: new Date().toISOString() });
  await broadcastSnapshot();
  const probeWindow = new BrowserWindow({
    show: false,
    webPreferences: { session: platformSession, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  probeWindow.webContents.setAudioMuted(true);
  probeWindow.webContents.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36");
  try {
    const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
    const result = await probeRoom(probeWindow.webContents, fixtureOrigin ? `${fixtureOrigin}/${roomId}` : room.canonicalUrl);
    const verificationRequired = result.status === "verification_required";
    await persistProbeResult(roomId, result, verificationRequired ? Buffer.alloc(0) : (await probeWindow.capturePage()).toPNG());
    return { value: result, verificationRequired };
  } finally {
    if (!probeWindow.isDestroyed()) probeWindow.destroy();
    await broadcastSnapshot();
  }
};

const probeScheduler = new ProbeScheduler(async (roomId, source) => coordinator.submit({
  roomId,
  type: source === "manual" ? "manual_probe" : "startup_probe",
  run: () => executePreparedProbe(roomId),
}), {
  defaultIntervalMinutes: monitoringSettings.preparedCheckMinutes ?? 5,
  maxConcurrency: 1,
  jitterRatio: 0.2,
  manualCooldownMs: 0,
});
```

The direct card action remains `source="manual"`; startup, recurring and update-all tasks map to `startup_probe`, so only direct repeated clicks use the access coordinator's per-room manual cooldown.

- [ ] **Step 5: Add schedule synchronization helpers**

Place these helpers next to the scheduler in `src/main/main.ts`:

```ts
// Add `type Room` to the existing contracts import in this file.
const schedulePreparedRoom = (room: Room) => {
  if (room.monitoring) { probeScheduler.cancel(room.roomId); return; }
  probeScheduler.schedule(room.roomId, room);
};

const reschedulePreparedRooms = async () => {
  probeScheduler.setDefaultIntervalMinutes(monitoringSettings.preparedCheckMinutes ?? 5);
  for (const room of await rooms.list()) schedulePreparedRoom(room);
};

const broadcastProbeState = (state = probeScheduler.state()) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("rooms:probe-state", state);
};
const unsubscribeProbeState = probeScheduler.subscribe(broadcastProbeState);
```

Lifecycle wiring requirements:

- Startup: schedule every non-monitoring room, then start one serial `runBatch(preparedIds, "startup")`.
- Add/update: reschedule the resulting non-monitoring room; preserve the existing immediate first detection.
- Remove: cancel the room timer and queued work.
- Join monitoring: cancel prepared scheduling before starting `RoomManager`.
- Leave monitoring: stop `RoomManager`, schedule the room as prepared, and do not create a second concurrent probe.
- Save monitoring settings: call `setDefaultIntervalMinutes`, reschedule all prepared rooms, and only then return “立即生效”.
- Shutdown: unsubscribe scheduler state before database close.

- [ ] **Step 6: Add batch IPC handlers**

Add in `src/main/main.ts`:

```ts
ipcMain.handle("rooms:get-probe-state", () => probeScheduler.state());
ipcMain.handle("rooms:probe-all", async () => {
  if (coordinator.getState().mode !== "normal") throw new Error("ACCESS_VERIFICATION_PAUSED");
  const ids = (await rooms.list()).filter((room) => !room.monitoring).map((room) => room.roomId);
  void probeScheduler.runBatch(ids, "manual_batch").catch((error) => {
    diagnostic("prepared_probe_batch_failed", { error: error instanceof Error ? error.message : String(error) });
  });
  return probeScheduler.state();
});
ipcMain.handle("rooms:cancel-probe-batch", () => {
  probeScheduler.cancelManualBatch();
  return probeScheduler.state();
});
```

When a resolved outcome has `status === "verification_required"`, `ProbeScheduler` must call its pending-queue clearing path, while `DouyinAccessCoordinator` transitions to `verification_paused` and rejects its own queued tasks. Do not automatically recreate a canceled `manual_batch` after recovery.

- [ ] **Step 7: Run Task 2 tests**

Run: `npm test -- --run tests/unit/renderer-api.test.ts tests/unit/probe-scheduler.test.ts tests/unit/douyin-access-coordinator.test.ts && npm run typecheck`

Expected: all focused tests PASS; the scheduler tests prove single concurrency, jitter, source mapping, timer rescheduling and verification cancellation.

---

### Task 3: 自动更新状态栏与安全的“更新全部”

**Files:**
- Create: `src/renderer/components/PreparedRoomHeader.tsx`
- Create: `tests/unit/prepared-room-header.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `tests/unit/app-room-form.test.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: `PreparedProbeState` and Task 2 renderer API.
- Produces: `PreparedRoomHeader` with update-all and stop-queued-work actions.

- [ ] **Step 1: Write failing component tests**

Create `tests/unit/prepared-room-header.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreparedRoomHeader } from "../../src/renderer/components/PreparedRoomHeader";

afterEach(cleanup);

describe("PreparedRoomHeader", () => {
  it("shows automatic scheduling and starts a safe batch", () => {
    const onProbeAll = vi.fn();
    render(<PreparedRoomHeader count={16} state={{ mode: "idle", queuedRoomIds: [], nextRunAt: "2026-07-15T10:01:00.000Z" }} roomName={() => ""} accessBlocked={false} onProbeAll={onProbeAll} onCancelBatch={vi.fn()} />);
    expect(screen.getByText(/自动更新已开启/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "更新全部状态" }));
    expect(onProbeAll).toHaveBeenCalledTimes(1);
  });

  it("shows manual batch progress and can stop only the remaining queue", () => {
    const onCancelBatch = vi.fn();
    render(<PreparedRoomHeader count={16} state={{ mode: "running", currentRoomId: "a", queuedRoomIds: ["b"], batch: { source: "manual_batch", total: 2, completed: 0 } }} roomName={() => "主播 A"} accessBlocked={false} onProbeAll={vi.fn()} onCancelBatch={onCancelBatch} />);
    expect(screen.getByText(/批量更新 1\/2/)).toBeTruthy();
    expect(screen.getByText(/当前：主播 A/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "停止后续更新" }));
    expect(onCancelBatch).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `npm test -- --run tests/unit/prepared-room-header.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the header component**

Create `src/renderer/components/PreparedRoomHeader.tsx` with this public interface:

```tsx
import type { PreparedProbeState } from "../../shared/contracts";

interface Props {
  count: number;
  state: PreparedProbeState;
  roomName(roomId: string): string;
  accessBlocked: boolean;
  onProbeAll(): void;
  onCancelBatch(): void;
}

export function PreparedRoomHeader(props: Props) {
  const manualBatch = props.state.batch?.source === "manual_batch";
  const progress = props.state.batch ? Math.min(props.state.batch.completed + (props.state.currentRoomId ? 1 : 0), props.state.batch.total) : 0;
  const status = props.accessBlocked
    ? "自动更新已暂停"
    : manualBatch
      ? `批量更新 ${progress}/${props.state.batch!.total}`
      : props.state.mode === "running"
        ? `自动更新中 · 队列 ${props.state.queuedRoomIds.length}`
        : "自动更新已开启";
  return <div className="section-head prepared-room-head">
    <b>预备直播间 <small>{props.count}</small></b>
    <div className="prepared-probe-summary" role="status">
      <span>{status}</span>
      {props.state.currentRoomId && <span>当前：{props.roomName(props.state.currentRoomId)}</span>}
      {manualBatch ? <button onClick={props.onCancelBatch}>停止后续更新</button> : <button disabled={props.accessBlocked || props.count === 0} onClick={props.onProbeAll}>更新全部状态</button>}
    </div>
  </div>;
}
```

Format `nextRunAt` as `下次检测 HH:mm` in the idle copy. Do not show a countdown that requires a per-second renderer timer.

- [ ] **Step 4: Wire probe state into App**

In `src/renderer/App.tsx`:

```tsx
const [preparedProbeState, setPreparedProbeState] = useState<PreparedProbeState>({ mode: "idle", queuedRoomIds: [] });

useEffect(() => {
  void window.duoduo.rooms.getProbeState().then((value) => setPreparedProbeState(value as PreparedProbeState));
  return window.duoduo.rooms.subscribeProbeState((value) => setPreparedProbeState(value as PreparedProbeState));
}, []);

async function probeAllRooms() {
  try { setPreparedProbeState(await window.duoduo.rooms.probeAll() as PreparedProbeState); }
  catch (error) { setMessage(`无法更新全部状态：${String(error)}`); }
}
async function cancelProbeBatch() {
  setPreparedProbeState(await window.duoduo.rooms.cancelProbeBatch() as PreparedProbeState);
  setMessage("已停止尚未开始的更新，当前直播间会安全完成");
}
```

Replace the existing pre-room `section-head` with `PreparedRoomHeader`. Do not change the “实时监看中” section.

- [ ] **Step 5: Extend App test mocks and add one integration assertion**

The `rooms` mock in `tests/unit/app-room-form.test.tsx` must include:

```ts
getProbeState: vi.fn().mockResolvedValue({ mode: "idle", queuedRoomIds: [], nextRunAt: "2026-07-15T10:05:00.000Z" }),
probeAll: vi.fn().mockResolvedValue({ mode: "running", currentRoomId: "123", queuedRoomIds: [], batch: { source: "manual_batch", total: 1, completed: 0 } }),
cancelProbeBatch: vi.fn(),
subscribeProbeState: vi.fn(() => () => undefined),
```

Add a test that clicks `更新全部状态` and expects `window.duoduo.rooms.probeAll` exactly once. Also assert the button is disabled when `access.getState` returns a non-normal state.

- [ ] **Step 6: Style the compact status bar**

Add to `src/renderer/styles.css`:

```css
.prepared-room-head { height:auto; min-height:52px; gap:16px; }
.prepared-room-head b small { color:#87919e; font-size:11px; font-weight:500; }
.prepared-probe-summary { display:flex; align-items:center; justify-content:flex-end; gap:10px; min-width:0; }
.prepared-probe-summary span { white-space:nowrap; }
.prepared-probe-summary button { min-height:36px; border:1px solid #cbd2da; background:#fff; padding:0 12px; color:#42516a; }
.prepared-probe-summary button:disabled { cursor:not-allowed; opacity:.55; }
```

- [ ] **Step 7: Run Task 3 tests**

Run: `npm test -- --run tests/unit/prepared-room-header.test.tsx tests/unit/app-room-form.test.tsx && npm run typecheck`

Expected: component and App integration tests PASS.

---

### Task 4: 可理解的卡片操作、可靠提示和状态新鲜度

**Files:**
- Create: `src/renderer/components/Tooltip.tsx`
- Create: `src/renderer/components/RoomCardActions.tsx`
- Create: `src/renderer/room-card-presenter.ts`
- Create: `tests/unit/room-card-actions.test.tsx`
- Create: `tests/unit/room-card-presenter.test.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Produces: `Tooltip`、`RoomCardActions`、`roomDisplayName`、`probeDetail`、`probeFreshness`。
- Consumes: existing Phosphor icons and card callbacks.

- [ ] **Step 1: Write failing presenter tests**

Create `tests/unit/room-card-presenter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { probeDetail, probeFreshness, roomDisplayName } from "../../src/renderer/room-card-presenter";

it("does not present a verification interstitial as the remembered anchor", () => {
  expect(roomDisplayName({ roomId: "123", status: "page_error", title: "验证码中间页", anchorName: "验证码中间页", checkedAt: "2026-07-15T10:00:00.000Z" }, "123")).toBe("直播间 123");
});

it("uses specific failure copy", () => {
  expect(probeDetail({ roomId: "123", status: "timeout", checkedAt: "2026-07-15T10:00:00.000Z", error: "PROBE_TIMEOUT" })).toBe("页面响应超时");
  expect(probeDetail({ roomId: "123", status: "verification_required", checkedAt: "2026-07-15T10:00:00.000Z" })).toBe("安全验证已暂停更新");
});

it("marks data stale after twice the configured target interval", () => {
  expect(probeFreshness("2026-07-15T10:00:00.000Z", 5, Date.parse("2026-07-15T10:11:00.000Z"))).toEqual({ label: "已过期 · 11 分钟前", stale: true });
});
```

- [ ] **Step 2: Implement pure presentation helpers**

Create `src/renderer/room-card-presenter.ts`:

```ts
import type { RoomSnapshot } from "../shared/contracts";

const invalidRememberedName = /验证码|安全验证|中间页|扫码登录/;

export function roomDisplayName(snapshot: RoomSnapshot | undefined, roomId: string): string {
  return [snapshot?.anchorName, snapshot?.title].find((value) => value && !invalidRememberedName.test(value)) ?? `直播间 ${roomId}`;
}

export function probeDetail(snapshot: RoomSnapshot | undefined): string | undefined {
  if (!snapshot) return "等待首次检测";
  if (snapshot.status === "verification_required") return "安全验证已暂停更新";
  if (snapshot.status === "login_required") return "需要登录抖音";
  if (snapshot.status === "timeout") return "页面响应超时";
  if (snapshot.status === "page_error") return "页面解析失败";
  return undefined;
}

export function probeFreshness(checkedAt: string, targetMinutes: number, now = Date.now()): { label: string; stale: boolean } {
  const minutes = Math.max(0, Math.floor((now - Date.parse(checkedAt)) / 60_000));
  const age = minutes < 1 ? "刚刚" : `${minutes} 分钟前`;
  const stale = minutes > targetMinutes * 2;
  return { label: stale ? `已过期 · ${age}` : age, stale };
}
```

- [ ] **Step 3: Write failing card-action tests**

Create `tests/unit/room-card-actions.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RoomCardActions } from "../../src/renderer/components/RoomCardActions";

afterEach(cleanup);

it("shows frequent actions as text and secondary actions in a labeled menu", () => {
  const onProbe = vi.fn();
  render(<RoomCardActions active={false} blocked={false} cooldown={0} onPlay={vi.fn()} onProbe={onProbe} onRefreshAvatar={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByRole("button", { name: "播放直播" }).textContent).toContain("播放");
  fireEvent.click(screen.getByRole("button", { name: "立即检测直播状态" }));
  expect(onProbe).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  expect(screen.getByRole("menuitem", { name: "更新主播头像" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "编辑直播间" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "删除直播间" })).toBeTruthy();
});

it("gives the icon-only more button a custom hover and focus tooltip", () => {
  render(<RoomCardActions active={false} blocked={false} cooldown={0} onPlay={vi.fn()} onProbe={vi.fn()} onRefreshAvatar={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByText("更多操作").closest(".tooltip")).toBeTruthy();
  expect(screen.getByRole("button", { name: "更多操作" }).getAttribute("title")).toBeNull();
});
```

- [ ] **Step 4: Implement Tooltip and RoomCardActions**

`src/renderer/components/Tooltip.tsx`:

```tsx
import type { ReactNode } from "react";

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return <span className="tooltip">{children}<span className="tooltip-content" role="tooltip">{label}</span></span>;
}
```

`RoomCardActions` requirements:

- Render icon + visible text buttons named `播放直播`/`停止播放` and `立即检测直播状态`.
- Use a stateful `更多操作` button wrapped by `Tooltip`; do not use a native `title` attribute.
- Render an anchored `role="menu"` containing text menu items `更新主播头像`、`编辑直播间`、`删除直播间`.
- Close the menu after a menu item runs, on `Escape`, and when focus leaves the component.
- Disable play/probe/avatar according to `blocked`; show the remaining cooldown in the visible detection label.
- Do not add a second confirmation behavior for delete in this scope; preserve current deletion semantics.

Public props:

```ts
interface RoomCardActionsProps {
  active: boolean;
  blocked: boolean;
  cooldown: number;
  onPlay(): void;
  onProbe(): void;
  onRefreshAvatar(): void;
  onEdit(): void;
  onDelete(): void;
}
```

- [ ] **Step 5: Replace the card action row and clarify status age**

In `src/renderer/App.tsx`:

- Replace the five icon-only buttons inside `.card-actions` with `RoomCardActions`.
- Use `roomDisplayName(snapshot, room.roomId)` in card titles and `roomName` lookups.
- Derive the target interval from `room.probeIntervalMinutes ?? monitoringSettings.preparedCheckMinutes ?? 5`.
- Render `probeFreshness` beside the absolute checked time and add `.stale` when overdue.
- Render `probeDetail(snapshot)` below the checked time when present.
- Keep `Cover`, stored trusted metadata, and avatar behavior unchanged.

- [ ] **Step 6: Add reliable tooltip, action and status styles**

Add to `src/renderer/styles.css`:

```css
.card-actions { display:flex; align-items:center; gap:6px; position:relative; }
.card-actions .card-action { min-height:36px; width:auto; padding:0 9px; gap:5px; border:1px solid #d8dee6; background:#fff; color:#566477; display:flex; align-items:center; }
.card-actions .card-action:disabled { cursor:not-allowed; opacity:.5; }
.card-more-button { width:36px!important; height:36px!important; border:1px solid #d8dee6!important; }
.card-action-menu { position:absolute; top:40px; right:0; z-index:3; min-width:150px; padding:6px; background:#fff; border:1px solid #d8dee6; box-shadow:0 8px 24px #17203322; }
.card-action-menu button { width:100%; min-height:36px; padding:0 10px; border:0; background:#fff; display:flex; align-items:center; }
.card-action-menu button:hover,.card-action-menu button:focus-visible { background:#f2f5fa; }
.card-action-menu .danger { color:#a63d48; }
.tooltip { position:relative; display:inline-flex; }
.tooltip-content { position:absolute; right:0; bottom:calc(100% + 7px); z-index:5; width:max-content; max-width:220px; padding:6px 8px; border-radius:4px; background:#202a36; color:#fff; font-size:11px; pointer-events:none; opacity:0; visibility:hidden; transition:opacity .12s ease .3s,visibility 0s linear .42s; }
.tooltip:hover .tooltip-content,.tooltip:focus-within .tooltip-content { opacity:1; visibility:visible; transition-delay:.3s; }
.checked-at.stale { color:#a55a25; font-weight:600; }
.probe-detail { color:#a14b54!important; }
```

- [ ] **Step 7: Run Task 4 tests**

Run: `npm test -- --run tests/unit/room-card-actions.test.tsx tests/unit/room-card-presenter.test.ts tests/unit/app-room-form.test.tsx && npm run typecheck`

Expected: visible action labels, custom tooltip semantics, keyboard menu, invalid remembered titles, failure copy and staleness tests PASS.

---

### Task 5: 恢复提示、完整回归与人工验收

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `tests/unit/app-room-form.test.tsx`
- Verify: all source, tests, database and current development process.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: accurate post-recovery feedback and a user-verifiable build.

- [ ] **Step 1: Write a failing recovery-feedback test**

Add to `tests/unit/app-room-form.test.tsx`:

```tsx
it("replaces the stale recovery instruction after access is restored", async () => {
  const ready = { mode: "recovery_ready" as const, roomId: "123", taskType: "manual_probe" as const, triggeredAt: "2026-07-15T10:00:00.000Z" };
  vi.mocked(window.duoduo.access.getState).mockResolvedValue(ready);
  vi.mocked(window.duoduo.access.confirmRecovery).mockResolvedValue({ mode: "normal" });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "恢复访问" }));
  expect(await screen.findByText("访问已恢复，自动更新已继续")).toBeTruthy();
  expect(screen.queryByText("验证检查已通过，请点击“恢复访问”继续")).toBeNull();
});
```

- [ ] **Step 2: Correct the recovery transition message**

Replace `confirmRecovery` in `src/renderer/App.tsx` with:

```ts
async function confirmRecovery() {
  try {
    setAccessState(await window.duoduo.access.confirmRecovery() as DouyinAccessState);
    setVerificationVisible(false);
    setVerificationFeedback("");
    const recoveryMessage = "访问已恢复，自动更新已继续";
    setMessage(recoveryMessage);
    window.setTimeout(() => setMessage((current) => current === recoveryMessage ? "" : current), 4_000);
  } catch (error) { setMessage(`恢复失败：${String(error)}`); }
}
```

This confirms only periodic automatic scheduling resumes. The canceled manual batch remains canceled and can be explicitly started again with `更新全部状态`.

- [ ] **Step 3: Run the complete automated suite**

Run:

```bash
npm test -- --run
npm run typecheck
npm run test:electron-verification-main-frame
npm run test:electron-verification-view
npm run build
git diff --check
```

Expected: all Vitest files pass, typecheck exits 0, both local Electron regressions exit 0, packaging succeeds, and the diff has no whitespace errors.

- [ ] **Step 4: Verify data and process invariants**

Run read-only data checks:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const p=process.env.HOME+'/Library/Application Support/duoduo-live/duoduo.sqlite';const db=new DatabaseSync(p,{readOnly:true});console.log(db.prepare('select count(*) as count from rooms').get());console.log(db.prepare('pragma integrity_check').get());db.close()"
```

Expected: room count is unchanged from before implementation and `integrity_check` is `ok`.

Restart only the existing `/duoduo/demo/app` Electron development instance. Confirm exactly one project Electron main process remains; do not terminate unrelated Vite or Electron applications.

- [ ] **Step 5: Perform visual and interaction acceptance without automated Douyin control**

Capture the development window and verify:

1. `预备直播间` header shows `自动更新已开启` and the next scheduled time.
2. `更新全部状态` starts a serial progress display; only one card can be `检测中` at a time.
3. `停止后续更新` cancels queued rooms while the current room finishes normally.
4. The card shows visible `播放` and `立即检测` text.
5. Hovering or keyboard-focusing `更多操作` shows its custom tooltip after about 300ms.
6. The menu exposes textual `更新主播头像`、`编辑直播间`、`删除直播间` actions and closes on Escape.
7. Old snapshots show `已过期`; failures distinguish verification, login, timeout and page parsing.
8. A legacy `验证码中间页` title is not presented as the remembered anchor.
9. When verification occurs, automatic and batch access pauses globally and existing trusted metadata remains visible.
10. After the user manually verifies and clicks `恢复访问`, the stale instruction disappears and `访问已恢复，自动更新已继续` appears temporarily.

Do not click real Douyin controls on the user's behalf. Hand the final verification interaction to the user.
