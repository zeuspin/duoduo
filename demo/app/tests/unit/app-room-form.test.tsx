// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/App";

beforeEach(() => {
  Object.assign(window, {
    duoduo: {
      app: { getVersion: vi.fn().mockResolvedValue("0.6.0") },
      settings: {
        getAsrProvider: vi.fn().mockResolvedValue(undefined),
        saveAsrProvider: vi.fn(),
        testAsrProvider: vi.fn(),
        getInsightNotifications: vi
          .fn()
          .mockResolvedValue({ timeoutSeconds: 30 }),
        saveInsightNotifications: vi.fn(),
        getMonitoring: vi
          .fn()
          .mockResolvedValue({
            monitoredCheckSeconds: 30,
            preparedCheckMinutes: 5,
          }),
        saveMonitoring: vi.fn().mockImplementation(async (value) => value),
      },
      access: {
        getState: vi.fn().mockResolvedValue({ mode: "normal" }),
        showVerification: vi
          .fn()
          .mockResolvedValue({ url: "https://live.douyin.com/123" }),
        hideVerification: vi.fn().mockResolvedValue(true),
        setVerificationBounds: vi.fn().mockResolvedValue(true),
        checkVerification: vi
          .fn()
          .mockResolvedValue({
            clear: false,
            state: {
              mode: "verification_paused",
              roomId: "123",
              taskType: "manual_probe",
              triggeredAt: "2026-07-15T10:00:00.000Z",
              reason: "verification_required",
            },
          }),
        confirmRecovery: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      rooms: {
        list: vi
          .fn()
          .mockResolvedValue({
            rooms: [
              {
                roomId: "123",
                canonicalUrl: "https://live.douyin.com/123",
                groupId: "group-a",
                schedule: null,
                probeIntervalMinutes: null,
                monitoring: false,
                autoMonitorOnLive: false,
                createdAt: "2026-07-12T00:00:00.000Z",
                updatedAt: "2026-07-12T00:00:00.000Z",
              },
            ],
            runtimes: [],
            snapshots: [],
          }),
        add: vi.fn(),
        update: vi.fn(),
        remove: vi.fn(),
        setMonitoring: vi.fn(),
        setAutoMonitorOnLive: vi.fn(),
        probe: vi.fn(),
        probeAll: vi
          .fn()
          .mockResolvedValue({
            mode: "running",
            currentRoomId: "123",
            queuedRoomIds: [],
            batch: { source: "manual_batch", total: 1, completed: 0 },
          }),
        cancelProbeBatch: vi
          .fn()
          .mockResolvedValue({ mode: "idle", queuedRoomIds: [] }),
        getProbeState: vi
          .fn()
          .mockResolvedValue({
            mode: "idle",
            queuedRoomIds: [],
            nextRunAt: "2026-07-15T10:05:00.000Z",
          }),
        refreshAvatar: vi.fn(),
        listIntelligence: vi
          .fn()
          .mockResolvedValue([
            {
              roomId: "123",
              generatedAt: "2026-07-17T12:00:00.000Z",
              currentMetrics: {},
              labels: [
                {
                  kind: "insufficient_data",
                  text: "数据积累中",
                  explanation: "样本不足",
                  sampleCount: 0,
                },
              ],
            },
          ]),
        getIntelligence: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
        subscribeProbeState: vi.fn(() => () => undefined),
      },
      groups: {
        list: vi
          .fn()
          .mockResolvedValue({
            groups: [
              {
                id: "group-a",
                name: "分组 1",
                parserId: null,
                position: 0,
                roomCount: 1,
                createdAt: "2026-07-12T00:00:00.000Z",
                updatedAt: "2026-07-12T00:00:00.000Z",
              },
            ],
            activeRun: undefined,
          }),
        create: vi.fn(),
        rename: vi.fn(),
        remove: vi.fn(),
        moveRoom: vi.fn(),
        setParser: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        retryStop: vi.fn(),
        refresh: vi.fn(),
      },
      data: {
        getUsage: vi
          .fn()
          .mockResolvedValue({
            databaseBytes: 0,
            walBytes: 0,
            avatarBytes: 0,
            coverBytes: 0,
            logBytes: 0,
            categories: [],
          }),
        getRetention: vi
          .fn()
          .mockResolvedValue({
            observationDays: 30,
            aggregateDays: 365,
            asrDays: 90,
            logDays: 30,
          }),
        saveRetention: vi.fn(),
        previewCleanup: vi.fn(),
        executeCleanup: vi.fn(),
        compact: vi.fn(),
        exportBackup: vi.fn(),
        importBackup: vi.fn(),
      },
      asr: { listBefore: vi.fn().mockResolvedValue({ items: [] }) },
      player: {
        getState: vi
          .fn()
          .mockResolvedValue({ activeRoomId: null, status: "stopped" }),
        play: vi
          .fn()
          .mockResolvedValue({ activeRoomId: "123", status: "playing" }),
        stop: vi
          .fn()
          .mockResolvedValue({ activeRoomId: null, status: "stopped" }),
        setBounds: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      parsers: {
        list: vi
          .fn()
          .mockResolvedValue({
            definitions: [],
            bindings: [],
            tests: [],
            llmConfigured: false,
          }),
        bindRoom: vi.fn(),
      },
      insights: {
        list: vi.fn().mockResolvedValue({ items: [] }),
        subscribe: vi.fn(() => () => undefined),
      },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("room form", () => {
  it("does not label a room without a snapshot as actively checking", async () => {
    render(<App />);
    expect(await screen.findByText("等待首次检测")).toBeTruthy();
    expect(screen.queryByText("正在确认直播状态")).toBeNull();
  });

  it("renders the simplified offline card and saves its independent auto-monitor setting", async () => {
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    vi.mocked(window.duoduo.rooms.list).mockResolvedValue({
      rooms: [
        {
          roomId: "123",
          canonicalUrl: "https://live.douyin.com/123",
          groupId: "group-a",
          schedule: null,
          probeIntervalMinutes: null,
          monitoring: false,
          autoMonitorOnLive: false,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      ],
      runtimes: [],
      snapshots: [
        {
          roomId: "123",
          status: "offline",
          anchorName: "测试主播",
          checkedAt: "2026-07-17T10:24:00.000Z",
        },
      ],
    });
    render(<App />);

    expect(await screen.findByText("直播时间不确定")).toBeTruthy();
    expect(screen.getByText("96 分钟前检测")).toBeTruthy();
    expect(screen.getByText("主播粉丝").parentElement?.textContent).toContain(
      "待获取",
    );
    expect(screen.queryByText("https://live.douyin.com/123")).toBeNull();
    expect(screen.queryByText("数据积累中")).toBeNull();
    expect(screen.getByRole("button", { name: "数据详情" })).toBeTruthy();
    const join = screen.getByRole("button", { name: "加入实时监看" });
    expect((join as HTMLButtonElement).disabled).toBe(true);
    expect(join.getAttribute("title")).toBe("请先启动当前分组");
    expect(join.className).not.toContain("live");
    fireEvent.click(screen.getByRole("checkbox", { name: "开播后自动监看" }));
    await waitFor(() =>
      expect(window.duoduo.rooms.setAutoMonitorOnLive).toHaveBeenCalledWith(
        "123",
        true,
      ),
    );
  });

  it("shows a user-facing error if the running group changes while joining monitoring", async () => {
    vi.mocked(window.duoduo.groups.list).mockResolvedValue({
      groups: [
        {
          id: "group-a",
          name: "分组 1",
          parserId: null,
          position: 0,
          roomCount: 1,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      ],
      activeRun: {
        id: "run-1",
        groupId: "group-a",
        status: "running",
        startedAt: "2026-07-20T00:00:00.000Z",
      },
    });
    vi.mocked(window.duoduo.rooms.setMonitoring).mockRejectedValue(
      new Error("ROOM_GROUP_NOT_RUNNING"),
    );
    render(<App />);

    const join = await screen.findByRole("button", {
      name: "加入实时监看",
    });
    expect((join as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(join);

    expect(
      await screen.findByText(
        "无法加入实时监看：Error: ROOM_GROUP_NOT_RUNNING",
      ),
    ).toBeTruthy();
  });

  it("highlights the join action for a live prepared room", async () => {
    vi.mocked(window.duoduo.rooms.list).mockResolvedValue({
      rooms: [
        {
          roomId: "123",
          canonicalUrl: "https://live.douyin.com/123",
          groupId: "group-a",
          schedule: null,
          probeIntervalMinutes: null,
          monitoring: false,
          autoMonitorOnLive: false,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      ],
      runtimes: [],
      snapshots: [
        {
          roomId: "123",
          status: "live",
          anchorName: "测试主播",
          followerCount: 1_264_000,
          liveDescription: "每周日一二三四六18:00",
          checkedAt: "2026-07-17T11:59:00.000Z",
        },
      ],
    });
    render(<App />);
    const join = await screen.findByRole("button", { name: "加入实时监看" });
    expect(join.className).toContain("live");
    expect(screen.getByText("主播粉丝").parentElement?.textContent).toContain(
      "126.4 万",
    );
    expect(
      screen.getByText("直播介绍：每周日一二三四六18:00").getAttribute("title"),
    ).toBe("每周日一二三四六18:00");
  });

  it("refreshes the selected group from its controls", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "刷新状态" }));
    await waitFor(() =>
      expect(window.duoduo.groups.refresh).toHaveBeenCalledWith(
        "group-a",
      ),
    );
  });

  it("disables update-all while Douyin access is paused", async () => {
    vi.mocked(window.duoduo.access.getState).mockResolvedValue({
      mode: "verification_paused",
      roomId: "123",
      taskType: "manual_probe",
      triggeredAt: "2026-07-15T10:00:00.000Z",
      reason: "verification_required",
    });
    render(<App />);
    const button = await screen.findByRole("button", { name: "刷新状态" });
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(true),
    );
  });

  it("shows persistent verification recovery controls", async () => {
    vi.mocked(window.duoduo.access.getState).mockResolvedValue({
      mode: "verification_paused",
      roomId: "123",
      taskType: "manual_probe",
      triggeredAt: "2026-07-15T10:00:00.000Z",
      reason: "verification_required",
    });
    render(<App />);
    const banner = await screen.findByRole("alert", { name: "抖音访问已暂停" });
    expect(within(banner).getByText(/抖音要求安全验证/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "打开验证页" }));
    const verification = await screen.findByRole("dialog", {
      name: "抖音人工验证",
    });
    expect(within(verification).getByText(/live\.douyin\.com/)).toBeTruthy();
    expect(window.duoduo.access.showVerification).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "关闭验证页" }));
    await waitFor(() =>
      expect(window.duoduo.access.hideVerification).toHaveBeenCalled(),
    );
    expect(screen.queryByRole("dialog", { name: "抖音人工验证" })).toBeNull();
    expect(screen.getByText(/抖音要求安全验证/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "我已完成，检查状态" }));
    expect(
      await screen.findByText("仍检测到平台验证，请在验证页完成后再次检查"),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "立即检测直播状态",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("shows recovery-check progress inside the embedded verification toolbar", async () => {
    vi.mocked(window.duoduo.access.getState).mockResolvedValue({
      mode: "verification_paused",
      roomId: "123",
      taskType: "manual_probe",
      triggeredAt: "2026-07-15T10:00:00.000Z",
      reason: "verification_required",
    });
    let finishCheck!: (value: unknown) => void;
    vi.mocked(window.duoduo.access.checkVerification).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCheck = resolve;
        }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开验证页" }));
    const verification = await screen.findByRole("dialog", {
      name: "抖音人工验证",
    });

    fireEvent.click(
      within(verification).getByRole("button", { name: "我已完成，检查状态" }),
    );

    expect(within(verification).getByRole("status").textContent).toContain(
      "正在检查验证状态…",
    );
    finishCheck({
      clear: false,
      state: {
        mode: "verification_paused",
        roomId: "123",
        taskType: "manual_probe",
        triggeredAt: "2026-07-15T10:00:00.000Z",
        reason: "verification_required",
      },
    });
    await waitFor(() =>
      expect(within(verification).getByRole("status").textContent).toContain(
        "仍检测到平台验证",
      ),
    );
  });

  it("shows a retryable message when the verification check times out", async () => {
    vi.mocked(window.duoduo.access.getState).mockResolvedValue({
      mode: "verification_paused",
      roomId: "123",
      taskType: "manual_probe",
      triggeredAt: "2026-07-15T10:00:00.000Z",
      reason: "verification_required",
    });
    vi.mocked(window.duoduo.access.checkVerification).mockRejectedValue(
      new Error("VERIFICATION_CHECK_TIMEOUT"),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "打开验证页" }));
    const verification = await screen.findByRole("dialog", {
      name: "抖音人工验证",
    });

    fireEvent.click(
      within(verification).getByRole("button", { name: "我已完成，检查状态" }),
    );

    await waitFor(() =>
      expect(within(verification).getByRole("status").textContent).toBe(
        "验证检查超时，请等待页面稳定后重试",
      ),
    );
  });

  it("shows a successful verification check and the recovery action", async () => {
    const ready = {
      mode: "recovery_ready" as const,
      roomId: "123",
      taskType: "manual_probe" as const,
      triggeredAt: "2026-07-15T10:00:00.000Z",
    };
    vi.mocked(window.duoduo.access.getState).mockResolvedValue({
      mode: "verification_paused",
      roomId: "123",
      taskType: "manual_probe",
      triggeredAt: ready.triggeredAt,
      reason: "verification_required",
    });
    vi.mocked(window.duoduo.access.checkVerification).mockResolvedValue({
      clear: true,
      state: ready,
    });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "我已完成，检查状态" }),
    );
    expect(
      await screen.findByText("验证检查已通过，请点击“恢复访问”继续"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "恢复访问" })).toBeTruthy();
  });

  it("replaces the stale recovery instruction after access is restored", async () => {
    const ready = {
      mode: "recovery_ready" as const,
      roomId: "123",
      taskType: "manual_probe" as const,
      triggeredAt: "2026-07-15T10:00:00.000Z",
    };
    vi.mocked(window.duoduo.access.getState).mockResolvedValue(ready);
    vi.mocked(window.duoduo.access.confirmRecovery).mockResolvedValue({
      mode: "normal",
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "恢复访问" }));
    expect(await screen.findByText("访问已恢复，自动更新已继续")).toBeTruthy();
    expect(
      screen.queryByText("验证检查已通过，请点击“恢复访问”继续"),
    ).toBeNull();
  });

  it("shows the fixed avatar and current viewers on a live card", async () => {
    vi.mocked(window.duoduo.rooms.list).mockResolvedValue({
      rooms: [
        {
          roomId: "123",
          canonicalUrl: "https://live.douyin.com/123",
          groupId: "group-a",
          schedule: null,
          probeIntervalMinutes: null,
          monitoring: false,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      ],
      runtimes: [],
      snapshots: [
        {
          roomId: "123",
          status: "live",
          anchorName: "测试主播",
          avatarPath: "/avatars/123.png",
          coverPath: "/covers/123.png",
          viewerCount: 1234,
          checkedAt: "2026-07-12T01:00:00.000Z",
        },
      ],
    });
    render(<App />);
    expect(await screen.findByText("1,234 人在线")).toBeTruthy();
    expect((await screen.findByAltText("测试主播头像")).className).toContain(
      "avatar-live",
    );
    fireEvent.click(await screen.findByRole("button", { name: "更多操作" }));
    expect(
      await screen.findByRole("menuitem", { name: "更新主播头像" }),
    ).toBeTruthy();
  });

  it("shows a complete monitored-room name with follower and viewer metrics on one row", async () => {
    const longName = "这是一个需要完整展示而不能被省略的直播间名称";
    vi.mocked(window.duoduo.rooms.list).mockResolvedValue({
      rooms: [
        {
          roomId: "123",
          canonicalUrl: "https://live.douyin.com/123",
          groupId: "group-a",
          schedule: null,
          probeIntervalMinutes: null,
          monitoring: true,
          autoMonitorOnLive: false,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      ],
      runtimes: [
        { roomId: "123", state: "monitoring", liveStatus: "live", asr: [] },
      ],
      snapshots: [
        {
          roomId: "123",
          status: "live",
          anchorName: longName,
          followerCount: 1_264_000,
          viewerCount: 1_234,
          liveDescription: "每周日一二三四六18:00",
          checkedAt: "2026-07-18T12:00:00.000Z",
        },
      ],
    });
    render(<App />);
    const monitor = (await screen.findByText(longName)).closest<HTMLElement>(
      ".room-info",
    )!;
    expect(
      within(monitor).getByText("主播粉丝").parentElement?.textContent,
    ).toContain("126.4 万");
    expect(
      within(monitor).getByText("当前在线").parentElement?.textContent,
    ).toContain("1,234");
    expect(within(monitor).queryByText("直播间人数")).toBeNull();
    const titleRow = within(monitor).getByText(longName).parentElement!;
    expect(titleRow.classList.contains("room-title-actions")).toBe(true);
    expect(within(titleRow).getByRole("button", { name: "播放直播" })).toBeTruthy();
    expect(
      within(monitor).getByText("直播介绍：每周日一二三四六18:00"),
    ).toBeTruthy();
    expect(
      within(monitor).getByRole("button", { name: "退出实时监看" }),
    ).toBeTruthy();
    expect(screen.getAllByText("直播文字").length).toBeGreaterThan(0);
  });

  it("keeps a trusted live status while the monitoring ASR connection starts", async () => {
    vi.mocked(window.duoduo.rooms.list).mockResolvedValue({
      rooms: [
        {
          roomId: "123",
          canonicalUrl: "https://live.douyin.com/123",
          groupId: "group-a",
          schedule: null,
          probeIntervalMinutes: null,
          monitoring: true,
          autoMonitorOnLive: false,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      ],
      runtimes: [
        { roomId: "123", state: "starting", liveStatus: "checking", asr: [] },
      ],
      snapshots: [
        {
          roomId: "123",
          status: "live",
          anchorName: "正在直播的主播",
          followerCount: 88_000,
          viewerCount: 321,
          checkedAt: "2026-07-18T12:00:00.000Z",
        },
      ],
    });

    render(<App />);

    const monitor = (
      await screen.findByText("正在直播的主播")
    ).closest<HTMLElement>(".monitor")!;
    expect(within(monitor).getByText("直播中")).toBeTruthy();
    expect(within(monitor).queryByText("检测中")).toBeNull();
    expect(within(monitor).getByText("正在准备文字记录")).toBeTruthy();
  });

  it("keeps monitored metrics stable while offline or unavailable", async () => {
    vi.mocked(window.duoduo.rooms.list).mockResolvedValue({
      rooms: [
        {
          roomId: "123",
          canonicalUrl: "https://live.douyin.com/123",
          groupId: "group-a",
          schedule: null,
          probeIntervalMinutes: null,
          monitoring: true,
          autoMonitorOnLive: false,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      ],
      runtimes: [
        {
          roomId: "123",
          state: "waiting_for_live",
          liveStatus: "offline",
          asr: [],
        },
      ],
      snapshots: [
        {
          roomId: "123",
          status: "offline",
          anchorName: "测试主播",
          followerCount: 88_000,
          viewerCount: 999,
          checkedAt: "2026-07-18T12:00:00.000Z",
        },
      ],
    });
    render(<App />);
    const monitor = (await screen.findByText("测试主播")).closest<HTMLElement>(
      ".room-info",
    )!;
    expect(
      within(monitor).getByText("主播粉丝").parentElement?.textContent,
    ).toContain("8.8 万");
    expect(
      within(monitor).getByText("上次在线").parentElement?.textContent,
    ).toContain("—");
    expect(within(monitor).queryByText("直播间人数")).toBeNull();
  });

  it("shows transparent labels and opens their local evidence without probing Douyin", async () => {
    vi.mocked(window.duoduo.rooms.listIntelligence).mockResolvedValue([
      {
        roomId: "123",
        generatedAt: "2026-07-17T12:00:00.000Z",
        currentMetrics: {
          followerCount: 1_200_000,
          observedAt: "2026-07-17T12:00:00.000Z",
        },
        labels: [
          {
            kind: "audience_scale",
            text: "百万级粉丝",
            explanation: "最近一次采集到 1,200,000 名关注者。",
            sampleCount: 1,
          },
        ],
      },
    ]);
    vi.mocked(window.duoduo.rooms.getIntelligence).mockResolvedValue({
      roomId: "123",
      generatedAt: "2026-07-17T12:00:00.000Z",
      currentMetrics: {
        followerCount: 1_200_000,
        observedAt: "2026-07-17T12:00:00.000Z",
      },
      labels: [],
      allLabels: [
        {
          kind: "audience_scale",
          text: "百万级粉丝",
          explanation: "最近一次采集到 1,200,000 名关注者。",
          sampleCount: 1,
        },
      ],
      sevenDay: { days: 7, sampleCount: 1, sessionCount: 0, points: [] },
      thirtyDay: { days: 30, sampleCount: 1, sessionCount: 0, points: [] },
      sessions: [],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /百万级粉丝/ }));
    expect(
      await screen.findByRole("dialog", { name: /数据详情/ }),
    ).toBeTruthy();
    expect(window.duoduo.rooms.getIntelligence).toHaveBeenCalledWith("123");
    expect(window.duoduo.rooms.probe).not.toHaveBeenCalled();
  });

  it("manually starts and stops the single player", async () => {
    render(<App />);
    const play = await screen.findByRole("button", { name: "播放直播" });
    fireEvent.click(play);
    expect(window.duoduo.player.play).toHaveBeenCalledWith("123");
    const stops = await screen.findAllByRole("button", { name: "停止播放" });
    fireEvent.click(stops.at(-1)!);
    expect(window.duoduo.player.stop).toHaveBeenCalled();
  });

  it("uses the live monitoring product name", async () => {
    render(<App />);
    expect((await screen.findAllByText("直播监看")).length).toBeGreaterThan(0);
    expect(screen.queryByText("直播间管理")).toBeNull();
  });

  it("shows the delivered app version at the bottom of the sidebar", async () => {
    render(<App />);
    expect(await screen.findByText("v0.6.0")).toBeTruthy();
  });

  it("defaults new rooms to an uncertain schedule", async () => {
    render(<App />);
    await screen.findByRole("tab", { name: /分组 1/ });
    const addRoom = screen.getByRole("button", { name: "添加直播间" });
    await waitFor(() => expect((addRoom as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(addRoom);
    expect(
      ((await screen.findByLabelText("直播时间")) as HTMLSelectElement).value,
    ).toBe("uncertain");
    expect(
      (screen.getByLabelText("检查开播状态频率") as HTMLSelectElement).value,
    ).toBe("default");
  });

  it("adds a room to the currently viewed group instead of the first group", async () => {
    vi.mocked(window.duoduo.groups.list).mockResolvedValue({
      groups: [
        {
          id: "group-a",
          name: "盘中观察",
          parserId: null,
          position: 0,
          roomCount: 1,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
        {
          id: "group-b",
          name: "新建分组",
          parserId: null,
          position: 1,
          roomCount: 0,
          createdAt: "2026-07-20T00:00:00.000Z",
          updatedAt: "2026-07-20T00:00:00.000Z",
        },
      ],
      activeRun: undefined,
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /新建分组/ }));
    fireEvent.click(screen.getByRole("button", { name: "添加直播间" }));

    expect(
      ((await screen.findByLabelText("所属分组")) as HTMLSelectElement).value,
    ).toBe("group-b");
    fireEvent.change(screen.getByPlaceholderText("https://live.douyin.com/123456"), {
      target: { value: "https://live.douyin.com/789" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存直播间" }));
    await waitFor(() =>
      expect(window.duoduo.rooms.add).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: "group-b" }),
      ),
    );
  });

  it("does not redirect adding away from a full current group", async () => {
    vi.mocked(window.duoduo.groups.list).mockResolvedValue({
      groups: [
        {
          id: "group-a",
          name: "盘中观察",
          parserId: null,
          position: 0,
          roomCount: 9,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
        {
          id: "group-b",
          name: "空闲组",
          parserId: null,
          position: 1,
          roomCount: 0,
          createdAt: "2026-07-20T00:00:00.000Z",
          updatedAt: "2026-07-20T00:00:00.000Z",
        },
      ],
      activeRun: undefined,
    });
    render(<App />);
    await screen.findByRole("tab", { name: /盘中观察/ });
    const addRoom = screen.getByRole("button", { name: "添加直播间" });
    await waitFor(() => expect((addRoom as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(addRoom);

    expect(
      await screen.findByText(
        "“盘中观察”已达到 9 个直播间上限，请切换或新建分组",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "添加直播间" })).toBeNull();
  });

  it("opens an existing room for editing", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "更多操作" }));
    const edit = await screen.findByRole("menuitem", { name: "编辑直播间" });
    fireEvent.click(edit);
    expect(
      await screen.findByRole("heading", { name: "编辑直播间" }),
    ).toBeTruthy();
    expect(
      screen.getByDisplayValue("https://live.douyin.com/123"),
    ).toBeTruthy();
  });

  it("shows deletion progress and exposes a failed removal", async () => {
    let rejectRemoval!: (error: Error) => void;
    vi.mocked(window.duoduo.rooms.remove).mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRemoval = reject;
        }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "更多操作" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "删除直播间" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(
      (screen.getByRole("menuitem", { name: "正在删除" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    rejectRemoval(new Error("DELETE_FAILED"));

    expect(
      await screen.findByText(/删除直播间失败：.*DELETE_FAILED/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("menuitem", {
          name: "删除直播间",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("saves the global insight notification timeout without replacing the stored ASR key", async () => {
    window.duoduo.settings.getAsrProvider = vi
      .fn()
      .mockResolvedValue({
        type: "bailian",
        model: "paraformer-realtime-v2",
        secretId: "main",
      });
    render(<App />);
    fireEvent.click(screen.getByText("系统设置"));
    const timeout = await screen.findByLabelText("新观点提醒自动关闭");
    expect((timeout as HTMLSelectElement).value).toBe("30");
    fireEvent.change(timeout, { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "保存提醒设置" }));
    await waitFor(() =>
      expect(
        window.duoduo.settings.saveInsightNotifications,
      ).toHaveBeenCalledWith({ timeoutSeconds: 60 }),
    );
    expect(window.duoduo.settings.saveAsrProvider).not.toHaveBeenCalled();
  });

  it("saves monitored and prepared room intervals from monitoring settings", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("监看设置"));
    fireEvent.change(await screen.findByLabelText("直播状态更新速度"), {
      target: { value: "15" },
    });
    fireEvent.change(screen.getByLabelText("未监看直播间检查频率"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存监看设置" }));
    await waitFor(() =>
      expect(window.duoduo.settings.saveMonitoring).toHaveBeenCalledWith({
        monitoredCheckSeconds: 15,
        preparedCheckMinutes: 10,
      }),
    );
  });

  it("uses main-process progress and starts cooldown only after completion", async () => {
    let publishProbeState!: (value: unknown) => void;
    vi.mocked(window.duoduo.rooms.subscribeProbeState).mockImplementation(
      (listener) => {
        publishProbeState = listener;
        return () => undefined;
      },
    );
    vi.mocked(window.duoduo.rooms.probe).mockResolvedValue({
      mode: "running",
      currentRoomId: "123",
      queuedRoomIds: [],
      manualProbes: [
        { roomId: "123", requestType: "manual", phase: "running" },
      ],
    });
    render(<App />);
    const probe = await screen.findByRole("button", {
      name: "立即检测直播状态",
    });
    fireEvent.click(probe);
    expect(
      screen.queryByRole("button", { name: "60 秒后可再次检测" }),
    ).toBeNull();
    expect(
      (
        (await screen.findByRole("button", {
          name: "正在检测",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    publishProbeState({
      mode: "idle",
      queuedRoomIds: [],
      manualProbes: [
        {
          roomId: "123",
          requestType: "manual",
          phase: "cooldown",
          cooldownUntil: new Date(Date.now() + 60_000).toISOString(),
        },
      ],
    });
    expect(
      (
        (await screen.findByRole("button", {
          name: "60 秒后可再次检测",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(window.duoduo.rooms.probe).toHaveBeenCalledTimes(1);
  });

  it("shows manual detection feedback from the immediate IPC response", async () => {
    vi.mocked(window.duoduo.rooms.probe).mockResolvedValue({
      mode: "running",
      queuedRoomIds: ["123"],
      manualProbes: [{ roomId: "123", requestType: "manual", phase: "queued" }],
    });
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", { name: "立即检测直播状态" }),
    );

    expect(
      await screen.findByRole("button", { name: "等待检测" }),
    ).toBeTruthy();
    expect(screen.getByText("直播间 123")).toBeTruthy();
  });

  it("shows a dedicated verification status", async () => {
    vi.mocked(window.duoduo.rooms.list).mockResolvedValue({
      rooms: [
        {
          roomId: "123",
          canonicalUrl: "https://live.douyin.com/123",
          groupId: "group-a",
          schedule: null,
          probeIntervalMinutes: null,
          monitoring: false,
          createdAt: "2026-07-12T00:00:00.000Z",
          updatedAt: "2026-07-12T00:00:00.000Z",
        },
      ],
      runtimes: [],
      snapshots: [
        {
          roomId: "123",
          status: "verification_required",
          anchorName: "原主播",
          checkedAt: "2026-07-15T01:00:00.000Z",
        },
      ],
    });
    render(<App />);
    expect(await screen.findByText("需要验证")).toBeTruthy();
    expect(screen.getByText("原主播")).toBeTruthy();
  });
});
