const { createServer } = require("node:http");
const { mkdtemp, mkdir, writeFile, readFile, access } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

async function listen(server) { await new Promise((done) => server.listen(0, "127.0.0.1", done)); return server.address().port; }

(async () => {
  const llm = createServer((request, response) => {
    let body = ""; request.on("data", (chunk) => { body += chunk; }); request.on("end", () => {
      const parsed = JSON.parse(body); const user = parsed.messages.find((message) => message.role === "user")?.content || "";
      const evidence = user.includes("现在市场情绪只能算修复，还不能说反转。") ? "现在市场情绪只能算修复，还不能说反转。" : "今天指数虽然是红的，但是量没有明显放出来。";
      const content = JSON.stringify({ insights: [{ nature: "explicit", subjectKind: "market", subjectOriginal: "大盘", direction: "cautious", summary: "市场处于修复阶段，尚不能确认反转", rationale: "指数上涨但量能未放大", conditions: [], evidence: [evidence], confidence: 0.96, alertLevel: "important" }] });
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ id: "chatcmpl-e2e", model: "fixture-market", choices: [{ message: { content } }], usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 } }));
    });
  });
  const port = await listen(llm); const userData = await mkdtemp(join(tmpdir(), "duoduo-insight-e2e-")); const now = new Date().toISOString();
  await writeFile(join(userData, "rooms.json"), JSON.stringify([{ roomId: "123", canonicalUrl: "https://live.douyin.com/123", schedule: null, probeIntervalMinutes: 30, monitoring: false, createdAt: now, updatedAt: now }]));
  await writeFile(join(userData, "settings.json"), JSON.stringify({ llmProvider: { type: "openai-compatible", endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, model: "fixture-market", auth: "none" }, secrets: {} }));
  await mkdir(resolve("reports"), { recursive: true }); const report = resolve("reports/insight-parser-e2e.json"); const screenshot = resolve("reports/insight-parser-e2e.png");
  const executable = resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"); await access(executable);
  const child = spawn(executable, [".", `--user-data-dir=${userData}`], { cwd: resolve("."), env: { ...process.env, DUODUO_E2E_INSIGHT_REPORT: report, DUODUO_E2E_INSIGHT_SCREENSHOT: screenshot }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; child.stdout.on("data", (data) => { logs += data; }); child.stderr.on("data", (data) => { logs += data; });
  const watchdog = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 1000); }, 35_000);
  const code = await new Promise((done) => child.on("exit", done)); clearTimeout(watchdog); llm.close(); await writeFile(resolve("reports/insight-parser-e2e.log"), logs);
  if (code !== 0) throw new Error(`app exited ${code}`); const result = JSON.parse(await readFile(report, "utf8")); await access(screenshot);
  if (result.formalInsights?.length !== 1) throw new Error(`formal insight mismatch: ${JSON.stringify(result)}`);
  if (!result.groupParserId || !result.copiedParserId || result.groupParserId === result.copiedParserId) throw new Error(`immutable parser lifecycle mismatch: ${JSON.stringify(result)}`);
  if (!result.notificationVisible || !result.navigation?.roomCard || !result.navigation?.focusedInsight || !result.navigation?.insightTab) throw new Error(`notification navigation mismatch: ${JSON.stringify(result.navigation)}`);
  process.stdout.write(`${JSON.stringify({ ok: true, report, screenshot, formalInsights: result.formalInsights.length, parser: result.groupParserId })}\n`);
})().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
