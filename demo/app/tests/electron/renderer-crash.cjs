const { app, BrowserWindow, session } = require("electron");

app.whenReady().then(async () => {
  const healthy = new BrowserWindow({ show: false, webPreferences: { session: session.fromPartition(`healthy-${Date.now()}`), sandbox: true } });
  const failed = new BrowserWindow({ show: false, webPreferences: { session: session.fromPartition(`failed-${Date.now()}`), sandbox: true } });
  await Promise.all([healthy.loadURL("data:text/html,healthy"), failed.loadURL("data:text/html,failed")]);
  const failure = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("render-process-gone not emitted")), 5000);
    failed.webContents.once("render-process-gone", (_event, details) => { clearTimeout(timer); resolve(details.reason); });
  });
  failed.webContents.forcefullyCrashRenderer();
  const reason = await failure;
  const healthyAlive = !healthy.webContents.isDestroyed() && (await healthy.webContents.executeJavaScript("document.body.innerText")) === "healthy";
  process.stdout.write(`${JSON.stringify({ ok: healthyAlive, failedReason: reason, healthyAlive })}\n`);
  healthy.destroy(); failed.destroy(); app.exit(healthyAlive ? 0 : 1);
}).catch((error) => { process.stderr.write(`${error.stack}\n`); app.exit(1); });
