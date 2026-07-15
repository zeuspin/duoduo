import type { StoredAsrEvent } from "../storage/database";

export interface InsightCoordinatorOptions<T> {
  analyze(roomId: string, events: StoredAsrEvent[]): Promise<T[]>;
  persist(value: T): void | Promise<void>;
  debounceMs?: number;
  maxWaitMs?: number;
  maxCharacters?: number;
}

interface InsightStatus { state: "idle" | "buffering" | "analyzing" | "error"; error?: string }

export class InsightCoordinator<T = unknown> {
  private readonly buffers = new Map<string, StoredAsrEvent[]>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly statuses = new Map<string, InsightStatus>();
  private readonly bufferStartedAt = new Map<string, number>();
  private closed = false;

  constructor(private readonly options: InsightCoordinatorOptions<T>) {}

  accept(event: StoredAsrEvent): void {
    if (this.closed || !event.isFinal) return;
    const buffer = this.buffers.get(event.roomId) ?? [];
    if (buffer.length === 0) this.bufferStartedAt.set(event.roomId, Date.now());
    buffer.push(event); this.buffers.set(event.roomId, buffer);
    this.statuses.set(event.roomId, { state: "buffering" });
    const characters = buffer.reduce((sum, item) => sum + item.text.length, 0);
    if (characters >= (this.options.maxCharacters ?? 3000)) { void this.flush(event.roomId); return; }
    const existing = this.timers.get(event.roomId); if (existing) clearTimeout(existing);
    const elapsed = Date.now() - (this.bufferStartedAt.get(event.roomId) ?? Date.now());
    const delay = Math.max(0, Math.min(this.options.debounceMs ?? 8000, (this.options.maxWaitMs ?? 60_000) - elapsed));
    const timer = setTimeout(() => void this.flush(event.roomId), delay);
    timer.unref?.(); this.timers.set(event.roomId, timer);
  }

  status(roomId: string): InsightStatus { return this.statuses.get(roomId) ?? { state: "idle" }; }
  resourceCount(): number { return this.timers.size + this.running.size + this.buffers.size; }

  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled(this.running.values());
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.buffers.clear(); this.bufferStartedAt.clear();
    await this.idle(); this.statuses.clear();
  }

  private async flush(roomId: string): Promise<void> {
    const timer = this.timers.get(roomId); if (timer) clearTimeout(timer); this.timers.delete(roomId);
    if (this.running.has(roomId)) return;
    const events = this.buffers.get(roomId) ?? [];
    if (!events.length) return;
    this.buffers.delete(roomId); this.bufferStartedAt.delete(roomId); this.statuses.set(roomId, { state: "analyzing" });
    const task = this.options.analyze(roomId, events).then(async (values) => { for (const value of values) await this.options.persist(value); this.statuses.set(roomId, { state: "idle" }); }).catch((error) => { this.statuses.set(roomId, { state: "error", error: error instanceof Error ? error.message : String(error) }); }).finally(() => {
      this.running.delete(roomId);
      if (this.buffers.get(roomId)?.length) { const next = setTimeout(() => void this.flush(roomId), this.options.debounceMs ?? 8000); next.unref?.(); this.timers.set(roomId, next); }
    });
    this.running.set(roomId, task);
    await task;
  }
}
