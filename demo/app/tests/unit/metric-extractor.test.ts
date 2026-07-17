import { describe, expect, it } from "vitest";
import { extractRoomMetrics, parseCompactCount } from "../../src/main/rooms/metric-extractor";

describe("parseCompactCount", () => {
  it.each([
    ["1,234", 1_234],
    ["1.2万", 12_000],
    ["3.5亿", 350_000_000],
    ["在线 986 人", 986],
  ])("parses %s", (text, expected) => expect(parseCompactCount(text)).toBe(expected));

  it.each(["", "暂无", "--"])("keeps missing value %s undefined", (text) => {
    expect(parseCompactCount(text)).toBeUndefined();
  });
});

describe("extractRoomMetrics", () => {
  it("extracts semantic metrics and records their sources", () => {
    expect(extractRoomMetrics({
      bodyText: "2.3万人在线 本场观看 18.6万",
      candidates: [
        { text: "粉丝 126.4万", source: "accessibility" },
        { text: "获赞 8.1万", source: "visible_text" },
      ],
    })).toEqual({
      viewerCount: 23_000,
      followerCount: 1_264_000,
      totalViewerCount: 186_000,
      likeCount: 81_000,
      raw: { viewerCount: "2.3万", followerCount: "126.4万", totalViewerCount: "18.6万", likeCount: "8.1万" },
      evidence: {
        viewerCount: { raw: "2.3万", source: "visible_text" },
        followerCount: { raw: "126.4万", source: "accessibility" },
        totalViewerCount: { raw: "18.6万", source: "visible_text" },
        likeCount: { raw: "8.1万", source: "visible_text" },
      },
      quality: "complete",
    });
  });

  it("prefers accessibility evidence over generic visible text", () => {
    const result = extractRoomMetrics({
      bodyText: "粉丝 12万",
      candidates: [{ text: "主播粉丝 13.2万", source: "accessibility" }],
    });
    expect(result.followerCount).toBe(132_000);
    expect(result.evidence.followerCount?.source).toBe("accessibility");
  });

  it("does not treat room ids, times, or empty input as metrics", () => {
    expect(extractRoomMetrics({ bodyText: "直播间 591958226292 18:30 开播", candidates: [] })).toEqual({
      raw: {},
      evidence: {},
      quality: "missing",
    });
  });
});
