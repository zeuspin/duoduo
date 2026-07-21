import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DuoduoDatabase } from "../../src/main/storage/database";
import { DatabaseSync } from "node:sqlite";

const databases: DuoduoDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("DuoduoDatabase", () => {
  it("persists an independent auto-monitor-on-live setting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null });

    expect((await database.rooms.list())[0].autoMonitorOnLive).toBe(false);
    await database.rooms.setAutoMonitorOnLive("123", true);
    expect((await database.rooms.list())[0].autoMonitorOnLive).toBe(true);
  });

  it("persists rooms with an uncertain schedule and migrates legacy JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const legacyPath = join(directory, "rooms.json");
    const now = new Date().toISOString();
    await writeFile(legacyPath, JSON.stringify([{ roomId: "123", canonicalUrl: "https://live.douyin.com/123", schedule: { days: [1], ranges: [{ start: "09:00", end: "10:00" }] }, monitoring: false, createdAt: now, updatedAt: now }]));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.migrateLegacyRooms(legacyPath);
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/456", schedule: null, probeIntervalMinutes: null });
    expect((await database.rooms.list()).map((room) => [room.roomId, room.schedule])).toEqual([
      ["123", { days: [1], ranges: [{ start: "09:00", end: "10:00" }] }],
      ["456", null],
    ]);
  });

  it("deduplicates final ASR and pages older records by cursor", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null, probeIntervalMinutes: null });
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
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null });
    database.snapshots.upsert({ roomId: "123", status: "live", title: "第一次", anchorName: "主播", coverPath: "/covers/123.jpg", viewerCount: 1200, followerCount: 9000, checkedAt: "2026-07-12T01:00:00.000Z" });
    database.snapshots.upsert({ roomId: "123", status: "timeout", checkedAt: "2026-07-12T01:05:00.000Z", error: "PROBE_TIMEOUT" });
    expect(database.snapshots.list()).toEqual([expect.objectContaining({ roomId: "123", status: "timeout", title: "第一次", anchorName: "主播", coverPath: "/covers/123.jpg", viewerCount: 1200, followerCount: 9000, lastReliableStatus: "live", lastReliableStatusAt: "2026-07-12T01:00:00.000Z", metricsObservedAt: "2026-07-12T01:00:00.000Z", checkedAt: "2026-07-12T01:05:00.000Z", error: "PROBE_TIMEOUT" })]);
  });

  it("persists the last non-empty live description", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null });
    database.snapshots.upsert({ roomId: "123", status: "live", liveDescription: "每周日 18:00", checkedAt: "2026-07-18T01:00:00.000Z" });
    database.snapshots.upsert({ roomId: "123", status: "live", checkedAt: "2026-07-18T01:05:00.000Z" });
    expect(database.snapshots.list()[0].liveDescription).toBe("每周日 18:00");
  });

  it("preserves valid room metadata when a verification page is recorded", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null });
    database.snapshots.upsert({ roomId: "123", status: "live", title: "正常直播标题", anchorName: "正常主播", coverPath: "/covers/123.jpg", checkedAt: "2026-07-15T01:00:00.000Z" });
    database.snapshots.upsert({ roomId: "123", status: "verification_required", title: "请完成验证", anchorName: "安全验证", checkedAt: "2026-07-15T01:05:00.000Z", error: "PROBE_VERIFICATION_REQUIRED" });
    expect(database.snapshots.list()).toEqual([expect.objectContaining({ roomId: "123", status: "verification_required", title: "正常直播标题", anchorName: "正常主播", coverPath: "/covers/123.jpg", lastReliableStatus: "live", lastReliableStatusAt: "2026-07-15T01:00:00.000Z", checkedAt: "2026-07-15T01:05:00.000Z", error: "PROBE_VERIFICATION_REQUIRED" })]);
  });

  it("binds the first cached avatar while offline without allowing a normal replacement", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null });
    database.snapshots.upsert({ roomId: "123", status: "offline", checkedAt: "2026-07-17T01:00:00.000Z" });

    expect(database.snapshots.setAvatarIfMissing("123", "/avatars/123.png")).toBe(true);
    expect(database.snapshots.setAvatarIfMissing("123", "/avatars/replacement.png")).toBe(false);
    expect(database.snapshots.list()[0].avatarPath).toBe("/avatars/123.png");
  });

  it("explicitly replaces an avatar independently of the latest live status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null });
    database.snapshots.upsert({ roomId: "123", status: "offline", checkedAt: "2026-07-17T01:00:00.000Z" });
    database.snapshots.setAvatarIfMissing("123", "/avatars/old.png");

    database.snapshots.replaceAvatar("123", "/avatars/manual.png");

    expect(database.snapshots.list()[0].avatarPath).toBe("/avatars/manual.png");
  });

  it("records every observation while keeping missing heat metrics nullable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null });
    database.snapshots.record({ roomId: "123", status: "live", viewerCount: 1200, checkedAt: "2026-07-12T01:00:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "live", checkedAt: "2026-07-12T01:05:00.000Z" });
    const history = database.snapshots.listHistory("123", 10);
    expect(history).toHaveLength(2);
    expect(history.map((item) => item.viewerCount)).toEqual([1200, undefined]);
  });

  it("does not mark an empty metric object as observed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null });

    database.snapshots.record({ roomId: "123", status: "live", metricRaw: {}, metricQuality: "missing", checkedAt: "2026-07-17T01:00:00.000Z" });

    expect(database.snapshots.list()[0].metricsObservedAt).toBeUndefined();
  });

  it("persists bounded metric evidence on the latest snapshot and history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null });
    const metricEvidence = { viewerCount: { raw: "2.3万", source: "accessibility" as const } };

    database.snapshots.record({ roomId: "123", status: "live", viewerCount: 23_000, metricEvidence, metricQuality: "partial", checkedAt: "2026-07-17T01:00:00.000Z" });

    expect(database.snapshots.list()[0].metricEvidence).toEqual(metricEvidence);
    expect(database.snapshots.listHistory("123", 10)[0].metricEvidence).toEqual(metricEvidence);
  });

  it("returns the newest bounded metric history in chronological order", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null });
    for (const [checkedAt, viewerCount] of [
      ["2026-07-01T01:00:00.000Z", 100],
      ["2026-07-16T01:00:00.000Z", 200],
      ["2026-07-17T01:00:00.000Z", 300],
      ["2026-07-17T02:00:00.000Z", 400],
    ] as const) database.snapshots.record({ roomId: "123", status: "live", viewerCount, checkedAt });

    const history = database.snapshots.listHistorySince("123", "2026-07-15T00:00:00.000Z", 2);

    expect(history.map((item) => [item.checkedAt, item.viewerCount])).toEqual([
      ["2026-07-17T01:00:00.000Z", 300],
      ["2026-07-17T02:00:00.000Z", 400],
    ]);
  });

  it("merges a pre-evidence backup by column name without losing historical metrics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-merge-"));
    const importedPath = join(directory, "old.sqlite");
    const old = new DatabaseSync(importedPath);
    old.exec(`
      CREATE TABLE rooms(room_id TEXT PRIMARY KEY,canonical_url TEXT NOT NULL,schedule_json TEXT,probe_interval_minutes INTEGER,monitoring INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE room_snapshots(room_id TEXT PRIMARY KEY,status TEXT NOT NULL,title TEXT,anchor_name TEXT,cover_path TEXT,avatar_path TEXT,viewer_count INTEGER,follower_count INTEGER,total_viewer_count INTEGER,like_count INTEGER,metric_raw_json TEXT,metric_quality TEXT,last_reliable_status TEXT,last_reliable_status_at TEXT,metrics_observed_at TEXT,checked_at TEXT NOT NULL,error TEXT);
      CREATE TABLE room_observations(id INTEGER PRIMARY KEY AUTOINCREMENT,room_id TEXT NOT NULL,status TEXT NOT NULL,viewer_count INTEGER,follower_count INTEGER,total_viewer_count INTEGER,like_count INTEGER,metric_raw_json TEXT,metric_quality TEXT,checked_at TEXT NOT NULL,error TEXT);
      CREATE TABLE room_hourly_aggregates(room_id TEXT NOT NULL,hour_started_at TEXT NOT NULL,sample_count INTEGER NOT NULL,min_viewer_count INTEGER,max_viewer_count INTEGER,average_viewer_count REAL,PRIMARY KEY(room_id,hour_started_at));
      CREATE TABLE live_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,room_id TEXT NOT NULL,status TEXT NOT NULL,previous_offline_at TEXT,first_live_at TEXT NOT NULL,last_live_at TEXT NOT NULL,first_offline_at TEXT,peak_viewer_count INTEGER,average_viewer_count REAL,unknown_since TEXT,unknown_count INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE asr_segments(id INTEGER PRIMARY KEY AUTOINCREMENT,room_id TEXT NOT NULL,session_id TEXT NOT NULL,segment_id TEXT NOT NULL,start_ms INTEGER NOT NULL,end_ms INTEGER NOT NULL,text TEXT NOT NULL,occurred_at TEXT NOT NULL);
      INSERT INTO rooms VALUES('123','https://live.douyin.com/123',NULL,NULL,0,'2026-07-01T00:00:00.000Z','2026-07-01T00:00:00.000Z');
      INSERT INTO room_snapshots VALUES('123','live','旧标题','旧主播',NULL,NULL,1200,100000,NULL,NULL,'{"viewer":"1200"}','partial','live','2026-07-01T01:00:00.000Z','2026-07-01T01:00:00.000Z','2026-07-01T01:00:00.000Z',NULL);
      INSERT INTO room_observations(room_id,status,viewer_count,metric_raw_json,metric_quality,checked_at) VALUES('123','live',1200,'{"viewer":"1200"}','partial','2026-07-01T01:00:00.000Z');
    `);
    old.close();
    const database = new DuoduoDatabase(join(directory, "current.sqlite"));
    databases.push(database);

    expect(() => database.mergeFrom(importedPath)).not.toThrow();
    expect(database.snapshots.list()[0]).toMatchObject({ roomId: "123", viewerCount: 1200, followerCount: 100000 });
    expect(database.snapshots.listHistory("123", 10)[0]).toMatchObject({ viewerCount: 1200, metricQuality: "partial" });
    expect(database.snapshots.listHistory("123", 10)[0].metricEvidence).toBeUndefined();
  });

  it("derives one live session from explicit status transitions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null });
    database.snapshots.record({ roomId: "123", status: "offline", checkedAt: "2026-07-12T00:55:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "live", viewerCount: 100, checkedAt: "2026-07-12T01:00:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "live", viewerCount: 300, checkedAt: "2026-07-12T01:05:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "offline", checkedAt: "2026-07-12T01:10:00.000Z" });
    expect(database.snapshots.listSessions("123")).toEqual([expect.objectContaining({ status: "ended", previousOfflineAt: "2026-07-12T00:55:00.000Z", firstLiveAt: "2026-07-12T01:00:00.000Z", lastLiveAt: "2026-07-12T01:05:00.000Z", firstOfflineAt: "2026-07-12T01:10:00.000Z", peakViewerCount: 300, averageViewerCount: 200 })]);
  });

  it("never ends or downgrades a live session from unavailable checks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-db-"));
    const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
    databases.push(database);
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null });
    database.snapshots.record({ roomId: "123", status: "live", checkedAt: "2026-07-12T01:00:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "timeout", checkedAt: "2026-07-12T01:01:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "page_error", checkedAt: "2026-07-12T01:06:00.000Z" });
    expect(database.snapshots.listSessions("123")[0].status).toBe("live");
    database.snapshots.record({ roomId: "123", status: "login_required", checkedAt: "2026-07-12T01:11:00.000Z" });
    expect(database.snapshots.listSessions("123")[0].status).toBe("live");
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
    await database.rooms.add({ groupId: database.groups.list()[0].id, url: "https://live.douyin.com/123", schedule: null });
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
