# Live Room Profile Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在单次抖音直播页会话内提取在线人数、粉丝数和可选直播介绍，并在未监看与已监看卡片中展示介绍。

**Architecture:** `live-probe.ts` 负责稳定节点读取和资料卡交互，`RoomProbeResult` 将可选 `liveDescription` 传入现有快照保存链路。SQLite 快照保留最近一次有效介绍，渲染层从统一 `RoomSnapshot` 读取并复用一个小型展示组件。

**Tech Stack:** Electron、TypeScript、React、Zod、SQLite、Vitest、Testing Library

## Global Constraints

- 一次检测只加载一次直播间 URL，不重新导航或重复打开页面。
- `liveDescription` 只表示资料卡“直播介绍”，不得替代用户直播时间或本场开播时间。
- 资料卡缺失或交互失败不得导致基础直播状态检测失败。
- 没有介绍时保留上一次有效值，卡片不渲染空白占位。
- 不依赖抖音生成式类名；优先使用 `data-e2e` 和 `aria-describedby`。
- 不新建分支、不推送代码。

---

### Task 1: 稳定节点和资料卡提取

**Files:**
- Modify: `demo/app/src/main/rooms/live-probe.ts`
- Modify: `demo/app/src/main/rooms/metric-extractor.ts`
- Test: `demo/app/tests/unit/live-probe.test.ts`
- Test: `demo/app/tests/unit/metric-extractor.test.ts`

**Interfaces:**
- Produces: `RoomProbeResult.liveDescription?: string`
- Produces: 同一页面内的主播资料卡增强步骤，返回名称、头像、在线人数、粉丝数和直播介绍。

- [ ] **Step 1: 写失败测试，覆盖稳定节点与资料卡交互**

  在 `live-probe.test.ts` 增加模拟页面：首屏含 `live-room-nickname`、`live-avatar`、`live-room-audience`、`rooom-info-bar-anchor`；点击触发器后，`aria-describedby` 对应资料卡返回 `4 关注 · 1.2万 粉丝直播介绍：每周日一二三四六18:00`。断言只调用一次 `loadURL`，结果包含 `viewerCount: 145`、`followerCount: 12000` 和介绍文本。

- [ ] **Step 2: 写失败测试，覆盖无资料卡降级**

  模拟直播视频可播放但没有资料卡触发器，断言 `status === "live"` 且 `liveDescription` 未定义，不返回 `page_error`。

- [ ] **Step 3: 写失败测试，覆盖在线观众文本降级格式**

  在 `metric-extractor.test.ts` 输入 `在线观众 · 162`，断言 `viewerCount === 162`。

- [ ] **Step 4: 运行定向测试并确认失败**

  Run: `npm test -- --run tests/unit/live-probe.test.ts tests/unit/metric-extractor.test.ts`
  Expected: FAIL，缺少资料卡增强和“在线观众 · 数值”解析。

- [ ] **Step 5: 实现最小提取逻辑**

  在每轮页面证据中优先读取稳定节点；确认直播后，在同一个 `webContents` 中点击唯一的 `rooom-info-bar-anchor`，短时轮询其 `aria-describedby` 对应元素。资料卡存在时读取限定范围文本、头像及介绍；任何资料卡异常仅跳过增强。将首屏和资料卡候选合并后交给指标提取器。

- [ ] **Step 6: 运行定向测试并确认通过**

  Run: `npm test -- --run tests/unit/live-probe.test.ts tests/unit/metric-extractor.test.ts`
  Expected: PASS。

### Task 2: 快照契约与持久化

**Files:**
- Modify: `demo/app/src/shared/contracts.ts`
- Modify: `demo/app/src/main/storage/database.ts`
- Modify: `demo/app/src/main/main.ts`
- Test: `demo/app/tests/unit/contracts.test.ts`
- Test: `demo/app/tests/unit/database.test.ts`

**Interfaces:**
- Consumes: `RoomProbeResult.liveDescription?: string`
- Produces: `RoomSnapshot.liveDescription?: string`
- Produces: SQLite 可空列 `room_snapshots.live_description`。

