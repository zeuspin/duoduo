import { contextBridge, ipcRenderer } from "electron";
import { createRendererApi } from "./api";

const api = createRendererApi(
  (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  (channel, listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
);

contextBridge.exposeInMainWorld("duoduo", api);
