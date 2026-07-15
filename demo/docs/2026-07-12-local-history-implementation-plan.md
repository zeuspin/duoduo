# Local ASR History And Room Probing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 macOS 客户端实现可维护直播间、独立状态与封面探测、本地 ASR 历史分页、自然时间和有界资源。

**Architecture:** 使用 `node:sqlite` 建立主进程本地数据库，Renderer 只通过校验后的 IPC 读取分页历史。房间探测与实时监看分离，探测器只覆盖每个房间的最后快照，RoomManager 把最终 ASR 写入数据库并只保留有界热数据。

**Tech Stack:** Electron 39、React 19、TypeScript、Node `node:sqlite`、Zod、Vitest、Electron fixture E2E。

## Global Constraints

- 所有新增交付文件位于 `demo`。
- 当前只验收 macOS ARM64。
- ASR 默认静音，不实现音视频播放。
- 测试期 ASR 不自动删除。
- API Key 不进入 Renderer、日志或 SQLite 明文。

---

### Task 1: Schema And SQLite Storage

**Files:** `src/shared/contracts.ts`、新建 `src/main/storage/database.ts`、`src/main/storage/room-repository.ts`、`src/main/storage/asr-repository.ts`，测试位于 `tests/unit`。

- [ ] 先写失败测试，覆盖可选周期、默认不确定、旧 JSON 迁移、最终 ASR 去重、自然时间和游标分页。
- [ ] 运行对应 Vitest，确认因接口缺失而失败。
- [ ] 实现 WAL SQLite schema、repositories 和一次性 JSON 迁移。
- [ ] 运行单元测试，验收数据库重启后房间及 ASR 完整，重复 segment 不增加行数。

### Task 2: IPC And Bounded Runtime

**Files:** `src/main/main.ts`、`src/main/rooms/room-manager.ts`、`src/preload/api.ts`、`src/renderer/global.d.ts`。

- [ ] 先写失败测试，覆盖 `asr.listBefore`、`rooms.probe`、设置探测频次以及每路热数据上限。
- [ ] 实现 Zod 校验 IPC、final ASR 持久化和最多 100 条运行时缓存。
- [ ] 验收 Renderer API 不暴露 Node，分页接口一次最多返回 100 条。

### Task 3: Probe Scheduler And Latest Cover

**Files:** 新建 `src/main/rooms/probe-scheduler.ts`、`src/main/rooms/cover-cache.ts`，修改 `src/main/rooms/live-probe.ts`。

- [ ] 先写失败测试，覆盖状态收敛、失败保留旧快照、频次覆盖、错峰和封面原子替换。
- [ ] 实现单房间互斥探测、可配置定时器和最后快照覆盖。
- [ ] 验收未监看房间能离开“检测中”，每个房间磁盘只保留一张封面。

### Task 4: Room Editing And Schedule UI

**Files:** `src/renderer/App.tsx`、`src/renderer/forms.css`、`src/renderer/styles.css`。

- [ ] 先写 Renderer 测试，覆盖添加默认不确定、编辑入口、固定周期多时段和探测频次。
- [ ] 实现添加/编辑共用表单及卡片状态、封面、最后检测时间。
- [ ] 验收添加房间不再自动生成工作日时段，现有房间可修改周期。

### Task 5: Vertical ASR And History Pagination

**Files:** 新建 `src/renderer/components/AsrFeed.tsx`，修改 `src/renderer/asr.css`、`src/renderer/App.tsx`。

- [ ] 先写长文本与分页失败测试，要求无横向溢出、自然时间、顶部加载历史和滚动锚点稳定。
- [ ] 实现每路最多 200 条的纵向 feed、50 条游标分页和底部跟随规则。
- [ ] 验收长文本只纵向换行，查看历史时新消息不抢滚动位置。

### Task 6: Resource And Packaged Mac Verification

**Files:** 新建 `tests/electron/resource-soak.cjs`，修改 fixture E2E 与 `reports/acceptance-status.md`。

- [ ] 增加三路 20 分钟资源测试，采样 RSS、heap、WebContents、socket 和监听器数量。
- [ ] 运行 typecheck、全部 Vitest、音频隔离、崩溃隔离、三次 packaged Mac E2E 和密钥扫描。
- [ ] 验收后 10 分钟 RSS 增长不超过 20%，停止后隐藏 WebContents 和 ASR socket 为零。
- [ ] 重建并校验 macOS ARM64 DMG/ZIP，保存修复后截图与验收报告。
