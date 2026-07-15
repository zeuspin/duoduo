const { readFile, writeFile, mkdir } = require("node:fs/promises");
const { resolve } = require("node:path");
const { spawn } = require("node:child_process");

(async () => {
  const userData = process.argv[2]; if (!userData) throw new Error("userData path required");
  const envText = await readFile(resolve("../../.env"), "utf8"); const keyLine = envText.split(/\r?\n/).find((line) => line.startsWith("BAILIAN_API_KEY=")); if (!keyLine) throw new Error("BAILIAN_API_KEY missing");
  const apiKey = keyLine.slice("BAILIAN_API_KEY=".length).trim().replace(/^['"]|['"]$/g, ""); await mkdir(resolve("reports"), { recursive: true }); const report = resolve("reports/insight-real-replay.json"); const screenshot = resolve("reports/insight-real-replay.png");
  const executable = resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"); const child = spawn(executable, [".", `--user-data-dir=${userData}`], { cwd: resolve("."), env: { ...process.env, DUODUO_REAL_SMOKE: "1", DUODUO_SMOKE_API_KEY: apiKey, DUODUO_REPLAY_INSIGHT_REPORT: report, DUODUO_REPLAY_INSIGHT_SCREENSHOT: screenshot }, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; child.stderr.on("data", (data) => { logs += String(data).replaceAll(apiKey, "[REDACTED]"); }); const watchdog = setTimeout(() => child.kill("SIGKILL"), 120000); const code = await new Promise((done) => child.on("exit", done)); clearTimeout(watchdog); await writeFile(resolve("reports/insight-real-replay-debug.log"), logs); if (code !== 0) throw new Error(`replay exited ${code}`);
  process.stdout.write(await readFile(report, "utf8"));
})().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
