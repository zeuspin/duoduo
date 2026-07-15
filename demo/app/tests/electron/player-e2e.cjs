const { createServer } = require("node:http");
const { mkdtemp, mkdir, writeFile, readFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

async function listen(server) {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return server.address().port;
}

(async () => {
  const server = createServer((request, response) => {
    const roomId = request.url.slice(1);
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(`<!doctype html><title>播放器夹具 ${roomId}</title><style>body{margin:0;background:#111;color:white}</style><video autoplay muted loop playsinline></video><div>${roomId}</div>`);
  });
  const port = await listen(server);
  const userData = await mkdtemp(join(tmpdir(), "duoduo-player-e2e-"));
  const now = new Date().toISOString();
  await writeFile(join(userData, "rooms.json"), JSON.stringify(["440", "660"].map((roomId) => ({ roomId, canonicalUrl: `https://live.douyin.com/${roomId}`, schedule: null, monitoring: false, createdAt: now, updatedAt: now }))));
  await mkdir(resolve("reports"), { recursive: true });
  const reportPath = resolve("reports/player-single-active-e2e.json");
  const logPath = resolve("reports/player-single-active-e2e.log");
  const executable = resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
  const child = spawn(executable, [".", `--user-data-dir=${userData}`], {
    cwd: resolve("."),
    env: { ...process.env, DUODUO_FIXTURE_ORIGIN: `http://127.0.0.1:${port}`, DUODUO_E2E_PLAYER_REPORT: reportPath, DUODUO_E2E_LOG: logPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (data) => { logs += data; process.stdout.write(data); });
  child.stderr.on("data", (data) => { logs += data; process.stderr.write(data); });
  const watchdog = setTimeout(() => { child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 1_000); }, 20_000);
  const code = await new Promise((done) => child.on("exit", done));
  clearTimeout(watchdog);
  server.close();
  await writeFile(resolve("reports/player-single-active-e2e-child.log"), logs);
  if (code !== 0) throw new Error(`app exited ${code}`);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const expected = [
    ["initial", null, 0],
    ["play-first", "440", 1],
    ["switch-second", "660", 1],
    ["stop", null, 0],
  ];
  expected.forEach(([action, roomId, resources], index) => {
    const step = report.steps[index];
    if (step.action !== action || step.state.activeRoomId !== roomId || step.resources !== resources) throw new Error(`invalid step ${index}: ${JSON.stringify(step)}`);
  });
  process.stdout.write(`${JSON.stringify({ ok: true, reportPath, version: report.version })}\n`);
})().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
