import { describe, expect, it, vi } from "vitest";
import { ProbeScheduler } from "../../src/main/rooms/probe-scheduler";

describe("ProbeScheduler", () => {
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

  it("jitters recurring delays to avoid synchronized platform requests", () => {
    const scheduler = new ProbeScheduler(async () => undefined, { defaultIntervalMinutes: 5, jitterRatio: 0.2, random: () => 0 });
    expect(scheduler.jitteredIntervalMs({ probeIntervalMinutes: null })).toBe(240_000);
  });
});
