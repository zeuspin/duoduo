import { BrowserWindow, session, type Session } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AsrProvider, AsrSession } from "../asr/types";
import { START_PAGE_CAPTURE_SCRIPT, STOP_PAGE_CAPTURE_SCRIPT } from "../audio/capture-script";
import type { CaptureRouter } from "../audio/capture-router";
import { classifyCurrentHealth, evaluateNow, inspectCurrentRoom, probeRoom, type RoomProbeResult } from "./live-probe";
import type { MonitorSession } from "./room-manager";
import { disposeRoomResources } from "./room-session-resources";
import { roomPartitionName } from "./partitions";

export class RoomSession implements MonitorSession {
  private window?: BrowserWindow;
  private partition?: Session;
  private asr?: AsrSession;
  private unregisterCapture?: () => void;
  private readonly failureListeners = new Set<(error: Error) => void>();
  private closed = false;
  private healthTimer?: NodeJS.Timeout;
  private healthCheckRunning = false;
  private lastVideoTime?: number;
  private consecutiveOfflineSignals = 0;

  constructor(
    private readonly roomId: string,
    private readonly roomUrl: string,
    private readonly provider: AsrProvider,
    private readonly captureRouter: CaptureRouter,
    private readonly onAsr: Parameters<AsrSession["subscribe"]>[0],
    private readonly signal: AbortSignal,
    private readonly onProbe?: (result: RoomProbeResult, screenshot: Buffer) => Promise<void>,
    private readonly onNetworkError?: (event: { url: string; error: string; resourceType: string }) => void,
    private healthCheckSeconds = 30,
  ) {}

  async start(): Promise<void> {
    try {
      await this.startResources();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private async startResources(): Promise<void> {
    if (this.signal.aborted) throw new Error("ROOM_START_ABORTED");
    const token = randomUUID();
    const isolatedSession = session.fromPartition(roomPartitionName(this.roomId), { cache: false });
    this.partition = isolatedSession;
    isolatedSession.webRequest.onErrorOccurred((details) => {
      this.onNetworkError?.({ url: details.url, error: details.error, resourceType: details.resourceType });
    });
    isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    this.window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: isolatedSession,
        preload: join(__dirname, "room-capture.js"),
        additionalArguments: [`--duoduo-capture-token=${token}`],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.window.webContents.setAudioMuted(true);
    this.window.webContents.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36");
    this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.window.webContents.on("render-process-gone", (_event, details) => this.fail(new Error(`ROOM_RENDERER_GONE:${details.reason}`)));
    const probe = await probeRoom(this.window.webContents, this.roomUrl);
    await this.onProbe?.(probe, (await this.window.capturePage()).toPNG());
    if (probe.status !== "live") throw new Error(`ROOM_NOT_LIVE:${probe.status}`);
    if (this.signal.aborted) throw new Error("ROOM_START_ABORTED");
    this.asr = await this.provider.open(this.roomId);
    this.asr.subscribe(this.onAsr);
    this.asr.subscribeFailure?.((error) => this.fail(error));
    this.unregisterCapture = this.captureRouter.register(token, this.window.webContents.id, (bytes) => this.asr?.write({ bytes, sampleRate: 16000, channels: 1, encoding: "pcm_s16le" }), () => this.fail(new Error("AUDIO_TRACK_ENDED")));
    await evaluateNow(this.window.webContents, START_PAGE_CAPTURE_SCRIPT);
    this.startHealthChecks();
  }

  updateHealthCheckInterval(seconds: number): void {
    this.healthCheckSeconds = seconds;
    if (this.healthTimer) this.startHealthChecks();
  }

  private startHealthChecks(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    const intervalMs = Math.max(5_000, this.healthCheckSeconds * 500);
    this.healthTimer = setInterval(() => void this.checkCurrentHealth(), intervalMs);
    this.healthTimer.unref?.();
  }

  private async checkCurrentHealth(): Promise<void> {
    if (this.closed || this.healthCheckRunning || !this.window || this.window.isDestroyed()) return;
    this.healthCheckRunning = true;
    try {
      const evidence = await inspectCurrentRoom(this.window.webContents);
      const status = classifyCurrentHealth(evidence, this.lastVideoTime);
      this.lastVideoTime = evidence.currentTime;
      this.consecutiveOfflineSignals = status === "offline" ? this.consecutiveOfflineSignals + 1 : 0;
      if (this.consecutiveOfflineSignals >= 2) {
        if (this.healthTimer) clearInterval(this.healthTimer);
        this.healthTimer = undefined;
        this.fail(new Error("AUDIO_TRACK_ENDED"));
      }
    } catch { /* A transient inspection failure must not restart the room. */ }
    finally { this.healthCheckRunning = false; }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = undefined;
    this.unregisterCapture?.();
    this.unregisterCapture = undefined;
    const window = this.window;
    const asr = this.asr;
    const partition = this.partition;
    this.asr = undefined;
    this.window = undefined;
    this.partition = undefined;
    partition?.webRequest.onErrorOccurred(null);
    await disposeRoomResources({
      stopCapture: window && !window.isDestroyed() ? () => evaluateNow(window.webContents, STOP_PAGE_CAPTURE_SCRIPT) : undefined,
      closeAsr: asr ? () => asr.close() : undefined,
      destroyWindow: window && !window.isDestroyed() ? () => window.destroy() : undefined,
      clearStorage: undefined,
    });
    this.failureListeners.clear();
  }

  subscribeFailure(listener: (error: Error) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    for (const listener of this.failureListeners) listener(error);
  }
}
