import { describe, expect, it } from "vitest";
import { PlaybackController, type PlayerHandle } from "../../src/main/player/playback-controller";

class FakePlayer implements PlayerHandle {
  destroyed = false;
  muted = true;
  bounds = { x: 0, y: 0, width: 0, height: 0 };
  constructor(readonly roomId: string) {}
  async load() {}
  setMuted(value: boolean) { this.muted = value; }
  setBounds(value: typeof this.bounds) { this.bounds = value; }
  destroy() { this.destroyed = true; }
}

describe("PlaybackController", () => {
  it("starts with no active player and keeps only the latest room audible", async () => {
    const players: FakePlayer[] = [];
    const controller = new PlaybackController(async (roomId) => { const player = new FakePlayer(roomId); players.push(player); return player; });
    expect(controller.state()).toEqual({ activeRoomId: null, status: "stopped" });
    await controller.play("a", "https://live.douyin.com/a");
    expect(players[0].muted).toBe(false);
    await controller.play("b", "https://live.douyin.com/b");
    expect(players[0].destroyed).toBe(true);
    expect(players[1].muted).toBe(false);
    expect(controller.state().activeRoomId).toBe("b");
    controller.stop();
    expect(players[1].destroyed).toBe(true);
    expect(controller.state()).toEqual({ activeRoomId: null, status: "stopped" });
    expect(controller.resourceCount()).toBe(0);
  });

  it("destroys a stale player when rapid play requests resolve out of order", async () => {
    const players: FakePlayer[] = [];
    let releaseFirst!: () => void;
    const firstReady = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const controller = new PlaybackController(async (roomId) => {
      if (roomId === "a") await firstReady;
      const player = new FakePlayer(roomId); players.push(player); return player;
    });
    const first = controller.play("a", "https://live.douyin.com/a");
    const second = controller.play("b", "https://live.douyin.com/b");
    await second;
    releaseFirst();
    await first;
    expect(players.find((player) => player.roomId === "a")?.destroyed).toBe(true);
    expect(players.find((player) => player.roomId === "b")?.destroyed).toBe(false);
    expect(controller.state().activeRoomId).toBe("b");
    expect(controller.resourceCount()).toBe(1);
  });
});
