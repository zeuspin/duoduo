import { BrowserWindow, type Session } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AsrProvider, AsrSession } from "../asr/types";
import { START_PAGE_CAPTURE_SCRIPT, STOP_PAGE_CAPTURE_SCRIPT } from "../audio/capture-script";
import type { CaptureRouter } from "../audio/capture-router";
import { classifyCurrentHealth, evaluateNow, inspectCurrentRoom, probeRoom, type RoomProbeResult } from "./live-probe";
import type { MonitorSession } from "./room-manager";
import { disposeRoomResources, withRoomTimeout } from "./room-session-resources";
import { RoomMetricSampler } from "./metric-sampler";
import type { PreparedRoomPage } from "./prepared-page-lease";

export type RoomNavigationGate = (
  run: () => Promise<{ value: RoomProbeResult; verificationRequired?: boolean }>,
) => Promise<RoomProbeResult>;

export class RoomSession implements MonitorSession {
  private window?: BrowserWindow;
  private asr?: AsrSession;
  private unsubscribeAsr?: () => void;
  private unsubscribeAsrFailure?: () => void;
  private unregisterCapture?: () => void;
  private readonly failureListeners = new Set<(error: Error) => void>();
  private pendingFailure?: Error;
  private closed = false;
  private healthTimer?: NodeJS.Timeout;
  private healthCheckRunning = false;
  private lastVideoTime?: number;
  private consecutiveOfflineSignals = 0;
  private recovering = false;
  private readonly closeController = new AbortController();
  private lastAudioAt = 0;
  private consecutiveUnhealthySignals = 0;
  private readonly metricSampler: RoomMetricSampler;

  constructor(
    private readonly roomId: string,
    private readonly roomUrl: string,
    private readonly provider: AsrProvider,
    private readonly captureRouter: CaptureRouter,
    private readonly onAsr: Parameters<AsrSession["subscribe"]>[0],
    private readonly signal: AbortSignal,
    private readonly browserSession: Session,
    private readonly navigationGate: RoomNavigationGate,
    private readonly onProbe?: (result: RoomProbeResult, screenshot: Buffer) => Promise<void>,
    private readonly onMetricSnapshot?: (result: RoomProbeResult) => Promise<void>,
    private readonly onNetworkError?: (event: { url: string; error: string; resourceType: string }) => void,
    private healthCheckSeconds = 30,
    metricSampleIntervalMs = 300_000,
    private readonly now: () => number = Date.now,
    private preparedPage?: PreparedRoomPage,
    private readonly onAudio?: () => void,
  ) {
    this.metricSampler = new RoomMetricSampler({ intervalMs: metricSampleIntervalMs, now });
  }

