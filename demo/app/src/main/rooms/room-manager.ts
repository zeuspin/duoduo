import type { AsrEvent, RoomRuntime } from "../../shared/contracts";

export interface MonitorSession {
  start(): Promise<void>;
  close(): Promise<void>;
  subscribeFailure?(listener: (error: Error) => void): () => void;
  updateHealthCheckInterval?(seconds: number): void;
}

type SessionFactory = (roomId: string, signal: AbortSignal) => Promise<MonitorSession>;
type Listener = (rooms: RoomRuntime[]) => void;

interface Entry {
  runtime: RoomRuntime;
  controller?: AbortController;
  session?: MonitorSession;
  starting?: Promise<void>;
  recovering?: Promise<void>;
  offlineRetryTimer?: NodeJS.Timeout;
  technicalFailures?: number[];
  unsubscribeFailure?: () => void;
}

interface RoomManagerOptions {
  maxRetries?: number;
  retryDelayMs?: number;
  offlineRetryDelayMs?: number;
  maxHotAsr?: number;
  maxFailureCycles?: number;
  stabilityWindowMs?: number;
  persistFinalAsr?: (event: AsrEvent & { occurredAt: string }) => void;
}

export class RoomManager {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<Listener>();

  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private offlineRetryDelayMs: number;
  private readonly maxHotAsr: number;
  private readonly maxFailureCycles: number;
  private readonly stabilityWindowMs: number;
  private readonly persistFinalAsr?: RoomManagerOptions["persistFinalAsr"];

  constructor(private readonly createSession: SessionFactory, options: RoomManagerOptions = {}) {
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? 1_000;
    this.offlineRetryDelayMs = options.offlineRetryDelayMs ?? 60_000;
    this.maxHotAsr = options.maxHotAsr ?? 100;
    this.maxFailureCycles = options.maxFailureCycles ?? 3;
    this.stabilityWindowMs = options.stabilityWindowMs ?? 5 * 60_000;
    this.persistFinalAsr = options.persistFinalAsr;
  }

  startMonitoring(roomId: string): Promise<void> {
    const existing = this.entries.get(roomId);
    if (existing?.runtime.state === "monitoring" || existing?.runtime.state === "waiting_for_live") return Promise.resolve();
    if (existing?.starting) return existing.starting;

    const entry = existing ?? { runtime: { roomId, state: "idle", liveStatus: "checking", asr: [] } };
    const controller = new AbortController();
    entry.controller = controller;
    entry.runtime = { ...entry.runtime, state: "starting", liveStatus: "checking", error: undefined, asr: [] };
    this.entries.set(roomId, entry);
    this.emit();

    entry.starting = (async () => {
      try {
        const session = await this.createSession(roomId, controller.signal);
        if (controller.signal.aborted) { await session.close(); return; }
        entry.session = session;
        await session.start();
        this.bindFailure(entry, session);
        entry.runtime = { ...entry.runtime, state: "monitoring", liveStatus: "live" };
      } catch (error) {
        if (this.isOfflineFailure(error)) {
          entry.runtime = { ...entry.runtime, state: "waiting_for_live", liveStatus: "offline", error: undefined };
          this.scheduleOfflineRetry(entry);
          return;
        }
        entry.runtime = { ...entry.runtime, state: "error", liveStatus: "page_error", error: error instanceof Error ? error.message : String(error) };
        throw error;
      } finally {
        entry.starting = undefined;
        this.emit();
      }
    })();
    return entry.starting;
  }

  async stopMonitoring(roomId: string): Promise<void> {
    const entry = this.entries.get(roomId);
    if (!entry) return;
    entry.controller?.abort();
    if (entry.offlineRetryTimer) clearTimeout(entry.offlineRetryTimer);
    entry.offlineRetryTimer = undefined;
    entry.unsubscribeFailure?.();
    entry.unsubscribeFailure = undefined;
    if (entry.session) await entry.session.close();
    if (entry.recovering) await entry.recovering.catch(() => undefined);
    entry.session = undefined;
    entry.runtime = { ...entry.runtime, state: "stopped", liveStatus: "offline" };
    this.emit();
  }

  appendAsr(event: AsrEvent): void {
    const entry = this.entries.get(event.roomId);
    if (!entry) return;
    const timestamped = { ...event, occurredAt: event.occurredAt ?? new Date().toISOString() };
    const existing = entry.runtime.asr.findIndex((item) => item.segmentId === event.segmentId);
    const asr = [...entry.runtime.asr];
    if (existing >= 0) {
      if (asr[existing].isFinal) return;
      asr[existing] = timestamped;
    } else asr.push(timestamped);
    if (timestamped.isFinal) this.persistFinalAsr?.(timestamped);
    entry.runtime = { ...entry.runtime, asr: asr.slice(-this.maxHotAsr) };
    this.emit();
  }

  snapshot(): RoomRuntime[] { return [...this.entries.values()].map((entry) => structuredClone(entry.runtime)); }

