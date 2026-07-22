import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DuoduoDatabase } from "../../src/main/storage/database";

const parserSpec = (name: string) =>
  JSON.stringify({
    name,
    description: name,
    objectives: ["sector_direction"],
    filters: [],
    normalization: "suggest",
    model: "qwen-plus",
    advancedPrompt: "",
  });

describe("group migration", () => {
  it("splits 19 legacy rooms, clears monitoring and legacy analyzers, and never infers group parsers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-group-migration-"));
    const path = join(directory, "duoduo.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE rooms(room_id TEXT PRIMARY KEY,canonical_url TEXT NOT NULL,schedule_json TEXT,monitoring INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE parser_definitions(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,built_in INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE parser_versions(id INTEGER PRIMARY KEY AUTOINCREMENT,parser_id TEXT NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL,spec_json TEXT NOT NULL,created_at TEXT NOT NULL,published_at TEXT);
      CREATE TABLE room_parser_bindings(room_id TEXT PRIMARY KEY,parser_id TEXT NOT NULL,parser_version_id INTEGER NOT NULL,updated_at TEXT NOT NULL);
    `);
    const now = "2026-07-20T00:00:00.000Z";
    for (const [id, name] of [
      ["a", "解析器 A"],
      ["b", "解析器 B"],
    ] as const) {
      legacy
        .prepare("INSERT INTO parser_definitions VALUES(?,?,?,?,?)")
        .run(id, name, name, 0, now);
      legacy
        .prepare(
          "INSERT INTO parser_versions(parser_id,version,state,spec_json,created_at,published_at) VALUES(?,1,'published',?,?,?)",
        )
        .run(id, parserSpec(name), now, now);
    }
    for (let index = 0; index < 19; index += 1) {
      const roomId = String(100 + index);
      legacy
        .prepare("INSERT INTO rooms VALUES(?,?,NULL,1,?,?)")
        .run(
          roomId,
          `https://live.douyin.com/${roomId}`,
          new Date(index).toISOString(),
          now,
        );
      const parserId =
        index < 9 ? "a" : index === 18 ? "b" : index === 9 ? "a" : "b";
      const versionId = parserId === "a" ? 1 : 2;
      legacy
        .prepare("INSERT INTO room_parser_bindings VALUES(?,?,?,?)")
        .run(roomId, parserId, versionId, now);
    }
    legacy.close();

    const database = new DuoduoDatabase(path);
    try {
      const groups = database.groups.list();
      expect(groups.map((group) => group.roomCount)).toEqual([9, 9, 1]);
      expect(groups.map((group) => group.parserId)).toEqual([null, null, null]);
      expect(
        (await database.rooms.list()).every(
          (room) => !room.monitoring && Boolean(room.groupId),
        ),
      ).toBe(true);
      expect(
        database.parsers.listImmutable().map((parser) => parser.id),
      ).toEqual(["market-insight"]);
      expect(database.parsers.getForRoom("100")).toBeUndefined();
      expect(database.parsers.getForRoom("109")).toBeUndefined();
    } finally {
      database.close();
    }
  });
});
