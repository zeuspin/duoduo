import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_MODEL_ID,
  DEFAULT_ANALYSIS_MODEL_ID,
  DEFAULT_ASR_MODEL_ID,
  getAvailableModels,
  getBailianModel,
  isModelAvailable,
} from "../../src/shared/bailian-model-catalog";

describe("Bailian scene model catalog", () => {
  it("only exposes models that passed each scene gate", () => {
    expect(getAvailableModels("asr_extraction").map((model) => model.id)).toEqual([
      "paraformer-realtime-v2",
      "fun-asr-realtime",
    ]);
    expect(getAvailableModels("asr_analysis").map((model) => model.id)).toEqual([
      "qwen-plus",
      "deepseek-v4-flash",
    ]);
    expect(getAvailableModels("analyzer_agent").map((model) => model.id)).toEqual([
      "qwen3.5-flash-2026-02-23",
    ]);
  });

  it("uses the cheapest passed model as every default", () => {
    expect(DEFAULT_ASR_MODEL_ID).toBe(getAvailableModels("asr_extraction", "cost")[0].id);
    expect(DEFAULT_ANALYSIS_MODEL_ID).toBe(getAvailableModels("asr_analysis", "cost")[0].id);
    expect(DEFAULT_AGENT_MODEL_ID).toBe(getAvailableModels("analyzer_agent", "cost")[0].id);
  });

  it("supports effect sorting without exposing failed models", () => {
    expect(getAvailableModels("asr_extraction", "effect")[0].id).toBe("fun-asr-realtime");
    expect(isModelAvailable("asr_analysis", "qwen-flash-2025-07-28")).toBe(false);
    expect(isModelAvailable("asr_analysis", "qwen3.5-flash-2026-02-23")).toBe(false);
    expect(getBailianModel("deepseek-v4-pro")?.evaluations.asr_analysis?.status).toBe("failed");
  });
});
