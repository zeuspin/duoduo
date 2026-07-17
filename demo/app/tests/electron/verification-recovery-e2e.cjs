const { createServer } = require("node:http");
const { mkdtemp, readFile, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const { spawn } = require("node:child_process");

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return server.address().port;
}

async function runApp({ userData, origin, reportPath, logPath }) {
  const executable = resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
  const child = spawn(executable, [".", `--user-data-dir=${userData}`], {
    cwd: resolve("."),
    env: {
      ...process.env,
      DUODUO_FIXTURE_ORIGIN: origin,
      DUODUO_E2E_VERIFICATION_REPORT: reportPath,
      DUODUO_E2E_LOG: logPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const watchdog = setTimeout(() => child.kill("SIGTERM"), 20_000);
  const code = await new Promise((resolveExit) => child.on("exit", resolveExit));
  clearTimeout(watchdog);
  if (code !== 0) throw new Error(`verification fixture app exited ${code}\n${output}`);
  return JSON.parse(await readFile(reportPath, "utf8"));
}

(async () => {
  let active = 0;
  let maximumActive = 0;
  const requests = [];
  let room123Loads = 0;
  const server = createServer((request, response) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    requests.push(request.url);
    response.once("finish", () => { active -= 1; });
    response.setHeader("content-type", "text/html; charset=utf-8");
    const roomId = request.url.split("?")[0].slice(1);
    if (roomId === "123") {
      room123Loads += 1;
      const clearsInPlace = room123Loads >= 2 ? "<script>setTimeout(()=>{document.body.innerText='直播已结束'},700)</script>" : "";
      response.end(`<!doctype html><title>安全验证</title><main>请完成下列验证后继续 安全验证 验证码</main>${clearsInPlace}`);
      return;
    }
    response.end("<!doctype html><title>排队房间</title><main>直播已结束</main>");
  });
  const port = await listen(server);
  const origin = `http://127.0.0.1:${port}`;
  const userData = await mkdtemp(join(tmpdir(), "duoduo-verification-e2e-"));
  const now = new Date().toISOString();
  await writeFile(join(userData, "rooms.json"), JSON.stringify([
    { roomId: "123", canonicalUrl: "https://live.douyin.com/123", schedule: null, monitoring: true, createdAt: now, updatedAt: now },
    { roomId: "456", canonicalUrl: "https://live.douyin.com/456", schedule: null, monitoring: false, createdAt: now, updatedAt: now },
  ]));
  await writeFile(join(userData, "settings.json"), JSON.stringify({
    provider: { type: "duoduo-streaming-asr-v1", endpoint: "ws://127.0.0.1:65535", auth: "none" },
    secrets: {},
  }));
  const reportPath = join(userData, "verification-report.json");
  const logPath = join(userData, "verification.log");
  try {
    const report = await runApp({ userData, origin, reportPath, logPath });
    if (report.initialPaused?.mode !== "verification_paused" || report.initialPaused?.taskType !== "monitor_start") throw new Error("MONITOR_VERIFICATION_DID_NOT_PAUSE");
    if (report.blockedInspection !== "verification_required") throw new Error("BLOCKED_INSPECTION_MISMATCH");
    if (report.cleared !== true || report.beforeConfirmation?.mode !== "recovery_ready" || report.afterConfirmation?.mode !== "normal") throw new Error("RECOVERY_CONFIRMATION_FLOW_MISMATCH");
    if (report.snapshot?.status !== "verification_required" || report.snapshot?.title || report.snapshot?.anchorName) throw new Error("VERIFICATION_METADATA_WAS_TRUSTED");
    if (requests.some((url) => url.startsWith("/456"))) throw new Error("CANCELED_QUEUE_REPLAYED");
    if (maximumActive !== 1) throw new Error(`NAVIGATION_CONCURRENCY_${maximumActive}`);
    process.stdout.write(`${JSON.stringify({ ok: true, maximumActive, requests, report })}\n`);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
})().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
