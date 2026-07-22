import { describe, expect, it } from "vitest";
import { calculateCatalogCost } from "../../src/main/usage/pricing";

describe("calculateCatalogCost", () => {
  it.each([
    ["qwen3.7-plus-2026-05-26", 2, 8],
    ["qwen3.7-max-2026-05-20", 12, 36],
    ["qwen3.5-flash-2026-02-23", 0.2, 2],
    ["deepseek-v4-pro", 12, 24],
    ["deepseek-v4-flash", 1, 2],
    ["deepseek-v3.2", 2, 3],
    ["glm-5.2", 8, 28],
    ["kimi-k2.6", 6.5, 27],
  ])("prices verified model %s", (model, inputPrice, outputPrice) => {
    expect(
      calculateCatalogCost({
        apiKind: "chat_completions",
        model,
        region: "cn-beijing",
        thinkingEnabled: false,
        promptTokens: 1_000,
        completionTokens: 500,
      }),
    ).toEqual({
      status: "calculated",
      ruleKey: expect.stringContaining(model),
      inputCostMicros: Math.round(1_000 * inputPrice),
      outputCostMicros: Math.round(500 * outputPrice),
      totalCostMicros: Math.round(1_000 * inputPrice + 500 * outputPrice),
      currency: "CNY",
    });
  });

  it("uses the qwen 3.7 plus long-context tier", () => {
    expect(
      calculateCatalogCost({
        apiKind: "chat_completions",
        model: "qwen3.7-plus-2026-05-26",
        region: "cn-beijing",
        thinkingEnabled: false,
        promptTokens: 262_145,
        completionTokens: 1,
      }),
    ).toMatchObject({ inputCostMicros: 1_572_870, outputCostMicros: 24 });
  });

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
    expect(calculateCatalogCost({ apiKind: "asr_realtime", model: "paraformer-realtime-v2", region: "cn-beijing", billingDurationSeconds: 3600 })).toEqual({
      status: "calculated",
      ruleKey: "paraformer-realtime-v2:cn-beijing:seconds:2026-07-21",
      inputCostMicros: 864_000,
      outputCostMicros: 0,
      totalCostMicros: 864_000,
      currency: "CNY",
    });
  });

  it("prices provider-reported Fun-ASR seconds", () => {
    expect(calculateCatalogCost({ apiKind: "asr_realtime", model: "fun-asr-realtime", region: "cn-beijing", billingDurationSeconds: 3600 }))
      .toMatchObject({ status: "calculated", totalCostMicros: 1_188_000 });
  });
});
