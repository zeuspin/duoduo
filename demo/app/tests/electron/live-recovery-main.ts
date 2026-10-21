import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, session } from "electron";
import { WebSocketServer } from "ws";
import { BailianProvider } from "../../src/main/asr/bailian-provider";
import { CaptureRouter } from "../../src/main/audio/capture-router";
import { RoomManager } from "../../src/main/rooms/room-manager";
import { RoomSession } from "../../src/main/rooms/room-session";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("log-level", "3");
app.on("window-all-closed", () => undefined);
const report = process.env.DUODUO_RECOVERY_REPORT!;
writeFileSync(report, JSON.stringify({ stage: "loaded" }));

async function until(check: () => boolean | Promise<boolean>, description: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`Timed out: ${description}`);
}

app.whenReady().then(async () => {
  writeFileSync(report, JSON.stringify({ stage: "ready" }));
  const server = createServer();
  const wss = new WebSocketServer({ server });
  let connections = 0;
  let secondConnectionAudio = 0;
  let audibleChunks = 0;
  wss.on("connection", (socket) => {
    const number = ++connections;
    let taskId = "";
    let heartbeat: NodeJS.Timeout | undefined;
    socket.on("close", () => { if (heartbeat) clearInterval(heartbeat); });
    socket.on("message", (data, binary) => {
      if (binary) {
        if (number === 2 && Buffer.from(data as Buffer).some((value) => value !== 0)) audibleChunks += 1;
        if (number === 2 && ++secondConnectionAudio === 1) socket.send(JSON.stringify({
          header: { event: "result-generated", task_id: taskId },
          payload: { output: { sentence: { begin_time: 0, end_time: 100, text: "重连后的转写", sentence_end: true } } },
        }));
        return;
      }
      const message = JSON.parse(data.toString());
      taskId = message.header.task_id;
      if (message.header.action === "run-task") {
        socket.send(JSON.stringify({ header: { event: "task-started", task_id: taskId } }));
        // The first connection stays open but stops responding, like the incident.
        if (number > 1) heartbeat = setInterval(() => socket.send(JSON.stringify({
          header: { event: "result-generated", task_id: taskId }, payload: { output: { sentence: { heartbeat: true } } },
        })), 100);
      } else if (message.header.action === "finish-task") socket.send(JSON.stringify({ header: { event: "task-finished", task_id: taskId } }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local ASR address");
  const provider = new BailianProvider({ apiKey: "fixture", endpoint: `ws://127.0.0.1:${address.port}`, responseTimeoutMs: 500 });
  const router = new CaptureRouter();
  const player = pathToFileURL(resolve("tests/fixtures/live-room/player.html"));
  player.searchParams.set("src", pathToFileURL(resolve("tests/fixtures/live-room/440.mp4")).href);
  let navigations = 0;
  let roomSessions = 0;
  const manager = new RoomManager(async (roomId, signal) => {
    roomSessions += 1;
    return new RoomSession(roomId, player.href, provider, router, (event) => manager.appendAsr(event), signal,
      session.fromPartition(`live-recovery-${Date.now()}`), async (run) => { navigations += 1; return (await run()).value; },
      undefined, undefined, undefined, 10);
  }, { retryDelayMs: 20 });
  try {
    await manager.startMonitoring("fixture-live");
    await until(() => manager.snapshot()[0]?.asr.some((event) => event.text === "重连后的转写"), "transcription after ASR reconnect");
    assert.equal(connections, 2);
    assert.equal(navigations, 1);
    assert.equal(roomSessions, 1);
    assert.equal(router.activeCount, 1);
    const window = BrowserWindow.getAllWindows()[0];
    assert.ok(window);
    const contentsId = window.webContents.id;
    const audioBeforeRebind = audibleChunks;
    await window.webContents.executeJavaScript(`(() => {
      window.__recoveryOldStream = window.__duoduoCaptureStream;
      window.__duoduoCaptureStream.getAudioTracks()[0].dispatchEvent(new Event('ended'));
    })()`);
    await until(async () => manager.snapshot()[0]?.state === "monitoring" && await window.webContents.executeJavaScript(
      "window.__duoduoCaptureStream !== window.__recoveryOldStream && window.__duoduoCaptureStream?.getAudioTracks()[0]?.readyState === 'live'"), "capture track rebind");
    await until(() => audibleChunks > audioBeforeRebind + 2, "audible PCM after capture rebind");
    assert.equal(window.webContents.id, contentsId);
    assert.equal(connections, 2);
    assert.equal(navigations, 1);
    assert.equal(roomSessions, 1);
  } finally {
    await manager.shutdown();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((resolveClose) => wss.close(() => server.close(() => resolveClose())));
  }
  assert.equal(router.activeCount, 0);
  assert.equal(BrowserWindow.getAllWindows().length, 0);
  writeFileSync(report, JSON.stringify({ ok: true, asrConnections: connections, roomSessions, navigations, textRecovered: true, captureRebound: true, audioContinued: true, samePage: true, resourcesReleased: true }));
  app.exit(0);
}).catch((error) => { writeFileSync(report, JSON.stringify({ ok: false, error: error.stack })); process.stderr.write(`${error.stack}\n`); app.exit(1); });
