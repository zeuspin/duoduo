import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RoomStore } from "../../src/main/storage/room-store";

const input = {
  url: "https://live.douyin.com/123456?from=test",
  schedule: { days: [1, 2, 3, 4, 5], ranges: [{ start: "09:00", end: "12:00" }] },
};

describe("RoomStore", () => {
  it("persists normalized rooms across instances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-room-store-"));
    const path = join(dir, "rooms.json");
    const first = new RoomStore(path);
    await first.add(input);

    const second = new RoomStore(path);
    expect((await second.list())[0]).toMatchObject({ roomId: "123456", canonicalUrl: "https://live.douyin.com/123456" });
  });

  it("rejects duplicate rooms and removes rooms atomically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-room-store-"));
    const path = join(dir, "rooms.json");
    const store = new RoomStore(path);
    await store.add(input);
    await expect(store.add(input)).rejects.toThrow("ROOM_EXISTS");
    await store.remove("123456");
    expect(await store.list()).toEqual([]);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual([]);
  });

  it("updates schedules and monitoring without changing identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-room-store-"));
    const store = new RoomStore(join(dir, "rooms.json"));
    await store.add(input);
    await store.update("123456", { ...input, schedule: { days: [0], ranges: [{ start: "20:00", end: "23:00" }] } });
    await store.setMonitoring("123456", true);
    expect((await store.list())[0]).toMatchObject({ roomId: "123456", monitoring: true, schedule: { days: [0] } });
  });
});
