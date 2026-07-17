// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomIntelligence, RoomIntelligenceSummary } from "../../src/shared/contracts";
import { RoomIntelligenceBadges, RoomIntelligenceDrawer } from "../../src/renderer/components/RoomIntelligence";

afterEach(cleanup);

const generatedAt = "2026-07-17T12:00:00.000Z";
const labels = [
  { kind: "audience_scale" as const, text: "百万级粉丝", explanation: "最近一次采集到 1,200,000 名关注者；标签仅按公开阈值划分。", observedAt: generatedAt, sampleCount: 1 },
  { kind: "recent_heat" as const, text: "近期在线靠前", explanation: "最近 7 天 3 场直播，在本地 8 个有数据主播中位于前 25%。", observedAt: generatedAt, sampleCount: 3, comparisonCount: 8 },
];

const summary: RoomIntelligenceSummary = {
  roomId: "123",
  generatedAt,
  currentMetrics: { viewerCount: 2_345, followerCount: 1_200_000, observedAt: generatedAt, quality: "partial" },
  labels,
};

describe("transparent room intelligence UI", () => {
  it("shows compact metrics and evidence labels on the room card", () => {
    const onOpen = vi.fn();
    render(<RoomIntelligenceBadges summary={summary} status="live" onOpen={onOpen} />);
    expect(screen.getByText("当前在线 2,345")).toBeTruthy();
    expect(screen.queryByText("关注 1,200,000")).toBeNull();
    expect(screen.getByRole("button", { name: /百万级粉丝/ }).getAttribute("title")).toContain("1 个样本");
    fireEvent.click(screen.getByRole("button", { name: /近期在线靠前/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("explains every conclusion and distinguishes observations from estimates", () => {
    const details: RoomIntelligence = {
      ...summary,
      allLabels: labels,
      sevenDay: { days: 7, sampleCount: 3, sessionCount: 2, averageViewerCount: 2_000, peakViewerCount: 3_000, points: [] },
      thirtyDay: { days: 30, sampleCount: 10, sessionCount: 5, averageViewerCount: 1_800, peakViewerCount: 3_200, points: [] },
      sessions: [{ id: 1, status: "ended", previousOfflineAt: "2026-07-16T09:30:00.000Z", firstLiveAt: "2026-07-16T10:00:00.000Z", lastLiveAt: "2026-07-16T11:59:00.000Z", firstOfflineAt: "2026-07-16T12:00:00.000Z", observedDurationMinutes: 120, averageViewerCount: 2_000, peakViewerCount: 3_000 }],
    };
    const onClose = vi.fn();
    render(<RoomIntelligenceDrawer roomName="测试主播" details={details} onClose={onClose} />);
    const drawer = screen.getByRole("dialog", { name: "测试主播数据详情" });
    expect(within(drawer).getByText("标签依据")).toBeTruthy();
    expect(within(drawer).getByText(/本地 8 个有数据主播/)).toBeTruthy();
    expect(within(drawer).getByText(/数据质量：部分指标/)).toBeTruthy();
    expect(within(drawer).getByText("近 7 天")).toBeTruthy();
    expect(within(drawer).getByText(/观测时长 2小时/)).toBeTruthy();
    expect(within(drawer).getByText(/开播证据.*离线.*直播/)).toBeTruthy();
    expect(within(drawer).getByText(/停播证据.*直播.*离线/)).toBeTruthy();
    expect(within(drawer).getByText(/不等同于平台完整直播时长/)).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
