import { describe, expect, it } from "vitest";
import { createNetworkErrorSampler, decideRendererRecovery, formatDiagnostic, monitoringFingerprint } from "../../src/main/diagnostics";

describe("renderer recovery diagnostics", () => {
  it("reloads one crash but opens the circuit for another crash in the cooldown", () => {
    expect(decideRendererRecovery(undefined, 10_000, 60_000)).toEqual({ action: "reload", crashAt: 10_000 });
    expect(decideRendererRecovery(10_000, 20_000, 60_000)).toEqual({ action: "show_error", crashAt: 20_000 });
    expect(decideRendererRecovery(10_000, 80_000, 60_000)).toEqual({ action: "reload", crashAt: 80_000 });
  });

  it("redacts credential-shaped values from persistent diagnostics", () => {
    const line = formatDiagnostic("room_failure", { roomId: "1", apiKey: "secret", authorization: "Bearer abc", error: "AUDIO_TRACK_ENDED" }, new Date("2026-07-13T06:00:00.000Z"));
    expect(line).toContain('"roomId":"1"');
    expect(line).toContain('"error":"AUDIO_TRACK_ENDED"');
    expect(line).not.toContain("secret");
    expect(line).not.toContain("Bearer abc");
    expect(line).toContain('"apiKey":"[REDACTED]"');
  });

  it("uses only state fields when deciding whether a monitoring snapshot changed", () => {
    const before = monitoringFingerprint([{ roomId: "1", state: "monitoring", liveStatus: "live", asr: [{ text: "first" }] }]);
    const afterAsr = monitoringFingerprint([{ roomId: "1", state: "monitoring", liveStatus: "live", asr: [{ text: "second" }] }]);
    const afterStop = monitoringFingerprint([{ roomId: "1", state: "waiting_for_live", liveStatus: "offline", asr: [{ text: "second" }] }]);
    expect(afterAsr).toBe(before);
    expect(afterStop).not.toBe(before);
  });

  it("samples repeated network errors by host, error and resource type", () => {
    const sampler = createNetworkErrorSampler(60_000);
    const event = { url: "https://cdn.example.com/video/1", error: "net::ERR_CONNECTION_CLOSED", resourceType: "media" };
    expect(sampler.shouldLog(event, 1_000)).toBe(true);
    expect(sampler.shouldLog({ ...event, url: "https://cdn.example.com/video/2" }, 2_000)).toBe(false);
    expect(sampler.shouldLog(event, 61_000)).toBe(true);
    expect(sampler.shouldLog({ ...event, resourceType: "script" }, 62_000)).toBe(true);
  });
});
