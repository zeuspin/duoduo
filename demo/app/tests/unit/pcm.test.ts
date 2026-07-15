import { describe, expect, it } from "vitest";
import { floatToPcm16, resampleMono } from "../../src/main/audio/pcm";

describe("PCM conversion", () => {
  it("resamples browser audio to 16kHz mono without mixing room buffers", () => {
    const roomA = Float32Array.from({ length: 480 }, (_, index) => Math.sin(2 * Math.PI * 440 * index / 48000));
    const roomB = Float32Array.from({ length: 480 }, (_, index) => Math.sin(2 * Math.PI * 660 * index / 48000));
    const a = resampleMono(roomA, 48000, 16000);
    const b = resampleMono(roomB, 48000, 16000);
    expect(a).toHaveLength(160);
    expect(b).toHaveLength(160);
    expect(a).not.toEqual(b);
    expect(floatToPcm16(a)).toHaveLength(320);
  });

  it("clamps samples before S16LE encoding", () => {
    const pcm = floatToPcm16(Float32Array.from([-2, -1, 0, 1, 2]));
    expect([...pcm]).toEqual([1, 128, 1, 128, 0, 0, 255, 127, 255, 127]);
  });
});
