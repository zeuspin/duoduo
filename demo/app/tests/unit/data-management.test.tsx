// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataManagement } from "../../src/renderer/components/DataManagement";

beforeEach(() => Object.assign(window, { duoduo: { data: {
  getUsage: vi.fn().mockResolvedValue({ databaseBytes: 2048, walBytes: 0, avatarBytes: 1024, coverBytes: 4096, logBytes: 0, categories: [{ category: "observations", count: 42, oldestAt: "2026-01-01T00:00:00.000Z", newestAt: "2026-07-01T00:00:00.000Z" }] }),
  getRetention: vi.fn().mockResolvedValue({ observationDays: 30, aggregateDays: 365, asrDays: 90, logDays: 30 }),
  saveRetention: vi.fn(), previewCleanup: vi.fn().mockResolvedValue({ token: "token", category: "observations", count: 12, before: "2026-06-01T00:00:00.000Z" }), executeCleanup: vi.fn().mockResolvedValue(12), compact: vi.fn(), exportBackup: vi.fn(), importBackup: vi.fn(),
} } }));
afterEach(cleanup);

describe("DataManagement", () => {
  it("shows usage and requires preview before cleanup", async () => {
    render(<DataManagement />);
    expect(await screen.findByText("42 条")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "预览清理" }));
    expect(await screen.findByText("将清理 12 条数据")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认清理" }));
    await waitFor(() => expect(window.duoduo.data.executeCleanup).toHaveBeenCalledWith(expect.anything(), "token"));
  });
});
