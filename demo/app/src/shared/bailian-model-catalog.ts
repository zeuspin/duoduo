export type BailianModelScene =
  | "asr_extraction"
  | "asr_analysis"
  | "analyzer_agent";
export type BailianModelSort = "recommended" | "cost" | "effect";
export type BailianModelVendor = "qwen" | "deepseek" | "paraformer" | "fun-asr" | "other";

export interface BailianPriceTier {
  maxInputTokens: number | null;
  inputCnyPerMillion: number;
  outputCnyPerMillion: number;
}

export interface SceneEvaluation {
  status: "passed" | "failed";
  score: number;
  testedAt: string;
  benchmarkVersion: string;
  note: string;
}

export interface BailianModelCatalogEntry {
  id: string;
  label: string;
  vendor: BailianModelVendor;
  modality: "realtime_asr" | "text";
  region: "cn-beijing";
  versionKind: "fixed" | "generation";
  checkedAt: string;
  sourceUrl: string;
  asrCnyPerSecond?: number;
  nonThinkingPriceTiers?: readonly BailianPriceTier[];
  evaluations: Partial<Record<BailianModelScene, SceneEvaluation>>;
}

const PRICE_SOURCE = "https://help.aliyun.com/zh/model-studio/model-pricing";
const ASR_SOURCE = "https://help.aliyun.com/zh/model-studio/asr-model/";
const CHECKED_AT = "2026-07-21";
const BENCHMARK = "live-model-gate-2026-07-21-v1";

export const DEFAULT_ASR_MODEL_ID = "paraformer-realtime-v2";
export const DEFAULT_ANALYSIS_MODEL_ID = "qwen-plus";
export const DEFAULT_AGENT_MODEL_ID = "qwen3.5-flash-2026-02-23";

export const BAILIAN_MODEL_CATALOG: readonly BailianModelCatalogEntry[] = [
  asrModel("paraformer-realtime-v2", "Paraformer Realtime V2", "paraformer", 0.00024, 90.8,
    "通过股票金融与电商语音门槛；当前通过模型中成本最低。"),
  asrModel("fun-asr-realtime", "Fun-ASR Realtime", "fun-asr", 0.00033, 92.4,
    "通过股票金融与电商语音门槛；本次样本识别效果更优。"),
  textModel("qwen-flash-2025-07-28", "Qwen Flash", "qwen", 0.15, 1.5, {
    asr_analysis: failed(100, "短样本门禁通过，但真实直播长 ASR 的结构化输出无效率过高，暂不开放。"),
    analyzer_agent: failed(91.7, "未在一个模糊的电商竞品需求上要求必要澄清。"),
  }),
  textModel("qwen3.5-flash-2026-02-23", "Qwen 3.5 Flash", "qwen", 0.2, 2, {
    asr_analysis: failed(96.7, "一次电商寒暄样本被误识别为有效内容。"),
    analyzer_agent: passed(100, "双场景明确需求可成稿，模糊需求会提出必要问题。"),
  }),
  textModel("deepseek-v4-flash", "DeepSeek V4 Flash", "deepseek", 1, 2, {
    asr_analysis: passed(100, "双场景结构、逐字证据、噪声抑制与信息覆盖全部通过。"),
    analyzer_agent: failed(91.7, "未在一个模糊的电商竞品需求上要求必要澄清。"),
  }),
  {
    ...textModel("qwen3.7-plus-2026-05-26", "Qwen 3.7 Plus", "qwen", 2, 8, {
      asr_analysis: failed(96.7, "一次电商寒暄样本被误识别为有效内容。"),
      analyzer_agent: failed(88.3, "部分明确需求未形成可直接使用的分析器草稿。"),
    }),
    nonThinkingPriceTiers: [tier(262_144, 2, 8), tier(1_048_576, 6, 24)],
  },
  textModel("deepseek-v4-pro", "DeepSeek V4 Pro", "deepseek", 12, 24, {
    asr_analysis: failed(100, "重复测试结果不稳定，曾漏掉股票金融关键信息，暂不开放。"),
    analyzer_agent: failed(91.7, "未在一个模糊的电商竞品需求上进入澄清状态。"),
  }),
  {
    ...textModel("qwen-plus", "Qwen Plus", "qwen", 0.8, 2, {
      asr_analysis: passed(100, "真实直播长 ASR 生产数据验证稳定，恢复为默认分析模型。"),
    }),
    nonThinkingPriceTiers: [
      tier(131_072, 0.8, 2),
      tier(262_144, 2.4, 20),
      tier(1_048_576, 4.8, 48),
    ],
  },
  textModel("qwen3.7-max-2026-05-20", "Qwen 3.7 Max", "qwen", 12, 36, {}),
  textModel("deepseek-v3.2", "DeepSeek V3.2", "deepseek", 2, 3, {}),
  textModel("glm-5.2", "GLM 5.2", "other", 8, 28, {}),
  textModel("kimi-k2.6", "Kimi K2.6", "other", 6.5, 27, {}),
] as const;

