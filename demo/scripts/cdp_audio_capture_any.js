#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const endpoint = process.argv[2] || "http://127.0.0.1:9222/json";
const outFile = process.argv[3] || "demo/samples/audio/raw/cdp_capture_any.webm";
const durationMs = Number(process.argv[4] || "10000");
const targetNeedle = process.argv[5] || "";

async function getPageTarget() {
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to fetch CDP target list: ${response.status}`);
  }
  const targets = await response.json();
  const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  const page = targetNeedle
    ? pages.find((target) => `${target.url}\n${target.title}`.includes(targetNeedle))
    : pages[0];
  if (!page) {
    throw new Error(`No page target found for needle: ${targetNeedle}`);
  }
  return page;
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const eventWaiters = new Map();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      const waiters = eventWaiters.get(message.method) || [];
      eventWaiters.set(message.method, []);
      waiters.forEach((resolve) => resolve(message));
      return;
    }
    if (!pending.has(message.id)) return;
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
        waitForEvent(method, timeoutMs = 5000) {
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`timed out waiting for ${method}`)), timeoutMs);
            const waiters = eventWaiters.get(method) || [];
            waiters.push((message) => {
              clearTimeout(timeout);
              resolve(message);
            });
            eventWaiters.set(method, waiters);
          });
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
  const waitForMedia = async () => {
    for (let i = 0; i < 100; i += 1) {
      const items = Array.from(document.querySelectorAll("video, audio"));
      if (items.length) return items;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return [];
  };
  const mediaItems = await waitForMedia();
  const media = mediaItems.find((item) => item.readyState >= 2) || mediaItems[0];
  if (!media) {
    return {
      ok: false,
      reason: "no-media-element",
      mediaCount: 0,
      href: location.href,
      title: document.title,
      html: document.documentElement ? document.documentElement.outerHTML.slice(0, 1000) : ""
    };
  }

  media.muted = false;
  media.volume = 1;
  try {
    await media.play();
  } catch (error) {
    return {
      ok: false,
      reason: "media-play-failed",
      error: String(error && error.message || error),
      mediaCount: mediaItems.length,
      paused: media.paused,
      readyState: media.readyState
    };
  }

  const capture = media.captureStream || media.mozCaptureStream;
  if (!capture) {
    return { ok: false, reason: "captureStream-unavailable", mediaCount: mediaItems.length };
  }

  const sourceStream = capture.call(media);
  const audioTracks = sourceStream.getAudioTracks();
  if (!audioTracks.length) {
    return {
      ok: false,
      reason: "no-audio-tracks",
      mediaCount: mediaItems.length,
      paused: media.paused,
      readyState: media.readyState
    };
  }

  const audioStream = new MediaStream(audioTracks);
  const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "video/webm;codecs=opus", "video/webm"];
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
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
      resolve({
        ok: true,
        mimeType,
        size: blob.size,
        chunkCount: chunkSizes.length,
        nonEmptyChunkCount: chunkSizes.filter((size) => size > 0).length,
        chunkSizes,
        audioTracks: audioTracks.length,
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
    await client.waitForEvent("Runtime.executionContextCreated", 10000).catch(() => null);
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
