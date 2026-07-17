import { describe, expect, it, vi } from "vitest";
import { EmbeddedVerificationController, type VerificationSurface } from "../../src/main/rooms/embedded-verification-controller";

function fixture() {
  let url = "";
  const surface: VerificationSurface = {
    loadURL: vi.fn(async (value) => { url = value; }),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    currentUrl: vi.fn(() => url),
    inspectBlockedState: vi.fn(async () => "clear" as const),
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
  };
  const create = vi.fn(() => surface);
  return { surface, create, controller: new EmbeddedVerificationController(create) };
}

describe("EmbeddedVerificationController", () => {
  it("loads once and reuses the same surface after hiding", async () => {
    const { controller, surface, create } = fixture();
    controller.setBounds({ x: 12, y: 80, width: 900, height: 640 });

    await controller.show("https://live.douyin.com/123");
    controller.hide();
    await controller.show("https://live.douyin.com/123");

    expect(create).toHaveBeenCalledTimes(1);
    expect(surface.loadURL).toHaveBeenCalledTimes(1);
    expect(surface.setBounds).toHaveBeenCalledWith({ x: 12, y: 80, width: 900, height: 640 });
    expect(surface.setVisible).toHaveBeenNthCalledWith(1, true);
    expect(surface.setVisible).toHaveBeenNthCalledWith(2, false);
    expect(surface.setVisible).toHaveBeenNthCalledWith(3, true);
    expect(surface.destroy).not.toHaveBeenCalled();
  });

  it("waits for valid bounds before making the surface visible", async () => {
    const { controller, surface } = fixture();
    await controller.show("https://live.douyin.com/123");
    expect(surface.setVisible).not.toHaveBeenCalledWith(true);

    controller.setBounds({ x: 0, y: 64, width: 800, height: 600 });
    expect(surface.setVisible).toHaveBeenCalledWith(true);
    expect(() => controller.setBounds({ x: 0, y: 0, width: 0, height: 1 })).toThrow("INVALID_VERIFICATION_BOUNDS");
  });

  it("uses the same surface for recovery inspection", async () => {
    const { controller, surface } = fixture();
    vi.mocked(surface.inspectBlockedState).mockResolvedValue("verification_required");
    await controller.show("https://live.douyin.com/123");
    await expect(controller.inspectBlockedState()).resolves.toBe("verification_required");
    expect(controller.currentUrl()).toBe("https://live.douyin.com/123");
  });

  it("times out an unresponsive recovery inspection", async () => {
    vi.useFakeTimers();
    const { surface, create } = fixture();
    vi.mocked(surface.inspectBlockedState).mockImplementation(() => new Promise(() => undefined));
    const controller = new EmbeddedVerificationController(create, 1_000);
    await controller.show("https://live.douyin.com/123");

    const result = expect(controller.inspectBlockedState()).rejects.toThrow("VERIFICATION_CHECK_TIMEOUT");
    await vi.advanceTimersByTimeAsync(1_000);

    await result;
    vi.useRealTimers();
  });

  it("survives twenty show-hide cycles without destroying or recreating", async () => {
    const { controller, surface, create } = fixture();
    controller.setBounds({ x: 0, y: 80, width: 1000, height: 700 });
    for (let index = 0; index < 20; index += 1) {
      await controller.show("https://live.douyin.com/123");
      controller.hide();
    }
    expect(create).toHaveBeenCalledTimes(1);
    expect(surface.loadURL).toHaveBeenCalledTimes(1);
    expect(surface.destroy).not.toHaveBeenCalled();
  });

  it("only destroys during disposal and rejects later operations", async () => {
    const { controller, surface } = fixture();
    await controller.show("https://live.douyin.com/123");
    controller.dispose();
    expect(surface.destroy).toHaveBeenCalledTimes(1);
    await expect(controller.show("https://live.douyin.com/123")).rejects.toThrow("VERIFICATION_VIEW_DISPOSED");
    expect(() => controller.hide()).toThrow("VERIFICATION_VIEW_DISPOSED");
  });
});
