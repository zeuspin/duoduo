import { describe, expect, it } from "vitest";
import { calculateCatalogCost } from "../../src/main/usage/pricing";

describe("calculateCatalogCost", () => {
  it.each([
    [1, 1, 262_144],
    [131_072, 104_858, 262_144],
    [131_073, 314_575, 2_621_440],
    [262_144, 629_146, 2_621_440],
    [262_145, 1_258_296, 6_291_456],
    [1_048_576, 5_033_165, 6_291_456],
  ])("prices qwen-plus prompt boundary %i", (promptTokens, expectedInput, expectedOutput) => {
    expect(calculateCatalogCost({ apiKind: "chat_completions", model: "qwen-plus", region: "cn-beijing", thinkingEnabled: false, promptTokens, completionTokens: 131_072 })).toEqual({
      status: "calculated",
      ruleKey: expect.stringContaining("qwen-plus"),
      inputCostMicros: expectedInput,
      outputCostMicros: expectedOutput,
      totalCostMicros: expectedInput + expectedOutput,
      currency: "CNY",
    });
  });

  it.each([
    { apiKind: "chat_completions" as const, model: "qwen-plus", region: "cn-beijing" as const, thinkingEnabled: true, promptTokens: 1, completionTokens: 1 },
    { apiKind: "chat_completions" as const, model: "unknown", region: "cn-beijing" as const, thinkingEnabled: false, promptTokens: 1, completionTokens: 1 },
    { apiKind: "chat_completions" as const, model: "qwen-plus", region: "cn-beijing" as const, thinkingEnabled: false, promptTokens: 0, completionTokens: 1 },
    { apiKind: "chat_completions" as const, model: "qwen-plus", region: "cn-beijing" as const, thinkingEnabled: false, promptTokens: 1_048_577, completionTokens: 1 },
  ])("does not price unsupported LLM input %#", (input) => {
    expect(calculateCatalogCost(input)).toEqual({ status: "price_missing" });
  });

  it("prices provider-reported Paraformer seconds", () => {
    expect(calculateCatalogCost({ apiKind: "paraformer_realtime", model: "paraformer-realtime-v2", region: "cn-beijing", billingDurationSeconds: 3600 })).toEqual({
      status: "calculated",
      ruleKey: "paraformer-realtime-v2:cn-beijing:seconds:2026-07-19",
      inputCostMicros: 864_000,
      outputCostMicros: 0,
      totalCostMicros: 864_000,
      currency: "CNY",
    });
  });
});
