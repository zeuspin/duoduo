# 实时监看运行组前端守卫 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻止停止组从前端发起实时监看，并把状态竞争产生的后端拒绝转换为用户可见错误。

**Architecture:** 复用 `RoomGroupWorkspace` 已传入 `App` 内容渲染器的 `groupRunning` 真值作为按钮守卫；后端 `startRoomMonitoring` 的权威校验保持不变。新增一个带错误捕获的前端调用函数处理运行状态瞬时变化。

**Tech Stack:** React、TypeScript、Vitest、Testing Library、Electron IPC。

## Global Constraints

- 同一时间只允许一个组运行。
- 只有运行组允许实时监看，最多为组内 9 路。
- 不放宽或删除后端 `ROOM_GROUP_NOT_RUNNING` 校验。
- 不新建分支、不提交或推送代码。

---

### Task 1: 增加停止组交互回归测试

**Files:**
- Modify: `tests/unit/app-room-form.test.tsx`

- [ ] 将停止组场景改为断言“加入实时监看”按钮禁用并具有“请先启动当前分组”说明。
- [ ] 增加运行组场景，模拟后端因状态竞争拒绝调用，断言界面展示“无法加入实时监看”提示。
- [ ] 运行 `npm test -- --run tests/unit/app-room-form.test.tsx` 并确认测试因缺少守卫和错误处理失败。

### Task 2: 实现前端守卫和错误处理

**Files:**
- Modify: `src/renderer/App.tsx`

- [ ] 新增 `joinMonitoring(roomId)`，捕获调用异常并写入现有 toast 状态。
- [ ] 将按钮禁用条件设为 `accessBlocked || !groupRunning`。
- [ ] 为停止组按钮提供“请先启动当前分组”的 title。
- [ ] 运行定向测试，确认停止组不调用 IPC、运行组仍可调用且错误可见。

### Task 3: 完整验证

- [ ] 运行 `npm run typecheck && npm test && npm run build && git diff --check`。
- [ ] 静态确认 `ROOM_GROUP_NOT_RUNNING` 后端校验仍存在。
