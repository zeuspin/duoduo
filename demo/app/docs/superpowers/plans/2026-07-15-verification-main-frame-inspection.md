# 验证页主框架只读检查 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已经视觉可用但仍保持 loading 的抖音页面能够完成验证状态检查，不再固定等待到超时。

**Architecture:** 把验证码/登录标记识别提取为独立的主框架检查器，生产代码通过当前 `WebContentsView.webContents.mainFrame.executeJavaScript` 读取有限正文。保留控制器的 10 秒超时和全局暂停状态，并用本地持续加载页面证明检查不依赖 WebContents 停止加载。

**Tech Stack:** Electron 39、TypeScript、Vitest、Node.js HTTP server、Electron Forge/Vite

## Global Constraints

- 不自动识别、点击、代答或绕过验证码。
- 不刷新、停止加载或重新导航当前抖音页面。
- 不截图、不采集直播指标、不读取输入框、Cookie、验证码答案或用户键盘内容。
- 不创建额外验证窗口或 WebContents；继续使用当前内嵌 `WebContentsView` 和持久 session。
- 超时或异常继续保持 `verification_paused`，不得自动恢复访问。
- 不新建分支、不提交、不推送。

---

### Task 1: 主框架页面标记检查器

**Files:**
- Create: `src/main/rooms/verification-page-inspector.ts`
- Create: `tests/unit/verification-page-inspector.test.ts`
- Modify: `src/main/main.ts`

**Interfaces:**
- Consumes: `VerificationFrame.executeJavaScript(source: string): Promise<unknown>`，生产环境传入 `view.webContents.mainFrame`。
- Produces: `inspectVerificationPage(frame: VerificationFrame): Promise<VerificationBlockedState>`。

- [ ] **Step 1: Write failing unit tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { inspectVerificationPage } from "../../src/main/rooms/verification-page-inspector";

