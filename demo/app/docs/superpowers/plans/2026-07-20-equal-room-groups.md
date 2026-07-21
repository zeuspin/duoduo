# 平等分组与当前组添加 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增直播间始终以当前查看组为目标，并清除运行时“默认分组”兜底，同时保留至少一个分组的后端约束。

**Architecture:** `RoomGroupWorkspace` 成为当前组选择的唯一来源，通过回调把选择同步给 `App`；新增弹窗使用明确的目标组 ID。共享契约和存储层要求 `groupId` 必填，数据库不再选择第一组兜底；迁移逻辑仍负责给历史房间分配真实存在的普通分组 ID。

**Tech Stack:** React、TypeScript、Zod、node:sqlite、Vitest、Testing Library。

## Global Constraints

- 所有分组平等，不存在特殊默认分组。
- 新增直播间必须具有明确 `groupId`。
- 当前运行组不可增加成员。
- 每组最多 9 个直播间。
- 后端必须始终拒绝删除最后一个分组。
- 不新建分支、不提交或推送代码。

---

### Task 1: 当前组选择和新增行为测试

- 修改 `tests/unit/room-group-workspace.test.tsx`：验证切换组会通知父组件，新建成功后自动选中新组。
- 修改 `tests/unit/app-room-form.test.tsx`：验证在第二组点击添加时弹窗选中第二组；运行组与满组显示准确提示，不回退第一组。
- 运行定向测试并确认因现有 `available[0]` 行为失败。

### Task 2: 当前组数据流实现

- 修改 `src/renderer/components/RoomGroupWorkspace.tsx`：增加 `onSelectedGroupChange` 与 `onAddRoom`，新建后选中新组。
- 修改 `src/renderer/App.tsx`：添加操作接收当前组 ID，精确校验该组的运行和容量状态；移除 `legacy-default` 匹配分支。
- 运行 Task 1 测试并确认通过。

### Task 3: 移除存储兜底

- 修改 `src/shared/contracts.ts`：`RoomInputSchema.groupId` 与 `RoomSchema.groupId` 必填。
- 修改 `src/main/storage/database.ts`：新增房间不再回退到第一组。
- 修改 `src/main/storage/room-store.ts`：不再写入 `legacy-default`。
- 更新受影响测试夹具，为新增请求提供实际组 ID；增加缺少 `groupId` 被拒绝和最后一组不可删除测试。

### Task 4: 完整验证

- 运行 `npm run typecheck && npm test && npm run build && git diff --check`。
- 静态搜索运行时代码，确认不存在 `legacy-default` 和新增时的第一组兜底。
- 确认 `LAST_GROUP_REQUIRED` 后端约束仍存在并由测试覆盖。
