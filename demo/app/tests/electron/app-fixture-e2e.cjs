const { createServer } = require("node:http");
const { mkdtemp, mkdir, writeFile, access } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawn } = require("node:child_process");
const { createReadStream } = require("node:fs");
const { WebSocketServer } = require("ws");

async function listen(server) {
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  return server.address().port;
}

(async () => {
  const rooms = ["440", "441", "442", "443", "444", "445", "446", "447", "448"];
  const preparedRoom = "990";
  const validRooms = [...rooms, preparedRoom];
  const http = createServer((request, response) => {
    if (request.url.endsWith(".jpg")) {
      response.setHeader("content-type", "image/png");
      response.end(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      );
      return;
    }
    if (request.url.endsWith(".mp4")) {
      const room = request.url.slice(1, -4);
      if (!validRooms.includes(room)) return response.writeHead(404).end();
      response.setHeader("content-type", "video/mp4");
      createReadStream(resolve("tests/fixtures/live-room/440.mp4")).pipe(
        response,
      );
      return;
    }
    const room = request.url.slice(1);
    if (!validRooms.includes(room)) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    const coverMeta =
      room === preparedRoom
        ? ""
        : `<meta property="og:image" content="/${room}.jpg">`;
    response.end(
      `<!doctype html><meta property="og:title" content="测试主播 ${room}">${coverMeta}<video autoplay playsinline src="/${room}.mp4"></video><script>document.querySelector('video').play()</script>`,
    );
  });
  const httpPort = await listen(http);
  const asrHttp = createServer();
  const wss = new WebSocketServer({ server: asrHttp });
  wss.on("connection", (socket) => {
    let room = "";
    socket.on("message", (data, binary) => {
      if (!binary) {
        const event = JSON.parse(data);
        if (event.type === "start") room = event.room;
      } else
        socket.send(
          JSON.stringify({
            type: "final",
            room,
            segment: "fixture-1",
            startMs: 0,
            endMs: 800,
            text: `房间 ${room} 的独立实时识别文本`,
          }),
        );
    });
  });
  const asrPort = await listen(asrHttp);
  const userData = await mkdtemp(join(tmpdir(), "duoduo-e2e-"));
  const now = new Date().toISOString();
  await writeFile(
    join(userData, "rooms.json"),
    JSON.stringify([
      ...rooms.map((roomId) => ({
        roomId,
        canonicalUrl: `https://live.douyin.com/${roomId}`,
        schedule: {
          days: [1, 2, 3, 4, 5],
          ranges: [{ start: "09:00", end: "12:00" }],
        },
        monitoring: true,
        createdAt: now,
        updatedAt: now,
      })),
      {
        roomId: preparedRoom,
        canonicalUrl: `https://live.douyin.com/${preparedRoom}`,
        schedule: null,
        probeIntervalMinutes: 1,
        monitoring: false,
        createdAt: now,
        updatedAt: now,
      },
    ]),
  );
  await writeFile(
    join(userData, "settings.json"),
    JSON.stringify({
      provider: {
        type: "duoduo-streaming-asr-v1",
        endpoint: `ws://127.0.0.1:${asrPort}`,
        auth: "none",
      },
      secrets: {},
    }),
  );
  await mkdir(resolve("reports"), { recursive: true });
  const packaged = process.env.DUODUO_PACKAGED_E2E === "1";
  const reportPrefix = packaged ? "packaged-mac" : "fixture";
  const screenshot = resolve(`reports/${reportPrefix}-nine-room-asr.png`);
  const preparedScreenshot = resolve(
    `reports/${reportPrefix}-prepared-room.png`,
  );
  const stateLog = resolve(`reports/${reportPrefix}-e2e-state.json`);
  const executable = packaged
    ? resolve(
        "out/Duoduo Live-darwin-arm64/Duoduo Live.app/Contents/MacOS/Duoduo Live",
      )
    : resolve(
        "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
      );
  const args = packaged
    ? [
        `--user-data-dir=${userData}`,
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
      ]
    : [
        ".",
        `--user-data-dir=${userData}`,
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
      ];
  await access(executable);
  const child = spawn(executable, args, {
    cwd: resolve("."),
    env: {
      ...process.env,
      DUODUO_FIXTURE_ORIGIN: `http://127.0.0.1:${httpPort}`,
      DUODUO_E2E_SCREENSHOT: screenshot,
      DUODUO_E2E_PREPARED_SCREENSHOT: preparedScreenshot,
      DUODUO_E2E_PREPARED_ROOM: preparedRoom,
      DUODUO_E2E_LOG: stateLog,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (data) => {
    logs += data;
    process.stdout.write(data);
  });
  child.stderr.on("data", (data) => {
    logs += data;
    process.stderr.write(data);
  });
  const watchdog = setTimeout(() => child.kill("SIGTERM"), 30_000);
  const code = await new Promise((resolveExit) =>
    child.on("exit", resolveExit),
  );
  clearTimeout(watchdog);
  await writeFile(resolve(`reports/${reportPrefix}-e2e.log`), logs);
  for (const client of wss.clients) client.terminate();
  await new Promise((resolveClose) =>
    wss.close(() => asrHttp.close(() => http.close(resolveClose))),
  );
  if (code !== 0) throw new Error(`app exited ${code}`);
  await access(screenshot);
  await access(preparedScreenshot);
  process.stdout.write(
    `${JSON.stringify({ ok: true, screenshot, preparedScreenshot })}\n`,
  );
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
});
