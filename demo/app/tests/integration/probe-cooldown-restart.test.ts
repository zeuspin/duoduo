import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DuoduoDatabase } from "../../src/main/storage/database";
import { ProbeOrchestrator } from "../../src/main/rooms/probe-orchestrator";

describe("probe cooldown across restart", () => {
  it("reuses the durable last real access time after reopening the application database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "duoduo-probe-cooldown-"));
    const path = join(directory, "duoduo.sqlite");
    const first = new DuoduoDatabase(path);
    first.probeAccess.recordStartedAt("123", "2026-07-20T01:00:00.000Z");
    first.close();
    const second = new DuoduoDatabase(path);
    const execute = vi.fn();
    try {
      const orchestrator = new ProbeOrchestrator({
        execute,
        lastStartedAt: (roomId) => second.probeAccess.lastStartedAt(roomId),
        recordStartedAt: vi.fn(),
        now: () => Date.parse("2026-07-20T01:00:30.000Z"),
        cooldownMs: 60_000,
      });
      await expect(
        orchestrator.enqueue({
          roomId: "123",
          groupId: "g",
          source: "room_refresh",
        }),
      ).resolves.toEqual({
        status: "cooldown",
        cooldownUntil: "2026-07-20T01:01:00.000Z",
      });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      second.close();
    }
  });
});
