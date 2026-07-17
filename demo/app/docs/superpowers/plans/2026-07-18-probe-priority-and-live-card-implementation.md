# 检测优先级与直播卡片优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让手动与首次检测获得真实队列优先级和可观察状态，并统一预备/已监看卡片的信息布局与可信指标展示。

**Architecture:** 主进程 `ProbeScheduler` 是检测队列和冷却状态的唯一事实来源，通过 `PreparedProbeState.manualProbes` 向渲染进程发布房间级状态。渲染层移除本地冷却推测，使用公共指标/操作布局分别组合预备卡片和已监看卡片，同时保留后者现有工作区。

**Tech Stack:** Electron 39、React 19、TypeScript 5.9、Zod 4、Vitest 4、Testing Library。

## Global Constraints

- 检测并发数保持为 `1`，不绕过抖音访问协调器、访问间隔或验证暂停。
- 当前正在执行的检测不被中断；高优先级请求只重排待执行任务。
- 60 秒手动冷却从任务实际完成时开始；首次检测不进入手动冷却。
- 新增直播间保存后自动发起一次 `initial` 高优先级检测。
- 已监看卡片右侧 ASR、观点和解析器工作区保持不变。
- 不新建分支，不推送代码。

---

### Task 1: 房间级检测状态契约

**Files:**
- Modify: `demo/app/src/shared/contracts.ts`
- Test: `demo/app/tests/unit/contracts.test.ts`

**Interfaces:**
- Produces: `ProbeRequestState`，以及 `PreparedProbeState.manualProbes: ProbeRequestState[]`。
- Consumes: 现有 `PreparedProbeStateSchema` 和导出类型生成方式。

- [ ] **Step 1: 写失败的契约测试**

在 `contracts.test.ts` 增加断言，验证 `manual/initial + queued/running` 可解析，只有 `manual + cooldown + cooldownUntil` 可解析，并拒绝 `initial + cooldown`。

```ts
const base = { mode: "running", queuedRoomIds: [] };
expect(PreparedProbeStateSchema.parse({ ...base, manualProbes: [{ roomId: "a", requestType: "initial", phase: "queued" }] }).manualProbes).toHaveLength(1);
expect(() => PreparedProbeStateSchema.parse({ ...base, manualProbes: [{ roomId: "a", requestType: "initial", phase: "cooldown", cooldownUntil: new Date().toISOString() }] })).toThrow();
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd demo/app && npm test -- --run tests/unit/contracts.test.ts`

Expected: FAIL，因为 `manualProbes` 尚未进入 schema 或无效联合未被拒绝。

- [ ] **Step 3: 实现可判别联合契约**

```ts
export const ProbeRequestStateSchema = z.discriminatedUnion("phase", [
  z.object({ roomId: z.string().min(1), requestType: z.enum(["manual", "initial"]), phase: z.enum(["queued", "running"]) }),
  z.object({ roomId: z.string().min(1), requestType: z.literal("manual"), phase: z.literal("cooldown"), cooldownUntil: z.string().datetime() }),
]);

// PreparedProbeStateSchema
manualProbes: z.array(ProbeRequestStateSchema).default([]),
```

- [ ] **Step 4: 运行契约测试**

