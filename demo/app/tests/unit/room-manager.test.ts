import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomManager, type MonitorSession } from "../../src/main/rooms/room-manager";

class FakeSession implements MonitorSession {
  closed = false;
  private failure?: (error: Error) => void;
  async start() {}
  async close() { this.closed = true; }
  subscribeFailure(listener: (error: Error) => void) { this.failure = listener; return () => { this.failure = undefined; }; }
  fail(message = "session failed") { this.failure?.(new Error(message)); }
}

afterEach(() => vi.useRealTimers());

describe("RoomManager", () => {
  it("marks a room ready as soon as the first audio chunk is captured", async () => {
    const manager = new RoomManager(async () => new FakeSession());
    await manager.startMonitoring("a");
    expect(manager.snapshot()[0].audioReady).toBe(false);
    manager.markAudioReady("a");
    expect(manager.snapshot()[0].audioReady).toBe(true);
    await manager.shutdown();
  });

  it("starts each room once and stops it independently", async () => {
    const created: FakeSession[] = [];
    const manager = new RoomManager(async () => { const session = new FakeSession(); created.push(session); return session; });
    await Promise.all([manager.startMonitoring("a"), manager.startMonitoring("a"), manager.startMonitoring("b")]);
    expect(created).toHaveLength(2);
    expect(manager.snapshot().map((room) => [room.roomId, room.state])).toEqual([["a", "monitoring"], ["b", "monitoring"]]);
    await manager.stopMonitoring("a");
    expect(created[0].closed).toBe(true);
    expect(manager.snapshot().find((room) => room.roomId === "b")?.state).toBe("monitoring");
  });

  it("isolates one room startup failure", async () => {
    const manager = new RoomManager(async (roomId) => {
      if (roomId === "bad") throw new Error("page failed");
      return new FakeSession();
    });
    await Promise.allSettled([manager.startMonitoring("bad"), manager.startMonitoring("good")]);
    expect(manager.snapshot().find((room) => room.roomId === "bad")?.state).toBe("error");
    expect(manager.snapshot().find((room) => room.roomId === "good")?.state).toBe("monitoring");
  });

  it("closes every resource during shutdown", async () => {
    const sessions: FakeSession[] = [];
    const manager = new RoomManager(async () => { const session = new FakeSession(); sessions.push(session); return session; });
    await Promise.all([manager.startMonitoring("a"), manager.startMonitoring("b"), manager.startMonitoring("c")]);
    const report = await manager.shutdown();
    expect(report).toEqual({ sessions: 0 });
    expect(sessions.every((session) => session.closed)).toBe(true);
  });

  it("recovers one failed room without interrupting another room", async () => {
    const sessions = new Map<string, FakeSession[]>();
    const manager = new RoomManager(async (roomId) => {
      const session = new FakeSession();
      sessions.set(roomId, [...(sessions.get(roomId) ?? []), session]);
      return session;
    }, { retryDelayMs: 0, maxRetries: 2 });
    await Promise.all([manager.startMonitoring("a"), manager.startMonitoring("b")]);
    sessions.get("a")![0].fail("audio track ended");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sessions.get("a")).toHaveLength(2);
    expect(sessions.get("a")![0].closed).toBe(true);
    expect(manager.snapshot().find((room) => room.roomId === "a")?.state).toBe("monitoring");
    expect(sessions.get("b")).toHaveLength(1);
    expect(manager.snapshot().find((room) => room.roomId === "b")?.state).toBe("monitoring");
  });

  it("enters error after bounded recovery attempts", async () => {
    let creations = 0;
    const first = new FakeSession();
    const manager = new RoomManager(async () => {
      creations += 1;
      if (creations === 1) return first;
      throw new Error("still unavailable");
    }, { retryDelayMs: 0, maxRetries: 2 });
    await manager.startMonitoring("a"); first.fail();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(creations).toBe(3);
    expect(manager.snapshot()[0].state).toBe("error");
  });

  it("exits monitoring when the initial room check finds the broadcaster offline", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const onOffline = vi.fn();
    const manager = new RoomManager(async () => {
      attempts += 1;
      throw new Error("ROOM_NOT_LIVE:offline");
    }, { offlineRetryDelayMs: 5, onOffline });

    await manager.startMonitoring("a");
    expect(onOffline).toHaveBeenCalledOnce();
    expect(manager.snapshot()[0]).toMatchObject({ state: "stopped", liveStatus: "offline", error: undefined });
    await vi.advanceTimersByTimeAsync(100);
    expect(attempts).toBe(1);
    await manager.shutdown();
  });

  it("identifies technical recovery separately from an offline retry", async () => {
    const reasons: Array<string | undefined> = [];
    const sessions: FakeSession[] = [];
    const manager = new RoomManager(async (_roomId, _signal, reason) => {
      reasons.push(reason);
      const session = new FakeSession();
      sessions.push(session);
      return session;
    }, { retryDelayMs: 0, maxRetries: 1 });

    await manager.startMonitoring("a");
    sessions[0].fail("ROOM_RENDERER_GONE:crashed");
    await vi.waitFor(() => expect(sessions).toHaveLength(2));

    expect(reasons).toEqual(["user_start", "technical_retry"]);
    await manager.shutdown();
  });

  it("exits monitoring when a technical recovery finds the broadcast ended", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const first = new FakeSession();
    const onOffline = vi.fn();
    const manager = new RoomManager(async () => {
      attempts += 1;
      if (attempts === 1) return first;
      throw new Error("ROOM_NOT_LIVE:offline");
    }, { retryDelayMs: 0, maxRetries: 1, offlineRetryDelayMs: 50, onOffline });

    await manager.startMonitoring("a");
    first.fail("BAILIAN_RESPONSE_TIMEOUT");
    await vi.waitFor(() => expect(onOffline).toHaveBeenCalledOnce());

    expect(manager.snapshot()[0]).toMatchObject({
      state: "stopped",
      liveStatus: "offline",
      error: undefined,
    });
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(attempts).toBe(2);
    await manager.shutdown();
  });

  it("recovers a lost audio track without treating it as broadcaster offline", async () => {
    const sessions: FakeSession[] = [];
    const onOffline = vi.fn();
    const manager = new RoomManager(async () => {
      const session = new FakeSession();
      sessions.push(session);
      return session;
    }, { retryDelayMs: 0, onOffline });

    await manager.startMonitoring("a");
    sessions[0].fail("AUDIO_TRACK_ENDED");
    await vi.waitFor(() => expect(sessions).toHaveLength(2));
    expect(onOffline).not.toHaveBeenCalled();
    expect(sessions[0].closed).toBe(true);
    expect(manager.snapshot()[0]).toMatchObject({ state: "monitoring", liveStatus: "live", error: undefined });
    await manager.shutdown();
  });

  it("tries session recovery without closing the page or creating another session", async () => {
    const first = Object.assign(new FakeSession(), { recover: vi.fn(async () => true) });
    const factory = vi.fn(async () => first);
    const manager = new RoomManager(factory, { retryDelayMs: 0 });
    await manager.startMonitoring("a");
    first.fail("BAILIAN_RESPONSE_TIMEOUT");
    await vi.waitFor(() => expect(first.recover).toHaveBeenCalledOnce());
    expect(first.closed).toBe(false);
    expect(factory).toHaveBeenCalledOnce();
    expect(manager.snapshot()[0]).toMatchObject({ state: "monitoring", liveStatus: "live" });
    await manager.shutdown();
  });

  it("retries local ASR recovery on the same page when opening the replacement fails", async () => {
    const first = Object.assign(new FakeSession(), { recover: vi.fn().mockRejectedValueOnce(new Error("ASR_OPEN_TIMEOUT")).mockResolvedValue(true) });
    const factory = vi.fn(async () => first);
    const manager = new RoomManager(factory, { retryDelayMs: 0 });
    await manager.startMonitoring("a");
    first.fail("BAILIAN_RESPONSE_TIMEOUT");
    await vi.waitFor(() => expect(first.recover).toHaveBeenCalledTimes(2));
    expect(first.closed).toBe(false);
    expect(factory).toHaveBeenCalledOnce();
    expect(manager.snapshot()[0].state).toBe("monitoring");
    await manager.shutdown();
  });

  it("does not restore monitoring after stop cancels an in-flight local recovery", async () => {
    let resolveRecovery!: (recovered: boolean) => void;
    const first = Object.assign(new FakeSession(), { recover: vi.fn(() => new Promise<boolean>((resolve) => { resolveRecovery = resolve; })) });
    const manager = new RoomManager(async () => first, { retryDelayMs: 0 });
    await manager.startMonitoring("a");
    first.fail("BAILIAN_RESPONSE_TIMEOUT");
    await vi.waitFor(() => expect(first.recover).toHaveBeenCalledOnce());
    const stopping = manager.stopMonitoring("a");
    resolveRecovery(true);
    await stopping;
    expect(first.closed).toBe(true);
    expect(manager.snapshot()[0].state).toBe("stopped");
  });

  it("cancels the offline retry when monitoring is disabled", async () => {
    let attempts = 0;
    const manager = new RoomManager(async () => {
      attempts += 1;
      throw new Error("ROOM_NOT_LIVE:offline");
    }, { offlineRetryDelayMs: 10 });

    await manager.startMonitoring("a");
    await manager.stopMonitoring("a");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(attempts).toBe(1);
    expect(manager.snapshot()[0].state).toBe("stopped");
  });

  it("stops technical retry attempts while access is paused and resumes only after confirmation", async () => {
    const sessions: FakeSession[] = [];
    let accessPaused = false;
    let attempts = 0;
    const manager = new RoomManager(async () => {
      attempts += 1;
      if (accessPaused) throw new Error("ACCESS_VERIFICATION_PAUSED");
      const session = new FakeSession();
      sessions.push(session);
      return session;
    }, { retryDelayMs: 0, maxRetries: 3 });

    await manager.startMonitoring("a");
    accessPaused = true;
    sessions[0].fail("ROOM_RENDERER_GONE:crashed");
    await vi.waitFor(() => expect(attempts).toBe(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(attempts).toBe(2);
    expect(manager.snapshot()[0]).toMatchObject({ state: "recovering", liveStatus: "verification_required" });

    accessPaused = false;
    manager.resumeAccessRetries();
    await vi.waitFor(() => expect(attempts).toBe(3));
    expect(manager.snapshot()[0]).toMatchObject({ state: "monitoring", liveStatus: "live" });
    await manager.shutdown();
  });

  it("opens the circuit when nominally recovered sessions keep failing", async () => {
    const sessions: FakeSession[] = [];
    const manager = new RoomManager(async () => {
      const session = new FakeSession();
      sessions.push(session);
      return session;
    }, { retryDelayMs: 0, maxRetries: 1, maxFailureCycles: 2, stabilityWindowMs: 60_000 });

    await manager.startMonitoring("a");
    sessions[0].fail("ROOM_RENDERER_GONE:crashed");
    await new Promise((resolve) => setTimeout(resolve, 5));
    sessions[1].fail("ROOM_RENDERER_GONE:crashed");
    await new Promise((resolve) => setTimeout(resolve, 5));
    sessions[2].fail("ROOM_RENDERER_GONE:crashed");
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(sessions).toHaveLength(3);
    expect(manager.snapshot()[0]).toMatchObject({ state: "error", liveStatus: "page_error", error: "ROOM_RENDERER_GONE:crashed" });
    await manager.shutdown();
  });

  it("timestamps final ASR, persists it, and keeps bounded hot data", async () => {
    const persist = vi.fn();
    const manager = new RoomManager(async () => new FakeSession(), { maxHotAsr: 3, persistFinalAsr: persist });
    await manager.startMonitoring("a");
    for (let index = 0; index < 5; index += 1) {
      manager.appendAsr({ roomId: "a", sessionId: "session", segmentId: `segment-${index}`, startMs: index, endMs: index + 1, text: `text-${index}`, isFinal: true });
    }
    expect(manager.snapshot()[0].asr.map((item) => item.text)).toEqual(["text-2", "text-3", "text-4"]);
    expect(persist).toHaveBeenCalledTimes(5);
    expect(persist.mock.calls[0][0].occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("starts a new monitoring session without previous hot ASR", async () => {
    const manager = new RoomManager(async () => new FakeSession());
    await manager.startMonitoring("a");
    manager.appendAsr({ roomId: "a", sessionId: "old-session", segmentId: "old", startMs: 0, endMs: 1, text: "上一场内容", isFinal: true });
    await manager.stopMonitoring("a");
    await manager.startMonitoring("a");
    expect(manager.snapshot()[0].asr).toEqual([]);
  });
});
