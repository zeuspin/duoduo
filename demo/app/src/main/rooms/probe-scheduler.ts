export interface ProbeSchedule {
  probeIntervalMinutes: number | null;
}

interface ProbeSchedulerOptions {
  defaultIntervalMinutes?: number;
  maxConcurrency?: number;
  jitterRatio?: number;
  random?: () => number;
}

export class ProbeScheduler {
  private readonly running = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private defaultIntervalMinutes: number;
  private readonly maxConcurrency: number;
  private readonly jitterRatio: number;
  private readonly random: () => number;
  private activeCount = 0;
  private readonly pending: Array<{ roomId: string; resolve(): void; reject(error: unknown): void }> = [];
  private stopped = false;

  constructor(private readonly probe: (roomId: string) => Promise<void>, options: ProbeSchedulerOptions = {}) {
    this.defaultIntervalMinutes = options.defaultIntervalMinutes ?? 5;
    this.maxConcurrency = options.maxConcurrency ?? 2;
    this.jitterRatio = options.jitterRatio ?? 0.2;
    this.random = options.random ?? Math.random;
  }

  runNow(roomId: string): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const existing = this.running.get(roomId);
    if (existing) return existing;
    const task = new Promise<void>((resolve, reject) => this.pending.push({ roomId, resolve, reject }));
    this.running.set(roomId, task);
    this.drain();
    return task;
  }

  private drain(): void {
    while (!this.stopped && this.activeCount < this.maxConcurrency && this.pending.length) {
      const next = this.pending.shift()!;
      this.activeCount += 1;
      let work: Promise<void>;
      try { work = this.probe(next.roomId); }
      catch (error) { work = Promise.reject(error); }
      void work.then(next.resolve, next.reject).finally(() => {
        this.activeCount -= 1;
        this.running.delete(next.roomId);
        this.drain();
      });
    }
  }

  intervalMs(room: ProbeSchedule): number {
    return (room.probeIntervalMinutes ?? this.defaultIntervalMinutes) * 60_000;
  }

  setDefaultIntervalMinutes(value: number): void { this.defaultIntervalMinutes = value; }

  jitteredIntervalMs(room: ProbeSchedule): number {
    const base = this.intervalMs(room);
    return Math.round(base * (1 - this.jitterRatio + this.random() * this.jitterRatio * 2));
  }

  schedule(roomId: string, room: ProbeSchedule, initialDelayMs = this.jitteredIntervalMs(room)): void {
    if (this.stopped) return;
    const existing = this.timers.get(roomId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      void this.runNow(roomId).finally(() => this.schedule(roomId, room));
    }, initialDelayMs);
    timer.unref?.();
    this.timers.set(roomId, timer);
  }

  cancel(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (timer) clearTimeout(timer);
    this.timers.delete(roomId);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const queued of this.pending.splice(0)) { this.running.delete(queued.roomId); queued.resolve(); }
    await Promise.allSettled(this.running.values());
  }
}
