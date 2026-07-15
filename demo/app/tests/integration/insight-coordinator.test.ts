import { afterEach, describe, expect, it, vi } from "vitest";
import { InsightCoordinator } from "../../src/main/insights/insight-coordinator";
import type { StoredAsrEvent } from "../../src/main/storage/database";

afterEach(() => vi.useRealTimers());
const event = (roomId: string, id: number): StoredAsrEvent => ({ id, roomId, sessionId: "s", segmentId: String(id), startMs: id * 1000, endMs: id * 1000 + 500, text: `房间 ${roomId} 文本 ${id}`, isFinal: true, occurredAt: `2026-07-13T02:30:${String(id).padStart(2, "0")}.000Z` });

describe("InsightCoordinator", () => {
  it("debounces each room independently and serializes one room", async () => {
    vi.useFakeTimers();
    const analyze = vi.fn(async (roomId: string, _events: StoredAsrEvent[]) => [{ roomId }]);
    const persisted: unknown[] = [];
    const coordinator = new InsightCoordinator({ analyze, persist: (value) => { persisted.push(value); }, debounceMs: 8000, maxCharacters: 1000 });
    coordinator.accept(event("a", 1)); coordinator.accept(event("a", 2)); coordinator.accept(event("b", 3));
    await vi.advanceTimersByTimeAsync(7999);
    expect(analyze).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(persisted).toHaveLength(2);
    await coordinator.shutdown();
    expect(coordinator.resourceCount()).toBe(0);
  });

  it("flushes a room immediately at the character limit and isolates failures", async () => {
    const analyze = vi.fn(async (roomId: string) => { if (roomId === "bad") throw new Error("failed"); return [{ roomId }]; });
    const persisted: unknown[] = [];
    const coordinator = new InsightCoordinator({ analyze, persist: (value) => { persisted.push(value); }, debounceMs: 8000, maxCharacters: 10 });
    coordinator.accept(event("bad", 1)); coordinator.accept(event("good", 2));
    await coordinator.idle();
    expect(persisted).toEqual([{ roomId: "good" }]);
    expect(coordinator.status("bad").state).toBe("error");
    expect(coordinator.status("good").state).toBe("idle");
    await coordinator.shutdown();
  });

  it("flushes within the maximum wait while final ASR keeps arriving", async () => {
    vi.useFakeTimers();
    const analyze = vi.fn(async (_roomId: string, _events: StoredAsrEvent[]) => []);
    const coordinator = new InsightCoordinator({ analyze, persist: vi.fn(), debounceMs: 8000, maxWaitMs: 60000, maxCharacters: 3000 });
    for (let second = 0; second < 60; second += 5) {
      coordinator.accept(event("continuous", second / 5 + 1));
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze.mock.calls[0][1].length).toBeGreaterThan(1);
    await coordinator.shutdown();
  });
});
