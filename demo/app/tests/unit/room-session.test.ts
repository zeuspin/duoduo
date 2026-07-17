import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    async capturePage() { return { toPNG: () => Buffer.from("png") }; }
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

afterEach(() => vi.useRealTimers());

describe("RoomSession", () => {
  beforeEach(() => {
    harness.events.length = 0;
    harness.probeRoom.mockReset();
    harness.evaluateNow.mockReset();
    harness.inspectCurrentRoom.mockReset();
    harness.probeRoom.mockImplementation(async () => { harness.events.push("probe"); return { status: "live" as const }; });
    harness.evaluateNow.mockResolvedValue(true);
    harness.inspectCurrentRoom.mockResolvedValue({ hasVideo: true, videoReadyState: 4, currentTime: 20, paused: false, audioTrackState: "live", text: "", viewerCount: 200, metricQuality: "partial" });
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

    expect(harness.events.slice(0, 5)).toEqual(["gate:start", "window:create", "probe", "gate:end", "asr:open"]);
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
