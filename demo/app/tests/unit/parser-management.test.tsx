// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParserManagement } from "../../src/renderer/components/ParserManagement";

const legacyParser = {
  id: "market-insight",
  spec: {
    name: "市场观点",
    description: "旧说明",
    objectives: ["sector_direction" as const],
    filters: ["audience_question" as const, "advertising" as const],
    normalization: "suggest" as const,
    model: "qwen-plus",
    advancedPrompt: "只提取有证据的观点",
  },
  createdAt: "2026-07-13T00:00:00.000Z",
};
const snapshot = { parsers: [legacyParser], llmConfigured: true };

beforeEach(() =>
  Object.assign(window, {
    duoduo: {
      parsers: {
        list: vi.fn().mockResolvedValue(snapshot),
        create: vi.fn().mockResolvedValue(snapshot),
        copy: vi.fn().mockResolvedValue(snapshot),
        remove: vi.fn().mockResolvedValue({ parsers: [], llmConfigured: true }),
      },
    },
  }),
);
afterEach(cleanup);

describe("ParserManagement", () => {
  it("does not expose a duplicate content-analysis service or API Key setting", async () => {
    render(<ParserManagement rooms={[]} snapshots={[]} />);
    await screen.findByText("解析器列表");

    expect(screen.queryByText("内容分析服务")).toBeNull();
    expect(screen.queryByLabelText("模型 API Key")).toBeNull();
    expect(screen.queryByLabelText("服务类型")).toBeNull();
  });

  it("only exposes name, verified model, and full prompt when creating", async () => {
    render(<ParserManagement rooms={[]} snapshots={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建解析器" }));

    expect(screen.getByLabelText("解析器名称")).toBeTruthy();
    expect((screen.getByLabelText("模型") as HTMLSelectElement).value).toBe(
      "qwen3.7-plus-2026-05-26",
    );
    expect((screen.getByLabelText("用户提示词") as HTMLTextAreaElement).value).toContain(
      "必须忽略：",
    );
    expect(screen.queryByLabelText("解析器说明")).toBeNull();
    expect(screen.queryByText("关注内容")).toBeNull();
    expect(screen.queryByText("忽略内容")).toBeNull();
    expect(screen.queryByLabelText("名称规范化")).toBeNull();
    expect(screen.queryByLabelText("高级提示词")).toBeNull();
    expect(screen.queryByRole("button", { name: "运行样本测试" })).toBeNull();
  });

  it("shows official pricing tiers and marks qwen-plus as rolling", async () => {
    render(<ParserManagement rooms={[]} snapshots={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建解析器" }));
    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "qwen-plus" } });

    expect(screen.getByText("滚动版本")).toBeTruthy();
    expect(screen.getByText(/当前等效版本：qwen-plus-2025-12-01/)).toBeTruthy();
    expect(screen.getByText(/≤ 128K/)).toBeTruthy();
    expect(screen.getByText(/输入 ¥0.8/)).toBeTruthy();
    expect(
      screen.getByText("≤ 128K：输入 ¥0.8 / 输出 ¥2（每百万 Token）"),
    ).toBeTruthy();
    expect(screen.getByText(/2026-07-20/)).toBeTruthy();
  });

  it("shows a legacy parser as its complete materialized prompt", async () => {
    render(<ParserManagement rooms={[]} snapshots={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "查看" }));
    const prompt = screen.getByLabelText("解析器提示词") as HTMLTextAreaElement;
    const view = prompt.closest("section");
    expect(view?.classList.contains("parser-view")).toBe(true);
    expect(prompt.parentElement?.classList.contains("parser-view-prompt")).toBe(
      true,
    );
    expect(prompt.readOnly).toBe(true);
    expect(prompt.value).toContain("观众提问，除非主播随后明确回答并认可");
    expect(prompt.value).toContain("附加规则：只提取有证据的观点");
  });

  it("copies a legacy parser into an independent visible-prompt parser", async () => {
    render(<ParserManagement rooms={[]} snapshots={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "复制新建" }));
    fireEvent.change(screen.getByLabelText("解析器名称"), {
      target: { value: "市场观点 v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建并保存" }));

    await waitFor(() =>
      expect(window.duoduo.parsers.copy).toHaveBeenCalledWith(
        "market-insight",
        expect.objectContaining({
          schemaVersion: 2,
          name: "市场观点 v2",
          model: "qwen-plus",
          prompt: expect.stringContaining("商品、课程和直播广告"),
        }),
      ),
    );
  });
});
