import { describe, expect, it, vi } from "vitest";
import { classifyCurrentHealth, classifyProbe, inspectCurrentRoom, isFullscreenOrTheaterClass, isSafeTopLeftProfileTriggerCandidate, parseCompactCount, probeRoom, sanitizeProfileCandidateDiagnostics, sanitizeProfilePageDiagnostics, shouldIncludeProfileDiagnosticElement, shouldSkipProfileDiagnosticElement, selectAvatarCandidate } from "../../src/main/rooms/live-probe";

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

describe("sanitizeProfileCandidateDiagnostics", () => {
  it("includes unlabeled small square images so changed live page markup is still diagnosable", () => {
    expect(shouldIncludeProfileDiagnosticElement({ width: 72, height: 72 })).toBe(true);
    expect(shouldIncludeProfileDiagnosticElement({ width: 18, height: 18 })).toBe(false);
    expect(shouldIncludeProfileDiagnosticElement({ width: 320, height: 180 })).toBe(false);
  });

  it("skips gift bar candidates because they are not host profile triggers", () => {
    expect(shouldSkipProfileDiagnosticElement({ selfDataE2e: "", ancestorDataE2e: "gifts-container" })).toBe(true);
    expect(shouldSkipProfileDiagnosticElement({ selfDataE2e: "live-room-nickname", ancestorDataE2e: "" })).toBe(false);
  });

  it("keeps bounded structural fields without image urls or arbitrary text attributes", () => {
    const result = sanitizeProfileCandidateDiagnostics([
      {
        tag: "img",
        attributes: {
          class: "avatar ".repeat(40),
          "data-e2e": "live-avatar",
          src: "https://secret.example/avatar.jpeg",
          title: "主播昵称",
        },
        ancestors: [
          { tag: "button", attributes: { role: "button", "aria-label": "主播资料入口", src: "https://secret.example/parent.png" } },
        ],
      },
    ]);

    expect(result).toEqual([
      {
        tag: "IMG",
        attributes: {
          class: expect.stringMatching(/^avatar avatar/),
          "data-e2e": "live-avatar",
        },
        ancestors: [
          { tag: "BUTTON", attributes: { role: "button", "aria-label": "主播资料入口" } },
        ],
      },
    ]);
    expect(result[0].attributes.class.length).toBeLessThanOrEqual(120);
    expect(JSON.stringify(result)).not.toContain("secret.example");
    expect(JSON.stringify(result)).not.toContain("主播昵称");
  });
});

describe("isSafeTopLeftProfileTriggerCandidate", () => {
  it("accepts avatar-sized visual elements near the top-left live header", () => {
    expect(isSafeTopLeftProfileTriggerCandidate({
      tagName: "IMG",
      x: 92,
      y: 24,
      width: 54,
      height: 54,
      selfDataE2e: "",
      ancestorDataE2e: "living-container",
      className: "avatar",
      text: "",
    })).toBe(true);
  });

  it("rejects follow, gift, navigation, and back controls", () => {
    for (const candidate of [
      { tagName: "BUTTON", x: 320, y: 24, width: 120, height: 48, selfDataE2e: "live-followbutton", ancestorDataE2e: "", className: "", text: "已关注" },
      { tagName: "IMG", x: 120, y: 500, width: 40, height: 40, selfDataE2e: "", ancestorDataE2e: "gifts-container", className: "", text: "" },
      { tagName: "A", x: 120, y: 20, width: 80, height: 42, selfDataE2e: "douyin-navigation", ancestorDataE2e: "", className: "tab-follow", text: "关注" },
      { tagName: "BUTTON", x: 0, y: 12, width: 72, height: 72, selfDataE2e: "fullscreen-back", ancestorDataE2e: "", className: "", text: "" },
    ]) {
      expect(isSafeTopLeftProfileTriggerCandidate(candidate)).toBe(false);
    }
  });
});

describe("isFullscreenOrTheaterClass", () => {
  it("detects player states that hide the host profile header", () => {
    expect(isFullscreenOrTheaterClass("__playerIsFull __fullScreenOrTheaterOn pzKXdjhL")).toBe(true);
    expect(isFullscreenOrTheaterClass("__roomInfoBarInner __hasOptionBar")).toBe(false);
  });
});

