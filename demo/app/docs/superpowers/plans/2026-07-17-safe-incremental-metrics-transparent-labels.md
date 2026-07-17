# 安全增量指标与透明标签 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只利用既有状态访问和已打开直播页面积累可信指标，在卡片和详情中提供可解释的规模、热度、增长和开播标签。

**Architecture:** 页面证据采集与指标解析分离：Electron 页面只返回有限的可见文本候选，纯 TypeScript 提取器负责数值和质量；SQLite 只保存可信数值与来源。`RoomIntelligenceService` 是纯本地查询/计算层，渲染层通过只读 IPC 获取摘要和详情，绝不调用页面访问接口。

**Tech Stack:** Electron 39、TypeScript、React 19、Zod、Node SQLite、Recharts、Vitest、Testing Library

## Global Constraints

- 本计划只能在 `2026-07-17-safe-access-and-avatar-recovery.md` 全部通过后执行。
- 指标采集不得新增抖音页面、刷新、跳转或网络请求。
- 已打开监看页面的指标快照间隔不得短于 5 分钟。
- 缺失值保持缺失，不能写成 0；空指标不能产生 `metricsObservedAt`。
- 卡片最多三个标签，所有标签必须提供窗口、样本数、时间和计算依据。
- 相对排名只代表本地有数据主播，不代表抖音全平台。
- 自动化测试不得访问真实抖音。
- 保留当前未提交变更；不新建分支、不提交、不推送。

---

### Task 1: 纯函数指标提取与可信质量语义

**Files:**
- Create: `src/main/rooms/metric-extractor.ts`
- Create: `tests/unit/metric-extractor.test.ts`
- Modify: `src/main/rooms/live-probe.ts`
- Modify: `tests/unit/live-probe.test.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `tests/unit/contracts.test.ts`

**Interfaces:**
- Produces: `MetricField`、`MetricSource`、`MetricCandidate`、`ExtractedMetrics`。
- Produces: `extractRoomMetrics({ bodyText, candidates }): ExtractedMetrics`。
- Extends: `RoomProbeResult.metricEvidence` and `RoomSnapshot.metricEvidence`。

- [ ] **Step 1: Write failing extractor tests**

Cover visible Chinese text, accessibility labels, compact units, ambiguous strings and missing values:

```ts
it("extracts semantic metrics and records their sources", () => {
  expect(extractRoomMetrics({
    bodyText: "2.3万人在线 本场观看 18.6万",
    candidates: [
      { text: "粉丝 126.4万", source: "accessibility" },
      { text: "获赞 8.1万", source: "visible_text" },
    ],
  })).toEqual({
    viewerCount: 23_000,
    followerCount: 1_264_000,
    totalViewerCount: 186_000,
    likeCount: 81_000,
    raw: expect.any(Object),
    evidence: expect.objectContaining({ followerCount: { raw: "126.4万", source: "accessibility" } }),
    quality: "complete",
  });
});

it("does not treat room ids, times or empty objects as metrics", () => {
  expect(extractRoomMetrics({ bodyText: "直播间 591958226292 18:30 开播", candidates: [] })).toEqual({
    raw: {}, evidence: {}, quality: "missing",
  });
});
```

- [ ] **Step 2: Run extractor tests and verify RED**

Run: `npm test -- --run tests/unit/metric-extractor.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement bounded semantic extraction**

Define exact public types:

```ts
export type MetricField = "viewerCount" | "followerCount" | "totalViewerCount" | "likeCount";
export type MetricSource = "visible_text" | "accessibility" | "structured_data";
export interface MetricCandidate { text: string; source: MetricSource }
export interface MetricDatum { raw: string; source: MetricSource }
export interface ExtractedMetrics {
  viewerCount?: number;
  followerCount?: number;
  totalViewerCount?: number;
  likeCount?: number;
  raw: Partial<Record<MetricField, string>>;
  evidence: Partial<Record<MetricField, MetricDatum>>;
  quality: "complete" | "partial" | "missing";
}
```

Use label-specific regular expressions and existing compact-number parsing. Reject negative, non-finite and unlabeled long numbers. Candidate order is accessibility, visible text, then bounded structured public data; a higher-confidence source wins per field.

- [ ] **Step 4: Return bounded page candidates from live probe**

