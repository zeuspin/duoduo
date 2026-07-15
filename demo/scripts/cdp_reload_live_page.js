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

(async () => {
  const target = await getPageTarget();
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    await client.send("Page.enable");
    await client.send("Page.reload", { ignoreCache: true });
    console.log(JSON.stringify({
      ok: true,
      targetTitle: target.title,
      targetUrl: target.url,
    }, null, 2));
  } finally {
    client.close();
  }
})().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
