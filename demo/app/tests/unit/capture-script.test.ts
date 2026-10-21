import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { START_PAGE_CAPTURE_SCRIPT, STOP_PAGE_CAPTURE_SCRIPT } from "../../src/main/audio/capture-script";

function capturePage() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } });
  const track = { stop: vi.fn(), addEventListener: vi.fn() };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const video = { paused: true, readyState: 4, play: vi.fn(async () => { video.paused = false; }), captureStream: () => stream };
  const processor = { ...node(), onaudioprocess: undefined as unknown };
  const context = { state: "suspended", sampleRate: 16_000, destination: {}, resume: vi.fn(async () => { context.state = "running"; }), close: vi.fn(async () => undefined), createMediaStreamSource: node, createScriptProcessor: () => processor, createGain: node };
  const window: Record<string, any> = { postMessage: vi.fn() };
  const globals = { window, document: { querySelectorAll: () => [video], querySelector: () => video }, AudioContext: function () { return context; } };
  return { globals, window, video, track, context };
}

describe("page capture recovery", () => {
  it("resumes a paused player and suspended audio context before reporting capture ready", async () => {
    const page = capturePage();
    await runInNewContext(START_PAGE_CAPTURE_SCRIPT, page.globals);
    expect(page.video.paused).toBe(false);
    expect(page.context.state).toBe("running");
    expect(await runInNewContext(STOP_PAGE_CAPTURE_SCRIPT, page.globals)).toBe(true);
    expect(page.context.close).toHaveBeenCalledOnce();
    expect(page.track.stop).toHaveBeenCalledOnce();
  });

  it("releases newly acquired tracks if audio initialization fails", async () => {
    const page = capturePage();
    page.context.createMediaStreamSource = () => { throw new Error("audio source failed"); };
    await expect(Promise.resolve().then(() => runInNewContext(START_PAGE_CAPTURE_SCRIPT, page.globals))).rejects.toThrow("audio source failed");
    expect(page.track.stop).toHaveBeenCalledOnce();
    expect(page.context.close).toHaveBeenCalledOnce();
    expect(page.window.__duoduoCaptureStop).toBeUndefined();
  });
});