The page evaluation may return at most 100 candidates, each truncated to 160 characters, from elements with `aria-label`, `title` or known metric-oriented attributes. It may return selected scalar values from public in-page structured data only when keys match a fixed metric allowlist. It must not return form values, cookies, local storage, request bodies or full script contents.

After evaluation, call `extractRoomMetrics` in the main process and populate numeric fields, raw text, evidence and quality.

- [ ] **Step 5: Extend schemas and test round-tripping**

Add:

```ts
export const MetricDatumSchema = z.object({
  raw: z.string().min(1).max(160),
  source: z.enum(["visible_text", "accessibility", "structured_data"]),
});
export const MetricEvidenceSchema = z.object({
  viewerCount: MetricDatumSchema.optional(),
  followerCount: MetricDatumSchema.optional(),
  totalViewerCount: MetricDatumSchema.optional(),
  likeCount: MetricDatumSchema.optional(),
});
```

Attach optional `metricEvidence` to `RoomSnapshotSchema`.

- [ ] **Step 6: Run Task 1 tests**

Run:

```bash
npm test -- --run tests/unit/metric-extractor.test.ts tests/unit/live-probe.test.ts tests/unit/contracts.test.ts
npm run typecheck
```

Expected: PASS and exit 0.

---

### Task 2: 指标来源存储、空指标迁移与最近历史查询

**Files:**
- Modify: `src/main/storage/database.ts`
- Modify: `tests/unit/database.test.ts`

**Interfaces:**
- Consumes: Task 1 `RoomSnapshot.metricEvidence`。
- Produces: `snapshots.listHistorySince(roomId, since, limit)`。
- Produces: `snapshots.listSessionsSince(roomId, since)`。
- Preserves: unavailable attempts retain last trusted metrics without creating a new observation time.

- [ ] **Step 1: Write failing persistence tests**

Add:

```ts
it("does not mark an empty metric object as observed", () => {
  database.snapshots.record({ roomId: "123", status: "live", metricRaw: {}, metricQuality: "missing", checkedAt: now });
  expect(database.snapshots.list()[0].metricsObservedAt).toBeUndefined();
});

it("persists metric evidence and returns the newest bounded history", () => {
  // Insert more than the limit across old and recent dates.
  const history = database.snapshots.listHistorySince("123", since, 2);
  expect(history.map((item) => item.checkedAt)).toEqual([recent1, recent2]);
  expect(history[1].metricEvidence?.viewerCount?.source).toBe("accessibility");
});
```

- [ ] **Step 2: Run database tests and verify RED**

Run: `npm test -- --run tests/unit/database.test.ts`

Expected: FAIL because empty `metricRaw` currently sets `metricsObservedAt` and evidence columns/queries do not exist.

- [ ] **Step 3: Add compatible evidence columns and cleanup migration**

Add nullable `metric_evidence_json` to snapshots and observations through the existing additive migration path. On startup run:

```sql
UPDATE room_snapshots
SET metrics_observed_at=NULL, metric_raw_json=NULL
WHERE viewer_count IS NULL
  AND follower_count IS NULL
  AND total_viewer_count IS NULL
  AND like_count IS NULL
  AND (metric_raw_json IS NULL OR metric_raw_json='{}');
```

Do not delete historical status observations. Analytics ignores rows without numeric metrics.

- [ ] **Step 4: Fix observed-metric semantics and queries**

Use numeric presence or non-empty validated evidence, never `metricRaw !== undefined`:

```ts
const observedMetrics = [parsed.viewerCount, parsed.followerCount, parsed.totalViewerCount, parsed.likeCount]
  .some((value) => value !== undefined);
```

`listHistorySince` selects `checked_at >= ?`, orders descending for the SQL limit, then reverses the result into chronological order. `listSessionsSince` returns sessions overlapping the requested window.

- [ ] **Step 5: Run database regression**

Run: `npm test -- --run tests/unit/database.test.ts tests/unit/data-maintenance.test.ts && npm run typecheck`

Expected: PASS; existing retention behavior remains intact.

---

### Task 3: 已打开直播页面的五分钟本地指标快照

**Files:**
- Modify: `src/main/rooms/live-probe.ts`
- Modify: `src/main/rooms/room-session.ts`
- Modify: `src/main/main.ts`
- Modify: `tests/unit/live-probe.test.ts`
- Modify: `tests/unit/room-session.test.ts`