describe("sanitizeProfilePageDiagnostics", () => {
  it("keeps bounded page state without body text", () => {
    const result = sanitizeProfilePageDiagnostics({
      pageUrl: "https://live.douyin.com/123?token=secret",
      pageTitle: "财经老张的抖音直播间 - 抖音直播".repeat(20),
      anchorName: "财经老张".repeat(20),
      liveNicknamePresent: true,
      textMarkers: { fans: true, following: false, live: true },
      dataE2eInventory: [
        { name: "live-room-nickname", count: 1 },
        { name: "x".repeat(200), count: 3 },
      ],
      keyNodes: {
        "live-followbutton": {
          tag: "button",
          attributes: { "data-e2e": "live-followbutton", src: "https://secret.example/follow.png" },
          ancestors: [{ tag: "div", attributes: { class: "profile header" } }],
          nearbyDataE2e: ["live-room-audience", "gifts-container", "y".repeat(200)],
        },
      },
      bodyText: "不应该记录整页正文",
    });

    expect(result).toBeDefined();
    if (!result) throw new Error("expected diagnostics");
    expect(result).toEqual({
      pageUrl: "https://live.douyin.com/123",
      pageTitle: expect.stringContaining("财经老张"),
      anchorName: expect.stringContaining("财经老张"),
      liveNicknamePresent: true,
      textMarkers: { fans: true, following: false, live: true },
      dataE2eInventory: [
        { name: "live-room-nickname", count: 1 },
        { name: "x".repeat(120), count: 3 },
      ],
      keyNodes: {
        "live-followbutton": {
          tag: "BUTTON",
          attributes: { "data-e2e": "live-followbutton" },
          ancestors: [{ tag: "DIV", attributes: { class: "profile header" } }],
          nearbyDataE2e: ["live-room-audience", "gifts-container", "y".repeat(120)],
        },
      },
    });
    expect(result.pageTitle?.length).toBeLessThanOrEqual(120);
    expect(result.anchorName?.length).toBeLessThanOrEqual(80);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("不应该记录");
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

  it("enriches an already open monitoring page from its profile card", async () => {
    const webContents = {
      executeJavaScript: vi.fn()
        .mockResolvedValueOnce({ hasVideo: true, videoReadyState: 4, currentTime: 10, paused: false, audioTrackState: "live", text: "在线观众·88", metricCandidates: [], profileTrigger: true })
        .mockResolvedValueOnce({ status: "found", text: "4 关注 · 1.2万 粉丝直播介绍：每周日18:00", liveDescription: "每周日18:00" }),
    };

    const result = await inspectCurrentRoom(webContents as never);

    expect(result).toMatchObject({ viewerCount: 88, followerCount: 12_000, liveDescription: "每周日18:00", profileEvidenceStatus: "found" });
    expect(webContents.executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it.each([
    [false, undefined, "trigger_missing"],
    [true, { status: "popup_missing" }, "popup_missing"],
    [true, { status: "followers_missing", text: "直播介绍：每天开播" }, "followers_missing"],
  ] as const)("reports profile evidence status %s", async (profileTrigger, profileResult, expected) => {
    const executeJavaScript = vi
      .fn()
      .mockResolvedValueOnce({
        hasVideo: true,
        videoReadyState: 4,
        currentTime: 10,
        paused: false,
        audioTrackState: "live",
        text: "在线观众·88",
        metricCandidates: [],
        profileTrigger,
      });
    if (profileResult) executeJavaScript.mockResolvedValueOnce(profileResult);

    const result = await inspectCurrentRoom({ executeJavaScript } as never);

    expect(result.profileEvidenceStatus).toBe(expected);
    expect(result.followerCount).toBeUndefined();
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

  it("enriches a live probe from the host profile card without navigating again", async () => {
    vi.useFakeTimers();
    const webContents = {
      once: (_event: "dom-ready", listener: () => void) => listener(),
      loadURL: vi.fn(async () => undefined),
      stop: vi.fn(),
      executeJavaScript: vi.fn()
        .mockResolvedValueOnce({
          hasVideo: true,
          videoReadyState: 4,
          text: "在线观众·145",
          title: "周伯通财道的抖音直播间 - 抖音直播",
          anchorName: "周伯通财道",
          avatar: "https://example.com/header-avatar.jpg",
          metricCandidates: [{ text: "在线 145", source: "accessibility" }],
          profileTrigger: true,
        })
        .mockResolvedValueOnce({
          status: "found",
          text: "4 关注 · 1.2万 粉丝直播介绍：每周日一二三四六18:00粉丝团团成员：604",
          avatar: "https://example.com/card-avatar.jpg",
          liveDescription: "每周日一二三四六18:00",
        }),
    };

    const pending = probeRoom(webContents as never, "https://live.douyin.com/666914142539", 5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;
    vi.useRealTimers();

    expect(webContents.loadURL).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "live",
      anchorName: "周伯通财道",
      avatar: "https://example.com/card-avatar.jpg",
      viewerCount: 145,
      followerCount: 12_000,
      profileEvidenceStatus: "found",
      liveDescription: "每周日一二三四六18:00",
    });
  });

  it("runs the before-profile callback before opening the host profile card", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const webContents = {
      once: (_event: "dom-ready", listener: () => void) => listener(),
      loadURL: vi.fn(async () => undefined),
      stop: vi.fn(),
      executeJavaScript: vi.fn()
        .mockImplementationOnce(async () => {
          events.push("base-probe");
          return {
            hasVideo: true,
            videoReadyState: 4,
            text: "在线观众·302",
            title: "低吸一哥奇点的抖音直播间 - 抖音直播",
            anchorName: "低吸一哥奇点",
            metricCandidates: [{ text: "在线 302", source: "accessibility" }],
            profileTrigger: true,
          };
        })
        .mockImplementationOnce(async () => {
          events.push("profile-card");
          return {
            status: "found",
            text: "已关注低吸一哥奇点0 关注 · 3.5万 粉丝直播介绍：每周一至周五09:00粉丝团团成员：3633",
            liveDescription: "每周一至周五09:00",
          };
        }),
    };

    const pending = probeRoom(webContents as never, "https://live.douyin.com/773107011629", 5_000, {
      beforeProfile: (result) => {
        events.push(`before-profile:${result.status}:${result.viewerCount}`);
      },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;
    vi.useRealTimers();

    expect(events).toEqual(["base-probe", "before-profile:live:302", "profile-card"]);
    expect(result).toMatchObject({ followerCount: 35_000, profileEvidenceStatus: "found" });
  });

  it("still attempts the host profile card when the first live DOM snapshot has not rendered the trigger yet", async () => {
    vi.useFakeTimers();
    const webContents = {
      once: (_event: "dom-ready", listener: () => void) => listener(),
      loadURL: vi.fn(async () => undefined),
      stop: vi.fn(),
      executeJavaScript: vi.fn()
        .mockResolvedValueOnce({
          hasVideo: true,
          videoReadyState: 4,
          text: "在线观众·302",
          title: "低吸一哥奇点的抖音直播间 - 抖音直播",
          anchorName: "低吸一哥奇点",
          metricCandidates: [{ text: "在线 302", source: "accessibility" }],
          profileTrigger: false,
        })
        .mockResolvedValueOnce({
          status: "found",
          text: "已关注低吸一哥奇点0 关注 · 3.5万 粉丝直播介绍：每周一至周五09:00粉丝团团成员：3633",
          liveDescription: "每周一至周五09:00",
        }),
    };

    const pending = probeRoom(webContents as never, "https://live.douyin.com/773107011629", 5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await pending;
    vi.useRealTimers();

    expect(webContents.executeJavaScript).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: "live",
      viewerCount: 302,
      followerCount: 35_000,
      profileEvidenceStatus: "found",
      liveDescription: "每周一至周五09:00",
    });
  });

  it("uses a real debugger mouse hover when synthetic profile events do not open the card", async () => {
    vi.useFakeTimers();
    let attached = false;
    const sendCommand = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "Input.dispatchMouseEvent") return {};
      if (method !== "Runtime.evaluate") throw new Error(`unexpected debugger command: ${method}`);
      const expression = String(params?.expression ?? "");
      if (expression.includes("const video = document.querySelector('video')")) {
        return {
          result: {
            type: "object",
            value: {
              hasVideo: true,
              videoReadyState: 4,
              text: "在线观众·302",
              title: "低吸一哥奇点的抖音直播间 - 抖音直播",
              anchorName: "低吸一哥奇点",
              metricCandidates: [{ text: "在线 302", source: "accessibility" }],
              profileTrigger: true,
            },
          },
        };
      }
      if (expression.includes("let trigger;")) {
        return { result: { type: "object", value: { status: "popup_missing" } } };
      }
      if (expression.includes("bounds.left + bounds.width / 2")) {
        return { result: { type: "object", value: { x: 122.5, y: 32 } } };
      }
      if (expression.includes("const readProfile = () =>")) {
        return {
          result: {
            type: "object",
            value: {
              status: "found",
              text: "已关注低吸一哥奇点0 关注 · 3.5万 粉丝直播介绍：每周一至周五09:00粉丝团团成员：3633",
              liveDescription: "每周一至周五09:00",
            },
          },
        };
      }
      throw new Error(`unhandled Runtime.evaluate expression: ${expression.slice(0, 120)}`);
    });
    const webContents = {
      once: (_event: "dom-ready", listener: () => void) => listener(),
      loadURL: vi.fn(async () => undefined),
      stop: vi.fn(),
      executeJavaScript: vi.fn(),
      debugger: {
        isAttached: () => attached,
        attach: vi.fn(() => { attached = true; }),
        detach: vi.fn(() => { attached = false; }),
        sendCommand,
      },
    };

    const pending = probeRoom(webContents as never, "https://live.douyin.com/773107011629", 5_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(800);
    const result = await pending;
    vi.useRealTimers();

    expect(sendCommand).toHaveBeenCalledWith("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1, button: "none" });
    expect(sendCommand).toHaveBeenCalledWith("Input.dispatchMouseEvent", { type: "mouseMoved", x: 122.5, y: 32, button: "none" });
    expect(result).toMatchObject({
      status: "live",
      viewerCount: 302,
      followerCount: 35_000,
      profileEvidenceStatus: "found",
    });
  });
});
