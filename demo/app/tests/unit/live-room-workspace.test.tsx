// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveRoomWorkspace } from "../../src/renderer/components/LiveRoomWorkspace";

const insight = {
  id: 9,
  roomId: "123",
  parserId: "market-insight",
  parserVersionId: 1,
  nature: "explicit",
  subjectKind: "sector",
  subjectOriginal: "半导体",
  direction: "positive",
  summary: "半导体板块短线偏强",
  rationale: "放量",
  conditions: [],
  evidence: ["半导体今天放量走强"],
  sourceAsrIds: [8],
  startedAt: "2026-07-13T04:05:00.000Z",
  endedAt: "2026-07-13T04:05:05.000Z",
  confidence: 0.92,
  alertLevel: "important",
  createdAt: "2026-07-13T04:05:08.000Z",
} as const;
beforeEach(() =>
  Object.assign(window, {
    duoduo: {
      insights: {
        list: vi.fn().mockResolvedValue({ items: [insight] }),
        subscribe: vi.fn(() => () => undefined),
      },
      asr: { listBefore: vi.fn().mockResolvedValue({ items: [] }) },
    },
  }),
);
afterEach(cleanup);

describe("LiveRoomWorkspace", () => {
  it("shows the group-owned parser state without a room-level selector", () => {
    render(
      <LiveRoomWorkspace
        roomId="123"
        liveEvents={[
          {
            roomId: "123",
            sessionId: "current",
            segmentId: "1",
            startMs: 0,
            endMs: 1,
            text: "本次实时识别",
            isFinal: true,
            occurredAt: "2026-07-13T04:06:00.000Z",
          },
        ]}
        runtimeState="monitoring"
        analysisEnabled
        llmConfigured
      />,
    );
    expect(screen.getByText("本次实时识别")).toBeTruthy();
    expect(screen.queryByText("使用当前分组解析器")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("shows only the current room insights with evidence", async () => {
    render(
      <LiveRoomWorkspace
        roomId="123"
        liveEvents={[]}
        runtimeState="monitoring"
        analysisEnabled
        llmConfigured
        focusInsightId={9}
      />,
    );
    expect(await screen.findByText("半导体板块短线偏强")).toBeTruthy();
    expect(window.duoduo.insights.list).toHaveBeenCalledWith({
      roomId: "123",
      limit: 20,
    });
    expect(screen.getByText(/半导体今天放量走强/)).toBeTruthy();
  });

  it("shows a plain-language reconnecting state", () => {
    render(
      <LiveRoomWorkspace
        roomId="123"
        liveEvents={[]}
        runtimeState="recovering"
        analysisEnabled={false}
        llmConfigured
      />,
    );
    expect(screen.getByText("正在重新连接")).toBeTruthy();
    expect(screen.queryByText("recovering")).toBeNull();
  });
});
