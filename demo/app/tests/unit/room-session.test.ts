import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserWindow } from "electron";
import type { PreparedRoomPage } from "../../src/main/rooms/prepared-page-lease";

const harness = vi.hoisted(() => ({
  events: [] as string[],
  probeRoom: vi.fn(),
  evaluateNow: vi.fn(),
  inspectCurrentRoom: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: class {
    destroyed = false;
    webContents = {
      id: 7,
      setAudioMuted: vi.fn(),
      setUserAgent: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    };
    constructor(options: { webPreferences: { session: unknown } }) {
      harness.events.push("window:create");
      if (!options.webPreferences.session) throw new Error("SESSION_REQUIRED");
    }
    async capturePage() { harness.events.push("capture"); return { toPNG: () => Buffer.from("png") }; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; harness.events.push("window:destroy"); }
  },
  session: { fromPartition: vi.fn(() => ({ webRequest: { onErrorOccurred: vi.fn() }, setPermissionRequestHandler: vi.fn() })) },
}));

vi.mock("../../src/main/rooms/live-probe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/main/rooms/live-probe")>();
  return { ...actual, probeRoom: harness.probeRoom, evaluateNow: harness.evaluateNow, inspectCurrentRoom: harness.inspectCurrentRoom };
});

import { RoomSession, type RoomNavigationGate } from "../../src/main/rooms/room-session";
import { RoomManager } from "../../src/main/rooms/room-manager";
import type { AsrSession } from "../../src/main/asr/types";
import { START_PAGE_CAPTURE_SCRIPT, STOP_PAGE_CAPTURE_SCRIPT } from "../../src/main/audio/capture-script";

function recoveryFixture(retryDelayMs = 0) {
  const makeAsr = () => {
    const events = new Set<Parameters<AsrSession["subscribe"]>[0]>();
    const failures = new Set<(error: Error) => void>();
    return {
      write: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
      subscribe(listener: Parameters<AsrSession["subscribe"]>[0]) { events.add(listener); return () => events.delete(listener); },
      subscribeFailure(listener: (error: Error) => void) { failures.add(listener); return () => failures.delete(listener); },
      fail(message: string) { for (const listener of failures) listener(new Error(message)); },
      emit(text: string) { for (const listener of events) listener({ roomId: "123", sessionId: text, segmentId: text, startMs: 0, endMs: 100, text, isFinal: true }); },
    };
  };
  const first = makeAsr();
  const replacement = makeAsr();
  const provider = { testConnection: vi.fn(), open: vi.fn().mockResolvedValueOnce(first).mockResolvedValue(replacement) };
  let audio!: (bytes: Buffer) => void | Promise<void>;
  let ended!: () => void;
  const router = { register: vi.fn((_token, _sender, listener, onEnded) => { audio = listener; ended = onEnded; return vi.fn(); }) };
  const controller = new AbortController();
  const gate = vi.fn(async (run) => (await run()).value);
  const onAsr = vi.fn();
  const session = new RoomSession("123", "https://live.douyin.com/123", provider, router as never, onAsr, controller.signal, {} as never, gate);
  const factory = vi.fn(async () => session);
  const manager = new RoomManager(factory, { retryDelayMs });
  return { first, replacement, provider, router, controller, gate, onAsr, session, factory, manager, audio: (bytes: Buffer) => audio(bytes), ended: () => ended() };
}

afterEach(() => vi.useRealTimers());