- [ ] **Step 1: 写失败契约与数据库测试**

  断言 `RoomSnapshotSchema` 接受非空 `liveDescription`；数据库写入介绍后再次仅写状态时仍保留旧介绍；新数据库和旧数据库迁移后均可读写该字段。

- [ ] **Step 2: 运行定向测试并确认失败**

  Run: `npm test -- --run tests/unit/contracts.test.ts tests/unit/database.test.ts`
  Expected: FAIL，契约和数据库尚无该字段。

- [ ] **Step 3: 实现契约、迁移和保存规则**

  为快照 schema 增加 `z.string().trim().min(1).max(500).optional()`；创建表和兼容迁移增加 `live_description TEXT`；SQL 映射读写该列。主进程保存探测结果时使用 `result.liveDescription ?? existing?.liveDescription`。

- [ ] **Step 4: 运行定向测试并确认通过**

  Run: `npm test -- --run tests/unit/contracts.test.ts tests/unit/database.test.ts`
  Expected: PASS。

### Task 3: 未监看与已监看卡片展示

**Files:**
- Modify: `demo/app/src/renderer/App.tsx`
- Modify: `demo/app/src/renderer/styles.css`
- Test: `demo/app/tests/unit/app-room-form.test.tsx`

**Interfaces:**
- Consumes: `RoomSnapshot.liveDescription?: string`
- Produces: `LiveDescription` 展示组件，供两种卡片复用。

- [ ] **Step 1: 写失败渲染测试**

  构造含长 `liveDescription` 的未监看和已监看快照，断言两处均出现 `直播介绍：`，元素 `title` 保存全文；构造无介绍快照，断言对应节点不存在。

- [ ] **Step 2: 运行定向测试并确认失败**

  Run: `npm test -- --run tests/unit/app-room-form.test.tsx`
  Expected: FAIL，卡片尚未展示直播介绍。

- [ ] **Step 3: 实现统一可选展示组件和样式**

  `LiveDescription` 在值为空时返回 `null`，否则渲染带 `title` 的段落。将它放在未监看卡片的指标操作行后，以及 `RoomInfo` 的 `RoomMetricsActions` 后。CSS 使用 `display: -webkit-box`、`-webkit-line-clamp: 2`、`overflow: hidden`，不设置固定高度。

- [ ] **Step 4: 运行定向测试并确认通过**

  Run: `npm test -- --run tests/unit/app-room-form.test.tsx`
  Expected: PASS。

### Task 4: 监看页更新链路与完整回归

**Files:**
- Modify: `demo/app/src/main/rooms/room-session.ts`
- Test: `demo/app/tests/unit/room-session.test.ts`
- Test: `demo/app/tests/unit/room-session-resources.test.ts`

**Interfaces:**
- Consumes: `inspectCurrentRoom()` 的资料字段。
- Produces: 已监看直播间后续健康检查可补充在线人数、粉丝数和直播介绍，不重新导航。

- [ ] **Step 1: 写失败测试覆盖监看页资料补全**

  模拟现有监看页面返回稳定在线人数和已打开资料卡数据，断言会话快照更新携带 `liveDescription`；资料卡缺失时不清空已有介绍。

- [ ] **Step 2: 运行会话测试并确认失败**

  Run: `npm test -- --run tests/unit/room-session.test.ts tests/unit/room-session-resources.test.ts`
  Expected: FAIL，当前健康证据没有介绍字段。

- [ ] **Step 3: 复用资料增强逻辑**

  将资料卡增强封装为 `live-probe.ts` 内可复用函数，由首次检测和现有监看页调用；监看页不执行 `loadURL`，只在当前页面内读取或进行一次资料卡交互。

- [ ] **Step 4: 运行会话测试并确认通过**

  Run: `npm test -- --run tests/unit/room-session.test.ts tests/unit/room-session-resources.test.ts`
  Expected: PASS。

- [ ] **Step 5: 完整验证**

  Run: `npm run typecheck && npm test -- --run && npm run build:electron && git diff --check`
  Expected: 类型检查、全部测试、Electron 构建和补丁格式检查均通过。

- [ ] **Step 6: 审查工作区范围**

  Run: `git status --short && git diff --stat`
  Expected: 只包含本功能及此前用户已确认但尚未提交的工作区修改；不覆盖或撤销无关改动。
