import type { DouyinAccessState, DouyinTaskType } from "../../shared/contracts";

export interface AccessTask<T> {
  roomId: string;
  type: DouyinTaskType;
  traffic?: "interactive" | "automatic";
  run(): Promise<{ value: T; verificationRequired?: boolean; protectionReason?: "verification_required" | "suspected_verification" }>;
}

interface CoordinatorOptions {
  initialState?: DouyinAccessState;
  now?: () => number;
  cooldownMs?: number;
  minimumGapMs?: number;
  automaticBudgetPerHour?: number;
  recoveryBudgetPerHour?: number;
  sleep?: (ms: number) => Promise<void>;
  persistState?: (state: DouyinAccessState) => void | Promise<void>;
}

interface QueuedTask<T = unknown> extends AccessTask<T> {
  key: string;
  resolve(value: T): void;
  reject(error: unknown): void;
}

const priority: Record<DouyinTaskType, number> = {
  verification_recovery_check: 0,
  user_play: 1,
  monitor_start: 2,
  manual_probe: 3,
  avatar_refresh: 4,
  monitor_reconnect: 5,
  startup_probe: 6,
};

export class DouyinAccessCoordinator {
  private state: DouyinAccessState;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private readonly minimumGapMs: number;
  private readonly automaticBudgetPerHour: number;
  private readonly recoveryBudgetPerHour: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly persistState?: CoordinatorOptions["persistState"];
  private readonly listeners = new Set<(state: DouyinAccessState) => void>();
  private readonly tasks = new Map<string, Promise<unknown>>();
  private readonly cooldowns = new Map<string, number>();
  private readonly pending: QueuedTask[] = [];
  private active = false;
  private activeTask?: QueuedTask;
  private interruptPacing?: () => void;
  private readonly canceledTaskKeys = new Set<string>();
  private stopped = false;
  private lastNavigationStartedAt: number | undefined;
  private automaticStarts: number[] = [];
  private recoveryStarts: number[] = [];

  constructor(options: CoordinatorOptions = {}) {
    const initialState = options.initialState ?? { mode: "normal" };
    this.state = initialState.mode === "recovery_checking"
      ? { mode: "verification_paused", roomId: initialState.roomId, taskType: initialState.taskType, triggeredAt: initialState.triggeredAt, reason: "verification_required" }
      : initialState;
    this.now = options.now ?? Date.now;
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.minimumGapMs = options.minimumGapMs ?? 0;
    this.automaticBudgetPerHour = options.automaticBudgetPerHour ?? Number.POSITIVE_INFINITY;
    this.recoveryBudgetPerHour = options.recoveryBudgetPerHour ?? this.automaticBudgetPerHour;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.persistState = options.persistState;
  }

