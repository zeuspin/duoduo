# 内嵌验证页替换独立窗口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用主窗口内的 `WebContentsView` 承载抖音人工验证，彻底移除验证流程中的独立原生窗口及其关闭崩溃路径。

**Architecture:** 新增可单元测试的 `EmbeddedVerificationController`，管理一个长期存活的视图、可见性、边界和受控释放。React 渲染固定工具栏及占位表面，并通过 IPC 把表面边界同步给主进程；恢复检查直接读取同一视图，不再创建隐藏检查窗口。

**Tech Stack:** Electron 39 `WebContentsView`、TypeScript、React 19、Vitest。

## Global Constraints

- 不自动识别、点击、代答或绕过验证码。
- 验证期间不截图、不采集直播指标、不读取用户输入。
- 复用 `persist:duoduo-douyin` session。
- 关闭验证页后继续保持 `verification_paused`。
- 不创建分支、不提交、不推送。

---

### Task 1: 内嵌验证视图控制器

**Files:**
- Create: `src/main/rooms/embedded-verification-controller.ts`
- Create: `tests/unit/embedded-verification-controller.test.ts`
- Delete after migration: `src/main/rooms/verification-window.ts`
- Delete after migration: `tests/unit/verification-window.test.ts`

**Interfaces:**
- Consumes: Electron 适配层提供的 `setBounds`、`setVisible`、`loadURL`、`getURL`、`readBlockedState`、`destroy`。
- Produces: `show(url)`, `hide()`, `setBounds(bounds)`, `currentUrl()`, `inspectBlockedState()`, `dispose()`。

- [ ] **Step 1: Write failing controller tests**

覆盖：首次 `show` 只加载一次；重复显示不重载；隐藏只调用 `setVisible(false)` 而不销毁；隐藏后重新显示复用页面；边界只接受正尺寸；`dispose` 后拒绝操作；20 次显示/隐藏只创建并加载一次。

- [ ] **Step 2: Run RED test**

Run: `npm test -- --run tests/unit/embedded-verification-controller.test.ts`

Expected: FAIL because the controller module does not exist.

- [ ] **Step 3: Implement minimal controller**

控制器持有单个 surface；`show` 首次调用 `loadURL`，然后设置边界和可见；`hide` 仅设置不可见；`dispose` 才调用销毁。

- [ ] **Step 4: Run GREEN test**

Run: `npm test -- --run tests/unit/embedded-verification-controller.test.ts`

Expected: all controller tests PASS.

### Task 2: 主进程与 IPC 迁移

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/preload/api.ts`
- Modify: `tests/unit/preload-api.test.ts`

**Interfaces:**
- Consumes: `EmbeddedVerificationController` from Task 1.
- Produces: `access:show-verification`, `access:hide-verification`, `access:set-verification-bounds`, existing recovery IPC.

- [ ] **Step 1: Extend preload IPC tests first**

断言 `hideVerification()` 调用 `access:hide-verification`，`setVerificationBounds(bounds)` 调用 `access:set-verification-bounds`。

- [ ] **Step 2: Run RED preload test**

Run: `npm test -- --run tests/unit/preload-api.test.ts`

Expected: FAIL because the two API methods are absent.

- [ ] **Step 3: Replace verification BrowserWindow paths**

在 `main.ts` 中：

- 删除 `verificationWindow`、软关闭处理器和独立恢复检查窗口。
- 通过 `WebContentsView` + `platformSession` 创建 surface，并附加到 `mainWindow.contentView`。
- 探测得到验证码后正常销毁探测窗口，仅保留持久 session 和触发上下文。
- `show-verification` 创建/复用视图并加载触发房间。
- `hide-verification` 只隐藏视图。
- `set-verification-bounds` 校验整数正尺寸并更新视图。
- `check-verification` 直接读取同一视图当前页面的阻塞标记。
- `confirm-recovery` 隐藏视图；应用 shutdown 才受控释放。

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm test -- --run tests/unit/embedded-verification-controller.test.ts tests/unit/preload-api.test.ts && npm run typecheck`

Expected: PASS.

### Task 3: 主窗口验证覆盖层与稳定性验收

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Modify: renderer test file selected by existing App test coverage
- Create: `tests/electron/embedded-verification-e2e.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 2 preload methods.
- Produces: 固定工具栏、验证表面边界同步、关闭与恢复操作。

- [ ] **Step 1: Write failing renderer test**

断言点击“打开验证页”显示覆盖层；覆盖层包含域名/说明、“关闭验证页”和“我已完成，检查状态”；关闭调用 `hideVerification` 且横幅仍存在。

- [ ] **Step 2: Run RED renderer test**

Run: `npm test -- --run tests/unit/app.test.tsx`

Expected: FAIL on missing embedded overlay behavior.

- [ ] **Step 3: Implement overlay**

React 使用 `verificationVisible` 和 `ref` 管理覆盖层。`ResizeObserver`、窗口 resize 及首次显示时把表面 `getBoundingClientRect()` 转为整数边界发送给主进程。工具栏留在 WebContentsView 边界之外，远端页面不能覆盖控制按钮。

- [ ] **Step 4: Add fixture E2E**

本地页面替代真实抖音；连续执行 20 次打开/关闭，记录主 PID 未变化、数据库仍可读取、视图计数恒为 1，且没有新 crash report。

- [ ] **Step 5: Final verification**

Run: `npm test && npm run typecheck && npm run test:e2e-embedded-verification && git diff --check`

Expected: all tests PASS; no Electron crash; only one main process and one verification view.

