import { describe, expect, it } from "vitest";
import { mergeAnalyzerSampleEvents } from "../../src/main/insights/analyzer-live-sample";

describe("live analyzer samples", () => {
  it("makes a non-final realtime ASR segment immediately usable", () => {
    const merged = mergeAnalyzerSampleEvents([], [{
      roomId: "room-a",
      sessionId: "session-a",
      segmentId: "partial-1",
      startMs: 0,
      endMs: 800,
      text: "主播正在介绍这件商品",
      isFinal: false,
      occurredAt: "2026-07-22T00:00:01.000Z",
    }]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      roomId: "room-a",
      text: "主播正在介绍这件商品",
      isFinal: false,
    });
    expect(merged[0].id).toBeGreaterThan(0);
  });

  it("does not duplicate a final segment already persisted in history", () => {
    const stored = [{
      id: 7,
      roomId: "room-a",
      sessionId: "session-a",
      segmentId: "segment-1",
      startMs: 0,
      endMs: 800,
      text: "已经完成的句子",
      isFinal: true,
      occurredAt: "2026-07-22T00:00:01.000Z",
    }];
    const merged = mergeAnalyzerSampleEvents(stored, [{ ...stored[0] }]);
    expect(merged).toEqual(stored);
  });
});
