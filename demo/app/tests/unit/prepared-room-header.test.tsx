// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PreparedRoomHeader } from "../../src/renderer/components/PreparedRoomHeader";

afterEach(cleanup);

describe("PreparedRoomHeader", () => {
  it("shows automatic scheduling and starts a safe batch", () => {
    const onProbeAll = vi.fn();
    render(<PreparedRoomHeader count={16} state={{ mode: "idle", queuedRoomIds: [], manualProbes: [], nextRunAt: "2026-07-15T10:01:00.000Z" }} roomName={() => ""} accessBlocked={false} onProbeAll={onProbeAll} onCancelBatch={vi.fn()} />);
    expect(screen.getByText(/自动更新已开启/)).toBeTruthy();
    expect(screen.getByText(/下次检测/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "更新全部状态" }));
    expect(onProbeAll).toHaveBeenCalledTimes(1);
  });

  it("shows manual batch progress and can stop only the remaining queue", () => {
    const onCancelBatch = vi.fn();
    render(<PreparedRoomHeader count={16} state={{ mode: "running", currentRoomId: "a", queuedRoomIds: ["b"], manualProbes: [], batch: { source: "manual_batch", total: 2, completed: 0 } }} roomName={() => "主播 A"} accessBlocked={false} onProbeAll={vi.fn()} onCancelBatch={onCancelBatch} />);
    expect(screen.getByText(/批量更新 1\/2/)).toBeTruthy();
    expect(screen.getByText(/当前：主播 A/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "停止后续更新" }));
    expect(onCancelBatch).toHaveBeenCalledTimes(1);
  });

  it("explains the earliest completion time of a safely paced batch", () => {
    render(<PreparedRoomHeader count={18} state={{ mode: "running", currentRoomId: "a", queuedRoomIds: ["b"], manualProbes: [], batch: { source: "manual_batch", total: 18, completed: 0 }, estimatedCompletionAt: "2026-07-17T07:07:00.000Z" }} roomName={() => "主播 A"} accessBlocked={false} onProbeAll={vi.fn()} onCancelBatch={vi.fn()} />);
    expect(screen.getByText(/按照安全节流，预计最早.*完成/)).toBeTruthy();
  });
});
