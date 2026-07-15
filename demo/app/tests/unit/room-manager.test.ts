import { describe, expect, it, vi } from "vitest";
import { RoomManager, type MonitorSession } from "../../src/main/rooms/room-manager";

class FakeSession implements MonitorSession {
  closed = false;
  private failure?: (error: Error) => void;
  async start() {}
  async close() { this.closed = true; }
  subscribeFailure(listener: (error: Error) => void) { this.failure = listener; return () => { this.failure = undefined; }; }
  fail(message = "session failed") { this.failure?.(new Error(message)); }
}

describe("RoomManager", () => {
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

  it("waits when a monitored broadcaster is offline and resumes when live again", async () => {
    const sessions: FakeSession[] = [];
    let attempts = 0;
    const manager = new RoomManager(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("ROOM_NOT_LIVE:offline");
      const session = new FakeSession();
      sessions.push(session);
      return session;
    }, { offlineRetryDelayMs: 5 });

    await manager.startMonitoring("a");
    expect(manager.snapshot()[0]).toMatchObject({ state: "waiting_for_live", liveStatus: "offline" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(attempts).toBe(2);
    expect(sessions).toHaveLength(1);
    expect(manager.snapshot()[0]).toMatchObject({ state: "monitoring", liveStatus: "live" });
    await manager.shutdown();
  });

  it("treats an ended live audio track as offline instead of a technical error", async () => {
    const sessions: FakeSession[] = [];
    const manager = new RoomManager(async () => {
      const session = new FakeSession();
      sessions.push(session);
      return session;
    }, { offlineRetryDelayMs: 50 });

    await manager.startMonitoring("a");
    sessions[0].fail("AUDIO_TRACK_ENDED");
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(sessions[0].closed).toBe(true);
    expect(manager.snapshot()[0]).toMatchObject({ state: "waiting_for_live", liveStatus: "offline" });
    expect(sessions).toHaveLength(1);
    await manager.shutdown();
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
