const { app, BrowserWindow, WebContentsView } = require("electron");
const http = require("node:http");

async function main() {
  const hangingResponses = new Set();
  const server = http.createServer((request, response) => {
    if (request.url === "/hang") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.write("<!doctype html><p>still loading");
      hangingResponses.add(response);
      response.once("close", () => hangingResponses.delete(response));
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end("<!doctype html><main>直播已结束</main><iframe src='/hang'></iframe>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("SERVER_ADDRESS_UNAVAILABLE");

  const window = new BrowserWindow({ show: false });
  const view = new WebContentsView();
  window.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
  try {
    const domReady = new Promise((resolve) => view.webContents.once("dom-ready", resolve));
    void view.webContents.loadURL(`http://127.0.0.1:${address.port}/`).catch(() => undefined);
    await domReady;
    if (!view.webContents.isLoading()) throw new Error("FIXTURE_DID_NOT_KEEP_LOADING");

    const result = await Promise.race([
      view.webContents.mainFrame.executeJavaScript("document.body?.innerText ?? ''"),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error("MAIN_FRAME_INSPECTION_TIMEOUT")), 1_000)),
    ]);
    if (!String(result).includes("直播已结束")) throw new Error("MAIN_FRAME_INSPECTION_WRONG_RESULT");
  } finally {
    for (const response of hangingResponses) response.end();
    view.webContents.stop();
    window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    if (!window.isDestroyed()) window.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

app.whenReady().then(() => main()).then(() => app.quit(), (error) => { console.error(error); app.exit(1); });
