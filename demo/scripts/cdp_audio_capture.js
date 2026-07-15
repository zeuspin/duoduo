#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const endpoint = process.argv[2] || "http://127.0.0.1:9222/json";
const outFile = process.argv[3] || "demo/samples/audio/raw/cdp_capture.webm";
const durationMs = Number(process.argv[4] || "10000");

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

const captureExpression = `(async () => {
  const describeVideo = (item) => item ? ({
    paused: item.paused,
    muted: item.muted,
    volume: item.volume,
    readyState: item.readyState,
    networkState: item.networkState,
    currentTime: item.currentTime,
    duration: Number.isFinite(item.duration) ? item.duration : null,
    srcPresent: Boolean(item.currentSrc || item.src)
  }) : null;

  const videos = Array.from(document.querySelectorAll("video"));
  const video = videos.find((item) => item.readyState >= 2) || videos[0];
  if (!video) {
    return { ok: false, reason: "no-video-element", videos: 0 };
  }

  video.muted = false;
  video.volume = 1;
  try {
    await video.play();
  } catch (error) {
    return {
      ok: false,
      reason: "video-play-failed",
      error: String(error && error.message || error),
      videos: videos.length,
      paused: video.paused,
      readyState: video.readyState
    };
  }

  const capture = video.captureStream || video.mozCaptureStream;
  if (!capture) {
    return { ok: false, reason: "captureStream-unavailable", videos: videos.length };
  }

  const sourceStream = capture.call(video);
  const audioTracks = sourceStream.getAudioTracks();
  const videoTracks = sourceStream.getVideoTracks();
  const startState = {
    video: describeVideo(video),
    audioTracks: audioTracks.map((track) => ({
      id: track.id,
      kind: track.kind,
      label: track.label,
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState
    })),
    videoTrackCount: videoTracks.length
  };
  if (!audioTracks.length) {
    return {
      ok: false,
      reason: "no-audio-tracks",
      videos: videos.length,
      paused: video.paused,
      readyState: video.readyState,
      hasVideoTracks: sourceStream.getVideoTracks().length
    };
  }

  const audioStream = new MediaStream(audioTracks);
  const mimeTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "video/webm;codecs=opus",
    "video/webm"
  ];
  const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    return { ok: false, reason: "mediarecorder-mime-unavailable", audioTracks: audioTracks.length };
  }

  const chunks = [];
  const chunkSizes = [];
  const recorder = new MediaRecorder(audioStream, { mimeType });
  recorder.ondataavailable = (event) => {
    if (event.data) {
      chunkSizes.push(event.data.size || 0);
      if (event.data.size) chunks.push(event.data);
    }
  };

  const done = new Promise((resolve) => {
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: mimeType });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
      }
      resolve({
        ok: true,
        mimeType,
        size: blob.size,
        chunkCount: chunkSizes.length,
        nonEmptyChunkCount: chunkSizes.filter((size) => size > 0).length,
        chunkSizes,
        audioTracks: audioTracks.length,
        startState,
        endState: {
          video: describeVideo(video),
          audioTracks: audioTracks.map((track) => ({
            id: track.id,
            kind: track.kind,
            label: track.label,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState
          })),
          recorderState: recorder.state
        },
        durationMs: ${durationMs},
        base64: btoa(binary)
      });
    };
  });

  recorder.start(1000);
  await new Promise((resolve) => setTimeout(resolve, ${durationMs}));
  recorder.stop();
  return await done;
})()`;

(async () => {
  const target = await getPageTarget();
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.enable");
    const result = await withTimeout(
      client.send("Runtime.evaluate", {
        expression: captureExpression,
        awaitPromise: true,
        returnByValue: true,
        timeout: durationMs + 10000,
      }),
      durationMs + 30000,
      `capture timed out after ${durationMs + 30000} ms`
    );

    const value = result.result && result.result.value;
    if (!value || !value.ok) {
      console.error(JSON.stringify(value || result, null, 2));
      process.exitCode = 2;
      return;
    }

    const absOut = path.resolve(outFile);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, Buffer.from(value.base64, "base64"));
    delete value.base64;
    console.log(JSON.stringify({ ...value, output: absOut, targetTitle: target.title, targetUrl: target.url }, null, 2));
  } finally {
    client.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