export const BAILIAN_PARSER_MODELS = BAILIAN_MODEL_CATALOG.filter(
  (entry) => entry.modality === "text",
);
export const DEFAULT_PARSER_MODEL_ID = DEFAULT_ANALYSIS_MODEL_ID;
export type BailianParserModel = BailianModelCatalogEntry;

export function getBailianModel(id: string): BailianModelCatalogEntry | undefined {
  return BAILIAN_MODEL_CATALOG.find((entry) => entry.id === id);
}

export const getBailianParserModel = getBailianModel;

export function getAvailableModels(
  scene: BailianModelScene,
  sort: BailianModelSort = "recommended",
): BailianModelCatalogEntry[] {
  const entries = BAILIAN_MODEL_CATALOG.filter(
    (entry) => entry.evaluations[scene]?.status === "passed",
  );
  return [...entries].sort((left, right) => {
    const leftEvaluation = left.evaluations[scene]!;
    const rightEvaluation = right.evaluations[scene]!;
    if (sort === "effect")
      return rightEvaluation.score - leftEvaluation.score || modelCost(left) - modelCost(right);
    return modelCost(left) - modelCost(right) || rightEvaluation.score - leftEvaluation.score;
  });
}

export function isModelAvailable(scene: BailianModelScene, id: string): boolean {
  return getAvailableModels(scene).some((entry) => entry.id === id);
}

export function formatModelPrice(entry: BailianModelCatalogEntry): string {
  if (entry.asrCnyPerSecond !== undefined)
    return `¥${(entry.asrCnyPerSecond * 3600).toFixed(3)} / 小时`;
  const tier = entry.nonThinkingPriceTiers?.[0];
  return tier
    ? `输入 ¥${tier.inputCnyPerMillion} / 输出 ¥${tier.outputCnyPerMillion} 每百万 Token`
    : "暂无价格";
}

function modelCost(entry: BailianModelCatalogEntry): number {
  if (entry.asrCnyPerSecond !== undefined) return entry.asrCnyPerSecond * 3600;
  const tier = entry.nonThinkingPriceTiers?.[0];
  return tier ? tier.inputCnyPerMillion * 0.8 + tier.outputCnyPerMillion * 0.2 : Number.POSITIVE_INFINITY;
}

function asrModel(
  id: string,
  label: string,
  vendor: BailianModelVendor,
  asrCnyPerSecond: number,
  score: number,
  note: string,
): BailianModelCatalogEntry {
  return {
    id, label, vendor, modality: "realtime_asr", region: "cn-beijing",
    versionKind: "fixed", checkedAt: CHECKED_AT, sourceUrl: ASR_SOURCE,
    asrCnyPerSecond, evaluations: { asr_extraction: passed(score, note) },
  };
}

function textModel(
  id: string,
  label: string,
  vendor: BailianModelVendor,
  inputCnyPerMillion: number,
  outputCnyPerMillion: number,
  evaluations: BailianModelCatalogEntry["evaluations"],
): BailianModelCatalogEntry {
  return {
    id, label, vendor, modality: "text", region: "cn-beijing",
    versionKind: id.includes("2026-") || id.includes("2025-") ? "fixed" : "generation",
    checkedAt: CHECKED_AT, sourceUrl: PRICE_SOURCE,
    nonThinkingPriceTiers: [{ maxInputTokens: null, inputCnyPerMillion, outputCnyPerMillion }],
    evaluations,
  };
}

function passed(score: number, note: string): SceneEvaluation {
  return { status: "passed", score, testedAt: CHECKED_AT, benchmarkVersion: BENCHMARK, note };
}

function failed(score: number, note: string): SceneEvaluation {
  return { status: "failed", score, testedAt: CHECKED_AT, benchmarkVersion: BENCHMARK, note };
}

function tier(maxInputTokens: number | null, inputCnyPerMillion: number, outputCnyPerMillion: number): BailianPriceTier {
  return { maxInputTokens, inputCnyPerMillion, outputCnyPerMillion };
}
