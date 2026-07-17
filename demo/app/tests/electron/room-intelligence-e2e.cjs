const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { DatabaseSync } = require("node:sqlite");
const { access, mkdir, mkdtemp, readFile, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return server.address().port;
}

function seedDatabase(path, avatarPath) {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE rooms(room_id TEXT PRIMARY KEY,canonical_url TEXT NOT NULL,schedule_json TEXT,probe_interval_minutes INTEGER,monitoring INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE room_snapshots(room_id TEXT PRIMARY KEY,status TEXT NOT NULL,title TEXT,anchor_name TEXT,cover_path TEXT,avatar_path TEXT,viewer_count INTEGER,follower_count INTEGER,total_viewer_count INTEGER,like_count INTEGER,metric_raw_json TEXT,metric_evidence_json TEXT,metric_quality TEXT,last_reliable_status TEXT,last_reliable_status_at TEXT,metrics_observed_at TEXT,checked_at TEXT NOT NULL,error TEXT);
    CREATE TABLE room_observations(id INTEGER PRIMARY KEY AUTOINCREMENT,room_id TEXT NOT NULL,status TEXT NOT NULL,viewer_count INTEGER,follower_count INTEGER,total_viewer_count INTEGER,like_count INTEGER,metric_raw_json TEXT,metric_evidence_json TEXT,metric_quality TEXT,checked_at TEXT NOT NULL,error TEXT);
    CREATE TABLE live_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,room_id TEXT NOT NULL,status TEXT NOT NULL,previous_offline_at TEXT,first_live_at TEXT NOT NULL,last_live_at TEXT NOT NULL,first_offline_at TEXT,peak_viewer_count INTEGER,average_viewer_count REAL,unknown_since TEXT,unknown_count INTEGER NOT NULL DEFAULT 0);
  `);
  const now = Date.now();
  const iso = (daysAgo, hourOffset = 0) => new Date(now - daysAgo * 86_400_000 + hourOffset * 3_600_000).toISOString();
  const roomIds = ["100", "200", "300", "400", "500", "600"];
  const insertRoom = database.prepare("INSERT INTO rooms VALUES(?,?,?,?,?,?,?)");
  for (const roomId of roomIds) insertRoom.run(roomId, `https://live.douyin.com/${roomId}`, null, null, 0, iso(20), iso(0));
  const insertSnapshot = database.prepare("INSERT INTO room_snapshots(room_id,status,title,anchor_name,avatar_path,viewer_count,follower_count,metric_raw_json,metric_evidence_json,metric_quality,last_reliable_status,last_reliable_status_at,metrics_observed_at,checked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  insertSnapshot.run("100", "offline", "热门主播", "热门主播", avatarPath, 1_000, 1_200_000, JSON.stringify({ viewerCount: "1000", followerCount: "120万" }), JSON.stringify({ viewerCount: { raw: "1000人在线", source: "accessibility" }, followerCount: { raw: "120万粉丝", source: "visible_text" } }), "partial", "offline", iso(0), iso(0), iso(0));
  for (const [roomId, name] of [["200", "高位主播"], ["300", "中位主播"], ["400", "普通主播"], ["500", "小型主播"], ["600", "空样本主播"]]) insertSnapshot.run(roomId, "offline", name, name, null, null, null, null, null, "missing", "offline", iso(0), null, iso(0));

  const insertObservation = database.prepare("INSERT INTO room_observations(room_id,status,viewer_count,follower_count,metric_raw_json,metric_evidence_json,metric_quality,checked_at) VALUES(?,?,?,?,?,?,?,?)");
  insertObservation.run("100", "live", 900, 1_190_000, "{}", JSON.stringify({ viewerCount: { raw: "900人在线", source: "visible_text" } }), "partial", iso(5));
  insertObservation.run("100", "live", null, 1_195_000, "{}", JSON.stringify({ followerCount: { raw: "119.5万粉丝", source: "visible_text" } }), "partial", iso(4));
  insertObservation.run("100", "live", 1_100, 1_198_000, "{}", JSON.stringify({ viewerCount: { raw: "1100人在线", source: "visible_text" } }), "partial", iso(3));
  insertObservation.run("100", "live", 1_000, 1_200_000, "{}", JSON.stringify({ viewerCount: { raw: "1000人在线", source: "visible_text" } }), "partial", iso(1));

  const insertSession = database.prepare("INSERT INTO live_sessions(room_id,status,previous_offline_at,first_live_at,last_live_at,first_offline_at,peak_viewer_count,average_viewer_count,unknown_since,unknown_count) VALUES(?,?,?,?,?,?,?,?,?,?)");
  let sessionOffset = 0;
  const addSession = (roomId, daysAgo, average, durationHours = 2) => {
    const firstLiveAt = iso(daysAgo);
    const first = Date.parse(firstLiveAt);
    insertSession.run(roomId, "ended", new Date(first - 30 * 60_000).toISOString(), firstLiveAt, new Date(first + durationHours * 3_600_000 - 60_000).toISOString(), new Date(first + durationHours * 3_600_000).toISOString(), average + 150 + sessionOffset++, average, null, 0);
  };
  for (const [daysAgo, average] of [[10, 600], [8, 600], [5, 900], [3, 1100], [1, 1000]]) addSession("100", daysAgo, average);
  for (const [roomId, average] of [["200", 800], ["300", 600], ["400", 400], ["500", 200]]) for (const daysAgo of [5, 3, 1]) addSession(roomId, daysAgo, average, 1);
  database.close();
}

(async () => {
  const fixtureRequests = [];
  const server = createServer((request, response) => {
    fixtureRequests.push(request.url);
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end("<!doctype html><main>fixture page should not be opened by local intelligence reads</main>");
  });
  const port = await listen(server);
  const userData = await mkdtemp(join(tmpdir(), "duoduo-room-intelligence-e2e-"));
  const avatarDirectory = join(userData, "avatars");
  await mkdir(avatarDirectory, { recursive: true });
  const avatarPath = join(avatarDirectory, "100.png");
  await writeFile(avatarPath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
  seedDatabase(join(userData, "duoduo.sqlite"), avatarPath);
  const triggeredAt = new Date().toISOString();
  await writeFile(join(userData, "settings.json"), JSON.stringify({ douyinAccessState: { mode: "verification_paused", roomId: "100", taskType: "startup_probe", triggeredAt, reason: "verification_required" }, secrets: {} }));
  await mkdir(resolve("reports"), { recursive: true });
  const reportPath = resolve("reports/room-intelligence-e2e.json");
  const screenshotPath = resolve("reports/room-intelligence-details.png");
  const executable = resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
  const child = spawn(executable, [".", `--user-data-dir=${userData}`], {
    cwd: resolve("."),
    env: { ...process.env, DUODUO_FIXTURE_ORIGIN: `http://127.0.0.1:${port}`, DUODUO_E2E_ROOM_INTELLIGENCE_REPORT: reportPath, DUODUO_E2E_ROOM_INTELLIGENCE_SCREENSHOT: screenshotPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const watchdog = setTimeout(() => child.kill("SIGTERM"), 20_000);
  const code = await new Promise((resolveExit) => child.on("exit", resolveExit));
  clearTimeout(watchdog);
  await new Promise((resolveClose) => server.close(resolveClose));
  if (code !== 0) throw new Error(`room intelligence fixture app exited ${code}\n${output}`);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.version, "0.6.0");
  assert.equal(report.beforeLocalReads, 0);
  assert.equal(report.afterLocalReads, 0);
  assert.equal(report.realDouyinRequests, 0);
  assert.deepEqual(fixtureRequests, []);
  assert.equal(report.cardState.topFound, true);
  assert.equal(report.cardState.avatarVisible, true);
  assert.equal(report.cardState.labelCount, 3);
  assert.deepEqual(report.cardState.labelTexts, ["百万级粉丝", "近期在线靠前", "近期升温 +67%"]);
  assert.match(report.cardState.tooltip, /样本/);
  assert.equal(report.cardState.emptyAccumulating, true);
  assert.equal(report.detailsState.opened, true);
  assert.ok(report.detailsState.allLabelCount >= 5);
  assert.equal(report.detailsState.hasTrend, true);
  assert.equal(report.detailsState.hasStartEvidence, true);
  assert.equal(report.detailsState.hasStopEvidence, true);
  assert.equal(report.detailsState.hasObservedDisclaimer, true);
  assert.equal(report.detailsState.containsSyntheticZero, false);
  await access(screenshotPath);
  process.stdout.write(`${JSON.stringify({ ok: true, fixtureRequests, report, screenshotPath })}\n`);
})().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
