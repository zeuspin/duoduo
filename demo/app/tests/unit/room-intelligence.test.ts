import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "../../src/shared/contracts";
import { audienceScaleLabel, RoomIntelligenceService, type RoomIntelligenceRepository, type StoredLiveSession } from "../../src/main/rooms/room-intelligence";

const NOW = "2026-07-17T12:00:00.000Z";

function serviceFixture(input: {
  roomIds: string[];
  snapshots?: RoomSnapshot[];
  history?: Record<string, RoomSnapshot[]>;
  sessions?: Record<string, StoredLiveSession[]>;
}) {
  const repository: RoomIntelligenceRepository = {
    listRoomIds: async () => input.roomIds,
    listSnapshots: () => input.snapshots ?? [],
    listHistorySince: (roomId) => input.history?.[roomId] ?? [],
    listSessions: (roomId) => input.sessions?.[roomId] ?? [],
  };
  return new RoomIntelligenceService(repository);
}

function endedSession(id: number, roomId: string, firstLiveAt: string, averageViewerCount: number, durationHours = 1): StoredLiveSession {
  const first = Date.parse(firstLiveAt);
  const firstOfflineAt = new Date(first + durationHours * 60 * 60 * 1000).toISOString();
  return { id, roomId, status: "ended", firstLiveAt, lastLiveAt: new Date(Date.parse(firstOfflineAt) - 60_000).toISOString(), firstOfflineAt, averageViewerCount, peakViewerCount: averageViewerCount + 100 };
}

describe("transparent room intelligence", () => {
  it.each([
    [10_000_000, "千万级粉丝"],
    [1_000_000, "百万级粉丝"],
    [100_000, "十万级粉丝"],
    [99_999, undefined],
  ])("uses explicit follower-scale thresholds for %s", (followers, expected) => {
    expect(audienceScaleLabel(followers, NOW)?.text).toBe(expected);
  });

  it("returns no conclusion when metrics are absent", async () => {
    const service = serviceFixture({ roomIds: ["empty"], snapshots: [{ roomId: "empty", status: "offline", checkedAt: NOW }] });
    const [summary] = await service.listSummaries(NOW);
    expect(summary.labels).toEqual([]);
    expect((await service.getDetails("empty", NOW)).allLabels).toEqual([]);
  });

  it("marks recent online performance in the local top quartile only with enough comparable rooms", async () => {
    const roomIds = ["top", "high", "middle", "low", "bottom"];
    const sessions = Object.fromEntries(roomIds.map((roomId, roomIndex) => [roomId, [
      endedSession(roomIndex * 2 + 1, roomId, "2026-07-12T10:00:00.000Z", 1_000 - roomIndex * 200),
      endedSession(roomIndex * 2 + 2, roomId, "2026-07-15T10:00:00.000Z", 1_000 - roomIndex * 200),
    ]]));
    const service = serviceFixture({ roomIds, sessions });

    const summaries = await service.listSummaries(NOW);
    const top = summaries.find((item) => item.roomId === "top")!;
    const high = summaries.find((item) => item.roomId === "high")!;

    expect(top.labels).toContainEqual(expect.objectContaining({ kind: "recent_heat", text: "近期在线靠前", sampleCount: 2, comparisonCount: 5 }));
    expect(top.labels.find((label) => label.kind === "recent_heat")?.explanation).toContain("本地 5 个有数据主播");
    expect(high.labels.some((label) => label.kind === "recent_heat")).toBe(false);
  });

  it("requires two sessions in both windows, 30 percent growth, and 100 absolute viewers", async () => {
    const sessions = {
      rising: [
        endedSession(1, "rising", "2026-07-04T10:00:00.000Z", 1_000),
        endedSession(2, "rising", "2026-07-08T10:00:00.000Z", 1_000),
        endedSession(3, "rising", "2026-07-12T10:00:00.000Z", 1_400),
        endedSession(4, "rising", "2026-07-15T10:00:00.000Z", 1_400),
      ],
    };
    const service = serviceFixture({ roomIds: ["rising"], sessions });
    const [summary] = await service.listSummaries(NOW);
    expect(summary.labels).toContainEqual(expect.objectContaining({ kind: "growth", text: "近期升温 +40%", sampleCount: 4 }));
  });

  it("shows natural-day activity and evidence-based long sessions", async () => {
    const sessions = {
      active: [
        endedSession(1, "active", "2026-07-12T10:00:00.000Z", 100, 2),
        endedSession(2, "active", "2026-07-14T10:00:00.000Z", 100, 3),
        endedSession(3, "active", "2026-07-16T10:00:00.000Z", 100, 4),
      ],
    };
    const service = serviceFixture({ roomIds: ["active"], sessions });
    const details = await service.getDetails("active", NOW);
    expect(details.allLabels).toContainEqual(expect.objectContaining({ kind: "activity", text: "近7日开播3天" }));
    expect(details.allLabels).toContainEqual(expect.objectContaining({ kind: "duration", text: "已观测长播" }));
    expect(details.sessions[0].observedDurationMinutes).toBe(120);
  });

  it("counts activity by the user's local natural day rather than UTC date text", async () => {
    const sessions = {
      localDays: [
        endedSession(1, "localDays", new Date(2026, 6, 13, 0, 30).toISOString(), 100),
        endedSession(2, "localDays", new Date(2026, 6, 13, 9, 0).toISOString(), 100),
        endedSession(3, "localDays", new Date(2026, 6, 14, 9, 0).toISOString(), 100),
      ],
    };
    const service = serviceFixture({ roomIds: ["localDays"], sessions });
    const details = await service.getDetails("localDays", NOW);
    expect(details.allLabels.some((label) => label.kind === "activity")).toBe(false);
  });
});
