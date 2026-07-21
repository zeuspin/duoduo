// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InsightNotificationRail } from "../../src/renderer/components/InsightNotificationRail";

const item = (id: number) => ({ id, roomId: id % 2 ? "123" : "456", parserId: "market-insight", parserVersionId: 1, nature: "explicit" as const, subjectKind: "sector" as const, subjectOriginal: "科技", direction: "positive" as const, summary: `观点 ${id}`, rationale: "", conditions: [], evidence: ["科技走强"], sourceAsrIds: [id], startedAt: "2026-07-13T04:05:00.000Z", endedAt: "2026-07-13T04:05:05.000Z", confidence: 0.9, alertLevel: id === 2 ? "important" as const : "normal" as const, createdAt: "2026-07-13T04:05:08.000Z" });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("InsightNotificationRail", () => {
  it("opens the correct room insight and supports manual dismissal", () => {
    const open = vi.fn(); const dismiss = vi.fn();
    render(<InsightNotificationRail items={[item(1), item(2)]} timeoutSeconds={null} roomName={(roomId) => `房间 ${roomId}`} onOpen={open} onDismiss={dismiss} />);
    fireEvent.click(screen.getByText("观点 2"));
    expect(open).toHaveBeenCalledWith(item(2));
    fireEvent.click(screen.getByRole("button", { name: "关闭观点 1" }));
    expect(dismiss).toHaveBeenCalledWith(1);
  });

  it("auto dismisses at the global timeout and never schedules in persistent mode", () => {
    vi.useFakeTimers(); const dismiss = vi.fn();
    const { rerender } = render(<InsightNotificationRail items={[item(1)]} timeoutSeconds={30} roomName={() => "直播间"} onOpen={vi.fn()} onDismiss={dismiss} />);
    vi.advanceTimersByTime(29_999); expect(dismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(dismiss).toHaveBeenCalledWith(1);
    dismiss.mockClear(); rerender(<InsightNotificationRail items={[item(2)]} timeoutSeconds={null} roomName={() => "直播间"} onOpen={vi.fn()} onDismiss={dismiss} />);
    vi.advanceTimersByTime(120_000); expect(dismiss).not.toHaveBeenCalled();
  });

  it("renders at most twenty notifications", () => {
    render(<InsightNotificationRail items={Array.from({ length: 24 }, (_, index) => item(index + 1))} timeoutSeconds={null} roomName={() => "直播间"} onOpen={vi.fn()} onDismiss={vi.fn()} />);
    expect(document.querySelectorAll(".insight-notification-track article")).toHaveLength(20);
  });

  it("uses the room avatar and keeps the room identity separate from time", () => {
    render(<InsightNotificationRail items={[item(1)]} timeoutSeconds={null} roomName={() => "大潘说股的抖音直播间"} roomAvatar={() => "duoduo-avatar://123?v=avatar.png"} onOpen={vi.fn()} onDismiss={vi.fn()} />);
    expect(document.querySelector(".insight-notification-avatar")?.getAttribute("src")).toBe("duoduo-avatar://123?v=avatar.png");
    expect(screen.getByText("大潘说股的抖音直播间").tagName).toBe("STRONG");
    expect(document.querySelector(".insight-notification-identity time")).not.toBeNull();
  });
});
