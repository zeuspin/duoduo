import { ipcMain, type IpcMainEvent } from "electron";
import { floatToPcm16, resampleMono } from "./pcm";

type Listener = (pcm: Buffer) => void | Promise<void>;

export class CaptureRouter {
  private readonly routes = new Map<string, {
    senderId: number;
    listener: Listener;
    onEnded?: () => void;
    onAudio?: () => void;
    audioReceived: boolean;
  }>();

  constructor() {
    ipcMain.on("room-capture:audio", (event, payload) => this.handleAudio(event, payload));
    ipcMain.on("room-capture:ended", (event, payload) => this.handleEnded(event, payload));
  }

  register(
    token: string,
    senderId: number,
    listener: Listener,
    onEnded?: () => void,
    onAudio?: () => void,
  ): () => void {
    this.routes.set(token, { senderId, listener, onEnded, onAudio, audioReceived: false });
    return () => this.routes.delete(token);
  }

  get activeCount(): number { return this.routes.size; }

  private handleAudio(event: IpcMainEvent, payload: unknown): void {
    if (!payload || typeof payload !== "object") return;
    const { token, sampleRate, samples } = payload as { token?: unknown; sampleRate?: unknown; samples?: unknown };
    if (typeof token !== "string" || typeof sampleRate !== "number") return;
    const route = this.routes.get(token);
    if (!route || route.senderId !== event.sender.id) return;
    const input = samples instanceof Float32Array ? samples : ArrayBuffer.isView(samples) ? new Float32Array(samples.buffer) : undefined;
    if (!input || ![16000, 32000, 44100, 48000].includes(sampleRate)) return;
    try {
      const normalized = sampleRate === 16000 ? input : resampleMono(input, sampleRate, 16000);
      if (!route.audioReceived) {
        route.audioReceived = true;
        route.onAudio?.();
      }
      void route.listener(floatToPcm16(normalized));
    } catch { /* Drop malformed chunks without affecting other rooms. */ }
  }

  private handleEnded(event: IpcMainEvent, payload: unknown): void {
    const token = payload && typeof payload === "object" ? (payload as { token?: unknown }).token : undefined;
    if (typeof token !== "string") return;
    const route = this.routes.get(token);
    if (route?.senderId === event.sender.id) route.onEnded?.();
  }
}