describe("RoomSession", () => {
  beforeEach(() => {
    harness.events.length = 0;
    harness.probeRoom.mockReset();
    harness.evaluateNow.mockReset();
    harness.inspectCurrentRoom.mockReset();
    harness.probeRoom.mockImplementation(async (_webContents, _url, _timeoutMs, options) => {
      harness.events.push("probe:start");
      await options?.beforeProfile?.({ status: "live" });
      harness.events.push("probe:profile");
      return { status: "live" as const, followerCount: 35_000 };
    });
    harness.evaluateNow.mockResolvedValue(true);
    harness.inspectCurrentRoom.mockResolvedValue({ hasVideo: true, videoReadyState: 4, currentTime: 20, paused: false, audioTrackState: "live", text: "", viewerCount: 200, metricQuality: "partial" });
  });

  it("reconnects ASR and routes audio and text through the replacement while preserving capture and the page", async () => {
    const fixture = recoveryFixture();
    await fixture.manager.startMonitoring("123");
    fixture.first.fail("BAILIAN_RESPONSE_TIMEOUT");
    await vi.waitFor(() => expect(fixture.provider.open).toHaveBeenCalledTimes(2));
    await fixture.audio(Buffer.from([1, 2]));
    fixture.replacement.emit("恢复后的文字");
    expect(fixture.replacement.write).toHaveBeenCalledWith(expect.objectContaining({ bytes: Buffer.from([1, 2]) }));
    expect(fixture.onAsr).toHaveBeenCalledWith(expect.objectContaining({ text: "恢复后的文字" }));
    fixture.first.emit("旧连接的文字");
    expect(fixture.onAsr).toHaveBeenCalledTimes(1);
    expect(fixture.first.close).toHaveBeenCalledOnce();
    expect(fixture.gate).toHaveBeenCalledOnce();
    expect(fixture.factory).toHaveBeenCalledOnce();
    expect(fixture.router.register).toHaveBeenCalledOnce();
    expect(harness.events).not.toContain("window:destroy");
    expect(harness.evaluateNow.mock.calls.map((call) => call[1])).toEqual([START_PAGE_CAPTURE_SCRIPT]);
    expect(fixture.manager.snapshot()[0].state).toBe("monitoring");
    await fixture.manager.shutdown();
  });

  it("rebinds an ended capture track on a live page without reopening ASR or navigating", async () => {
    const fixture = recoveryFixture();
    await fixture.manager.startMonitoring("123");
    fixture.ended();
    await vi.waitFor(() => expect(harness.evaluateNow).toHaveBeenCalledTimes(3));
    expect(harness.evaluateNow.mock.calls.map((call) => call[1])).toEqual([START_PAGE_CAPTURE_SCRIPT, STOP_PAGE_CAPTURE_SCRIPT, START_PAGE_CAPTURE_SCRIPT]);
    expect(fixture.provider.open).toHaveBeenCalledOnce();
    expect(fixture.gate).toHaveBeenCalledOnce();
    expect(harness.events).not.toContain("window:destroy");
    expect(fixture.manager.snapshot()[0]).toMatchObject({ state: "monitoring", liveStatus: "live" });
    await fixture.manager.shutdown();
  });

  it("exits only when a capture failure is accompanied by explicit broadcast-end evidence", async () => {
    const fixture = recoveryFixture();
    await fixture.manager.startMonitoring("123");
    harness.inspectCurrentRoom.mockResolvedValue({ hasVideo: true, videoReadyState: 4, currentTime: 20, paused: true, audioTrackState: "ended", text: "直播已结束" });
    fixture.ended();
    await vi.waitFor(() => expect(fixture.manager.snapshot()[0].state).toBe("stopped"));
    expect(fixture.provider.open).toHaveBeenCalledOnce();
    expect(fixture.factory).toHaveBeenCalledOnce();
    expect(harness.events).toContain("window:destroy");
    await fixture.manager.shutdown();
  });

  it("detects missing PCM callbacks even while the video keeps progressing", async () => {
    vi.useFakeTimers();
    const fixture = recoveryFixture();
    let videoTime = 0;
    harness.inspectCurrentRoom.mockImplementation(async () => ({ hasVideo: true, videoReadyState: 4, currentTime: ++videoTime, paused: false, audioTrackState: "live", text: "" }));
    await fixture.manager.startMonitoring("123");
    await vi.advanceTimersByTimeAsync(45_000);
    expect(harness.evaluateNow.mock.calls.map((call) => call[1])).toContain(STOP_PAGE_CAPTURE_SCRIPT);
    expect(fixture.factory).toHaveBeenCalledOnce();
    expect(fixture.manager.snapshot()[0].state).toBe("monitoring");
    await fixture.manager.shutdown();
  });

  it("rebinds a replaced video even if the old live audio track keeps sending PCM", async () => {
    vi.useFakeTimers();
    const fixture = recoveryFixture();
    let videoTime = 0;
    harness.inspectCurrentRoom.mockImplementation(async () => ({ hasVideo: true, videoReadyState: 4, currentTime: ++videoTime, paused: false, audioTrackState: "live", captureVideoConnected: false, text: "" }));
    await fixture.manager.startMonitoring("123");
    const pcm = setInterval(() => { void fixture.audio(Buffer.from([1, 2])); }, 1_000);
    await vi.advanceTimersByTimeAsync(30_000);
    clearInterval(pcm);
    expect(harness.evaluateNow.mock.calls.map((call) => call[1])).toContain(STOP_PAGE_CAPTURE_SCRIPT);
    expect(fixture.factory).toHaveBeenCalledOnce();
    expect(fixture.provider.open).toHaveBeenCalledOnce();
    await fixture.manager.shutdown();
  });

  it("bounds capture reset so an unresponsive renderer falls back to a page restart", async () => {
    vi.useFakeTimers();
    const fixture = recoveryFixture();
    await fixture.session.start();
    harness.evaluateNow.mockImplementation((_contents, script) => script === STOP_PAGE_CAPTURE_SCRIPT ? new Promise(() => undefined) : Promise.resolve(true));
    const recovering = fixture.session.recover(new Error("AUDIO_TRACK_ENDED"));
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(recovering).resolves.toBe(false);
    harness.evaluateNow.mockResolvedValue(true);
    await fixture.session.close();
  });

  it("allows stop to cancel ASR opening during a local reconnect", async () => {
    const fixture = recoveryFixture();
    await fixture.manager.startMonitoring("123");
    fixture.provider.open.mockImplementationOnce((_roomId: string, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("ASR_OPEN_ABORTED")), { once: true });
    }));
    fixture.first.fail("BAILIAN_RESPONSE_TIMEOUT");
    await vi.waitFor(() => expect(fixture.provider.open).toHaveBeenCalledTimes(2));
    await fixture.manager.stopMonitoring("123");
    expect(fixture.manager.snapshot()[0].state).toBe("stopped");
    expect(harness.events.filter((event) => event === "window:destroy")).toHaveLength(1);
  });

  it("does not lose an ASR failure arriving while capture recovery is in progress", async () => {
    const fixture = recoveryFixture();
    await fixture.manager.startMonitoring("123");
    harness.evaluateNow.mockImplementation(async (_contents, script) => {
      if (script === STOP_PAGE_CAPTURE_SCRIPT) fixture.first.fail("BAILIAN_RESPONSE_TIMEOUT");
      return true;
    });
    fixture.ended();
    await vi.waitFor(() => expect(fixture.provider.open).toHaveBeenCalledTimes(2));
    await fixture.audio(Buffer.from([1, 2]));
    expect(fixture.replacement.write).toHaveBeenCalledOnce();
    expect(fixture.manager.snapshot()[0].state).toBe("monitoring");
    await fixture.manager.shutdown();
  });

  it("preserves an ASR failure arriving during the retry delay before capture recovery", async () => {
    vi.useFakeTimers();
    const fixture = recoveryFixture(500);
    await fixture.manager.startMonitoring("123");
    fixture.ended();
    fixture.first.fail("BAILIAN_RESPONSE_TIMEOUT");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.provider.open).toHaveBeenCalledTimes(2);
    expect(fixture.manager.snapshot()[0].state).toBe("monitoring");
    expect(fixture.factory).toHaveBeenCalledOnce();
    await fixture.manager.shutdown();
  });

  it("requests a page restart when the capture page can no longer be inspected", async () => {
    const fixture = recoveryFixture();
    await fixture.session.start();
    harness.inspectCurrentRoom.mockRejectedValue(new Error("Execution context destroyed"));
    await expect(fixture.session.recover(new Error("AUDIO_TRACK_ENDED"))).resolves.toBe(false);
    await fixture.session.close();
  });

  it("does not hang stopping while a page restart waits in the navigation queue", async () => {
    const controller = new AbortController();
    const session = new RoomSession("123", "https://live.douyin.com/123", { testConnection: vi.fn(), open: vi.fn() }, { register: vi.fn() } as never, vi.fn(), controller.signal, {} as never, () => new Promise(() => undefined));
    const starting = session.start();
    const rejected = expect(starting).rejects.toThrow("ROOM_START_ABORTED");
    controller.abort();
    await rejected;
    expect(harness.events).not.toContain("window:create");
  });

  it("creates and probes the room inside the navigation gate before opening ASR", async () => {
    const provider = {
      testConnection: vi.fn(),
      open: vi.fn(async () => {
        harness.events.push("asr:open");
        return { write: vi.fn(), close: vi.fn(), subscribe: vi.fn(() => () => undefined) };
      }),
    };
    const captureRouter = { register: vi.fn(() => () => undefined) };
    const browserSession = {};
    const gate: RoomNavigationGate = async (run) => {
      harness.events.push("gate:start");
      const outcome = await run();
      harness.events.push("gate:end");
      return outcome.value;
    };
    const session = new RoomSession(
      "123",
      "https://live.douyin.com/123",
      provider,
      captureRouter as never,
      vi.fn(),
      new AbortController().signal,
      browserSession as never,
      gate,
    );

    await session.start();

    expect(harness.events.slice(0, 6)).toEqual(["gate:start", "window:create", "probe:start", "capture", "probe:profile", "gate:end"]);
    expect(harness.events).toContain("asr:open");
    expect(provider.open).toHaveBeenCalledTimes(1);
    await session.close();
  });

  it("adopts a prepared live page and starts ASR without navigation or another probe", async () => {
    const adoptedWindow = new BrowserWindow({ webPreferences: { session: {} as never } }) as never;
    harness.events.length = 0;
    const provider = {
      testConnection: vi.fn(),
      open: vi.fn(async () => {
        harness.events.push("asr:open");
        return { write: vi.fn(), close: vi.fn(), subscribe: vi.fn(() => () => undefined) };
      }),
    };
    const gate: RoomNavigationGate = vi.fn(async (run) => (await run()).value);
    const preparedPage: PreparedRoomPage = {
      roomId: "123",
      window: adoptedWindow,
      captureToken: "prepared-token",
      probe: { status: "live", viewerCount: 321 },
    };
    const session = new RoomSession(
      "123",
      "https://live.douyin.com/123",
      provider,
      { register: vi.fn(() => () => undefined) } as never,
      vi.fn(),
      new AbortController().signal,
      {} as never,
      gate,
      undefined,
      undefined,
      undefined,
      30,
      300_000,
      Date.now,
      preparedPage,
    );

    await session.start();

    expect(gate).not.toHaveBeenCalled();
    expect(harness.probeRoom).not.toHaveBeenCalled();
    expect(harness.events).toEqual(["asr:open"]);
    expect(provider.open).toHaveBeenCalledTimes(1);
    await session.close();
  });

  it("reports verification through the gate before closing the blocked page", async () => {
    harness.probeRoom.mockResolvedValue({ status: "verification_required" });
    const provider = { testConnection: vi.fn(), open: vi.fn() };
    const captureRouter = { register: vi.fn() };
    let verificationRequired: boolean | undefined;
    const gate: RoomNavigationGate = async (run) => {
      const outcome = await run();
      verificationRequired = outcome.verificationRequired;
      harness.events.push("gate:observed");
      return outcome.value;
    };
    const session = new RoomSession(
      "123",
      "https://live.douyin.com/123",
      provider as never,
      captureRouter as never,
      vi.fn(),
      new AbortController().signal,
      {} as never,
      gate,
    );

    await expect(session.start()).rejects.toThrow("ROOM_NOT_LIVE:verification_required");

    expect(verificationRequired).toBe(true);
    expect(provider.open).not.toHaveBeenCalled();
    expect(harness.events).toContain("gate:observed");
    expect(harness.events.at(-1)).toBe("window:destroy");
  });

  it("persists changed metrics from the open page at most once per five minutes without another probe", async () => {
    vi.useFakeTimers();
    harness.probeRoom.mockResolvedValue({ status: "live", viewerCount: 100, metricQuality: "partial" });
    const onMetricSnapshot = vi.fn(async () => undefined);
    const provider = {
      testConnection: vi.fn(),
      open: vi.fn(async () => ({ write: vi.fn(), close: vi.fn(), subscribe: vi.fn(() => () => undefined) })),
    };
    const session = new RoomSession(
      "123",
      "https://live.douyin.com/123",
      provider,
      { register: vi.fn(() => () => undefined) } as never,
      vi.fn(),
      new AbortController().signal,
      {} as never,
      async (run) => (await run()).value,
      vi.fn(),
      onMetricSnapshot,
      undefined,
      10,
      300_000,
      () => Date.now(),
    );
    await session.start();

    await vi.advanceTimersByTimeAsync(299_999);
    expect(onMetricSnapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onMetricSnapshot).toHaveBeenCalledTimes(1);
    expect(harness.probeRoom).toHaveBeenCalledTimes(1);

    await session.close();
    vi.useRealTimers();
  });
});
