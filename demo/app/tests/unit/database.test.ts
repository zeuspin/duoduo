import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DuoduoDatabase } from "../../src/main/storage/database";

const databases: DuoduoDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("DuoduoDatabase", () => {
  it("persists rooms with an uncertain schedule and migrates legacy JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const legacyPath = join(directory, "rooms.json");
    const now = new Date().toISOString();
    await writeFile(legacyPath, JSON.stringify([{ roomId: "123", canonicalUrl: "https://live.douyin.com/123", schedule: { days: [1], ranges: [{ start: "09:00", end: "10:00" }] }, monitoring: false, createdAt: now, updatedAt: now }]));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.migrateLegacyRooms(legacyPath);
    await database.rooms.add({ url: "https://live.douyin.com/456", schedule: null, probeIntervalMinutes: null });
    expect((await database.rooms.list()).map((room) => [room.roomId, room.schedule])).toEqual([
      ["123", { days: [1], ranges: [{ start: "09:00", end: "10:00" }] }],
      ["456", null],
    ]);
  });

  it("deduplicates final ASR and pages older records by cursor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ url: "https://live.douyin.com/123", schedule: null, probeIntervalMinutes: null });
    for (let index = 0; index < 4; index += 1) {
      database.asr.insert({ roomId: "123", sessionId: "session", segmentId: `segment-${index}`, startMs: index * 1000, endMs: index * 1000 + 500, text: `文本 ${index}`, isFinal: true, occurredAt: `2026-07-12T00:00:0${index}.000Z` });
    }
    database.asr.insert({ roomId: "123", sessionId: "session", segmentId: "segment-3", startMs: 3000, endMs: 3500, text: "重复", isFinal: true, occurredAt: "2026-07-12T00:00:03.000Z" });
    const latest = database.asr.listBefore("123", { limit: 2 });
    const older = database.asr.listBefore("123", { limit: 2, beforeId: latest.nextCursor! });
    expect(latest.items.map((item) => item.text)).toEqual(["文本 2", "文本 3"]);
    expect(older.items.map((item) => item.text)).toEqual(["文本 0", "文本 1"]);
    expect(latest.items[1].occurredAt).toBe("2026-07-12T00:00:03.000Z");
  });

  it("keeps one latest room snapshot and preserves the last good cover", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ url: "https://live.douyin.com/123", schedule: null });
    database.snapshots.upsert({ roomId: "123", status: "live", title: "第一次", anchorName: "主播", coverPath: "/covers/123.jpg", checkedAt: "2026-07-12T01:00:00.000Z" });
    database.snapshots.upsert({ roomId: "123", status: "timeout", checkedAt: "2026-07-12T01:05:00.000Z", error: "PROBE_TIMEOUT" });
    expect(database.snapshots.list()).toEqual([{ roomId: "123", status: "timeout", title: "第一次", anchorName: "主播", coverPath: "/covers/123.jpg", checkedAt: "2026-07-12T01:05:00.000Z", error: "PROBE_TIMEOUT" }]);
  });

  it("records every observation while keeping missing heat metrics nullable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ url: "https://live.douyin.com/123", schedule: null });
    database.snapshots.record({ roomId: "123", status: "live", viewerCount: 1200, checkedAt: "2026-07-12T01:00:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "live", checkedAt: "2026-07-12T01:05:00.000Z" });
    const history = database.snapshots.listHistory("123", 10);
    expect(history).toHaveLength(2);
    expect(history.map((item) => item.viewerCount)).toEqual([1200, undefined]);
  });

  it("derives one live session from explicit status transitions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ url: "https://live.douyin.com/123", schedule: null });
    database.snapshots.record({ roomId: "123", status: "offline", checkedAt: "2026-07-12T00:55:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "live", viewerCount: 100, checkedAt: "2026-07-12T01:00:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "live", viewerCount: 300, checkedAt: "2026-07-12T01:05:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "offline", checkedAt: "2026-07-12T01:10:00.000Z" });
    expect(database.snapshots.listSessions("123")).toEqual([expect.objectContaining({ status: "ended", previousOfflineAt: "2026-07-12T00:55:00.000Z", firstLiveAt: "2026-07-12T01:00:00.000Z", lastLiveAt: "2026-07-12T01:05:00.000Z", firstOfflineAt: "2026-07-12T01:10:00.000Z", peakViewerCount: 300, averageViewerCount: 200 })]);
  });

  it("marks a live session pending only after three unknown checks spanning ten minutes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ url: "https://live.douyin.com/123", schedule: null });
    database.snapshots.record({ roomId: "123", status: "live", checkedAt: "2026-07-12T01:00:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "timeout", checkedAt: "2026-07-12T01:01:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "page_error", checkedAt: "2026-07-12T01:06:00.000Z" });
    expect(database.snapshots.listSessions("123")[0].status).toBe("live");
    database.snapshots.record({ roomId: "123", status: "login_required", checkedAt: "2026-07-12T01:11:00.000Z" });
    expect(database.snapshots.listSessions("123")[0].status).toBe("end_pending");
  });

  it("initializes the built-in parser and publishes immutable versions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    const initial = database.parsers.list();
    expect(initial[0].id).toBe("market-insight");
    expect(initial[0].publishedVersion?.version).toBe(1);
    const draft = database.parsers.createDraft("market-insight");
    expect(draft.state).toBe("draft");
    expect(() => database.parsers.createDraft("market-insight")).toThrow("PARSER_DRAFT_EXISTS");
    const published = database.parsers.publish("market-insight", draft.id);
    expect(published.version).toBe(2);
    expect(database.parsers.list()[0].draftVersion).toBeUndefined();
    expect(() => database.parsers.updateDraft(published.id, published.spec)).toThrow("PARSER_VERSION_NOT_DRAFT");
  });

  it("binds at most one published parser per room and keeps formal insights separate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ url: "https://live.douyin.com/123", schedule: null });
    const parser = database.parsers.list()[0];
    const binding = database.parsers.bindRoom("123", parser.id, parser.publishedVersion!.id);
    expect(binding!.parserId).toBe("market-insight");
    const insight = database.insights.insert({ roomId: "123", parserId: parser.id, parserVersionId: parser.publishedVersion!.id, nature: "explicit", subjectKind: "market", subjectOriginal: "大盘", direction: "cautious", summary: "市场处于修复阶段", rationale: "量能未放大", conditions: [], evidence: ["现在市场情绪只能算修复"], sourceAsrIds: [1], startedAt: "2026-07-13T02:30:00.000Z", endedAt: "2026-07-13T02:30:10.000Z", confidence: 0.95, alertLevel: "important", createdAt: "2026-07-13T02:30:12.000Z" });
    expect(database.insights.list({ roomId: "123", limit: 20 }).items[0].id).toBe(insight.id);
    database.parsers.bindRoom("123", null, null);
    expect(database.parsers.getBinding("123")).toBeUndefined();
    expect(database.insights.list({ roomId: "123", limit: 20 }).items).toHaveLength(1);
  });
});
