import type { PricingInput, PricingResult } from "./types";
import { getBailianModel } from "../../shared/bailian-model-catalog";

export function calculateCatalogCost(input: PricingInput): PricingResult {
  if (input.apiKind === "asr_realtime") {
    const model = getBailianModel(input.model);
    if (model?.asrCnyPerSecond === undefined || !validCount(input.billingDurationSeconds)) return { status: "price_missing" };
    const totalCostMicros = Math.round(input.billingDurationSeconds * model.asrCnyPerSecond * 1_000_000);
    return { status: "calculated", ruleKey: `${model.id}:cn-beijing:seconds:${model.checkedAt}`, inputCostMicros: totalCostMicros, outputCostMicros: 0, totalCostMicros, currency: "CNY" };
  }

  if (
    input.thinkingEnabled ||
    !validPositiveCount(input.promptTokens) ||
    !validCount(input.completionTokens)
  )
    return { status: "price_missing" };
  const model = getBailianModel(input.model);
  const prices = model?.nonThinkingPriceTiers?.find(
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
