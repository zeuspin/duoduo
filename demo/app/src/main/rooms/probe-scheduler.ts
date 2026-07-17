import type { PreparedProbeSource, PreparedProbeState, ProbeRequestState } from "../../shared/contracts";

export interface ProbeSchedule {
  probeIntervalMinutes: number | null;
}

interface ProbeSchedulerOptions {
  defaultIntervalMinutes?: number;
  maxConcurrency?: number;
  jitterRatio?: number;
  random?: () => number;
  now?: () => number;
  manualCooldownMs?: number;
  safeNavigationGapMs?: number;
  automaticBudgetPerHour?: number;
}

interface ProbeOutcome { status?: string }

interface QueuedProbe {
  roomId: string;
  source: PreparedProbeSource;
  requestType?: "manual" | "initial";
  batchId?: number;
  resolve(result: ProbeOutcome | void): void;
  reject(error: unknown): void;
}

interface BatchProgress {
  id: number;
  source: "startup" | "manual_batch";
  total: number;
  completed: number;
  promise?: Promise<void>;
}

type Probe = (roomId: string, source: PreparedProbeSource) => Promise<ProbeOutcome | void>;
type StateListener = (state: PreparedProbeState) => void;

export function estimateSafeBatchDurationMs(remaining: number, gapMs: number, budgetPerHour: number): number {
  if (remaining <= 1) return 0;
  const transitions = remaining - 1;
  const fullBudgetBoundaries = Math.floor(transitions / budgetPerHour);
  return transitions * gapMs + fullBudgetBoundaries * Math.max(0, 3_600_000 - budgetPerHour * gapMs);
}

export function splitPreparedStartupRooms(roomIds: string[], snapshots: Array<{ roomId: string; status: string }>): { initialRoomIds: string[]; refreshRoomIds: string[] } {
  const statusByRoom = new Map(snapshots.map((snapshot) => [snapshot.roomId, snapshot.status]));
  const initialRoomIds = roomIds.filter((roomId) => {
    const status = statusByRoom.get(roomId);
    return status === undefined || status === "checking";
  });
  const initialSet = new Set(initialRoomIds);
  return { initialRoomIds, refreshRoomIds: roomIds.filter((roomId) => !initialSet.has(roomId)) };
}

export class ProbeScheduler {
  private readonly running = new Map<string, Promise<ProbeOutcome | void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly timerDeadlines = new Map<string, number>();
  private readonly scheduleVersions = new Map<string, number>();
  private readonly schedules = new Map<string, ProbeSchedule>();
  private readonly backoffStages = new Map<string, number>();
  private readonly active = new Set<QueuedProbe>();
  private readonly listeners = new Set<StateListener>();
  private defaultIntervalMinutes: number;
  private readonly maxConcurrency: number;
  private readonly jitterRatio: number;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly manualCooldownMs: number;
  private readonly safeNavigationGapMs: number;
  private readonly automaticBudgetPerHour: number;
  private readonly lastManualProbeAt = new Map<string, number>();
  private activeCount = 0;
  private readonly pending: QueuedProbe[] = [];
  private batchSequence = 0;
  private batch: BatchProgress | undefined;
  private lastCompletedAt: string | undefined;
  private stopped = false;

  constructor(private readonly probe: Probe, options: ProbeSchedulerOptions = {}) {
    this.defaultIntervalMinutes = options.defaultIntervalMinutes ?? 5;
    this.maxConcurrency = options.maxConcurrency ?? 1;
    this.jitterRatio = options.jitterRatio ?? 0.2;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.manualCooldownMs = options.manualCooldownMs ?? 60_000;
    this.safeNavigationGapMs = options.safeNavigationGapMs ?? 60_000;
    this.automaticBudgetPerHour = options.automaticBudgetPerHour ?? 10;
  }

  runNow(roomId: string, source: PreparedProbeSource = "manual"): Promise<ProbeOutcome | void> {
    if (this.stopped) return Promise.resolve();
    const existing = this.running.get(roomId);
    if (existing) {
      if (source === "manual" || source === "initial") this.promoteExisting(roomId, source);
      return existing;
    }
    if (source === "manual") {
      const now = this.now();
      const lastProbeAt = this.lastManualProbeAt.get(roomId);
      if (lastProbeAt !== undefined && now - lastProbeAt < this.manualCooldownMs) return Promise.reject(new Error("PROBE_COOLDOWN"));
    }
    return this.enqueue(roomId, source);
  }

