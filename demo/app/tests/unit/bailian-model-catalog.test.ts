import { describe, expect, it } from "vitest";
import {
  BAILIAN_PARSER_MODELS,
  DEFAULT_PARSER_MODEL_ID,
  getBailianParserModel,
} from "../../src/shared/bailian-model-catalog";

describe("Bailian parser model catalog", () => {
  it("contains only the approved Beijing parser models", () => {
    expect(BAILIAN_PARSER_MODELS.map((model) => model.id)).toEqual([
      "qwen3.7-plus-2026-05-26",
      "qwen-plus",
      "qwen3.7-max-2026-05-20",
      "qwen3.5-flash-2026-02-23",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-v3.2",
      "glm-5.2",
      "kimi-k2.6",
    ]);
    expect(DEFAULT_PARSER_MODEL_ID).toBe("qwen3.7-plus-2026-05-26");
    expect(
      BAILIAN_PARSER_MODELS.every(
        (model) =>
          model.region === "cn-beijing" &&
          model.checkedAt === "2026-07-20" &&
          model.sourceUrl ===
            "https://help.aliyun.com/zh/model-studio/model-pricing" &&
          model.nonThinkingPriceTiers.length > 0,
      ),
    ).toBe(true);
  });

  it("marks qwen-plus as rolling and exposes every official price tier", () => {
    expect(getBailianParserModel("qwen-plus")).toMatchObject({
      versionKind: "rolling",
      currentEquivalent: "qwen-plus-2025-12-01",
      nonThinkingPriceTiers: [
        { maxInputTokens: 131_072, inputCnyPerMillion: 0.8, outputCnyPerMillion: 2 },
        { maxInputTokens: 262_144, inputCnyPerMillion: 2.4, outputCnyPerMillion: 20 },
        { maxInputTokens: 1_048_576, inputCnyPerMillion: 4.8, outputCnyPerMillion: 48 },
      ],
    });
  });

  it("returns undefined for an unverified model", () => {
    expect(getBailianParserModel("made-up-model")).toBeUndefined();
  });
});
