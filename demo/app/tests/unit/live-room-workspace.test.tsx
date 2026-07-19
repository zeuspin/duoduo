// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveRoomWorkspace } from "../../src/renderer/components/LiveRoomWorkspace";

const parserSnapshot = { definitions: [{ id: "market-insight", name: "市场观点与情绪提炼", description: "", builtIn: true, createdAt: "2026-07-13T00:00:00.000Z", publishedVersion: { id: 1, parserId: "market-insight", version: 1, state: "published", spec: { name: "市场观点与情绪提炼", description: "", objectives: ["sector_direction"], filters: [], normalization: "suggest", model: "qwen-plus", advancedPrompt: "" }, createdAt: "2026-07-13T00:00:00.000Z", publishedAt: "2026-07-13T00:00:00.000Z" } }], bindings: [], tests: [], llmConfigured: true } as const;
const insight = { id: 9, roomId: "123", parserId: "market-insight", parserVersionId: 1, nature: "explicit", subjectKind: "sector", subjectOriginal: "半导体", direction: "positive", summary: "半导体板块短线偏强", rationale: "放量", conditions: [], evidence: ["半导体今天放量走强"], sourceAsrIds: [8], startedAt: "2026-07-13T04:05:00.000Z", endedAt: "2026-07-13T04:05:05.000Z", confidence: 0.92, alertLevel: "important", createdAt: "2026-07-13T04:05:08.000Z" } as const;

beforeEach(() => Object.assign(window, { duoduo: {
  parsers: { bindRoom: vi.fn().mockResolvedValue({ ...parserSnapshot, bindings: [{ roomId: "123", parserId: "market-insight", parserVersionId: 1, updatedAt: "2026-07-13T04:00:00.000Z" }] }) },
  insights: { list: vi.fn().mockResolvedValue({ items: [insight] }), subscribe: vi.fn(() => () => undefined) },
  asr: { listBefore: vi.fn().mockResolvedValue({ items: [] }) },
  rooms: { setMonitoring: vi.fn() },
} }));
afterEach(cleanup);

describe("LiveRoomWorkspace", () => {
  it("binds an analysis rule without interrupting the visible live transcript", async () => {
    render(<LiveRoomWorkspace roomId="123" liveEvents={[{ roomId: "123", sessionId: "current", segmentId: "1", startMs: 0, endMs: 1, text: "本次实时识别", isFinal: true, occurredAt: "2026-07-13T04:06:00.000Z" }]} runtimeState="monitoring" parsers={parserSnapshot as never} onParsersChange={vi.fn()} />);
    expect(screen.getByText("本次实时识别")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("直播间 123 分析规则"), { target: { value: "market-insight:1" } });
    await waitFor(() => expect(window.duoduo.parsers.bindRoom).toHaveBeenCalledWith("123", "market-insight", 1));
    expect(window.duoduo.rooms.setMonitoring).not.toHaveBeenCalled();
    expect(screen.getByText("本次实时识别")).toBeTruthy();
  });

  it("shows only the current room insights with evidence", async () => {
    render(<LiveRoomWorkspace roomId="123" liveEvents={[]} runtimeState="monitoring" parsers={{ ...parserSnapshot, bindings: [{ roomId: "123", parserId: "market-insight", parserVersionId: 1, updatedAt: "2026-07-13T04:00:00.000Z" }] } as never} onParsersChange={vi.fn()} focusInsightId={9} />);
    expect(await screen.findByText("半导体板块短线偏强")).toBeTruthy();
    expect(window.duoduo.insights.list).toHaveBeenCalledWith({ roomId: "123", limit: 20 });
    expect(screen.getByText(/半导体今天放量走强/)).toBeTruthy();
  });

  it("shows a plain-language reconnecting state", () => {
    render(<LiveRoomWorkspace roomId="123" liveEvents={[]} runtimeState="recovering" parsers={parserSnapshot as never} onParsersChange={vi.fn()} />);
    expect(screen.getByText("正在重新连接")).toBeTruthy();
    expect(screen.queryByText("recovering")).toBeNull();
  });
});
