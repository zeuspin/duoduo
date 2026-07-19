import { afterEach, describe, expect, it, vi } from "vitest";
import { PreparedPageLeasePool, type PreparedRoomPage } from "../../src/main/rooms/prepared-page-lease";

function page(destroyed = false): PreparedRoomPage & { window: PreparedRoomPage["window"] & { destroy: ReturnType<typeof vi.fn> } } {
  const destroy = vi.fn();
  return {
    roomId: "123",
    captureToken: "token",
    probe: { status: "live" },
    window: { isDestroyed: () => destroyed, destroy } as never,
  };
}

afterEach(() => vi.useRealTimers());

describe("PreparedPageLeasePool", () => {
  it("transfers a live page exactly once without destroying it", () => {
    const pool = new PreparedPageLeasePool();
    const prepared = page();
    pool.put("123", prepared);

    expect(pool.take("123")).toBe(prepared);
    expect(pool.take("123")).toBeUndefined();
    expect(prepared.window.destroy).not.toHaveBeenCalled();
  });

  it("destroys an unclaimed page after three minutes", () => {
    vi.useFakeTimers();
    const pool = new PreparedPageLeasePool();
    const prepared = page();
    pool.put("123", prepared);

    vi.advanceTimersByTime(180_000);

    expect(prepared.window.destroy).toHaveBeenCalledTimes(1);
    expect(pool.take("123")).toBeUndefined();
  });

  it("destroys the previous page when replacing a room lease", () => {
    const pool = new PreparedPageLeasePool();
    const previous = page();
    const next = page();
    pool.put("123", previous);

    pool.put("123", next);

    expect(previous.window.destroy).toHaveBeenCalledTimes(1);
    expect(pool.take("123")).toBe(next);
  });

  it("discards a page that was destroyed before consumption", () => {
    const pool = new PreparedPageLeasePool();
    const prepared = page(true);
    pool.put("123", prepared);

    expect(pool.take("123")).toBeUndefined();
  });
});
