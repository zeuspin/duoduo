const { mkdtemp, readFile, writeFile, mkdir } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

(async () => {
  const envText = await readFile(resolve("../../.env"), "utf8");
  const keyLine = envText.split(/\r?\n/).find((line) => line.startsWith("BAILIAN_API_KEY="));
  if (!keyLine) throw new Error("BAILIAN_API_KEY missing");
  const apiKey = keyLine.slice("BAILIAN_API_KEY=".length).trim().replace(/^['"]|['"]$/g, "");
  const rooms = process.argv.slice(2); if (rooms.length < 3) throw new Error("at least three rooms required");
  const durationMs = Math.min(Number(process.env.DUODUO_REAL_INSIGHT_DURATION_MS || 300000), 1200000);
  const userData = await mkdtemp(join(tmpdir(), "duoduo-real-insight-")); const now = new Date().toISOString();
  await writeFile(join(userData, "rooms.json"), JSON.stringify(rooms.map((roomId) => ({ roomId, canonicalUrl: `https://live.douyin.com/${roomId}`, schedule: null, monitoring: true, createdAt: now, updatedAt: now }))));
  await writeFile(join(userData, "settings.json"), JSON.stringify({ provider: { type: "bailian", model: "paraformer-realtime-v2", secretId: "smoke-only" }, llmProvider: { type: "bailian", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus", secretId: "smoke-only" }, secrets: {} }));
  await mkdir(resolve("reports"), { recursive: true }); const report = resolve("reports/insight-real-smoke.json"); const screenshot = resolve("reports/insight-real-smoke.png");
  const executable = resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
  const child = spawn(executable, [".", `--user-data-dir=${userData}`, "--disable-renderer-backgrounding", "--disable-background-timer-throttling"], { cwd: resolve("."), env: { ...process.env, DUODUO_REAL_SMOKE: "1", DUODUO_REAL_INSIGHT_SMOKE: "1", DUODUO_SMOKE_API_KEY: apiKey, DUODUO_REAL_SMOKE_REPORT: report, DUODUO_REAL_SMOKE_SCREENSHOT: screenshot, DUODUO_REAL_SMOKE_DURATION_MS: String(durationMs) }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; child.stdout.on("data", (data) => { logs += String(data).replaceAll(apiKey, "[REDACTED]"); }); child.stderr.on("data", (data) => { logs += String(data).replaceAll(apiKey, "[REDACTED]"); });
  const watchdog = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 1000); }, durationMs + 120000);
  const code = await new Promise((done) => child.on("exit", done)); clearTimeout(watchdog); await writeFile(resolve("reports/insight-real-smoke.log"), logs);
  if (code !== 0) throw new Error(`real insight smoke exited ${code}`);
  const result = JSON.parse(await readFile(report, "utf8")); const asrRooms = result.rooms.filter((room) => room.finalCount > 0);
  const supported = result.insights.filter((insight) => insight.evidence.length > 0 && insight.sourceAsrIds.length > 0);
  process.stdout.write(`${JSON.stringify({ ok: asrRooms.length >= 3 && result.insights.length > 0, durationMs, asrRooms: asrRooms.map((room) => ({ roomId: room.roomId, finalCount: room.finalCount })), insightCount: result.insights.length, importantCount: result.insights.filter((item) => item.alertLevel === "important").length, report, screenshot }, null, 2)}\n`);
  if (asrRooms.length < 3 || result.insights.length === 0 || supported.length !== result.insights.length) process.exit(1);
})().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