  async start(): Promise<void> {
    try {
      if (this.closed || this.signal.aborted) throw new Error("ROOM_START_ABORTED");
      const prepared = this.takePreparedPage();
      const probe = prepared ?? await this.waitForNavigation(this.navigationGate(async () => {
        const value = await this.startPage();
        return { value, ...(value.status === "verification_required" ? { verificationRequired: true } : {}) };
      }));
      if (probe.status !== "live") throw new Error(`ROOM_NOT_LIVE:${probe.status}`);
      if (this.signal.aborted) throw new Error("ROOM_START_ABORTED");
      await this.startAsr();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  private async waitForNavigation(operation: Promise<RoomProbeResult>): Promise<RoomProbeResult> {
    const signal = AbortSignal.any([this.signal, this.closeController.signal]);
    if (signal.aborted) throw new Error("ROOM_START_ABORTED");
    let onAbort!: () => void;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          onAbort = () => reject(new Error("ROOM_START_ABORTED"));
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } finally { signal.removeEventListener("abort", onAbort); }
  }

  private async startPage(): Promise<RoomProbeResult> {
    if (this.closed || this.signal.aborted) throw new Error("ROOM_START_ABORTED");
    const token = randomUUID();
    this.window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: this.browserSession,
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
    this.attachWindowEvents(this.window);
    let screenshot: Buffer | undefined;
    const probe = await probeRoom(this.window.webContents, this.roomUrl, 20_000, {
      beforeProfile: async (result) => {
        screenshot = result.status === "verification_required" ? Buffer.alloc(0) : (await this.window!.capturePage()).toPNG();
      },
    });
    screenshot ??= probe.status === "verification_required" ? Buffer.alloc(0) : (await this.window.capturePage()).toPNG();
    await this.onProbe?.(probe, screenshot);
    this.metricSampler.seed(probe);
    this.captureToken = token;
    return probe;
  }

  private takePreparedPage(): RoomProbeResult | undefined {
    const page = this.preparedPage;
    this.preparedPage = undefined;
    if (!page || page.roomId !== this.roomId || page.window.isDestroyed()) return undefined;
    this.window = page.window;
    this.captureToken = page.captureToken;
    this.attachWindowEvents(page.window);
    this.metricSampler.seed(page.probe);
    return page.probe;
  }

  private attachWindowEvents(window: BrowserWindow): void {
    window.webContents.on("render-process-gone", (_event, details) => this.fail(new Error(`ROOM_RENDERER_GONE:${details.reason}`)));
    window.webContents.on("did-fail-load", (_event, _errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame) this.onNetworkError?.({ url: validatedURL, error: errorDescription, resourceType: "mainFrame" });
    });
  }

  private captureToken: string | undefined;

  private async startAsr(): Promise<void> {
    if (!this.window || this.window.isDestroyed() || !this.captureToken) throw new Error("ROOM_PAGE_UNAVAILABLE");
    await this.openAsr();
    this.unregisterCapture = this.captureRouter.register(
      this.captureToken,
      this.window.webContents.id,
      async (bytes) => {
        this.lastAudioAt = this.now();
        const asr = this.asr;
        try {
          if (!asr) return;
          await asr.write({ bytes, sampleRate: 16000, channels: 1, encoding: "pcm_s16le" });
          this.onAudio?.();
        } catch (error) { if (this.asr === asr) this.fail(error instanceof Error ? error : new Error(String(error))); }
      },
      () => this.fail(new Error("AUDIO_TRACK_ENDED")),
      this.onAudio,
    );
    await withRoomTimeout(evaluateNow(this.window.webContents, START_PAGE_CAPTURE_SCRIPT));
    this.lastAudioAt = this.now();
    this.startHealthChecks();
  }

  private async openAsr(): Promise<void> {
    const asr = await this.provider.open(this.roomId, AbortSignal.any([this.signal, this.closeController.signal]));
    if (this.closed || this.signal.aborted) {
      await withRoomTimeout(asr.close()).catch(() => undefined);
      throw new Error("ROOM_START_ABORTED");
    }
    this.asr = asr;
    this.unsubscribeAsr = asr.subscribe(this.onAsr);
    this.unsubscribeAsrFailure = asr.subscribeFailure?.((error) => this.fail(error));
  }