**Interfaces:**
- Produces: `inspectCurrentRoom` metric candidates parsed through Task 1 extractor.
- Produces: `onMetricSnapshot(result: RoomProbeResult)` callback in `RoomSession`。
- Enforces: minimum 300,000 ms between persisted in-page metric snapshots.

- [ ] **Step 1: Write failing throttle tests**

Use fake timers and an already-open fake room page:

```ts
it("samples metrics from an open room at most once per five minutes without navigation", async () => {
  vi.useFakeTimers();
  const snapshots = vi.fn();
  const session = createStartedSession({ onMetricSnapshot: snapshots, metricSampleIntervalMs: 300_000 });
  await vi.advanceTimersByTimeAsync(299_999);
  expect(snapshots).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(snapshots).toHaveBeenCalledTimes(1);
  expect(webContents.loadURL).toHaveBeenCalledTimes(1);
});
```

Add unchanged-value deduplication and no-metric cases.

- [ ] **Step 2: Run RoomSession tests and verify RED**

Run: `npm test -- --run tests/unit/room-session.test.ts`

Expected: FAIL because in-page metric snapshots do not exist.

- [ ] **Step 3: Extend current-page inspection without navigation**

Return the same bounded metric candidates used by `probeRoom`. The health loop may inspect them, but persistence occurs only when:

```ts
now - lastMetricSnapshotAt >= metricSampleIntervalMs
&& extracted.quality !== "missing"
&& fingerprint(extracted) !== lastMetricFingerprint
```

No call to `loadURL`, `reload`, `stop` or a new BrowserWindow is allowed in this path.

- [ ] **Step 4: Persist the local live snapshot**

In `main.ts`, map the callback to:

```ts
database.snapshots.record({
  roomId,
  status: "live",
  ...metrics,
  checkedAt: new Date().toISOString(),
});
```

The existing session aggregation updates peak/average counts. Broadcast after persistence using the existing queued broadcast path.

- [ ] **Step 5: Run Task 3 tests**

Run:

```bash
npm test -- --run tests/unit/room-session.test.ts tests/unit/live-probe.test.ts tests/unit/database.test.ts
npm run typecheck
```

Expected: PASS and the load count remains one.

---

### Task 4: 本地画像服务与透明标签规则

**Files:**
- Create: `src/main/rooms/room-intelligence.ts`
- Create: `tests/unit/room-intelligence.test.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `tests/unit/contracts.test.ts`

**Interfaces:**
- Produces: `TransparentLabelSchema`、`RoomIntelligenceSummarySchema`、`RoomPeriodSummarySchema`、`RoomSessionSummarySchema`、`RoomIntelligenceSchema`。
- Produces: `RoomIntelligenceService.listSummaries(now): RoomIntelligenceSummary[]` and `.getDetails(roomId, now): RoomIntelligence`。
- Consumes: Task 2 recent history and sessions.

- [ ] **Step 1: Write failing contract and rule tests**

Cover exact thresholds and insufficient data:

```ts
it.each([
  [10_000_000, "千万级粉丝"],
  [1_000_000, "百万级粉丝"],
  [100_000, "十万级粉丝"],
  [99_999, undefined],
])("labels follower scale %s", (followers, expected) => {
  expect(scaleLabel(followers)?.text).toBe(expected);
});

it("labels local top quartile only with two sessions and five comparable rooms", () => {
  const result = service.listSummaries(now);
  expect(result.find((item) => item.roomId === "top")?.labels).toContainEqual(expect.objectContaining({ text: "近期在线靠前", sampleCount: 2, comparisonCount: 5 }));
});

it("requires two sessions in both windows, 30 percent and 100 absolute growth", () => {
  expect(summary.labels).toContainEqual(expect.objectContaining({ text: "近期升温 +40%" }));
});

