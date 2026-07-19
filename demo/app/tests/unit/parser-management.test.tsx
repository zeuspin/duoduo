// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParserManagement } from "../../src/renderer/components/ParserManagement";

const parserSnapshot = { definitions: [{ id: "market-insight", name: "市场观点与情绪提炼", description: "板块与情绪", builtIn: true, createdAt: "2026-07-13T00:00:00.000Z", publishedVersion: { id: 1, parserId: "market-insight", version: 1, state: "published", spec: { name: "市场观点与情绪提炼", description: "板块与情绪", objectives: ["sector_direction"], filters: ["audience_question"], normalization: "suggest", model: "qwen-plus", advancedPrompt: "" }, createdAt: "2026-07-13T00:00:00.000Z", publishedAt: "2026-07-13T00:00:00.000Z" } }], bindings: [], tests: [], llmConfigured: true };

beforeEach(() => Object.assign(window, { duoduo: { parsers: { list: vi.fn().mockResolvedValue(parserSnapshot), createDraft: vi.fn().mockResolvedValue(parserSnapshot), updateDraft: vi.fn().mockResolvedValue(parserSnapshot), removeDraft: vi.fn(), publish: vi.fn(), bindRoom: vi.fn().mockResolvedValue(parserSnapshot), runTest: vi.fn() }, llm: { get: vi.fn().mockResolvedValue({ type: "bailian", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus", secretId: "llm-main" }), save: vi.fn(), test: vi.fn() } } }));
afterEach(cleanup);

describe("ParserManagement", () => {
  it("shows the built-in parser and creates a safe draft before editing", async () => {
    render(<ParserManagement rooms={[{ roomId: "123", canonicalUrl: "https://live.douyin.com/123", schedule: null, probeIntervalMinutes: null, monitoring: true, autoMonitorOnLive: false, createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z" }]} snapshots={[]} />);
    expect(await screen.findByText("市场观点与情绪提炼")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(window.duoduo.parsers.createDraft).toHaveBeenCalledWith("market-insight");
  });

  it("can save only the live transcript for a room", async () => {
    render(<ParserManagement rooms={[{ roomId: "123", canonicalUrl: "https://live.douyin.com/123", schedule: null, probeIntervalMinutes: null, monitoring: true, autoMonitorOnLive: false, createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z" }]} snapshots={[]} />);
    const select = await screen.findByLabelText("直播间 123 的分析规则");
    fireEvent.change(select, { target: { value: "none" } });
    expect(window.duoduo.parsers.bindRoom).toHaveBeenCalledWith("123", null, null);
  });
});