  async recover(error: Error): Promise<boolean> {
    if (this.closed || this.signal.aborted) throw new Error("ROOM_START_ABORTED");
    if (!this.window || this.window.isDestroyed() || error.message.startsWith("ROOM_RENDERER_GONE:")) return false;
    this.recovering = true;
    if (this.pendingFailure === error) this.pendingFailure = undefined;
    try {
      const captureFailure = ["AUDIO_TRACK_ENDED", "VIDEO_NOT_FOUND", "AUDIO_TRACK_NOT_FOUND", "AUDIO_CAPTURE_STALLED"].includes(error.message);
      if (captureFailure) {
        try {
          const evidence = await withRoomTimeout(inspectCurrentRoom(this.window.webContents));
          if (classifyCurrentHealth(evidence, this.lastVideoTime) === "offline") throw new Error("ROOM_NOT_LIVE:offline");
          await withRoomTimeout(evaluateNow(this.window.webContents, STOP_PAGE_CAPTURE_SCRIPT));
          if (this.closed || this.signal.aborted) throw new Error("ROOM_START_ABORTED");
          await withRoomTimeout(evaluateNow(this.window.webContents, START_PAGE_CAPTURE_SCRIPT));
          this.lastVideoTime = undefined;
          this.lastAudioAt = this.now();
          this.consecutiveUnhealthySignals = 0;
        } catch (error) {
          if (error instanceof Error && error.message === "ROOM_NOT_LIVE:offline") throw error;
          return false;
        }
      } else {
        this.unsubscribeAsr?.();
        this.unsubscribeAsrFailure?.();
        this.unsubscribeAsr = undefined;
        this.unsubscribeAsrFailure = undefined;
        const previous = this.asr;
        this.asr = undefined;
        if (previous) await withRoomTimeout(previous.close()).catch(() => undefined);
        if (this.closed || this.signal.aborted) throw new Error("ROOM_START_ABORTED");
        await this.openAsr();
      }
      return true;
    } finally { this.recovering = false; }
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
    if (this.closed || this.recovering || this.healthCheckRunning || !this.window || this.window.isDestroyed()) return;
    this.healthCheckRunning = true;
    try {
      const evidence = await withRoomTimeout(inspectCurrentRoom(this.window.webContents));
      const status = classifyCurrentHealth(evidence, this.lastVideoTime);
      const stalled = !evidence.hasVideo || evidence.paused || evidence.videoReadyState < 2 || evidence.audioTrackState === "ended" || evidence.captureVideoConnected === false
        || (this.lastVideoTime !== undefined && evidence.currentTime <= this.lastVideoTime);
      this.lastVideoTime = evidence.currentTime;
      if (this.metricSampler.accept(evidence)) {
        await this.onMetricSnapshot?.({
          status: "live",
          viewerCount: evidence.viewerCount,
          followerCount: evidence.followerCount,
          totalViewerCount: evidence.totalViewerCount,
          likeCount: evidence.likeCount,
          metricRaw: evidence.metricRaw,
          metricEvidence: evidence.metricEvidence,
          metricQuality: evidence.metricQuality,
          liveDescription: evidence.liveDescription,
        });
      }
      this.consecutiveOfflineSignals = status === "offline" ? this.consecutiveOfflineSignals + 1 : 0;
      if (this.consecutiveOfflineSignals >= 2) {
        if (this.healthTimer) clearInterval(this.healthTimer);
        this.healthTimer = undefined;
        this.fail(new Error("ROOM_NOT_LIVE:offline"));
      } else if (status !== "offline") {
        this.consecutiveUnhealthySignals = stalled ? this.consecutiveUnhealthySignals + 1 : 0;
        if (this.consecutiveUnhealthySignals >= 2 || this.now() - this.lastAudioAt >= 30_000) {
          this.fail(new Error("AUDIO_CAPTURE_STALLED"));
        }
      }
    } catch { /* A transient inspection failure must not restart the room. */ }
    finally { this.healthCheckRunning = false; }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.closeController.abort();
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = undefined;
    this.unregisterCapture?.();
    this.unregisterCapture = undefined;
    this.unsubscribeAsr?.();
    this.unsubscribeAsrFailure?.();
    this.unsubscribeAsr = undefined;
    this.unsubscribeAsrFailure = undefined;
    const window = this.window;
    const asr = this.asr;
    this.asr = undefined;
    this.window = undefined;
    this.captureToken = undefined;
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
    const pending = this.pendingFailure;
    if (pending) queueMicrotask(() => {
      if (this.pendingFailure === pending && this.failureListeners.has(listener)) listener(pending);
    });
    return () => this.failureListeners.delete(listener);
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.pendingFailure = error;
    for (const listener of this.failureListeners) listener(error);
  }
}