Run: `cd demo/app && npm test -- --run tests/unit/contracts.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交该任务**

```bash
git add demo/app/src/shared/contracts.ts demo/app/tests/unit/contracts.test.ts
git commit -m "feat: expose room probe request states"
```

### Task 2: 高优先级队列、任务升级与完成后冷却

**Files:**
- Modify: `demo/app/src/main/rooms/probe-scheduler.ts`
- Modify: `demo/app/src/main/main.ts`
- Test: `demo/app/tests/unit/probe-scheduler.test.ts`

**Interfaces:**
- Consumes: `ProbeRequestState`、`PreparedProbeSource`。
- Produces: `runNow(roomId, "manual" | "initial")`；`state().manualProbes` 发布真实 queued/running/cooldown。

- [ ] **Step 1: 写队列优先级失败测试**

覆盖四个行为：手动请求排在自动待执行任务前；待执行自动任务被升级且不重复；运行中同房间被复用；多个高优先级任务保持请求顺序。

```ts
const autoB = scheduler.runNow("b", "scheduled");
const manualC = scheduler.runNow("c", "manual");
releaseA();
await vi.waitFor(() => expect(order).toEqual(["a", "c"]));
```

- [ ] **Step 2: 写状态和冷却失败测试**

断言点击后先出现 `queued/running`，任务完成前没有 cooldown；完成后 `manual` 出现 60 秒 cooldown；`initial` 完成后直接消失；失败后不产生 cooldown。

- [ ] **Step 3: 运行调度器测试确认失败**

Run: `cd demo/app && npm test -- --run tests/unit/probe-scheduler.test.ts`

Expected: FAIL，当前 FIFO 队列不升级任务且点击即记录冷却。

- [ ] **Step 4: 实现优先任务升级**

将待执行任务的多个调用者汇聚到同一 `QueuedProbe`，保留原 `batchId`，并为 `manual/initial` 设置优先来源：

```ts
private promotePending(roomId: string, source: "manual" | "initial") {
  const index = this.pending.findIndex((item) => item.roomId === roomId);
  if (index < 0) return undefined;
  const [item] = this.pending.splice(index, 1);
  item.requestType = source;
  this.pending.splice(this.priorityBoundary(), 0, item);
  this.emit();
  return this.running.get(roomId);
}
```

冷却时间只在成功完成 `manual` 项后写入；`state()` 清理过期冷却并从 active、pending、cooldown map 生成 `manualProbes`。

- [ ] **Step 5: 让新增直播间使用 initial 来源**

```ts
ipcMain.handle("rooms:add", async (_event, input) => {
  const result = await rooms.add(RoomInputSchema.parse(input));
  schedulePreparedRoom(result);
  void probeScheduler.runNow(result.roomId, "initial").catch(() => undefined);
  await broadcastSnapshot();
  return result;
});
```

同时扩展 `PreparedProbeSourceSchema` 包含 `initial`，并把它映射为现有安全的 `manual_probe` 访问任务类型。

- [ ] **Step 6: 运行调度器、契约和主进程相关测试**

Run: `cd demo/app && npm test -- --run tests/unit/probe-scheduler.test.ts tests/unit/contracts.test.ts tests/unit/live-probe.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交该任务**

```bash
git add demo/app/src/main/rooms/probe-scheduler.ts demo/app/src/main/main.ts demo/app/src/shared/contracts.ts demo/app/tests/unit/probe-scheduler.test.ts demo/app/tests/unit/contracts.test.ts
git commit -m "fix: prioritize requested room probes"
```

### Task 3: 渲染真实检测状态与检测中可信信息

**Files:**
- Modify: `demo/app/src/renderer/App.tsx`
- Modify: `demo/app/src/renderer/components/RoomCardActions.tsx`
- Modify: `demo/app/src/renderer/styles.css`
- Test: `demo/app/tests/unit/room-card-actions.test.tsx`
- Test: `demo/app/tests/unit/app-room-form.test.tsx`

**Interfaces:**
- Consumes: `PreparedProbeState.manualProbes`。
- Produces: `RoomCardActions.probeState?: ProbeRequestState`；按钮状态完全来自主进程。

- [ ] **Step 1: 写操作按钮状态失败测试**

分别渲染 queued、running、cooldown、initial queued、initial running，断言按钮文案、禁用状态和点击不会重复触发。

```tsx
render(<RoomCardActions probeState={{ roomId: "123", requestType: "initial", phase: "queued" }} {...handlers} />);
expect((screen.getByRole("button", { name: "等待首次检测" }) as HTMLButtonElement).disabled).toBe(true);
```

- [ ] **Step 2: 写 App 状态流失败测试**

模拟 `subscribeProbeState` 发布 queued → running → cooldown，验证界面不在点击瞬间显示 60 秒，完成后才倒计时；模拟 checking 快照，验证名称、粉丝数、监看按钮和上次可信状态仍存在。

- [ ] **Step 3: 运行渲染测试确认失败**

Run: `cd demo/app && npm test -- --run tests/unit/room-card-actions.test.tsx tests/unit/app-room-form.test.tsx`

Expected: FAIL，当前组件只接受本地 `cooldown` 数字。

- [ ] **Step 4: 实现主进程状态驱动的按钮**

删除 `probeCooldowns` 及点击时 `setProbeCooldowns(...60)`；从 `preparedProbeState.manualProbes` 查找当前房间状态。仅根据 `cooldownUntil - Date.now()` 渲染剩余秒数，计时器只负责重绘，不创建业务状态。

- [ ] **Step 5: 保留检测中的可信展示**

让 Cover 对 `checking` 显示“检测中”与上次状态说明；名称、头像、粉丝数和加入监看高亮使用快照中的最近可信字段，不因临时 checking 清空。

