import { afterEach, describe, expect, it, vi } from "vitest";
import { DuoduoDatabase } from "../../src/main/storage/database";
import { GroupRunService } from "../../src/main/groups/group-run-service";

const databases: DuoduoDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
const open = () => {
  const database = new DuoduoDatabase(":memory:");
  databases.push(database);
  return database;
};

describe("GroupRunService", () => {
  it("allows only one active group run", async () => {
    const database = open();
    const first = database.groups.list()[0];
    const second = database.groups.create("第二组");
    const service = new GroupRunService(database.groupRuns, {
      startScheduling: vi.fn(),
      cancelRun: vi.fn(),
      stopRooms: vi.fn().mockResolvedValue([]),
    });
    await service.start(first.id);
    await expect(service.start(second.id)).rejects.toThrow(
      "ANOTHER_GROUP_RUNNING",
    );
  });

  it("stops scheduling and releases the run only after rooms close", async () => {
    const database = open();
    const group = database.groups.list()[0];
    const dependencies = {
      startScheduling: vi.fn(),
      cancelRun: vi.fn(),
      stopRooms: vi.fn().mockResolvedValue([]),
    };
    const service = new GroupRunService(database.groupRuns, dependencies);
    const run = await service.start(group.id);
    await service.stop(group.id);
    expect(dependencies.cancelRun).toHaveBeenCalledWith(run.id);
    expect(dependencies.stopRooms).toHaveBeenCalledWith(group.id);
    expect(database.groupRuns.active()).toBeUndefined();
  });

  it("retains the active slot after a stop failure and supports retry", async () => {
    const database = open();
    const group = database.groups.list()[0];
    const stopRooms = vi
      .fn()
      .mockResolvedValueOnce(["room-1"])
      .mockResolvedValueOnce([]);
    const service = new GroupRunService(database.groupRuns, {
      startScheduling: vi.fn(),
      cancelRun: vi.fn(),
      stopRooms,
    });
    await service.start(group.id);
    await expect(service.stop(group.id)).rejects.toThrow("GROUP_STOP_FAILED");
    expect(database.groupRuns.active()?.status).toBe("stop_failed");
    await service.retryStop(group.id);
    expect(database.groupRuns.active()).toBeUndefined();
  });

  it("marks stale active runs interrupted on startup", () => {
    const database = open();
    const group = database.groups.list()[0];
    database.groupRuns.start(group.id);
    expect(database.groupRuns.interruptOnStartup()).toBe(1);
    expect(database.groupRuns.active()).toBeUndefined();
  });

  it("cancels partially-created schedules when group startup fails", async () => {
    const database = open();
    const group = database.groups.list()[0];
    const cancelRun = vi.fn();
    const service = new GroupRunService(database.groupRuns, {
      startScheduling: vi.fn().mockRejectedValue(new Error("schedule failed")),
      cancelRun,
      stopRooms: vi.fn().mockResolvedValue([]),
    });
    await expect(service.start(group.id)).rejects.toThrow("schedule failed");
    expect(cancelRun).toHaveBeenCalledWith(expect.any(String));
    expect(database.groupRuns.active()).toBeUndefined();
  });

  it("retains the active slot when cancelling scheduled work fails", async () => {
    const database = open();
    const group = database.groups.list()[0];
    const service = new GroupRunService(database.groupRuns, {
      startScheduling: vi.fn(),
      cancelRun: vi.fn().mockRejectedValue(new Error("cancel failed")),
      stopRooms: vi.fn().mockResolvedValue([]),
    });
    await service.start(group.id);
    await expect(service.stop(group.id)).rejects.toThrow("GROUP_STOP_FAILED");
    expect(database.groupRuns.active()).toEqual(
      expect.objectContaining({
        status: "stop_failed",
        error: "cancel failed",
      }),
    );
  });
});
