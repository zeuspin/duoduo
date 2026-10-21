import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeRoomResources } from "../../src/main/rooms/room-session-resources";

afterEach(() => vi.useRealTimers());

describe("disposeRoomResources", () => {
  it("releases ASR and destroys the window even if capture shutdown never resolves", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const disposing = disposeRoomResources({
      stopCapture: () => new Promise<void>(() => undefined),
      closeAsr: () => { calls.push("asr"); },
      destroyWindow: () => { calls.push("window"); },
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toEqual(["asr", "window"]);
    await disposing;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("continues releasing later resources when capture cleanup fails", async () => {
    const calls: string[] = [];
    const closeAsr = vi.fn(async () => { calls.push("asr"); });
    const destroyWindow = vi.fn(() => { calls.push("window"); });
    const clearStorage = vi.fn(async () => { calls.push("storage"); });

    await disposeRoomResources({
      stopCapture: async () => { calls.push("capture"); throw new Error("renderer gone"); },
      closeAsr,
      destroyWindow,
      clearStorage,
    });

    expect(calls).toEqual(["capture", "asr", "window", "storage"]);
    expect(closeAsr).toHaveBeenCalledOnce();
    expect(destroyWindow).toHaveBeenCalledOnce();
    expect(clearStorage).toHaveBeenCalledOnce();
  });
});
