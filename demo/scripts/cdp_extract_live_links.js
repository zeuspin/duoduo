#!/usr/bin/env node

const endpoint = process.argv[2] || "http://127.0.0.1:9222/json";
const scrollCount = Number.parseInt(process.argv[3] || "0", 10);
const scrollWaitMs = Number.parseInt(process.argv[4] || "1200", 10);

async function getPageTarget() {
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Failed to fetch CDP target list: ${response.status}`);
  }
  const targets = await response.json();
  const page = targets.find((target) => target.type === "page" && target.url.includes("douyin.com"));
  if (!page || !page.webSocketDebuggerUrl) {
    throw new Error("No douyin.com page target with webSocketDebuggerUrl found");
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

const expression = `(() => {
  const anchors = Array.from(document.querySelectorAll("a[href*='live.douyin.com/']"));
  const seen = new Set();
  const links = [];
  for (const anchor of anchors) {
    const href = anchor.href.split("?")[0];
    const match = href.match(/^https:\\/\\/live\\.douyin\\.com\\/(\\d+)/);
    if (!match || seen.has(match[1])) continue;
    seen.add(match[1]);
    const text = (anchor.innerText || anchor.textContent || "").replace(/\\s+/g, " ").trim();
    links.push({ room_id: match[1], href, text });
  }
  return {
    pageTitle: document.title,
    pageUrl: location.href,
    linkCount: links.length,
    links
  };
})()`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const target = await getPageTarget();
  const client = await connect(target.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.enable");
    for (let i = 0; i < scrollCount; i += 1) {
      await client.send("Runtime.evaluate", {
        expression: "window.scrollBy(0, Math.max(window.innerHeight || 800, 800));",
        returnByValue: true,
      });
      await sleep(scrollWaitMs);
    }
    const result = await client.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    });
    const value = result.result && result.result.value;
    console.log(JSON.stringify({
      ...value,
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
