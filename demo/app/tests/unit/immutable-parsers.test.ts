import { afterEach, describe, expect, it } from "vitest";
import { DuoduoDatabase } from "../../src/main/storage/database";
import type { ParserSpec } from "../../src/shared/contracts";
import { materializeParserPrompt } from "../../src/shared/parser-prompt";

const databases: DuoduoDatabase[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});
const open = () => {
  const database = new DuoduoDatabase(":memory:");
  databases.push(database);
  return database;
};
const spec = (name: string): ParserSpec => ({
  name,
  description: `${name}说明`,
  objectives: ["sector_direction"],
  filters: ["advertising"],
  normalization: "suggest",
  model: "qwen-plus",
  advancedPrompt: `${name}提示词`,
});

describe("immutable parsers", () => {
  it("stores a new parser as a frozen visible-prompt spec", () => {
    const database = open();
    const created = database.parsers.createImmutable({
      schemaVersion: 2,
      name: "完整提示词",
      model: "qwen3.7-plus-2026-05-26",
      prompt: "只输出 JSON。",
    });
    expect(created.spec).toEqual({
      schemaVersion: 2,
      name: "完整提示词",
      model: "qwen3.7-plus-2026-05-26",
      prompt: "只输出 JSON。",
    });
  });

  it("copies a legacy parser into the visible-prompt format without losing rules", () => {
    const database = open();
    const legacy = database.parsers.createImmutable(spec("旧格式"));
    const copied = database.parsers.copyImmutable(legacy.id, {
      schemaVersion: 3,
      name: "旧格式副本",
      prompt: materializeParserPrompt(legacy.spec),
    });
    expect(copied.spec).toMatchObject({ schemaVersion: 3, name: "旧格式副本" });
    expect(materializeParserPrompt(copied.spec)).toBe(
      materializeParserPrompt(legacy.spec),
    );
  });

  it("creates a frozen parser and copies it to a new identity", () => {
    const database = open();
    const created = database.parsers.createImmutable(spec("行业研究"));
    const copied = database.parsers.copyImmutable(created.id, {
      ...created.spec,
      name: "行业研究副本",
    });
    expect(created.id).not.toBe(copied.id);
    const stored = database.parsers.getImmutable(created.id)?.spec;
    expect(stored && !("schemaVersion" in stored) && stored.advancedPrompt).toBe(
      "行业研究提示词",
    );
    expect(copied.spec.name).toBe("行业研究副本");
  });

  it("soft deletes an unused parser but preserves readable history", () => {
    const database = open();
    const parser = database.parsers.createImmutable(spec("待删除"));
    database.parsers.removeImmutable(parser.id);
    expect(
      database.parsers.listImmutable().some((item) => item.id === parser.id),
    ).toBe(false);
    expect(database.parsers.getImmutable(parser.id)).toEqual(
      expect.objectContaining({ id: parser.id, deletedAt: expect.any(String) }),
    );
  });

  it("refuses to delete a parser used by a group and resolves the room parser through its group", async () => {
    const database = open();
    const parser = database.parsers.createImmutable(spec("组级规则"));
    const group = database.groups.list()[0];
    database.groups.setParser(group.id, parser.id);
    await database.rooms.add({
      url: "https://live.douyin.com/900",
      schedule: null,
      groupId: group.id,
    });
    expect(() => database.parsers.removeImmutable(parser.id)).toThrow(
      `PARSER_IN_USE:${group.id}:${group.name}`,
    );
    expect(database.parsers.getForRoom("900")).toEqual(
      expect.objectContaining({
        id: parser.id,
        spec: expect.objectContaining({ name: "组级规则" }),
      }),
    );
  });
});
