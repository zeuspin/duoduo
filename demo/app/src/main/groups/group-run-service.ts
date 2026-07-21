import type { GroupRun } from "../../shared/contracts";
import type { GroupRunRepository } from "./group-run-repository";

export interface GroupRunDependencies {
  startScheduling(groupId: string, runId: string): void | Promise<void>;
  cancelRun(runId: string): void | Promise<void>;
  stopRooms(
    groupId: string,
    onProgress?: (progress: {
      total: number;
      completed: number;
      failedRoomIds: string[];
    }) => void,
  ): Promise<string[]>;
}

export class GroupRunService {
  constructor(
    private readonly repository: GroupRunRepository,
    private readonly dependencies: GroupRunDependencies,
  ) {}

  async start(groupId: string): Promise<GroupRun> {
    const run = this.repository.start(groupId);
    try {
      await this.dependencies.startScheduling(groupId, run.id);
      return this.repository.markRunning(run.id);
    } catch (error) {
      await Promise.resolve(this.dependencies.cancelRun(run.id)).catch(
        () => undefined,
      );
      this.repository.failStart(run.id, message(error));
      throw error;
    }
  }

  async stop(
    groupId: string,
    onProgress?: (progress: {
      total: number;
      completed: number;
      failedRoomIds: string[];
    }) => void,
  ): Promise<GroupRun> {
    const run = this.requireGroup(groupId);
    this.repository.requestStop(run.id);
    let failed: string[];
    try {
      await this.dependencies.cancelRun(run.id);
      failed = onProgress
        ? await this.dependencies.stopRooms(groupId, onProgress)
        : await this.dependencies.stopRooms(groupId);
    } catch (error) {
      this.repository.failStop(run.id, message(error));
      throw new Error("GROUP_STOP_FAILED", { cause: error });
    }
    if (failed.length) {
      this.repository.failStop(run.id, failed.join(","));
      throw new Error("GROUP_STOP_FAILED");
    }
    return this.repository.finishStop(run.id);
  }

  retryStop(
    groupId: string,
    onProgress?: (progress: {
      total: number;
      completed: number;
      failedRoomIds: string[];
    }) => void,
  ): Promise<GroupRun> {
    const run = this.requireGroup(groupId);
    if (run.status !== "stop_failed")
      return Promise.reject(new Error("GROUP_RUN_INVALID_TRANSITION"));
    return this.stop(groupId, onProgress);
  }
  active(): GroupRun | undefined {
    return this.repository.active();
  }

  private requireGroup(groupId: string): GroupRun {
    const run = this.repository.active();
    if (!run || run.groupId !== groupId) throw new Error("GROUP_NOT_RUNNING");
    return run;
  }
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
