// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { inspectCurrentRoom } from "../../src/main/rooms/live-probe";

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(window, "__duoduoCaptureVideo");
  Reflect.deleteProperty(window, "__duoduoCaptureStream");
});

describe("captured video health", () => {
  it("checks the captured video instead of an unrelated paused preview", async () => {
    document.body.innerHTML = '<video id="preview"></video><video id="live"></video>';
    const live = document.getElementById("live")!;
    Object.defineProperties(live, { readyState: { value: 4 }, currentTime: { value: 42 }, paused: { value: false } });
    Object.assign(window, { __duoduoCaptureVideo: live, __duoduoCaptureStream: { getAudioTracks: () => [{ readyState: "live" }] } });
    const result = await inspectCurrentRoom({ executeJavaScript: async (expression: string) => window.eval(expression) } as never);
    expect(result).toMatchObject({ videoReadyState: 4, currentTime: 42, paused: false, audioTrackState: "live" });
  });

  it("reports when the player replaced the captured video even if its old audio track is still live", async () => {
    document.body.innerHTML = '<video id="live"></video>';
    const live = document.getElementById("live")!;
    Object.defineProperties(live, { readyState: { value: 4 }, currentTime: { value: 42 }, paused: { value: false } });
    Object.assign(window, { __duoduoCaptureVideo: document.createElement("video"), __duoduoCaptureStream: { getAudioTracks: () => [{ readyState: "live" }] } });
    const result = await inspectCurrentRoom({ executeJavaScript: async (expression: string) => window.eval(expression) } as never);
    expect(result).toMatchObject({ captureVideoConnected: false, audioTrackState: "live" });
  });
});
