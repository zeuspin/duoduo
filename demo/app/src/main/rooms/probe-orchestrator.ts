export type ProbeSource = "scheduled" | "group_refresh" | "room_refresh";
export interface ProbeTask {
  roomId: string;
  groupId: string;
  source: ProbeSource;
  runId?: string;
}
export type ProbeOutcome<T> =
  | { status: "completed"; value: T }
  | { status: "cooldown"; cooldownUntil: string }
  | { status: "cancelled" }
  | { status: "failed"; error: unknown };

interface Dependencies<T> {
  execute(task: ProbeTask): Promise<T>;
  lastStartedAt(roomId: string): string | undefined;
  recordStartedAt(roomId: string, at: string): void;
  now?: () => number;
  cooldownMs?: number;
  preempt?(task: ProbeTask): void;
}
interface QueueItem<T> {
  task: ProbeTask;
  priority: number;
  sequence: number;
  waiters: Array<(value: ProbeOutcome<T>) => void>;
}

const priorities: Record<ProbeSource, number> = {
  scheduled: 1,
  group_refresh: 2,
  room_refresh: 3,
};

export class ProbeOrchestrator<T = unknown> {
  private readonly queue = new Map<string, QueueItem<T>>();
  private running = false;
  private paused = false;
  private sequence = 0;
  private activeTask?: ProbeTask;
  private preemptRequested = false;
  constructor(private readonly dependencies: Dependencies<T>) {}

  enqueue(task: ProbeTask): Promise<ProbeOutcome<T>> {
    return new Promise((resolve) => {
      const existing = this.queue.get(task.roomId);
      if (existing) {
        existing.waiters.push(resolve);
        if (priorities[task.source] > existing.priority) {
          existing.priority = priorities[task.source];
          existing.task = task;
        }
      } else
        this.queue.set(task.roomId, {
          task,
          priority: priorities[task.source],
          sequence: this.sequence++,
          waiters: [resolve],
        });
      if (
        task.source !== "scheduled" &&
        this.activeTask?.source === "scheduled" &&
        !this.preemptRequested
      ) {
        this.preemptRequested = true;
        this.dependencies.preempt?.(this.activeTask);
      }
      void this.pump();
    });
  }

  cancelRun(runId: string): void {
    for (const [roomId, item] of this.queue)
      if (item.task.runId === runId) {
        this.queue.delete(roomId);
        item.waiters.forEach((resolve) => resolve({ status: "cancelled" }));
      }
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
    void this.pump();
  }
  state(): { running: boolean; queuedRoomIds: string[]; paused: boolean } {
    return {
      running: this.running,
      queuedRoomIds: this.ordered().map((item) => item.task.roomId),
      paused: this.paused,
    };
  }

  private async pump(): Promise<void> {
    if (this.running || this.paused) return;
    const item = this.ordered()[0];
    if (!item) return;
    this.queue.delete(item.task.roomId);
    this.running = true;
    this.activeTask = item.task;
    this.preemptRequested = false;
    try {
      const now = (this.dependencies.now ?? Date.now)();
      const previous = this.dependencies.lastStartedAt(item.task.roomId);
      const cooldown = this.dependencies.cooldownMs ?? 60_000;
      if (previous && now - Date.parse(previous) < cooldown) {
        const outcome: ProbeOutcome<T> = {
          status: "cooldown",
          cooldownUntil: new Date(
            Date.parse(previous) + cooldown,
          ).toISOString(),
        };
        item.waiters.forEach((resolve) => resolve(outcome));
      } else {
        const startedAt = new Date(now).toISOString();
        this.dependencies.recordStartedAt(item.task.roomId, startedAt);
        const value = await this.dependencies.execute(item.task);
        const outcome: ProbeOutcome<T> = { status: "completed", value };
        item.waiters.forEach((resolve) => resolve(outcome));
      }
    } catch (error) {
      item.waiters.forEach((resolve) => resolve({ status: "failed", error }));
    } finally {
      this.running = false;
      this.activeTask = undefined;
      this.preemptRequested = false;
      void this.pump();
    }
  }

  private ordered(): QueueItem<T>[] {
    return [...this.queue.values()].sort(
      (a, b) => b.priority - a.priority || a.sequence - b.sequence,
    );
  }
}