it("returns only data accumulation when no numeric evidence exists", () => {
  expect(summary.labels).toEqual([expect.objectContaining({ kind: "insufficient_data", text: "数据积累中" })]);
});
```

Also test natural-day activity, three-session two-hour median duration, missing intervals, label ordering and maximum card-label count.

- [ ] **Step 2: Run intelligence tests and verify RED**

Run: `npm test -- --run tests/unit/room-intelligence.test.ts tests/unit/contracts.test.ts`

Expected: FAIL because the service and contracts do not exist.

- [ ] **Step 3: Add shared read models**

Define label fields exactly as the spec: `kind`, `text`, `explanation`, `observedAt`, `sampleCount`, optional `comparisonCount`. `RoomIntelligenceSummary` contains `roomId`, current metrics, at most three labels and generated time. `RoomIntelligence` extends it with 7/30-day summaries, chronological points, all label evidence and evidence-based session boundaries. All timestamps use ISO datetime strings.

- [ ] **Step 4: Implement deterministic local calculations**

Rules:

```ts
const MAX_CARD_LABELS = 3;
const TOP_QUARTILE = 0.75;
const MIN_COMPARISON_ROOMS = 5;
const MIN_HEAT_SESSIONS = 2;
const GROWTH_RATIO = 1.30;
const MIN_ABSOLUTE_GROWTH = 100;
const LONG_SESSION_MS = 2 * 60 * 60 * 1000;
```

Aggregate viewer counts per session before cross-room comparison so a frequently sampled room does not dominate. Use evidence intervals for start/stop; do not interpolate trend gaps. Generate explanations from the same values used in predicates.

- [ ] **Step 5: Run Task 4 tests**

Run: `npm test -- --run tests/unit/room-intelligence.test.ts tests/unit/contracts.test.ts && npm run typecheck`

Expected: PASS with deterministic time injected.

---

### Task 5: 只读画像 IPC 与“零页面访问”契约

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/preload/api.ts`
- Modify: `tests/unit/renderer-api.test.ts`
- Create: `tests/integration/room-intelligence-ipc.test.ts`

**Interfaces:**
- Produces: `rooms:list-intelligence` and `rooms:get-intelligence` IPC handlers.
- Produces renderer methods: `rooms.listIntelligence()` and `rooms.getIntelligence(roomId)`。
- Consumes: Task 4 service.

- [ ] **Step 1: Write failing preload and integration tests**

Assert exact channels and that local reads do not touch access/navigation spies:

```ts
await api.rooms.listIntelligence();
expect(invoke).toHaveBeenCalledWith("rooms:list-intelligence");
await api.rooms.getIntelligence("123");
expect(invoke).toHaveBeenCalledWith("rooms:get-intelligence", "123");

expect(coordinator.submit).not.toHaveBeenCalled();
expect(probeRoom).not.toHaveBeenCalled();
expect(browserWindowFactory).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --run tests/unit/renderer-api.test.ts tests/integration/room-intelligence-ipc.test.ts`

Expected: FAIL because APIs do not exist.

- [ ] **Step 3: Expose only local read methods**

Parse room IDs with Zod. Construct the service from database repository callbacks. The two handlers must be defined in a local-read section and must not close over coordinator, `probeRoom`, Electron session, BrowserWindow or WebContentsView.

- [ ] **Step 4: Run Task 5 tests**

Run: `npm test -- --run tests/unit/renderer-api.test.ts tests/integration/room-intelligence-ipc.test.ts && npm run typecheck`

Expected: PASS; navigation spies remain zero.

---

### Task 6: 卡片透明标签与无障碍说明

**Files:**
- Create: `src/renderer/components/RoomLabels.tsx`
- Create: `tests/unit/room-labels.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: `tests/unit/app-room-form.test.tsx`

**Interfaces:**
- Consumes: Task 4 `TransparentLabel` and Task 5 list API.
- Produces: compact maximum-three-label card row and evidence tooltip/popover.

- [ ] **Step 1: Write failing card-label tests**

Assert:

```tsx
expect(screen.getAllByRole("button", { name: /标签说明/ })).toHaveLength(3);
await user.hover(screen.getByRole("button", { name: "标签说明：近期在线靠前" }));
expect(await screen.findByText(/本地 11 个有数据主播/)).toBeVisible();
expect(screen.getByText(/最后采集/)).toBeVisible();
```

Add keyboard-focus behavior, `数据积累中`, offline “上次采集” copy and no request caused by tooltip interaction.

- [ ] **Step 2: Run UI tests and verify RED**

Run: `npm test -- --run tests/unit/room-labels.test.tsx tests/unit/app-room-form.test.tsx`

Expected: FAIL because labels are not rendered.

- [ ] **Step 3: Implement the compact label row**

Use the existing custom `Tooltip` component rather than native `title`. Render labels as buttons with explicit accessible names. Tooltip content includes explanation, window/sample count, comparison count, observed time and “仅基于本地已采集样本”。Never call probe APIs from this component.

- [ ] **Step 4: Integrate summaries into App**

Load summaries after the initial room snapshot and refresh them after a local snapshot broadcast. Keep intelligence in a `Map<string, RoomIntelligenceSummary>`. A failed query shows no false labels and does not block room cards.

- [ ] **Step 5: Run Task 6 tests**

Run: `npm test -- --run tests/unit/room-labels.test.tsx tests/unit/app-room-form.test.tsx && npm run typecheck`

Expected: PASS with at most three visible labels.

---

### Task 7: 本地详情抽屉、趋势与开停播证据区间

**Files:**
- Create: `src/renderer/components/RoomDetailsDrawer.tsx`
- Create: `tests/unit/room-details-drawer.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: Task 5 `rooms.getIntelligence(roomId)`。
- Produces: accessible modal/drawer with status, metrics, trends, sessions and full label evidence.

