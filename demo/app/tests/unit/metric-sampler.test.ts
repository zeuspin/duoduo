import { describe, expect, it } from "vitest";
import { RoomMetricSampler } from "../../src/main/rooms/metric-sampler";

describe("RoomMetricSampler", () => {
  it("accepts changed metrics no more than once per five minutes", () => {
    let now = 0;
    const sampler = new RoomMetricSampler({ intervalMs: 300_000, now: () => now });
    sampler.seed({ viewerCount: 100, metricQuality: "partial" });

    now = 299_999;
    expect(sampler.accept({ viewerCount: 200, metricQuality: "partial" })).toBe(false);
    now = 300_000;
    expect(sampler.accept({ viewerCount: 200, metricQuality: "partial" })).toBe(true);
    now = 600_000;
    expect(sampler.accept({ viewerCount: 200, metricQuality: "partial" })).toBe(false);
    expect(sampler.accept({ viewerCount: 250, metricQuality: "partial" })).toBe(true);
  });

  it("rejects missing metric snapshots", () => {
    const sampler = new RoomMetricSampler({ intervalMs: 300_000, now: () => 300_000 });
    expect(sampler.accept({ metricQuality: "missing", metricRaw: {} })).toBe(false);
  });
});
