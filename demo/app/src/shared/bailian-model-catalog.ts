export type BailianModelVendor = "recommended" | "qwen" | "deepseek" | "other";
export type BailianModelPosition = "balanced" | "quality" | "economy";

export interface BailianPriceTier {
  maxInputTokens: number | null;
  inputCnyPerMillion: number;
  outputCnyPerMillion: number;
}

export interface BailianParserModel {
  id: string;
  label: string;
  vendor: BailianModelVendor;
  position: BailianModelPosition;
  region: "cn-beijing";
  versionKind: "fixed" | "rolling" | "generation";
  currentEquivalent?: string;
  checkedAt: string;
  sourceUrl: string;
  nonThinkingPriceTiers: readonly BailianPriceTier[];
}

const PRICE_SOURCE = "https://help.aliyun.com/zh/model-studio/model-pricing";
const CHECKED_AT = "2026-07-20";

export const DEFAULT_PARSER_MODEL_ID = "qwen3.7-plus-2026-05-26";

export const BAILIAN_PARSER_MODELS: readonly BailianParserModel[] = [
  model("qwen3.7-plus-2026-05-26", "Qwen 3.7 Plus", "recommended", "balanced", "fixed", [
    tier(262_144, 2, 8),
    tier(1_048_576, 6, 24),
  ]),
  {
    ...model("qwen-plus", "Qwen Plus", "qwen", "economy", "rolling", [
      tier(131_072, 0.8, 2),
      tier(262_144, 2.4, 20),
      tier(1_048_576, 4.8, 48),
    ]),
    currentEquivalent: "qwen-plus-2025-12-01",
  },
  model("qwen3.7-max-2026-05-20", "Qwen 3.7 Max", "qwen", "quality", "fixed", [
    tier(1_048_576, 12, 36),
  ]),
  model("qwen3.5-flash-2026-02-23", "Qwen 3.5 Flash", "qwen", "economy", "fixed", [
    tier(131_072, 0.2, 2),
    tier(262_144, 0.8, 8),
    tier(1_048_576, 1.2, 12),
  ]),
  model("deepseek-v4-pro", "DeepSeek V4 Pro", "deepseek", "quality", "generation", [
    tier(null, 12, 24),
  ]),
  model("deepseek-v4-flash", "DeepSeek V4 Flash", "deepseek", "economy", "generation", [
    tier(null, 1, 2),
  ]),
  model("deepseek-v3.2", "DeepSeek V3.2", "deepseek", "balanced", "generation", [
    tier(null, 2, 3),
  ]),
  model("glm-5.2", "GLM 5.2", "other", "quality", "generation", [
    tier(null, 8, 28),
  ]),
  model("kimi-k2.6", "Kimi K2.6", "other", "quality", "generation", [
    tier(null, 6.5, 27),
  ]),
] as const;

export function getBailianParserModel(id: string): BailianParserModel | undefined {
  return BAILIAN_PARSER_MODELS.find((modelEntry) => modelEntry.id === id);
}

function model(
  id: string,
  label: string,
  vendor: BailianModelVendor,
  position: BailianModelPosition,
  versionKind: BailianParserModel["versionKind"],
  nonThinkingPriceTiers: readonly BailianPriceTier[],
): BailianParserModel {
  return {
    id,
    label,
    vendor,
    position,
    region: "cn-beijing",
    versionKind,
    checkedAt: CHECKED_AT,
    sourceUrl: PRICE_SOURCE,
    nonThinkingPriceTiers,
  };
}

function tier(
  maxInputTokens: number | null,
  inputCnyPerMillion: number,
  outputCnyPerMillion: number,
): BailianPriceTier {
  return { maxInputTokens, inputCnyPerMillion, outputCnyPerMillion };
}
