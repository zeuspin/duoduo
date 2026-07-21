# 粉丝指标采集与监看卡片布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 恢复有证据的主播粉丝数采集，并消除监看卡片的在线人数重复与操作按钮遮挡。

**Architecture:** `live-probe` 扩展资料卡发现策略并返回诊断状态，主进程把缺失原因写入诊断日志；数值仍统一交给 `metric-extractor` 解析。渲染端把操作按钮移入标题行，指标行只保留粉丝和当前/上次在线，标签组件通过参数关闭重复指标。

**Tech Stack:** Electron WebContents、TypeScript、React、CSS Flex/Grid、Vitest、Testing Library。

## Global Constraints

- 没有原始粉丝证据时保持 `—`，禁止猜测。
- 不增加额外页面访问，资料卡采集复用当前探测或监看页面。
- 在线人数只在卡片展示一次。
- 不新建分支、不提交或推送代码。

---

### Task 1: 固化采集缺失与成功状态

- 修改 `tests/unit/live-probe.test.ts`，覆盖资料入口缺失、弹层缺失、弹层无粉丝和找到粉丝四种状态。
- 修改 `src/main/rooms/live-probe.ts`，返回资料卡采集状态并扩展可见弹层发现。
- 在 `src/main/main.ts` 对缺少粉丝的探测记录诊断事件。

### Task 2: 消除指标重复和遮挡

- 修改 `tests/unit/app-room-form.test.tsx`，断言监看卡片只有一个“当前在线”，不存在“直播间人数”，标题与操作共用独立标题行。
- 修改 `src/renderer/App.tsx`、`src/renderer/components/RoomMetricsActions.tsx` 和 `src/renderer/components/RoomIntelligence.tsx`，重排标题、操作和指标。
- 修改 `src/renderer/styles.css`，确保指标行不与固定宽度操作区竞争。

### Task 3: 完整验证

- 运行定向测试、类型检查、全量测试、Electron 打包和 `git diff --check`。
- 读取本地数据库确认历史缺失值仍为 NULL，不伪造回填。
