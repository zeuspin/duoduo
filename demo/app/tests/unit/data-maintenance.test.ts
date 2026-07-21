import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DuoduoDatabase } from "../../src/main/storage/database";

const databases: DuoduoDatabase[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "duoduo-maintenance-"));
  const database = new DuoduoDatabase(join(directory, "duoduo.sqlite"));
  databases.push(database);
  await database.rooms.add({
    groupId: database.groups.list()[0].id,
    url: "https://live.douyin.com/123",
    schedule: null,
  });
  return database;
}

describe("DataMaintenance", () => {
  it("aggregates observations before deleting them", async () => {
    const database = await setup();
    database.snapshots.record({ roomId: "123", status: "live", viewerCount: 100, checkedAt: "2026-01-01T01:05:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "live", viewerCount: 300, checkedAt: "2026-01-01T01:45:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "live", viewerCount: 500, checkedAt: "2026-07-01T01:00:00.000Z" });
    const preview = database.maintenance.previewCleanup({ category: "observations", before: "2026-02-01T00:00:00.000Z" });
    expect(preview.count).toBe(2);
    expect(database.maintenance.executeCleanup({ category: "observations", before: "2026-02-01T00:00:00.000Z" }, preview.token)).toBe(2);
    expect(database.snapshots.listHistory("123", 10)).toHaveLength(1);
    expect(database.maintenance.listAggregates("123")).toEqual([expect.objectContaining({ sampleCount: 2, minViewerCount: 100, maxViewerCount: 300, averageViewerCount: 200 })]);
  });

  it("rejects a stale cleanup preview token without deleting data", async () => {
    const database = await setup();
    database.snapshots.record({ roomId: "123", status: "offline", checkedAt: "2026-01-01T01:05:00.000Z" });
    expect(() => database.maintenance.executeCleanup({ category: "observations", before: "2026-02-01T00:00:00.000Z" }, "wrong")).toThrow("CLEANUP_PREVIEW_MISMATCH");
    expect(database.snapshots.listHistory("123", 10)).toHaveLength(1);
  });

  it("applies automatic retention cutoffs without deleting sessions", async () => {
    const database = await setup();
    database.snapshots.record({ roomId: "123", status: "live", checkedAt: "2026-01-01T01:05:00.000Z" });
    database.snapshots.record({ roomId: "123", status: "offline", checkedAt: "2026-01-01T02:05:00.000Z" });
    database.maintenance.runAutomaticRetention({ observationDays: 30, aggregateDays: 365, asrDays: 90, logDays: 30 }, new Date("2026-07-01T00:00:00.000Z"));
    expect(database.snapshots.listHistory("123", 10)).toHaveLength(0);
    expect(database.snapshots.listSessions("123")).toHaveLength(1);
    expect(database.maintenance.listAggregates("123")).toHaveLength(2);
  });
});
