import { ipcRenderer } from "electron";

const tokenArgument = process.argv.find((value) => value.startsWith("--duoduo-capture-token="));
const token = tokenArgument?.slice("--duoduo-capture-token=".length);

window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "duoduo-room-capture" || !token) return;
  const samples = event.data.samples;
  if (!(samples instanceof Float32Array)) return;
  ipcRenderer.send("room-capture:audio", { token, sampleRate: Number(event.data.sampleRate), samples });
});

window.addEventListener("message", (event) => {
  if (event.source === window && event.data?.source === "duoduo-room-capture-ended" && token) ipcRenderer.send("room-capture:ended", { token });
});

window.addEventListener("beforeunload", () => {
  if (token) ipcRenderer.send("room-capture:ended", { token });
});
