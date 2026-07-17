const { app, BrowserWindow, WebContentsView } = require("electron");

app.whenReady().then(async () => {
  const main = new BrowserWindow({ show: false, width: 1000, height: 760 });
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  main.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 64, width: 1000, height: 696 });
  view.setVisible(false);
  await view.webContents.loadURL("data:text/html;charset=utf-8,%3Ch1%3Everification-fixture%3C%2Fh1%3E");
  const pid = process.pid;
  for (let index = 0; index < 20; index += 1) {
    view.setVisible(true);
    await new Promise((resolve) => setImmediate(resolve));
    view.setVisible(false);
    await new Promise((resolve) => setImmediate(resolve));
  }
  const text = await view.webContents.executeJavaScript("document.body.innerText");
  if (process.pid !== pid || text.trim() !== "verification-fixture" || view.webContents.isDestroyed()) throw new Error("EMBEDDED_VERIFICATION_VIEW_UNSTABLE");
  main.contentView.removeChildView(view);
  view.webContents.close();
  main.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
