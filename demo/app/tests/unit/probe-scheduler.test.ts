import { describe, expect, it, vi } from "vitest";
import { estimateSafeBatchDurationMs, ProbeScheduler, splitPreparedStartupRooms } from "../../src/main/rooms/probe-scheduler";
import type { PreparedProbeState } from "../../src/shared/contracts";

describe("ProbeScheduler", () => {
  it("restores rooms without a final snapshot as prioritized initial probes", () => {
    expect(splitPreparedStartupRooms(["new", "stuck", "known"], [
      { roomId: "stuck", status: "checking" },
      { roomId: "known", status: "offline" },
    ])).toEqual({ initialRoomIds: ["new", "stuck"], refreshRoomIds: ["known"] });
  });
  it("estimates the earliest safe batch completion across rolling-hour limits", () => {
    expect(estimateSafeBatchDurationMs(1, 60_000, 10)).toBe(0);
    expect(estimateSafeBatchDurationMs(10, 60_000, 10)).toBe(9 * 60_000);
    expect(estimateSafeBatchDurationMs(11, 60_000, 10)).toBe(60 * 60_000);
    expect(estimateSafeBatchDurationMs(18, 60_000, 10)).toBe(67 * 60_000);
  });

  it("prevents overlapping probes for the same room", async () => {
    let release!: () => void;
    const probe = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const scheduler = new ProbeScheduler(probe);
    const first = scheduler.runNow("123");
    const second = scheduler.runNow("123");
    expect(probe).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
  });

  it("uses the room interval override or global default", () => {
    const scheduler = new ProbeScheduler(async () => undefined, { defaultIntervalMinutes: 5 });
    expect(scheduler.intervalMs({ probeIntervalMinutes: 1 })).toBe(60_000);
    expect(scheduler.intervalMs({ probeIntervalMinutes: null })).toBe(300_000);
  });

  it("cancels delayed initial probes during shutdown", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => undefined);
    const scheduler = new ProbeScheduler(probe);
    scheduler.schedule("123", { probeIntervalMinutes: null }, 500);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(probe).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("applies a changed global interval when a room is rescheduled", () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => undefined);
    const scheduler = new ProbeScheduler(probe, { defaultIntervalMinutes: 5 });
    scheduler.schedule("123", { probeIntervalMinutes: null });
    scheduler.setDefaultIntervalMinutes(10);
    scheduler.schedule("123", { probeIntervalMinutes: null });
    expect(scheduler.intervalMs({ probeIntervalMinutes: null })).toBe(600_000);
    vi.advanceTimersByTime(300_000);
    expect(probe).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("limits probes across different rooms to the configured concurrency", async () => {
    const releases: Array<() => void> = [];
    const probe = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)));
    const scheduler = new ProbeScheduler(probe, { maxConcurrency: 1 });
    const first = scheduler.runNow("a");
    const second = scheduler.runNow("b");
    expect(probe).toHaveBeenCalledTimes(1);
    releases.shift()!();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(probe).toHaveBeenCalledTimes(2);
    releases.shift()!();
    await second;
  });

  it("promotes a requested room ahead of queued automatic probes", async () => {
    const order: string[] = [];
    const releases: Array<() => void> = [];
    const scheduler = new ProbeScheduler((roomId) => new Promise((resolve) => {
      order.push(roomId);
      releases.push(() => resolve({ status: "offline" }));
    }), { maxConcurrency: 1 });
    const active = scheduler.runNow("a", "scheduled");
    const automatic = scheduler.runNow("b", "scheduled");
    const requested = scheduler.runNow("c", "manual");

    expect(order).toEqual(["a"]);
    expect(scheduler.state().manualProbes).toContainEqual({ roomId: "c", requestType: "manual", phase: "queued" });
    releases.shift()!();
    await active;
    await vi.waitFor(() => expect(order).toEqual(["a", "c"]));
    releases.shift()!();
    await requested;
    await vi.waitFor(() => expect(order).toEqual(["a", "c", "b"]));
    releases.shift()!();
    await automatic;
  });

  it("upgrades an already queued automatic room without duplicating it", async () => {
    const order: string[] = [];
    const releases: Array<() => void> = [];
    const scheduler = new ProbeScheduler((roomId) => new Promise((resolve) => {
      order.push(roomId);
      releases.push(() => resolve({ status: "offline" }));
    }), { maxConcurrency: 1 });
    const active = scheduler.runNow("a", "scheduled");
    const automatic = scheduler.runNow("b", "scheduled");
    const upgraded = scheduler.runNow("b", "manual");

    expect(upgraded).toBe(automatic);
    expect(scheduler.state().manualProbes).toContainEqual({ roomId: "b", requestType: "manual", phase: "queued" });
    releases.shift()!();
    await active;
    await vi.waitFor(() => expect(order).toEqual(["a", "b"]));
    releases.shift()!();
    await Promise.all([automatic, upgraded]);
    expect(order).toEqual(["a", "b"]);
  });

  it("starts manual cooldown only after a successful probe completes", async () => {
    let now = 1_000;
    let release!: () => void;
    const scheduler = new ProbeScheduler(() => new Promise((resolve) => {
      release = () => resolve({ status: "offline" });
    }), { now: () => now, manualCooldownMs: 60_000 });

    const task = scheduler.runNow("a", "manual");
    expect(scheduler.state().manualProbes).toContainEqual({ roomId: "a", requestType: "manual", phase: "running" });
    expect(scheduler.state().manualProbes.some((item) => item.phase === "cooldown")).toBe(false);
    now += 10_000;
    release();
    await task;
    expect(scheduler.state().manualProbes).toContainEqual({ roomId: "a", requestType: "manual", phase: "cooldown", cooldownUntil: new Date(71_000).toISOString() });
  });

  it("publishes initial progress without adding a manual cooldown", async () => {
    let release!: () => void;
    const scheduler = new ProbeScheduler(() => new Promise((resolve) => {
      release = () => resolve({ status: "offline" });
    }));
    const task = scheduler.runNow("new-room", "initial");
    expect(scheduler.state().manualProbes).toContainEqual({ roomId: "new-room", requestType: "initial", phase: "running" });
    release();
    await task;
    expect(scheduler.state().manualProbes).toEqual([]);
  });

  it("runs a startup batch serially without scheduling recurring probes", async () => {
    const order: string[] = [];
    let release!: () => void;
    const scheduler = new ProbeScheduler((roomId) => new Promise((resolve) => {
      order.push(roomId);
      release = () => resolve({ status: "offline" });
    }));
    const batch = scheduler.runStartup(["a", "b"]);
    expect(order).toEqual(["a"]);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["a", "b"]);
    release();
    await batch;
  });

  it("rejects a repeated manual probe during the 60 second cooldown", async () => {
    let now = 1_000;
    const probe = vi.fn(async () => ({ status: "offline" as const }));
    const scheduler = new ProbeScheduler(probe, { now: () => now, manualCooldownMs: 60_000 });
    await scheduler.runNow("123");
    await expect(scheduler.runNow("123")).rejects.toThrow("PROBE_COOLDOWN");
    now += 60_000;
    await scheduler.runNow("123");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("stops the remaining startup queue after a verification page", async () => {
    const probe = vi.fn(async (roomId: string) => ({ status: roomId === "a" ? "verification_required" as const : "offline" as const }));
    const scheduler = new ProbeScheduler(probe);
    await scheduler.runStartup(["a", "b", "c"]);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith("a", "startup");
  });

  it("clears already queued manual probes after a verification page", async () => {
    let release!: (result: { status: string }) => void;
    const probe = vi.fn((roomId: string) => roomId === "a" ? new Promise<{ status: string }>((resolve) => { release = resolve; }) : Promise.resolve({ status: "offline" }));
    const scheduler = new ProbeScheduler(probe);
    const first = scheduler.runNow("a");
    const queued = scheduler.runNow("b");
    release({ status: "verification_required" });
    await Promise.all([first, queued]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("jitters recurring delays to avoid synchronized platform requests", () => {
    const scheduler = new ProbeScheduler(async () => undefined, { defaultIntervalMinutes: 5, jitterRatio: 0.2, random: () => 0 });
    expect(scheduler.jitteredIntervalMs({ probeIntervalMinutes: null })).toBe(240_000);
  });

  it("runs a manual batch serially and publishes progress", async () => {
    const releases: Array<() => void> = [];
    const scheduler = new ProbeScheduler((_roomId, _source) => new Promise((resolve) => {
      releases.push(() => resolve({ status: "offline" }));
    }), { maxConcurrency: 1 });
    const states: PreparedProbeState[] = [];
    scheduler.subscribe((state) => states.push(state));

    const batch = scheduler.runBatch(["a", "b"], "manual_batch");
    expect(scheduler.state()).toMatchObject({
      mode: "running",
      currentRoomId: "a",
      queuedRoomIds: ["b"],
      batch: { source: "manual_batch", total: 2, completed: 0 },
    });
    releases.shift()!();
    await vi.waitFor(() => expect(scheduler.state().currentRoomId).toBe("b"));
    expect(scheduler.state().batch?.completed).toBe(1);
    releases.shift()!();
    await batch;
    expect(scheduler.state().mode).toBe("idle");
    expect(states.length).toBeGreaterThan(2);
  });

  it("publishes the earliest safe completion estimate for a batch", async () => {
    const now = Date.parse("2026-07-17T06:00:00.000Z");
    let release!: () => void;
    const scheduler = new ProbeScheduler(() => new Promise<void>((resolve) => { release = resolve; }), {
      now: () => now,
      safeNavigationGapMs: 60_000,
      automaticBudgetPerHour: 10,
    });

    const batch = scheduler.runBatch(Array.from({ length: 18 }, (_, index) => String(index)), "manual_batch");
    expect(scheduler.state().estimatedCompletionAt).toBe(new Date(now + 67 * 60_000).toISOString());
    scheduler.cancelManualBatch();
    release();
    await batch;
  });

  it("cancels only queued manual-batch rooms and lets the active room finish", async () => {
    let release!: () => void;
    const probe = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const scheduler = new ProbeScheduler(probe, { maxConcurrency: 1 });
    const batch = scheduler.runBatch(["a", "b", "c"], "manual_batch");

    scheduler.cancelManualBatch();
    expect(scheduler.state().queuedRoomIds).toEqual([]);
    release();
    await batch;
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("waits for an active room probe when cancellation must hand off its page access", async () => {
    let release!: () => void;
    const scheduler = new ProbeScheduler(() => new Promise<void>((resolve) => { release = resolve; }));
    void scheduler.runNow("a", "scheduled");
    let canceled = false;
    const cancellation = Promise.resolve(scheduler.cancel("a")).then(() => { canceled = true; });

    await Promise.resolve();
    expect(canceled).toBe(false);
    release();
    await cancellation;
    expect(canceled).toBe(true);
  });

  it("records the earliest recurring deadline and uses scheduled source", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => ({ status: "offline" as const }));
    const scheduler = new ProbeScheduler(probe, { now: () => Date.now(), jitterRatio: 0 });
    scheduler.schedule("a", { probeIntervalMinutes: 1 }, 1_000);
    expect(scheduler.state().nextRunAt).toBe(new Date(Date.now() + 1_000).toISOString());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(probe).toHaveBeenCalledWith("a", "scheduled");
    vi.useRealTimers();
  });

  it("backs trusted offline rooms off for 30, 60, then 120 minutes", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => ({ status: "offline" as const }));
    const scheduler = new ProbeScheduler(probe, { now: () => Date.now(), jitterRatio: 0 });
    scheduler.schedule("a", { probeIntervalMinutes: 1 }, 1_000);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(scheduler.state().nextRunAt).toBe(new Date(Date.now() + 30 * 60_000).toISOString());
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(scheduler.state().nextRunAt).toBe(new Date(Date.now() + 60 * 60_000).toISOString());
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(scheduler.state().nextRunAt).toBe(new Date(Date.now() + 120 * 60_000).toISOString());
    vi.useRealTimers();
  });

  it("never schedules a known live room status navigation faster than ten minutes", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => ({ status: "live" as const }));
    const scheduler = new ProbeScheduler(probe, { now: () => Date.now(), jitterRatio: 0 });
    scheduler.schedule("a", { probeIntervalMinutes: 1 }, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(scheduler.state().nextRunAt).toBe(new Date(Date.now() + 10 * 60_000).toISOString());
    vi.useRealTimers();
  });

  it("re-arms the safe delay from a startup result instead of retaining the short initial timer", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => ({ status: "offline" as const }));
    const scheduler = new ProbeScheduler(probe, { now: () => Date.now(), jitterRatio: 0 });
    scheduler.schedule("a", { probeIntervalMinutes: 1 }, 60_000);
    await scheduler.runStartup(["a"]);
    expect(scheduler.state().nextRunAt).toBe(new Date(Date.now() + 30 * 60_000).toISOString());
    vi.useRealTimers();
  });
});