  runBatch(roomIds: string[], source: "startup" | "manual_batch"): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.batch?.promise) return this.batch.promise;
    const unique = [...new Set(roomIds)];
    const eligible = unique.filter((roomId) => !this.running.has(roomId));
    const batch: BatchProgress = { id: ++this.batchSequence, source, total: unique.length, completed: unique.length - eligible.length };
    this.batch = batch;
    const tasks = eligible.map((roomId) => this.enqueue(roomId, source, batch.id));
    const promise = Promise.allSettled(tasks).then(() => {
      if (this.batch?.id === batch.id) this.batch = undefined;
      this.emit();
    });
    batch.promise = promise;
    this.emit();
    return promise;
  }

  runStartup(roomIds: string[]): Promise<void> { return this.runBatch(roomIds, "startup"); }

  cancelManualBatch(): void {
    if (this.batch?.source !== "manual_batch") return;
    this.clearPending((queued) => queued.source === "manual_batch" && queued.batchId === this.batch?.id);
    this.emit();
  }

  state(): PreparedProbeState {
    const now = this.now();
    for (const [roomId, completedAt] of this.lastManualProbeAt) {
      if (now - completedAt >= this.manualCooldownMs) this.lastManualProbeAt.delete(roomId);
    }
    const earliestDeadline = this.timerDeadlines.size ? Math.min(...this.timerDeadlines.values()) : undefined;
    const currentRoomId = this.active.values().next().value?.roomId;
    const remaining = this.batch ? Math.max(0, this.batch.total - this.batch.completed) : 0;
    const estimatedCompletionAt = this.batch
      ? new Date(this.now() + estimateSafeBatchDurationMs(remaining, this.safeNavigationGapMs, this.automaticBudgetPerHour)).toISOString()
      : undefined;
    const manualProbes: ProbeRequestState[] = [
      ...[...this.active].flatMap((item): ProbeRequestState[] => item.requestType ? [{ roomId: item.roomId, requestType: item.requestType, phase: "running" }] : []),
      ...this.pending.flatMap((item): ProbeRequestState[] => item.requestType ? [{ roomId: item.roomId, requestType: item.requestType, phase: "queued" }] : []),
      ...[...this.lastManualProbeAt].map(([roomId, completedAt]): ProbeRequestState => ({ roomId, requestType: "manual", phase: "cooldown", cooldownUntil: new Date(completedAt + this.manualCooldownMs).toISOString() })),
    ];
    return {
      mode: this.activeCount > 0 || this.pending.length > 0 ? "running" : "idle",
      ...(currentRoomId ? { currentRoomId } : {}),
      queuedRoomIds: this.pending.map((item) => item.roomId),
      ...(this.batch ? { batch: { source: this.batch.source, total: this.batch.total, completed: this.batch.completed } } : {}),
      ...(earliestDeadline === undefined ? {} : { nextRunAt: new Date(earliestDeadline).toISOString() }),
      ...(this.lastCompletedAt ? { lastCompletedAt: this.lastCompletedAt } : {}),
      ...(estimatedCompletionAt ? { estimatedCompletionAt } : {}),
      manualProbes,
    };
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private enqueue(roomId: string, source: PreparedProbeSource, batchId?: number): Promise<ProbeOutcome | void> {
    const existing = this.running.get(roomId);
    if (existing) return existing;
    let queued!: QueuedProbe;
    const task = new Promise<ProbeOutcome | void>((resolve, reject) => {
      queued = { roomId, source, batchId, ...(source === "manual" || source === "initial" ? { requestType: source } : {}), resolve, reject };
      this.insertPending(queued);
    });
    this.running.set(roomId, task);
    this.drain();
    this.emit();
    return task;
  }

  private insertPending(item: QueuedProbe): void {
    if (!item.requestType) { this.pending.push(item); return; }
    const firstAutomatic = this.pending.findIndex((queued) => !queued.requestType);
    this.pending.splice(firstAutomatic < 0 ? this.pending.length : firstAutomatic, 0, item);
  }

  private promoteExisting(roomId: string, requestType: "manual" | "initial"): void {
    const active = [...this.active].find((item) => item.roomId === roomId);
    if (active) {
      active.requestType = active.requestType === "manual" ? "manual" : requestType;
      this.emit();
      return;
    }
    const index = this.pending.findIndex((item) => item.roomId === roomId);
    if (index < 0) return;
    const [item] = this.pending.splice(index, 1);
    item.requestType = item.requestType === "manual" ? "manual" : requestType;
    item.source = item.requestType;
    this.insertPending(item);
    this.emit();
  }

  private drain(): void {
    while (!this.stopped && this.activeCount < this.maxConcurrency && this.pending.length) {
      const next = this.pending.shift()!;
      this.activeCount += 1;
      this.active.add(next);
      this.emit();
      let work: Promise<ProbeOutcome | void>;
      try { work = this.probe(next.roomId, next.source); }
      catch (error) { work = Promise.reject(error); }
      void work.then((result) => {
        if (result?.status === "verification_required") this.clearPending();
        this.finishStarted(next);
        this.completeStarted(next, result?.status);
        next.resolve(result);
      }, (error) => {
        this.finishStarted(next);
        this.completeStarted(next, undefined, error);
        next.reject(error);
      });
    }
  }

  private finishStarted(item: QueuedProbe): void {
    if (item.batchId !== undefined && this.batch?.id === item.batchId) this.batch.completed += 1;
  }

  private completeStarted(item: QueuedProbe, status?: string, error?: unknown): void {
    this.running.delete(item.roomId);
    this.active.delete(item);
    this.activeCount -= 1;
    this.lastCompletedAt = new Date(this.now()).toISOString();
    if (item.requestType === "manual" && error === undefined) this.lastManualProbeAt.set(item.roomId, this.now());
    this.scheduleAfterOutcome(item.roomId, status, error);
    this.drain();
    this.emit();
  }

  private clearPending(predicate: (queued: QueuedProbe) => boolean = () => true): void {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const queued = this.pending[index];
      if (!predicate(queued)) continue;
      this.pending.splice(index, 1);
      this.running.delete(queued.roomId);
      queued.resolve();
    }
    this.emit();
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
    const version = (this.scheduleVersions.get(roomId) ?? 0) + 1;
    this.scheduleVersions.set(roomId, version);
    this.schedules.set(roomId, room);
    this.armSchedule(roomId, room, initialDelayMs, version);
  }

  private armSchedule(roomId: string, room: ProbeSchedule, delayMs: number, version: number): void {
    const existing = this.timers.get(roomId);
    if (existing) clearTimeout(existing);
    const deadline = this.now() + delayMs;
    const timer = setTimeout(() => {
      this.timers.delete(roomId);
      this.timerDeadlines.delete(roomId);
      this.emit();
      void this.runNow(roomId, "scheduled").catch(() => undefined);
    }, delayMs);
    timer.unref?.();
    this.timers.set(roomId, timer);
    this.timerDeadlines.set(roomId, deadline);
    this.emit();
  }

  cancel(roomId: string): Promise<void> {
    const running = this.running.get(roomId);
    const timer = this.timers.get(roomId);
    if (timer) clearTimeout(timer);
    this.timers.delete(roomId);
    this.timerDeadlines.delete(roomId);
    this.scheduleVersions.delete(roomId);
    this.schedules.delete(roomId);
    this.backoffStages.delete(roomId);
    this.clearPending((item) => item.roomId === roomId);
    this.emit();
    return running ? running.then(() => undefined, () => undefined) : Promise.resolve();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.timerDeadlines.clear();
    this.scheduleVersions.clear();
    this.schedules.clear();
    this.backoffStages.clear();
    this.clearPending();
    await Promise.allSettled(this.running.values());
    this.batch = undefined;
    this.emit();
  }

  private emit(): void {
    const snapshot = this.state();
    for (const listener of this.listeners) listener(structuredClone(snapshot));
  }

  private scheduleAfterOutcome(roomId: string, status?: string, error?: unknown): void {
    if (this.stopped) return;
    const room = this.schedules.get(roomId);
    const version = this.scheduleVersions.get(roomId);
    if (!room || version === undefined) return;
    if (status === "verification_required") {
      this.deferAllSchedules(120 * 60_000);
      return;
    }
    if (status === "live") {
      this.backoffStages.delete(roomId);
      this.armSchedule(roomId, room, this.safeJitter(Math.max(this.intervalMs(room), 10 * 60_000)), version);
      return;
    }
    const accessPaused = error instanceof Error && ["ACCESS_VERIFICATION_PAUSED", "ACCESS_CANCELED_BY_VERIFICATION"].includes(error.message);
    if (accessPaused) {
      this.armSchedule(roomId, room, this.safeJitter(120 * 60_000), version);
      return;
    }
    const backoffs = [30, 60, 120] as const;
    const stage = this.backoffStages.get(roomId) ?? 0;
    this.backoffStages.set(roomId, Math.min(stage + 1, backoffs.length - 1));
    this.armSchedule(roomId, room, this.safeJitter(backoffs[Math.min(stage, backoffs.length - 1)] * 60_000), version);
  }

  private safeJitter(base: number): number {
    return Math.round(base * (1 + this.random() * this.jitterRatio));
  }

  private deferAllSchedules(delayMs: number): void {
    for (const [roomId, room] of this.schedules) {
      const version = this.scheduleVersions.get(roomId);
      if (version === undefined) continue;
      this.backoffStages.set(roomId, 2);
      this.armSchedule(roomId, room, this.safeJitter(delayMs), version);
    }
  }
}
