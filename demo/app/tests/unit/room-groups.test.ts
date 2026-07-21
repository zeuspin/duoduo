import { afterEach, describe, expect, it } from "vitest";
import { DuoduoDatabase } from "../../src/main/storage/database";

const databases: DuoduoDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
const open = () => {
  const database = new DuoduoDatabase(":memory:");
  databases.push(database);
  return database;
};
const addRoom = (database: DuoduoDatabase, id: number, groupId?: string) =>
  database.rooms.add({
    url: `https://live.douyin.com/${id}`,
    schedule: null,
    probeIntervalMinutes: null,
    groupId: groupId ?? database.groups.list()[0].id,
  });

describe("room groups", () => {
  it.each([
    [0, [0]],
    [1, [1]],
    [9, [9]],
    [10, [9, 1]],
    [19, [9, 9, 1]],
  ] as const)(
    "migrates %i legacy rooms into bounded groups",
    (count, expected) => {
      const database = open();
      const initialGroupId = database.groups.list()[0].id;
      for (let index = 0; index < count; index += 1)
        database.rooms.insertExisting({
          roomId: String(800 + index),
          canonicalUrl: `https://live.douyin.com/${800 + index}`,
          schedule: null,
          probeIntervalMinutes: null,
          monitoring: true,
          autoMonitorOnLive: false,
          groupId: initialGroupId,
          positionInGroup: 0,
          createdAt: new Date(index).toISOString(),
          updatedAt: new Date(index).toISOString(),
        });
      database.groups.migrateExistingRooms(true);
      expect(database.groups.list().map((group) => group.roomCount)).toEqual(
        expected,
      );
    },
  );
  it("creates a stopped default group and assigns new rooms to it", async () => {
    const database = open();
    const [group] = database.groups.list();
    expect(group).toEqual(
      expect.objectContaining({
        name: "分组 1",
        roomCount: 0,
        parserId: null,
      }),
    );
    expect((await addRoom(database, 100)).groupId).toBe(group.id);
    expect(database.groups.list()[0].roomCount).toBe(1);
  });

  it("moves a room atomically and preserves group ordering", async () => {
    const database = open();
    const source = database.groups.list()[0];
    const target = database.groups.create("行业研究");
    await addRoom(database, 101);
    await addRoom(database, 102);
    database.groups.moveRoom("102", target.id);
    expect(
      (await database.rooms.list()).map(
        ({ roomId, groupId, positionInGroup }) => ({
          roomId,
          groupId,
          positionInGroup,
        }),
      ),
    ).toEqual([
      { roomId: "101", groupId: source.id, positionInGroup: 0 },
      { roomId: "102", groupId: target.id, positionInGroup: 0 },
    ]);
  });

  it("creates a group with its initial parser in one repository operation", () => {
    const database = open();
    const parser = database.parsers.createImmutable({
      name: "行业解析",
      description: "",
      objectives: ["sector_direction"],
      filters: [],
      normalization: "suggest",
      model: "qwen-plus",
      advancedPrompt: "",
    });
    expect(database.groups.create("行业研究", parser.id).parserId).toBe(
      parser.id,
    );
    expect(() => database.groups.create("错误解析器", "missing")).toThrow(
      "PARSER_NOT_FOUND",
    );
  });

  it("enforces the nine-room limit in the repository", async () => {
    const database = open();
    const source = database.groups.list()[0];
    const target = database.groups.create("已满分组");
    for (let id = 200; id < 209; id++) await addRoom(database, id, target.id);
    await addRoom(database, 209, source.id);
    expect(() => database.groups.moveRoom("209", target.id)).toThrow(
      "GROUP_ROOM_LIMIT_REACHED",
    );
    expect(database.groups.get(target.id)?.roomCount).toBe(9);
    expect(
      (await database.rooms.list()).find((room) => room.roomId === "209")
        ?.groupId,
    ).toBe(source.id);
  });

  it("only removes empty groups and always keeps one group", async () => {
    const database = open();
    const defaultGroup = database.groups.list()[0];
    const extra = database.groups.create("临时组");
    await addRoom(database, 300);
    expect(() => database.groups.remove(defaultGroup.id)).toThrow(
      "GROUP_NOT_EMPTY",
    );
    database.groups.remove(extra.id);
    expect(() => database.groups.remove(defaultGroup.id)).toThrow(
      "GROUP_NOT_EMPTY",
    );
    await database.rooms.remove("300");
    expect(() => database.groups.remove(defaultGroup.id)).toThrow(
      "LAST_GROUP_REQUIRED",
    );
  });

  it("splits legacy rooms into groups of at most nine", () => {
    const database = open();
    const initialGroupId = database.groups.list()[0].id;
    for (let id = 400; id < 419; id++)
      database.rooms.insertExisting({
        roomId: String(id),
        canonicalUrl: `https://live.douyin.com/${id}`,
        schedule: null,
        probeIntervalMinutes: null,
        monitoring: true,
        autoMonitorOnLive: false,
        groupId: initialGroupId,
        positionInGroup: 0,
        createdAt: new Date(id).toISOString(),
        updatedAt: new Date(id).toISOString(),
      });
    database.groups.migrateExistingRooms(true);
    expect(
      database.groups.list().map((group) => [group.name, group.roomCount]),
    ).toEqual([
      ["分组 1", 9],
      ["分组 2", 9],
      ["分组 3", 1],
    ]);
  });

  it("locks membership, parser changes, and deletion for the running group", async () => {
    const database = open();
    const running = database.groups.list()[0];
    const stopped = database.groups.create("停止组");
    await addRoom(database, 500, running.id);
    database.groupRuns.start(running.id);
    expect(() => database.groups.moveRoom("500", stopped.id)).toThrow(
      "RUNNING_GROUP_LOCKED",
    );
    expect(() => database.groups.setParser(running.id, null)).toThrow(
      "RUNNING_GROUP_LOCKED",
    );
    expect(() => database.groups.remove(running.id)).toThrow(
      "RUNNING_GROUP_LOCKED",
    );
    await expect(addRoom(database, 501, running.id)).rejects.toThrow(
      "RUNNING_GROUP_LOCKED",
    );
    await expect(database.rooms.remove("500")).rejects.toThrow(
      "RUNNING_GROUP_LOCKED",
    );
  });
});
