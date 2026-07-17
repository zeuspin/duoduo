import { describe, expect, it, vi } from "vitest";
import { DouyinAccessCoordinator } from "../../src/main/rooms/douyin-access-coordinator";

describe("DouyinAccessCoordinator", () => {
  it("restores an interrupted recovery check as verification paused", () => {
    const coordinator = new DouyinAccessCoordinator({
      initialState: {
        mode: "recovery_checking",
        roomId: "a",
        taskType: "manual_probe",
        triggeredAt: "2026-07-15T10:00:00.000Z",
      },
    });

    expect(coordinator.getState()).toEqual({
      mode: "verification_paused",
      roomId: "a",
      taskType: "manual_probe",
      triggeredAt: "2026-07-15T10:00:00.000Z",
      reason: "verification_required",
    });
  });

  it("runs page navigation tasks one at a time", async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const coordinator = new DouyinAccessCoordinator();
    const task = (roomId: string) => coordinator.submit({ roomId, type: "startup_probe", run: () => new Promise<{ value: string }>((resolve) => {
      active += 1;
      maximum = Math.max(maximum, active);
      releases.push(() => { active -= 1; resolve({ value: roomId }); });
    }) });
    const first = task("a");
    const second = task("b");
    expect(releases).toHaveLength(1);
    releases.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(releases).toHaveLength(1);
    releases.shift()!();
    await expect(Promise.all([first, second])).resolves.toEqual(["a", "b"]);
    expect(maximum).toBe(1);
  });

  it("paces every navigation and limits automatic starts per rolling hour", async () => {
    let now = 0;
    const waits: number[] = [];
    const startedAt: number[] = [];
    const coordinator = new DouyinAccessCoordinator({
      now: () => now,
      minimumGapMs: 60_000,
      automaticBudgetPerHour: 2,
      sleep: async (ms) => { waits.push(ms); now += ms; },
    });
    const run = async () => { startedAt.push(now); return { value: true }; };

    await coordinator.submit({ roomId: "a", type: "startup_probe", traffic: "automatic", run });
    await coordinator.submit({ roomId: "b", type: "startup_probe", traffic: "automatic", run });
    await coordinator.submit({ roomId: "c", type: "startup_probe", traffic: "automatic", run });

    expect(waits).toEqual([60_000, 3_540_000]);
    expect(startedAt).toEqual([0, 60_000, 3_600_000]);
  });

  it("does not let an hour-budget wait block a later user action", async () => {
    let now = 0;
    const releases: Array<() => void> = [];
    const order: string[] = [];
    const coordinator = new DouyinAccessCoordinator({
      now: () => now,
      automaticBudgetPerHour: 1,
      sleep: () => new Promise<void>((resolve) => { releases.push(resolve); }),
    });
    await coordinator.submit({ roomId: "a", type: "startup_probe", traffic: "automatic", run: async () => { order.push("automatic-a"); return { value: true }; } });
    const delayed = coordinator.submit({ roomId: "b", type: "startup_probe", traffic: "automatic", run: async () => { order.push("automatic-b"); return { value: true }; } });
    await vi.waitFor(() => expect(releases).toHaveLength(1));

    await expect(coordinator.submit({ roomId: "manual", type: "manual_probe", traffic: "interactive", run: async () => { order.push("manual"); return { value: true }; } })).resolves.toBe(true);
    expect(order).toEqual(["automatic-a", "manual"]);

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    now = 3_600_000;
    releases.forEach((release) => release());
    await expect(delayed).resolves.toBe(true);
    expect(order).toEqual(["automatic-a", "manual", "automatic-b"]);
  });

  it("does not start a paced task after the coordinator stops", async () => {
    let release!: () => void;
    const sleep = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const run = vi.fn(async () => ({ value: true }));
    const coordinator = new DouyinAccessCoordinator({ minimumGapMs: 60_000, sleep });
    await coordinator.submit({ roomId: "a", type: "manual_probe", traffic: "interactive", run });
    const paced = coordinator.submit({ roomId: "b", type: "manual_probe", traffic: "interactive", run });
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledWith(expect.any(Number)));

    const stopping = coordinator.stop();
    release();

    await expect(paced).rejects.toThrow("ACCESS_STOPPED");
    await stopping;
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("deduplicates the same room and task type", async () => {
    const run = vi.fn(async () => ({ value: "ok" }));
    const coordinator = new DouyinAccessCoordinator();
    const first = coordinator.submit({ roomId: "a", type: "startup_probe", run });
    const second = coordinator.submit({ roomId: "a", type: "startup_probe", run });
    await expect(Promise.all([first, second])).resolves.toEqual(["ok", "ok"]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("pauses globally, cancels waiting work, and requires checked user recovery", async () => {
    let release!: () => void;
    const persisted = vi.fn();
    const coordinator = new DouyinAccessCoordinator({ persistState: persisted });
    const blocked = coordinator.submit({ roomId: "a", type: "manual_probe", run: () => new Promise<{ value: string; verificationRequired: boolean }>((resolve) => { release = () => resolve({ value: "blocked", verificationRequired: true }); }) });
    const waiting = coordinator.submit({ roomId: "b", type: "startup_probe", run: async () => ({ value: "should-not-run" }) });
    release();
    await expect(blocked).resolves.toBe("blocked");
    await expect(waiting).rejects.toThrow("ACCESS_CANCELED_BY_VERIFICATION");
    expect(coordinator.getState()).toMatchObject({ mode: "verification_paused", roomId: "a" });
    await expect(coordinator.submit({ roomId: "c", type: "avatar_refresh", run: async () => ({ value: "no" }) })).rejects.toThrow("ACCESS_VERIFICATION_PAUSED");
    expect(() => coordinator.confirmRecovery()).toThrow("RECOVERY_NOT_READY");
    await expect(coordinator.beginRecoveryCheck(async () => false)).resolves.toBe(false);
    expect(coordinator.getState().mode).toBe("verification_paused");
    await expect(coordinator.beginRecoveryCheck(async () => true)).resolves.toBe(true);
    expect(coordinator.getState().mode).toBe("recovery_ready");
    coordinator.confirmRecovery();
    expect(coordinator.getState()).toEqual({ mode: "normal" });
    expect(persisted).toHaveBeenCalled();
  });

  it("enforces cooldown from the time manual navigation starts", async () => {
    let now = 1_000;
    const coordinator = new DouyinAccessCoordinator({ now: () => now });
    await coordinator.submit({ roomId: "a", type: "manual_probe", run: async () => ({ value: true }) });
    await expect(coordinator.submit({ roomId: "a", type: "manual_probe", run: async () => ({ value: true }) })).rejects.toThrow("ACCESS_COOLDOWN");
    now += 60_000;
    await expect(coordinator.submit({ roomId: "a", type: "manual_probe", run: async () => ({ value: true }) })).resolves.toBe(true);
  });
});
