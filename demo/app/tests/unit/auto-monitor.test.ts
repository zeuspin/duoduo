import { describe, expect, it } from "vitest";
import { shouldAutoMonitor } from "../../src/main/rooms/auto-monitor";
import type { Room } from "../../src/shared/contracts";

const room = (autoMonitorOnLive: boolean): Room => ({
  roomId: "123",
  canonicalUrl: "https://live.douyin.com/123",
  schedule: null,
  probeIntervalMinutes: null,
  monitoring: false,
  autoMonitorOnLive,
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
});

describe("automatic monitoring policy", () => {
  it("starts when an enabled room transitions from offline to live", () => {
    expect(shouldAutoMonitor(room(true), "offline", "live")).toBe(true);
  });

  it("starts when an enabled room is first observed live", () => {
    expect(shouldAutoMonitor(room(true), undefined, "live")).toBe(true);
  });

  it("does not restart while the same room remains live", () => {
    expect(shouldAutoMonitor(room(true), "live", "live")).toBe(false);
  });

  it("does not start when disabled or when the new status is not live", () => {
    expect(shouldAutoMonitor(room(false), "offline", "live")).toBe(false);
    expect(shouldAutoMonitor(room(true), "offline", "timeout")).toBe(false);
  });
});
