import type { PricingInput, PricingResult } from "./types";
import { getBailianParserModel } from "../../shared/bailian-model-catalog";

const PARAFORMER_RULE_KEY = "paraformer-realtime-v2:cn-beijing:seconds:2026-07-19";

export function calculateCatalogCost(input: PricingInput): PricingResult {
  if (input.apiKind === "paraformer_realtime") {
    if (input.model !== "paraformer-realtime-v2" || !validCount(input.billingDurationSeconds)) return { status: "price_missing" };
    const totalCostMicros = Math.round(input.billingDurationSeconds * 240);
    return { status: "calculated", ruleKey: PARAFORMER_RULE_KEY, inputCostMicros: totalCostMicros, outputCostMicros: 0, totalCostMicros, currency: "CNY" };
  }

  if (
    input.thinkingEnabled ||
    !validPositiveCount(input.promptTokens) ||
    !validCount(input.completionTokens)
  )
    return { status: "price_missing" };
  const model = getBailianParserModel(input.model);
  const prices = model?.nonThinkingPriceTiers.find(
    (tier) =>
      tier.maxInputTokens === null || input.promptTokens <= tier.maxInputTokens,
  );
  if (!model || !prices) return { status: "price_missing" };
  const inputCostMicros = Math.round(
    input.promptTokens * prices.inputCnyPerMillion,
  );
  const outputCostMicros = Math.round(
    input.completionTokens * prices.outputCnyPerMillion,
  );
  return {
    status: "calculated",
    ruleKey: `${model.id}:cn-beijing:non-thinking:${model.checkedAt}`,
    inputCostMicros,
    outputCostMicros,
    totalCostMicros: inputCostMicros + outputCostMicros,
    currency: "CNY",
  };
}

function validCount(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
function validPositiveCount(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
