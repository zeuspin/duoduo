import { describe, expect, it, vi } from "vitest";
import { ProbeOrchestrator } from "../../src/main/rooms/probe-orchestrator";
import { DuoduoDatabase } from "../../src/main/storage/database";

describe("ProbeOrchestrator", () => {
  it("settles a failed task and continues with the next queued room", async () => {
    const orchestrator = new ProbeOrchestrator({
      execute: vi.fn(async ({ roomId }) => {
        if (roomId === "bad") throw new Error("probe failed");
        return roomId;
      }),
      lastStartedAt: () => undefined,
      recordStartedAt: vi.fn(),
      cooldownMs: 0,
    });
    await expect(
      orchestrator.enqueue({
        roomId: "bad",
        groupId: "g",
        source: "room_refresh",
      }),
    ).resolves.toEqual(expect.objectContaining({ status: "failed" }));
    await expect(
      orchestrator.enqueue({
        roomId: "good",
        groupId: "g",
        source: "room_refresh",
      }),
    ).resolves.toEqual({ status: "completed", value: "good" });
  });

  it("asks the access layer to yield a paced scheduled task when a manual refresh arrives", async () => {
    let rejectScheduled!: (error: Error) => void;
    const preempt = vi.fn(() => rejectScheduled(new Error("preempted")));
    const orchestrator = new ProbeOrchestrator({
      execute: vi.fn(({ roomId }) =>
        roomId === "scheduled"
          ? new Promise<string>((_resolve, reject) => {
              rejectScheduled = reject;
            })
          : Promise.resolve(roomId),
      ),
      lastStartedAt: () => undefined,
      recordStartedAt: vi.fn(),
      cooldownMs: 0,
      preempt,
    });
    const scheduled = orchestrator.enqueue({
      roomId: "scheduled",
      groupId: "g",
      source: "scheduled",
      runId: "run",
    });
    const manual = orchestrator.enqueue({
      roomId: "manual",
      groupId: "g",
      source: "room_refresh",
    });
    await expect(scheduled).resolves.toEqual(
      expect.objectContaining({ status: "failed" }),
    );
    await expect(manual).resolves.toEqual({
      status: "completed",
      value: "manual",
    });
    expect(preempt).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: "scheduled" }),
    );
  });
  it("executes probes globally one at a time", async () => {
    const releases: Array<() => void> = [];
    let concurrent = 0;
    let maximum = 0;
    const execute = vi.fn(async () => {
      concurrent++;
      maximum = Math.max(maximum, concurrent);
      await new Promise<void>((resolve) => releases.push(resolve));
      concurrent--;
      return "ok";
    });
    const orchestrator = new ProbeOrchestrator({
      execute,
      lastStartedAt: () => undefined,
      recordStartedAt: () => undefined,
    });
    const first = orchestrator.enqueue({
      roomId: "1",
      groupId: "g",
      source: "scheduled",
      runId: "r",
    });
    const second = orchestrator.enqueue({
      roomId: "2",
      groupId: "g",
      source: "group_refresh",
    });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    releases.shift()!();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    releases.shift()!();
    await Promise.all([first, second]);
    expect(maximum).toBe(1);
  });

  it("merges a queued room and upgrades its priority", async () => {
    let release!: () => void;
    const order: string[] = [];
    const execute = vi.fn(async (task: { roomId: string }) => {
      order.push(task.roomId);
      if (task.roomId === "block")
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return task.roomId;
    });
    const orchestrator = new ProbeOrchestrator({
      execute,
      lastStartedAt: () => undefined,
      recordStartedAt: () => undefined,
    });
    const block = orchestrator.enqueue({
      roomId: "block",
      groupId: "g",
      source: "room_refresh",
    });
    await vi.waitFor(() => expect(order).toEqual(["block"]));
    const scheduled = orchestrator.enqueue({
      roomId: "same",
      groupId: "g",
      source: "scheduled",
      runId: "r",
    });
    const other = orchestrator.enqueue({
      roomId: "other",
      groupId: "g",
      source: "group_refresh",
    });
    const upgraded = orchestrator.enqueue({
      roomId: "same",
      groupId: "g",
      source: "room_refresh",
    });
    release();
    await Promise.all([block, scheduled, other, upgraded]);
    expect(order).toEqual(["block", "same", "other"]);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("reuses cooldown across orchestrator instances without a real probe", async () => {
    let now = Date.parse("2026-07-20T00:00:30.000Z");
    const starts = new Map<string, string>([["1", "2026-07-20T00:00:00.000Z"]]);
    const execute = vi.fn();
    const create = () =>
      new ProbeOrchestrator({
        execute,
        now: () => now,
        lastStartedAt: (roomId) => starts.get(roomId),
        recordStartedAt: (roomId, at) => {
          starts.set(roomId, at);
        },
      });
    await expect(
      create().enqueue({ roomId: "1", groupId: "g", source: "room_refresh" }),
    ).resolves.toEqual(expect.objectContaining({ status: "cooldown" }));
    now += 31_000;
    execute.mockResolvedValue("fresh");
    await expect(
      create().enqueue({ roomId: "1", groupId: "g", source: "room_refresh" }),
    ).resolves.toEqual(
      expect.objectContaining({ status: "completed", value: "fresh" }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("cancels queued tasks from a stopped run", async () => {
    let release!: () => void;
    const execute = vi.fn(async (task: { roomId: string }) => {
      if (task.roomId === "block")
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    });
    const orchestrator = new ProbeOrchestrator({
      execute,
      lastStartedAt: () => undefined,
      recordStartedAt: () => undefined,
    });
    const block = orchestrator.enqueue({
      roomId: "block",
      groupId: "g",
      source: "room_refresh",
    });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    const cancelled = orchestrator.enqueue({
      roomId: "scheduled",
      groupId: "g",
      source: "scheduled",
      runId: "run-1",
    });
    orchestrator.cancelRun("run-1");
    release();
    await block;
    await expect(cancelled).resolves.toEqual({ status: "cancelled" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("persists the last real access attempt in SQLite", async () => {
    const database = new DuoduoDatabase(":memory:");
    try {
      database.probeAccess.recordStartedAt("1", "2026-07-20T00:00:00.000Z");
      expect(database.probeAccess.lastStartedAt("1")).toBe(
        "2026-07-20T00:00:00.000Z",
      );
      database.probeAccess.recordCompleted(
        "1",
        "live",
        "2026-07-20T00:00:02.000Z",
      );
      expect(database.probeAccess.get("1")).toEqual({
        lastStartedAt: "2026-07-20T00:00:00.000Z",
        lastCompletedAt: "2026-07-20T00:00:02.000Z",
        lastResult: "live",
      });
    } finally {
      database.close();
    }
  });
});
