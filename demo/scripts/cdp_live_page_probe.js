#!/usr/bin/env node

const endpoint = process.argv[2] || "http://127.0.0.1:9222/json";

async function getPageTarget() {
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to fetch CDP target list: ${response.status}`);
  }
  const targets = await response.json();
  const page = targets.find((target) => target.type === "page" && target.url.includes("live.douyin.com"));
  if (!page || !page.webSocketDebuggerUrl) {
    throw new Error("No live.douyin.com page target with webSocketDebuggerUrl found");
  }
  return page;
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  });

  return new Promise((resolve, reject) => {
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((methodResolve, methodReject) => {
            pending.set(id, { resolve: methodResolve, reject: methodReject });
          });
        },
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener("error", reject);
  });
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

const probeExpression = `(async () => {
  const timeout = (ms, label) => new Promise((resolve) => {
    setTimeout(() => resolve({ timedOut: true, label }), ms);
  });
  const videos = Array.from(document.querySelectorAll("video"));
  const selected = videos.find((item) => item.readyState >= 2) || videos[0] || null;
  const result = {
    ok: false,
    pageTitle: document.title,
    videoCount: videos.length,
    selected: null,
    captureStreamAvailable: false,
    audioTrackCount: 0,
    videoTrackCount: 0,
    playAttempt: "",
    reason: ""
  };
  if (!selected) {
    result.reason = "no-video-element";
    return result;
  }

  selected.muted = false;
  selected.volume = 1;
  try {
    const playResult = await Promise.race([
      selected.play().then(() => ({ ok: true })).catch((error) => ({
        ok: false,
        error: String(error && error.message || error)
      })),
      timeout(2000, "play-timeout")
    ]);
    if (playResult.timedOut) {
      result.playAttempt = playResult.label;
    } else if (playResult.ok) {
      result.playAttempt = "ok";
    } else {
      result.playAttempt = playResult.error;
    }
  } catch (error) {
    result.playAttempt = String(error && error.message || error);
  }

  result.selected = {
    paused: selected.paused,
    muted: selected.muted,
    volume: selected.volume,
    readyState: selected.readyState,
    networkState: selected.networkState,
    currentTime: selected.currentTime,
    duration: Number.isFinite(selected.duration) ? selected.duration : null,
    srcPresent: Boolean(selected.currentSrc || selected.src)
  };

  const capture = selected.captureStream || selected.mozCaptureStream;
  result.captureStreamAvailable = Boolean(capture);
  if (!capture) {
    result.reason = "captureStream-unavailable";
    return result;
  }

  try {
    const stream = capture.call(selected);
    result.audioTrackCount = stream.getAudioTracks().length;
    result.videoTrackCount = stream.getVideoTracks().length;
    result.ok = result.audioTrackCount > 0 && selected.readyState >= 2 && !selected.paused;
    if (!result.ok) result.reason = "video-not-ready-or-no-audio-track";
    return result;
  } catch (error) {
    result.reason = String(error && error.message || error);
    return result;
  }
})()`;

(async () => {
  const target = await getPageTarget();
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.enable");
    const result = await withTimeout(
      client.send("Runtime.evaluate", {
        expression: probeExpression,
        awaitPromise: true,
        returnByValue: true,
        timeout: 5000,
      }),
      8000,
      "probe timed out after 8000 ms"
    );
    const value = result.result && result.result.value;
    console.log(JSON.stringify({
      ...value,
      targetTitle: target.title,
      targetUrl: target.url,
    }, null, 2));
    if (!value || !value.ok) process.exitCode = 2;
  } finally {
    client.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