  updateMonitoringInterval(seconds: number): void {
    this.offlineRetryDelayMs = seconds * 1_000;
    for (const entry of this.entries.values()) {
      entry.session?.updateHealthCheckInterval?.(seconds);
      if (entry.runtime.state === "waiting_for_live") {
        if (entry.offlineRetryTimer) clearTimeout(entry.offlineRetryTimer);
        entry.offlineRetryTimer = undefined;
        this.scheduleOfflineRetry(entry);
      }
    }
  }

  subscribe(listener: Listener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async shutdown(): Promise<{ sessions: number }> {
    await Promise.allSettled([...this.entries.keys()].map((roomId) => this.stopMonitoring(roomId)));
    return { sessions: [...this.entries.values()].filter((entry) => entry.session).length };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private bindFailure(entry: Entry, session: MonitorSession): void {
    entry.unsubscribeFailure?.();
    entry.unsubscribeFailure = session.subscribeFailure?.((error) => {
      if (entry.runtime.state !== "monitoring" || entry.recovering) return;
      if (this.isOfflineFailure(error)) void this.waitForLive(entry);
      else entry.recovering = this.handleTechnicalFailure(entry, error);
    });
  }

  private async handleTechnicalFailure(entry: Entry, error: Error): Promise<void> {
    const now = Date.now();
    entry.technicalFailures = [...(entry.technicalFailures ?? []).filter((time) => now - time < this.stabilityWindowMs), now];
    if (entry.technicalFailures.length > this.maxFailureCycles) {
      entry.runtime = { ...entry.runtime, state: "error", liveStatus: "page_error", error: error.message };
      this.emit();
      entry.unsubscribeFailure?.();
      entry.unsubscribeFailure = undefined;
      await entry.session?.close().catch(() => undefined);
      entry.session = undefined;
      entry.recovering = undefined;
      return;
    }
    await this.recover(entry, error);
  }

  private isOfflineFailure(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message === "AUDIO_TRACK_ENDED" || message === "VIDEO_NOT_FOUND" || message === "AUDIO_TRACK_NOT_FOUND" || message === "ROOM_NOT_LIVE:offline";
  }

  private async waitForLive(entry: Entry): Promise<void> {
    entry.unsubscribeFailure?.();
    entry.unsubscribeFailure = undefined;
    await entry.session?.close().catch(() => undefined);
    entry.session = undefined;
    if (entry.controller?.signal.aborted) return;
    entry.runtime = { ...entry.runtime, state: "waiting_for_live", liveStatus: "offline", error: undefined };
    this.emit();
    this.scheduleOfflineRetry(entry);
  }

  private scheduleOfflineRetry(entry: Entry): void {
    if (entry.offlineRetryTimer || entry.controller?.signal.aborted) return;
    entry.offlineRetryTimer = setTimeout(() => {
      entry.offlineRetryTimer = undefined;
      void this.retryOfflineRoom(entry);
    }, this.offlineRetryDelayMs);
  }

  private async retryOfflineRoom(entry: Entry): Promise<void> {
    if (entry.controller?.signal.aborted || entry.runtime.state !== "waiting_for_live") return;
    let session: MonitorSession | undefined;
    try {
      session = await this.createSession(entry.runtime.roomId, entry.controller!.signal);
      if (entry.controller?.signal.aborted) { await session.close(); return; }
      await session.start();
      entry.session = session;
      this.bindFailure(entry, session);
      entry.runtime = { ...entry.runtime, state: "monitoring", liveStatus: "live", error: undefined };
      this.emit();
    } catch (error) {
      await session?.close().catch(() => undefined);
      if (entry.controller?.signal.aborted) return;
      entry.runtime = { ...entry.runtime, state: "waiting_for_live", liveStatus: "offline", error: this.isOfflineFailure(error) ? undefined : error instanceof Error ? error.message : String(error) };
      this.emit();
      this.scheduleOfflineRetry(entry);
    }
  }

  private async recover(entry: Entry, initialError: Error): Promise<void> {
    entry.runtime = { ...entry.runtime, state: "recovering", error: initialError.message };
    this.emit();
    entry.unsubscribeFailure?.();
    entry.unsubscribeFailure = undefined;
    await entry.session?.close().catch(() => undefined);
    entry.session = undefined;
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      if (entry.controller?.signal.aborted) break;
      if (this.retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * attempt));
      try {
        const session = await this.createSession(entry.runtime.roomId, entry.controller!.signal);
        if (entry.controller?.signal.aborted) { await session.close(); break; }
        await session.start();
        entry.session = session;
        this.bindFailure(entry, session);
        entry.runtime = { ...entry.runtime, state: "monitoring", liveStatus: "live", error: undefined };
        entry.recovering = undefined;
        this.emit();
        return;
      } catch (error) {
        entry.runtime = { ...entry.runtime, state: "recovering", error: error instanceof Error ? error.message : String(error) };
        this.emit();
      }
    }
    if (!entry.controller?.signal.aborted) entry.runtime = { ...entry.runtime, state: "error", liveStatus: "page_error" };
    entry.recovering = undefined;
    this.emit();
  }
}