  submit<T>(task: AccessTask<T>): Promise<T> {
    if (this.stopped) return Promise.reject(new Error("ACCESS_STOPPED"));
    if (this.state.mode !== "normal") return Promise.reject(new Error("ACCESS_VERIFICATION_PAUSED"));
    const key = `${task.type}:${task.roomId}`;
    const existing = this.tasks.get(key);
    if (existing) return existing as Promise<T>;
    if (this.isCoolingDown(task.type, task.roomId)) return Promise.reject(new Error("ACCESS_COOLDOWN"));
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.push({ ...task, key, resolve, reject } as QueuedTask<T>);
      this.pending.sort((left, right) => priority[left.type] - priority[right.type]);
    });
    this.tasks.set(key, promise);
    this.drain();
    if (this.activeTask && this.compareTasks(task, this.activeTask) < 0) this.interruptPacing?.();
    return promise;
  }

  getState(): DouyinAccessState { return structuredClone(this.state); }

  cancelRoom(roomId: string): void {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const task = this.pending[index];
      if (task.roomId !== roomId) continue;
      this.pending.splice(index, 1);
      this.tasks.delete(task.key);
      task.reject(new Error("ACCESS_ROOM_CANCELED"));
    }
    if (this.activeTask?.roomId === roomId && this.interruptPacing) {
      this.canceledTaskKeys.add(this.activeTask.key);
      this.interruptPacing();
    }
  }

  subscribe(listener: (state: DouyinAccessState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async beginRecoveryCheck(check: () => Promise<boolean>): Promise<boolean> {
    if (this.state.mode !== "verification_paused") throw new Error("RECOVERY_NOT_PAUSED");
    const context = this.state;
    this.setState({ mode: "recovery_checking", roomId: context.roomId, taskType: context.taskType, triggeredAt: context.triggeredAt });
    try {
      const clear = await check();
      this.setState(clear
        ? { mode: "recovery_ready", roomId: context.roomId, taskType: context.taskType, triggeredAt: context.triggeredAt }
        : context);
      return clear;
    } catch (error) {
      this.setState(context);
      throw error;
    }
  }

  confirmRecovery(): void {
    if (this.state.mode !== "recovery_ready") throw new Error("RECOVERY_NOT_READY");
    this.setState({ mode: "normal" });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.interruptPacing?.();
    for (const task of this.pending.splice(0)) {
      this.tasks.delete(task.key);
      task.reject(new Error("ACCESS_STOPPED"));
    }
    await Promise.allSettled(this.tasks.values());
  }

  private isCoolingDown(type: DouyinTaskType, roomId: string): boolean {
    if (type !== "manual_probe" && type !== "avatar_refresh") return false;
    const startedAt = this.cooldowns.get(`${type}:${roomId}`);
    return startedAt !== undefined && this.now() - startedAt < this.cooldownMs;
  }

  private drain(): void {
    if (this.active || this.stopped || this.state.mode !== "normal") return;
    this.pending.sort((left, right) => this.compareTasks(left, right));
    const task = this.pending.shift();
    if (!task) return;
    this.active = true;
    this.activeTask = task;
    void this.execute(task).finally(() => {
      this.activeTask = undefined;
      this.active = false;
      this.drain();
    });
  }

  private compareTasks(left: AccessTask<unknown>, right: AccessTask<unknown>): number {
    // A task waiting for an exhausted budget must not block the other pool.
    return this.pacingDelay(left) - this.pacingDelay(right) || priority[left.type] - priority[right.type];
  }

  private async execute(task: QueuedTask): Promise<void> {
    try {
      const delay = this.pacingDelay(task);
      if (delay > 0) {
        let interrupted = false;
        const interruption = new Promise<void>((resolve) => {
          this.interruptPacing = () => { interrupted = true; resolve(); };
        });
        await Promise.race([this.sleep(delay), interruption]);
        this.interruptPacing = undefined;
        if (this.stopped) throw new Error("ACCESS_STOPPED");
        if (this.canceledTaskKeys.delete(task.key)) throw new Error("ACCESS_ROOM_CANCELED");
        if (interrupted) {
          this.pending.push(task);
          this.pending.sort((left, right) => priority[left.type] - priority[right.type]);
          return;
        }
      }
      if (this.stopped) throw new Error("ACCESS_STOPPED");
      if (this.state.mode !== "normal") throw new Error("ACCESS_CANCELED_BY_VERIFICATION");
      const startedAt = this.now();
      this.lastNavigationStartedAt = startedAt;
      if ((task.traffic ?? "interactive") === "automatic") {
        (task.type === "monitor_reconnect" ? this.recoveryStarts : this.automaticStarts).push(startedAt);
      }
      if (task.type === "manual_probe" || task.type === "avatar_refresh") this.cooldowns.set(task.key, startedAt);
      const { value, verificationRequired, protectionReason } = await task.run();
      if (verificationRequired || protectionReason) this.pauseForVerification(task, protectionReason ?? "verification_required");
      this.tasks.delete(task.key);
      task.resolve(value);
    } catch (error) {
      this.tasks.delete(task.key);
      task.reject(error);
    }
  }

  private pacingDelay(task: AccessTask<unknown>): number {
    const now = this.now();
    const hourAgo = now - 3_600_000;
    this.automaticStarts = this.automaticStarts.filter((startedAt) => startedAt > hourAgo);
    this.recoveryStarts = this.recoveryStarts.filter((startedAt) => startedAt > hourAgo);
    const reconnect = task.type === "monitor_reconnect";
    const starts = reconnect ? this.recoveryStarts : this.automaticStarts;
    const budget = reconnect ? this.recoveryBudgetPerHour : this.automaticBudgetPerHour;
    const gapDeadline = this.lastNavigationStartedAt === undefined ? now : this.lastNavigationStartedAt + this.minimumGapMs;
    const budgetDeadline = (task.traffic ?? "interactive") === "automatic" && starts.length >= budget
      ? starts[0] + 3_600_000
      : now;
    return Math.max(0, gapDeadline, budgetDeadline) - now;
  }

  private pauseForVerification(task: QueuedTask, reason: "verification_required" | "suspected_verification"): void {
    this.setState({ mode: "verification_paused", roomId: task.roomId, taskType: task.type, triggeredAt: new Date(this.now()).toISOString(), reason });
    for (const queued of this.pending.splice(0)) {
      this.tasks.delete(queued.key);
      queued.reject(new Error("ACCESS_CANCELED_BY_VERIFICATION"));
    }
  }

  private setState(state: DouyinAccessState): void {
    this.state = state;
    void this.persistState?.(structuredClone(state));
    for (const listener of this.listeners) listener(structuredClone(state));
  }
}
