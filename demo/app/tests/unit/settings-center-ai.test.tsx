// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsCenter } from "../../src/renderer/components/SettingsCenter";

const asrProvider = { type: "bailian" as const, model: "paraformer-realtime-v2", secretId: "bailian-main" };
const llmConfig = {
  type: "bailian" as const,
  analysisModel: "qwen-flash-2025-07-28",
  agentModel: "qwen3.5-flash-2026-02-23",
  secretId: "bailian-main",
};

beforeEach(() => Object.assign(window, {
  duoduo: {
    settings: { saveAsrProvider: vi.fn(), testAsrProvider: vi.fn() },
    llm: { get: vi.fn().mockResolvedValue(llmConfig), save: vi.fn(), test: vi.fn() },
    data: {
      getRetention: vi.fn().mockResolvedValue({ observationDays: 30, aggregateDays: 365, asrDays: 90, logDays: 30 }),
      saveRetention: vi.fn(),
    },
  },
}));
afterEach(cleanup);

describe("SettingsCenter AI models", () => {
  it("renders all three system scenes and saves one shared Bailian configuration", async () => {
    const onProviderChange = vi.fn();
    render(
      <SettingsCenter
        section="ai"
        onSectionChange={vi.fn()}
        theme="ink"
        onThemeChange={vi.fn()}
        provider={asrProvider}
        onProviderChange={onProviderChange}
        monitoring={{ monitoredCheckSeconds: 30, preparedCheckMinutes: 5 }}
        onMonitoringChange={vi.fn()}
        notificationTimeout={30}
        onNotificationTimeoutChange={vi.fn()}
        onMessage={vi.fn()}
      />,
    );

    expect(await screen.findByText("ASR 提取模型")).toBeTruthy();
    expect(screen.getByText("内容分析模型")).toBeTruthy();
    expect(screen.getByText("分析器创建 Agent 模型")).toBeTruthy();
    expect(screen.queryByText("OpenAI Compatible")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "保存 AI 设置" }));

    await waitFor(() => expect(window.duoduo.settings.saveAsrProvider).toHaveBeenCalledWith(asrProvider, undefined));
    expect(window.duoduo.llm.save).toHaveBeenCalledWith(llmConfig);
    expect(onProviderChange).toHaveBeenCalledWith(asrProvider);
  });
});
