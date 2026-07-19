// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsrFeed } from "../../src/renderer/components/AsrFeed";

describe("AsrFeed", () => {
  afterEach(cleanup);
  it("does not present persisted history as the current live session", async () => {
    const listBefore = vi.fn().mockResolvedValue({ items: [{ id: 1, roomId: "123", sessionId: "old", segmentId: "old", startMs: 0, endMs: 1, text: "上一场内容", isFinal: true, occurredAt: "2026-07-12T00:34:22.000Z" }] });
    render(<AsrFeed roomId="123" liveEvents={[]} listBefore={listBefore} />);
    expect(screen.getByText("正在等待主播说话…")).toBeTruthy();
    expect(screen.queryByText("上一场内容")).toBeNull();
    expect(listBefore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "查看历史记录" }));
    expect(await screen.findByText("上一场内容")).toBeTruthy();
    expect(listBefore).toHaveBeenCalledWith("123", { limit: 50 });
  });

  it("renders natural time and loads older history without unbounded growth", async () => {
    const listBefore = vi.fn()
      .mockResolvedValueOnce({ items: Array.from({ length: 50 }, (_, index) => ({ id: index + 151, roomId: "123", sessionId: "s", segmentId: `new-${index}`, startMs: 0, endMs: 1, text: index === 49 ? "这是一段需要纵向换行的很长识别文本" : `new ${index}`, isFinal: true, occurredAt: "2026-07-12T00:34:22.000Z" })), nextCursor: 151 })
      .mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, index) => ({ id: index + 51, roomId: "123", sessionId: "s", segmentId: `old-${index}`, startMs: 0, endMs: 1, text: `old ${index}`, isFinal: true, occurredAt: "2026-07-12T00:30:00.000Z" })), nextCursor: 51 })
      .mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, index) => ({ id: index + 1, roomId: "123", sessionId: "s", segmentId: `oldest-${index}`, startMs: 0, endMs: 1, text: `oldest ${index}`, isFinal: true, occurredAt: "2026-07-12T00:20:00.000Z" })) });
    render(<AsrFeed roomId="123" liveEvents={[]} listBefore={listBefore} />);
    fireEvent.click(screen.getByRole("button", { name: "查看历史记录" }));
    expect((await screen.findAllByText("08:34:22")).length).toBe(50);
    const feed = screen.getByTestId("asr-feed");
    Object.defineProperty(feed, "scrollTop", { value: 0, writable: true });
    fireEvent.scroll(feed);
    await waitFor(() => expect(listBefore).toHaveBeenCalledTimes(2));
    fireEvent.scroll(feed);
    await waitFor(() => expect(listBefore).toHaveBeenCalledTimes(3));
    expect(feed.querySelectorAll("[data-segment]").length).toBeLessThanOrEqual(200);
  });
});
