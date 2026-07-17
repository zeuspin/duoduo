// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RoomCardActions } from "../../src/renderer/components/RoomCardActions";

afterEach(cleanup);

it("shows frequent actions as text and secondary actions in a labeled menu", () => {
  const onProbe = vi.fn();
  render(<RoomCardActions active={false} blocked={false} onPlay={vi.fn()} onProbe={onProbe} onRefreshAvatar={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByRole("button", { name: "播放直播" }).textContent).toContain("播放");
  fireEvent.click(screen.getByRole("button", { name: "立即检测直播状态" }));
  expect(onProbe).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
  expect(screen.getByRole("menuitem", { name: "更新主播头像" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "编辑直播间" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "删除直播间" })).toBeTruthy();
});

it("gives the icon-only more button a custom hover and focus tooltip", () => {
  render(<RoomCardActions active={false} blocked={false} onPlay={vi.fn()} onProbe={vi.fn()} onRefreshAvatar={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
  expect(screen.getByText("更多操作").closest(".tooltip")).toBeTruthy();
  expect(screen.getByRole("button", { name: "更多操作" }).getAttribute("title")).toBeNull();
});

it.each([
  [{ roomId: "123", requestType: "manual", phase: "queued" } as const, "等待检测"],
  [{ roomId: "123", requestType: "manual", phase: "running" } as const, "正在检测"],
  [{ roomId: "123", requestType: "initial", phase: "queued" } as const, "等待首次检测"],
  [{ roomId: "123", requestType: "initial", phase: "running" } as const, "正在首次检测"],
])("disables the probe action while state is %s", (probeState, label) => {
  const onProbe = vi.fn();
  render(<RoomCardActions active={false} blocked={false} probeState={probeState} onPlay={vi.fn()} onProbe={onProbe} onRefreshAvatar={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
  const button = screen.getByRole("button", { name: label });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(onProbe).not.toHaveBeenCalled();
});

it("renders the remaining cooldown from the main-process deadline", () => {
  vi.setSystemTime(new Date("2026-07-18T12:00:00.000Z"));
  render(<RoomCardActions active={false} blocked={false} probeState={{ roomId: "123", requestType: "manual", phase: "cooldown", cooldownUntil: "2026-07-18T12:00:42.000Z" }} onPlay={vi.fn()} onProbe={vi.fn()} onRefreshAvatar={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
  expect((screen.getByRole("button", { name: "42 秒后可再次检测" }) as HTMLButtonElement).disabled).toBe(true);
  vi.useRealTimers();
});
