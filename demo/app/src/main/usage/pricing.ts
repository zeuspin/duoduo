import type { PricingInput, PricingResult } from "./types";

const QWEN_PLUS_RULE_KEY = "qwen-plus:cn-beijing:non-thinking:2026-07-19";
const PARAFORMER_RULE_KEY = "paraformer-realtime-v2:cn-beijing:seconds:2026-07-19";

export function calculateCatalogCost(input: PricingInput): PricingResult {
  if (input.apiKind === "paraformer_realtime") {
    if (input.model !== "paraformer-realtime-v2" || !validCount(input.billingDurationSeconds)) return { status: "price_missing" };
    const totalCostMicros = Math.round(input.billingDurationSeconds * 240);
    return { status: "calculated", ruleKey: PARAFORMER_RULE_KEY, inputCostMicros: totalCostMicros, outputCostMicros: 0, totalCostMicros, currency: "CNY" };
  }

  if (input.model !== "qwen-plus" || input.thinkingEnabled || !validPositiveCount(input.promptTokens) || !validCount(input.completionTokens)) return { status: "price_missing" };
  const prices = input.promptTokens <= 131_072 ? { input: 0.8, output: 2 }
    : input.promptTokens <= 262_144 ? { input: 2.4, output: 20 }
      : input.promptTokens <= 1_048_576 ? { input: 4.8, output: 48 }
        : undefined;
  if (!prices) return { status: "price_missing" };
  const inputCostMicros = Math.round(input.promptTokens * prices.input);
  const outputCostMicros = Math.round(input.completionTokens * prices.output);
  return { status: "calculated", ruleKey: QWEN_PLUS_RULE_KEY, inputCostMicros, outputCostMicros, totalCostMicros: inputCostMicros + outputCostMicros, currency: "CNY" };
}

function validCount(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
function validPositiveCount(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
