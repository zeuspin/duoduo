import { describe, expect, it, vi } from "vitest";
import { disposeRoomResources } from "../../src/main/rooms/room-session-resources";

describe("disposeRoomResources", () => {
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