describe("inspectVerificationPage", () => {
  it("classifies a verification marker", async () => {
    const executeJavaScript = vi.fn(async () => "请完成下列验证后继续");
    await expect(inspectVerificationPage({ executeJavaScript })).resolves.toBe("verification_required");
  });

  it("classifies a login marker", async () => {
    const executeJavaScript = vi.fn(async () => "扫码登录后继续");
    await expect(inspectVerificationPage({ executeJavaScript })).resolves.toBe("login_required");
  });

  it("classifies an ordinary rendered room page as clear", async () => {
    const executeJavaScript = vi.fn(async () => "直播已结束");
    await expect(inspectVerificationPage({ executeJavaScript })).resolves.toBe("clear");
    expect(executeJavaScript).toHaveBeenCalledWith("document.body?.innerText?.slice(0,20000) ?? ''");
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- --run tests/unit/verification-page-inspector.test.ts`

Expected: FAIL because `verification-page-inspector` does not exist.

- [ ] **Step 3: Implement the focused read-only inspector**

```ts
import type { VerificationBlockedState } from "./embedded-verification-controller";

export interface VerificationFrame {
  executeJavaScript(source: string): Promise<unknown>;
}

const readVisibleText = "document.body?.innerText?.slice(0,20000) ?? ''";

export async function inspectVerificationPage(frame: VerificationFrame): Promise<VerificationBlockedState> {
  const text = String(await frame.executeJavaScript(readVisibleText));
  if (/请完成下列验证后继续|安全验证|验证码/.test(text)) return "verification_required";
  if (/扫码登录|登录后/.test(text)) return "login_required";
  return "clear";
}
```

- [ ] **Step 4: Wire the current WebContentsView main frame and safe diagnostics**

Add the import in `src/main/main.ts`:

```ts
import { inspectVerificationPage } from "./rooms/verification-page-inspector";
```

Replace the current `inspectBlockedState` implementation with:

```ts
async inspectBlockedState() {
  const startedAt = Date.now();
  const host = (() => { try { return new URL(view.webContents.getURL()).hostname; } catch { return "unknown"; } })();
  const isLoading = view.webContents.isLoading();
  diagnostic("verification_check_started", { host, isLoading });
  try {
    const result = await inspectVerificationPage(view.webContents.mainFrame);
    diagnostic("verification_check_completed", { host, isLoading, durationMs: Date.now() - startedAt, result });
    return result;
  } catch (error) {
    diagnostic("verification_check_failed", { host, isLoading, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
},
```

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npm test -- --run tests/unit/verification-page-inspector.test.ts tests/unit/embedded-verification-controller.test.ts tests/unit/douyin-access-coordinator.test.ts && npm run typecheck`

Expected: all focused tests PASS and TypeScript exits with code 0.

---

### Task 2: 持续加载页面 Electron 回归测试

**Files:**
- Create: `tests/electron/verification-main-frame.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Electron `WebContentsView.webContents.mainFrame.executeJavaScript`。
- Produces: `npm run test:electron-verification-main-frame` regression command。

- [ ] **Step 1: Add a standalone Electron test with a never-finishing subframe**

Create `tests/electron/verification-main-frame.cjs`:

```js
const { app, BrowserWindow, WebContentsView } = require("electron");
const http = require("node:http");

async function main() {
  const hangingResponses = new Set();
  const server = http.createServer((request, response) => {
    if (request.url === "/hang") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.write("<!doctype html><p>still loading");
      hangingResponses.add(response);
      response.once("close", () => hangingResponses.delete(response));
      return;
    }
    response.end("<!doctype html><main>直播已结束</main><iframe src='/hang'></iframe>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("SERVER_ADDRESS_UNAVAILABLE");

  const window = new BrowserWindow({ show: false });
  const view = new WebContentsView();
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  try {
    const domReady = new Promise((resolve) => view.webContents.once("dom-ready", resolve));
    void view.webContents.loadURL(`http://127.0.0.1:${address.port}/`).catch(() => undefined);
    await domReady;
    if (!view.webContents.isLoading()) throw new Error("FIXTURE_DID_NOT_KEEP_LOADING");

    const result = await Promise.race([
      view.webContents.mainFrame.executeJavaScript("document.body?.innerText ?? ''"),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("MAIN_FRAME_INSPECTION_TIMEOUT")), 1_000)),
    ]);
    if (!String(result).includes("直播已结束")) throw new Error("MAIN_FRAME_INSPECTION_WRONG_RESULT");
  } finally {
    for (const response of hangingResponses) response.end();
    view.webContents.stop();
    window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    if (!window.isDestroyed()) window.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

app.whenReady().then(() => main()).then(() => app.quit(), (error) => { console.error(error); app.exit(1); });
```

- [ ] **Step 2: Add the package command**

Add to `package.json` scripts:

```json
"test:electron-verification-main-frame": "ELECTRON_DISABLE_SECURITY_WARNINGS=1 electron tests/electron/verification-main-frame.cjs"
```

- [ ] **Step 3: Run the Electron regression**

Run: `npm run test:electron-verification-main-frame`

Expected: exit code 0 while the fixture still reports `webContents.isLoading() === true`.

---

### Task 3: 完整验证与开发实例重启

**Files:**
- Verify only: all changed source, tests, package files, and existing SQLite data.

**Interfaces:**
- Consumes: Tasks 1–2 outputs.
- Produces: one running Electron development instance ready for user acceptance.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test -- --run && npm run typecheck && npm run test:electron-verification-main-frame && npm run test:electron-verification-view`

Expected: all Vitest files pass, typecheck exits 0, and both Electron regressions exit 0.

- [ ] **Step 2: Build the application**

Run: `npm run build`

Expected: Electron Forge packaging exits with code 0.

- [ ] **Step 3: Verify data and process invariants**

Run:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const p=process.env.HOME+'/Library/Application Support/duoduo-live/duoduo.sqlite';const db=new DatabaseSync(p,{readOnly:true});console.log(db.prepare('select count(*) as count from rooms').get());console.log(db.prepare('pragma integrity_check').get());db.close()"
```

Expected: `count` remains 16 and `integrity_check` is `ok`.

- [ ] **Step 4: Restart only the existing duoduo Electron development process**

Use the active Electron Forge terminal's `rs` command; if the old Electron process does not exit because a previous inspection is still pending, terminate only that Electron PID and let the same Forge process relaunch it. Do not kill unrelated Vite or Electron applications.

Expected: exactly one `/duoduo/demo/app/.../Electron .` main process remains.

- [ ] **Step 5: Hand off manual acceptance without automated Douyin interaction**

Ask the user to open the existing verification page and click `我已完成，检查状态`. Expected UI sequence:

1. Immediately shows `正在检查验证状态…` in the fixed toolbar.
2. The visually rendered `直播已结束` page is classified without waiting for all network requests to finish.
3. UI shows `验证检查已通过，请点击“恢复访问”继续` and exposes `恢复访问`.
4. The application does not automatically click `恢复访问` or start background Douyin navigation.
