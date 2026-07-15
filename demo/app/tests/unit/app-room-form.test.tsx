// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/App";

beforeEach(() => {
  Object.assign(window, { duoduo: {
    app: { getVersion: vi.fn().mockResolvedValue("0.5.1") },
    settings: { getAsrProvider: vi.fn().mockResolvedValue(undefined), saveAsrProvider: vi.fn(), testAsrProvider: vi.fn(), getInsightNotifications: vi.fn().mockResolvedValue({ timeoutSeconds: 30 }), saveInsightNotifications: vi.fn(), getMonitoring: vi.fn().mockResolvedValue({ monitoredCheckSeconds: 30, preparedCheckMinutes: 5 }), saveMonitoring: vi.fn().mockImplementation(async (value) => value) },
    rooms: {
      list: vi.fn().mockResolvedValue({ rooms: [{ roomId: "123", canonicalUrl: "https://live.douyin.com/123", schedule: null, probeIntervalMinutes: null, monitoring: false, createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z" }], runtimes: [], snapshots: [] }),
      add: vi.fn(), update: vi.fn(), remove: vi.fn(), setMonitoring: vi.fn(), probe: vi.fn(), refreshAvatar: vi.fn(), subscribe: vi.fn(() => () => undefined),
    },
    data: { getUsage: vi.fn().mockResolvedValue({ databaseBytes: 0, walBytes: 0, avatarBytes: 0, coverBytes: 0, logBytes: 0, categories: [] }), getRetention: vi.fn().mockResolvedValue({ observationDays: 30, aggregateDays: 365, asrDays: 90, logDays: 30 }), saveRetention: vi.fn(), previewCleanup: vi.fn(), executeCleanup: vi.fn(), compact: vi.fn(), exportBackup: vi.fn(), importBackup: vi.fn() },
    asr: { listBefore: vi.fn().mockResolvedValue({ items: [] }) },
    player: { getState: vi.fn().mockResolvedValue({ activeRoomId: null, status: "stopped" }), play: vi.fn().mockResolvedValue({ activeRoomId: "123", status: "playing" }), stop: vi.fn().mockResolvedValue({ activeRoomId: null, status: "stopped" }), setBounds: vi.fn(), subscribe: vi.fn(() => () => undefined) },
    parsers: { list: vi.fn().mockResolvedValue({ definitions: [], bindings: [], tests: [], llmConfigured: false }), bindRoom: vi.fn() },
    insights: { list: vi.fn().mockResolvedValue({ items: [] }), subscribe: vi.fn(() => () => undefined) },
  } });
});
afterEach(cleanup);

describe("room form", () => {
  it("shows the fixed avatar and current viewers on a live card", async () => {
    vi.mocked(window.duoduo.rooms.list).mockResolvedValue({
      rooms: [{ roomId: "123", canonicalUrl: "https://live.douyin.com/123", schedule: null, probeIntervalMinutes: null, monitoring: false, createdAt: "2026-07-12T00:00:00.000Z", updatedAt: "2026-07-12T00:00:00.000Z" }],
      runtimes: [],
      snapshots: [{ roomId: "123", status: "live", anchorName: "测试主播", avatarPath: "/avatars/123.png", coverPath: "/covers/123.png", viewerCount: 1234, checkedAt: "2026-07-12T01:00:00.000Z" }],
    });
    render(<App />);
    expect(await screen.findByText("1,234 人在线")).toBeTruthy();
    expect((await screen.findByAltText("测试主播头像")).className).toContain("avatar-live");
    expect(await screen.findByTitle("更新头像")).toBeTruthy();
  });

  it("manually starts and stops the single player", async () => {
    render(<App />);
    const play = await screen.findByTitle("播放直播");
    fireEvent.click(play);
    expect(window.duoduo.player.play).toHaveBeenCalledWith("123");
    const stops = await screen.findAllByTitle("停止播放");
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
    expect(await screen.findByText("v0.5.1")).toBeTruthy();
  });

  it("defaults new rooms to an uncertain schedule", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("添加直播间"));
    expect((screen.getByLabelText("直播时间") as HTMLSelectElement).value).toBe("uncertain");
    expect((screen.getByLabelText("状态检测频次") as HTMLSelectElement).value).toBe("default");
  });

  it("opens an existing room for editing", async () => {
    render(<App />);
    const edit = await screen.findByTitle("编辑直播间");
    fireEvent.click(edit);
    expect(screen.getByRole("heading", { name: "编辑直播间" })).toBeTruthy();
    expect(screen.getByDisplayValue("https://live.douyin.com/123")).toBeTruthy();
  });

  it("saves the global insight notification timeout without replacing the stored ASR key", async () => {
    window.duoduo.settings.getAsrProvider = vi.fn().mockResolvedValue({ type: "bailian", model: "paraformer-realtime-v2", secretId: "main" });
    render(<App />);
    fireEvent.click(screen.getByText("系统设置"));
    const timeout = await screen.findByLabelText("新观点提醒自动关闭");
    expect((timeout as HTMLSelectElement).value).toBe("30");
    fireEvent.change(timeout, { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "保存提醒设置" }));
    await waitFor(() => expect(window.duoduo.settings.saveInsightNotifications).toHaveBeenCalledWith({ timeoutSeconds: 60 }));
    expect(window.duoduo.settings.saveAsrProvider).not.toHaveBeenCalled();
  });

  it("saves monitored and prepared room intervals from monitoring settings", async () => {
    render(<App />);
    fireEvent.click(screen.getByText("监看设置"));
    fireEvent.change(await screen.findByLabelText("实时监看状态延迟"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("预备直播间检测频率"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "保存监看设置" }));
    await waitFor(() => expect(window.duoduo.settings.saveMonitoring).toHaveBeenCalledWith({ monitoredCheckSeconds: 15, preparedCheckMinutes: 10 }));
  });
});
