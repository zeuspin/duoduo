import { describe, expect, it } from "vitest";
import { classifyCurrentHealth, classifyProbe, parseCompactCount, selectAvatarCandidate } from "../../src/main/rooms/live-probe";

describe("parseCompactCount", () => {
  it.each([
    ["1,234", 1234],
    ["1.2万", 12000],
    ["3.5亿", 350000000],
    ["在线 986 人", 986],
  ])("parses %s", (text, expected) => expect(parseCompactCount(text)).toBe(expected));

  it.each(["", "暂无", "--"])("keeps missing value %s undefined", (text) => {
    expect(parseCompactCount(text)).toBeUndefined();
  });
});

describe("selectAvatarCandidate", () => {
  it("prefers a square profile image over covers, logos, and QR codes", () => {
    expect(selectAvatarCandidate([
      { source: "https://example.com/cover.jpg", width: 1280, height: 720, label: "直播封面" },
      { source: "https://example.com/logo.png", width: 80, height: 80, label: "douyin logo" },
      { source: "https://example.com/qr.png", width: 180, height: 180, label: "扫码二维码" },
      { source: "https://example.com/anchor.jpeg", width: 108, height: 108, label: "主播" },
    ])).toBe("https://example.com/anchor.jpeg");
  });

  it("rejects text and non-http sources", () => {
    expect(selectAvatarCandidate([{ source: "主播头像", width: 100, height: 100, label: "" }, { source: "data:image/png;base64,abc", width: 100, height: 100, label: "" }])).toBeUndefined();
  });
});

describe("classifyProbe", () => {
  it.each([
    [{ hasVideo: true, videoReadyState: 3, text: "正在直播" }, "live"],
    [{ hasVideo: false, videoReadyState: 0, text: "直播已结束" }, "offline"],
    [{ hasVideo: false, videoReadyState: 0, text: "登录后观看" }, "login_required"],
    [{ hasVideo: false, videoReadyState: 0, text: "主播暂未开播" }, "offline"],
  ] as const)("classifies page evidence", (evidence, expected) => {
    expect(classifyProbe(evidence)).toBe(expected);
  });
});

describe("classifyCurrentHealth", () => {
  it("detects explicit offline copy", () => {
    expect(classifyCurrentHealth({ hasVideo: true, videoReadyState: 4, text: "本场直播已结束", currentTime: 100, paused: true, audioTrackState: "ended" }, 99)).toBe("offline");
  });

  it("treats advancing playable video with a live audio track as live", () => {
    expect(classifyCurrentHealth({ hasVideo: true, videoReadyState: 4, text: "正在直播", currentTime: 101, paused: false, audioTrackState: "live" }, 100)).toBe("live");
  });

  it("keeps an ambiguous stalled page unknown instead of reporting a false stop", () => {
    expect(classifyCurrentHealth({ hasVideo: true, videoReadyState: 4, text: "", currentTime: 100, paused: false, audioTrackState: "live" }, 100)).toBe("unknown");
  });
});
