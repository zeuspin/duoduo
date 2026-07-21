import { afterEach, describe, expect, it, vi } from "vitest";
import { DuoduoDatabase } from "../../src/main/storage/database";
import { GroupRunService } from "../../src/main/groups/group-run-service";

const databases: DuoduoDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("nine-room group lifecycle", () => {
  it("runs all nine rooms, rejects a tenth, and waits for every room shutdown before releasing the run", async () => {
    const database = new DuoduoDatabase(":memory:");
    databases.push(database);
    const group = database.groups.list()[0];
    for (let index = 0; index < 9; index += 1)
      await database.rooms.add({
        url: `https://live.douyin.com/${700 + index}`,
        schedule: null,
        groupId: group.id,
      });
    await expect(
      database.rooms.add({
        url: "https://live.douyin.com/799",
        schedule: null,
        groupId: group.id,
      }),
    ).rejects.toThrow("GROUP_ROOM_LIMIT_REACHED");
    const scheduled: string[] = [];
    const stopped: string[] = [];
    const service = new GroupRunService(database.groupRuns, {
      startScheduling: async (groupId) => {
        scheduled.push(
          ...(await database.rooms.list())
            .filter((room) => room.groupId === groupId)
            .map((room) => room.roomId),
        );
      },
      cancelRun: vi.fn(),
      stopRooms: async (groupId, progress) => {
        const targets = (await database.rooms.list()).filter(
          (room) => room.groupId === groupId,
        );
        progress?.({ total: targets.length, completed: 0, failedRoomIds: [] });
        for (const room of targets) {
          stopped.push(room.roomId);
          progress?.({
            total: targets.length,
            completed: stopped.length,
            failedRoomIds: [],
          });
        }
        return [];
      },
    });
    await service.start(group.id);
    expect(scheduled).toHaveLength(9);
    const progress = vi.fn();
    await service.stop(group.id, progress);
    expect(stopped).toHaveLength(9);
    expect(progress).toHaveBeenLastCalledWith({
      total: 9,
      completed: 9,
      failedRoomIds: [],
    });
    expect(database.groupRuns.active()).toBeUndefined();
  });
});