- [ ] **Step 1: Write failing drawer tests**

Test local opening, focus behavior, missing values and evidence intervals:

```tsx
await user.click(screen.getByRole("button", { name: "查看老刘看财经详情" }));
expect(await screen.findByRole("dialog", { name: "老刘看财经直播间详情" })).toBeVisible();
expect(screen.getByText("首次直播证据 10:03")).toBeVisible();
expect(screen.getByText("首次离线证据 12:11")).toBeVisible();
expect(screen.queryByText(/在线人数 0/)).not.toBeInTheDocument();
expect(window.duoduo.rooms.probe).not.toHaveBeenCalled();
```

Add a trend-gap case proving no zero-valued point is synthesized.

- [ ] **Step 2: Run drawer tests and verify RED**

Run: `npm test -- --run tests/unit/room-details-drawer.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement accessible details**

Use a right-side `role="dialog"` with heading, close button, Escape handling and focus return. Sections are current/last metrics, 7/30-day Recharts line chart, session evidence table and label explanations. Render gaps as missing points; never add zero values for offline or unavailable times.

- [ ] **Step 4: Add card entry and local loading states**

Add a text “查看详情” action distinct from probe/play icons. While loading show “正在读取本地数据”；on error show “本地详情暂不可用”。Do not alter global access or prepared-probe state.

- [ ] **Step 5: Run Task 7 tests**

Run:

```bash
npm test -- --run tests/unit/room-details-drawer.test.tsx tests/unit/app-room-form.test.tsx
npm run typecheck
```

Expected: PASS and probe spies remain zero.

---

### Task 8: 第二阶段回归与零真实访问验收

**Files:**
- Create: `tests/electron/room-intelligence-e2e.cjs`
- Modify: `package.json`
- Create: `docs/superpowers/reports/2026-07-17-room-intelligence-acceptance.md`

**Interfaces:**
- Produces: `npm run test:e2e-room-intelligence`。
- Consumes: all prior tasks and local fixture data.

- [ ] **Step 1: Add fixture-only room intelligence E2E**

Seed rooms, valid and missing metrics, two time windows and live sessions directly through fixture/local test hooks. Assert avatar display, three-label cap, tooltip evidence, details trend gaps, start/stop evidence, data accumulation state and local-only interaction.

Capture a fixture navigation counter before and after opening every label and detail:

```js
assert.equal(navigationsAfterLocalReads, navigationsBeforeLocalReads);
assert.equal(realDouyinRequests, 0);
```

- [ ] **Step 2: Add command and run E2E**

Add:

```json
"test:e2e-room-intelligence": "npm run build --silent && node tests/electron/room-intelligence-e2e.cjs"
```

Run: `npm run test:e2e-room-intelligence`

Expected: exit 0 and zero navigation delta for local reads.

- [ ] **Step 3: Run complete verification**

Run:

```bash
npm test -- --run
npm run test:e2e-verification
npm run test:e2e-room-intelligence
npm run typecheck
npm run build
npm run scan:secrets
git diff --check
```

Expected: every command exits 0; no real Douyin request occurs.

- [ ] **Step 4: Write acceptance report**

Record exact test counts, fixture navigation counts, thresholds, current real-database limitation (existing valid viewer/follower samples may still be zero), and the fact that labels will remain “数据积累中” until future natural samples arrive.

- [ ] **Step 5: Inspect final workspace**

Run: `git status --short`

Expected: all work remains on the existing branch and uncommitted; nothing was pushed.
