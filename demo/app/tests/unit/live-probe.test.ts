import { describe, expect, it, vi } from "vitest";
import { classifyCurrentHealth, classifyProbe, inspectCurrentRoom, parseCompactCount, probeRoom, selectAvatarCandidate } from "../../src/main/rooms/live-probe";

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
    [{ hasVideo: false, videoReadyState: 0, text: "请完成下列验证后继续\n安全验证" }, "verification_required"],
    [{ hasVideo: true, videoReadyState: 4, text: "请完成下列验证后继续\n直播已结束" }, "verification_required"],
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

describe("probeRoom metrics", () => {
  it("extracts metrics from an already open monitoring page without navigation", async () => {
    const webContents = {
      executeJavaScript: vi.fn(async () => ({
        hasVideo: true,
        videoReadyState: 4,
        currentTime: 10,
        paused: false,
        audioTrackState: "live",
        text: "1.8万人在线",
        metricCandidates: [{ text: "粉丝 88.8万", source: "accessibility" }],
      })),
    };

    const result = await inspectCurrentRoom(webContents as never);

    expect(result).toMatchObject({ viewerCount: 18_000, followerCount: 888_000, metricQuality: "partial" });
    expect(webContents.executeJavaScript).toHaveBeenCalledTimes(1);
  });

  it("parses bounded page candidates in the main process", async () => {
    vi.useFakeTimers();
    const webContents = {
      once: (_event: "dom-ready", listener: () => void) => listener(),
      loadURL: vi.fn(async () => undefined),
      stop: vi.fn(),
      executeJavaScript: vi.fn(async () => ({
        hasVideo: true,
        videoReadyState: 4,
        text: "2.3万人在线 本场观看 18.6万",
        title: "测试主播 - 抖音直播",
        metricCandidates: [
          { text: "粉丝 126.4万", source: "accessibility" },
          { text: "获赞 8.1万", source: "visible_text" },
        ],
      })),
    };

    const pending = probeRoom(webContents as never, "https://live.douyin.com/123", 5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;
    vi.useRealTimers();

    expect(result).toMatchObject({
      status: "live",
      viewerCount: 23_000,
      followerCount: 1_264_000,
      totalViewerCount: 186_000,
      likeCount: 81_000,
      metricQuality: "complete",
      metricEvidence: expect.objectContaining({ followerCount: { raw: "126.4万", source: "accessibility" } }),
    });
  });
});