- [ ] **Step 6: 实现预备卡片三行布局**

标题独占第一行并使用 `overflow-wrap:anywhere`；第二行左侧粉丝数、右侧操作；第三行监看按钮与自动监看。移除旧的标题省略样式。

- [ ] **Step 7: 运行渲染测试**

Run: `cd demo/app && npm test -- --run tests/unit/room-card-actions.test.tsx tests/unit/app-room-form.test.tsx`

Expected: PASS。

- [ ] **Step 8: 提交该任务**

```bash
git add demo/app/src/renderer/App.tsx demo/app/src/renderer/components/RoomCardActions.tsx demo/app/src/renderer/styles.css demo/app/tests/unit/room-card-actions.test.tsx demo/app/tests/unit/app-room-form.test.tsx
git commit -m "feat: show real probe progress on room cards"
```

### Task 4: 已监看卡片统一信息头和双指标

**Files:**
- Create: `demo/app/src/renderer/components/RoomMetricsActions.tsx`
- Modify: `demo/app/src/renderer/App.tsx`
- Modify: `demo/app/src/renderer/styles.css`
- Test: `demo/app/tests/unit/app-room-form.test.tsx`

**Interfaces:**
- Produces: `RoomMetricsActions`，输入 `followerText`、`viewerText` 和操作插槽，输出固定双指标和右侧操作槽。
- Consumes: snapshot/runtime/intelligence 的最新可信指标以及现有 `LiveRoomWorkspace`。

- [ ] **Step 1: 写已监看卡片失败测试**

构造 `monitoring: true` 的房间、长名称、可信 follower/viewer；断言完整名称、`主播粉丝 126.4 万`、`直播间人数 1,234` 同行出现，播放/编辑操作在右侧，工作区仍渲染。

- [ ] **Step 2: 写离线和缺失指标失败测试**

构造 `liveStatus: offline`，断言 `直播间人数 —`、粉丝数保留；完全无可信值时两个指标均为 `—`。

- [ ] **Step 3: 运行 App 测试确认失败**

Run: `cd demo/app && npm test -- --run tests/unit/app-room-form.test.tsx`

Expected: FAIL，当前已监看 `RoomInfo` 显示链接和日程，不显示双指标。

- [ ] **Step 4: 创建公共指标操作行并接入两类卡片**

```tsx
export function RoomMetricsActions({ followerText, viewerText, children }: Props) {
  return <div className="room-metrics-actions">
    <div className="room-metrics"><span>主播粉丝 <b>{followerText}</b></span><span>直播间人数 <b>{viewerText}</b></span></div>
    {children}
  </div>;
}
```

已监看卡片移除直播间链接，名称独占首行，第三行改为明确的“退出实时监看”按钮；保留 Cover、数据详情和 `LiveRoomWorkspace`。

- [ ] **Step 5: 运行渲染测试和样式构建检查**

Run: `cd demo/app && npm test -- --run tests/unit/app-room-form.test.tsx tests/unit/room-card-actions.test.tsx && npm run typecheck`

Expected: PASS。

- [ ] **Step 6: 提交该任务**

```bash
git add demo/app/src/renderer/components/RoomMetricsActions.tsx demo/app/src/renderer/App.tsx demo/app/src/renderer/styles.css demo/app/tests/unit/app-room-form.test.tsx
git commit -m "feat: unify monitored room card details"
```

### Task 5: 全量回归与视觉验收

**Files:**
- Test: `demo/app/tests/electron/app-fixture-e2e.cjs`

**Interfaces:**
- Consumes: Tasks 1-4 的完整实现。
- Produces: 可构建、测试通过且 fixture 页面可验证的应用。

- [ ] **Step 1: 运行完整静态检查和测试**

Run: `cd demo/app && npm run typecheck && npm test`

Expected: TypeScript 无错误，全部 Vitest 测试通过。

- [ ] **Step 2: 构建 Electron 应用**

Run: `cd demo/app && npm run build`

Expected: Electron Forge package 成功完成。

- [ ] **Step 3: 运行 fixture E2E**

Run: `cd demo/app && npm run test:e2e-fixture`

Expected: 命令输出 `{"ok":true,...}`，预备卡片与已监看工作区截图均成功生成。

- [ ] **Step 4: 检查最终 diff**

Run: `git diff --check && git status --short`

Expected: 无空白错误；只包含本计划相关改动和用户已有未提交文件。
