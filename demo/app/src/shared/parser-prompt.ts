import type { LegacyParserSpec, ParserSpec } from "./contracts";

const objectiveLabels: Record<
  LegacyParserSpec["objectives"][number],
  string
> = {
  sector_direction: "板块方向与市场风格",
  market_indicator: "大盘指标及主播对指标的解读",
  volume_and_funds: "成交量、涨跌家数和资金信号",
  market_sentiment: "市场情绪及情绪转折",
  conditional_view: "带成立条件和时间范围的判断",
  risk_signal: "风险信号和观点变化",
};

const filterLabels: Record<LegacyParserSpec["filters"][number], string> = {
  greeting: "寒暄、点赞和关注引导",
  audience_question: "观众提问，除非主播随后明确回答并认可",
  unendorsed_quote: "主播未表示认可的第三方转述",
  advertising: "商品、课程和直播广告",
  unsupported_sentiment: "只有热度或情绪词、没有市场判断的表达",
  duplicate_view: "没有新增条件或依据的重复观点",
};

const promptStart = `你是直播市场观点审校器。只提炼主播实际表达且能被输入逐字证据支持的信息，不提供投资建议，不补充外部事实。

观点性质必须选择一种：
- explicit：明确观点（主播直接表达判断）
- conditional：条件观点（判断依赖明确条件）
- quote：转述（主播引用他人，不代表认可）
- inference：系统推断（只能低置信度，不得伪装成主播观点）
- fact：事实描述（指数、成交量等，不包含方向判断）
无法归入以上有效类型的内容属于噪音，不输出。

中文阅读标签对应为：明确观点、条件观点、转述、系统推断、事实描述、噪音。`;

const promptEnd = `每条结果必须包含从输入 ASR 原样复制的逐字证据 evidence；不得改写证据，不得输出没有证据支持的结论。
返回 JSON 对象 {"insights": [...]}，字段固定为 nature, subjectKind, subjectOriginal, subjectNormalized(可省略), direction, summary, rationale, conditions, evidence, confidence, alertLevel。
subjectKind: market|sector|indicator|style|sentiment；direction: positive|neutral|cautious|risk；alertLevel: none|normal|important。`;

export const DEFAULT_PARSER_PROMPT = `${promptStart}
关注范围：${Object.values(objectiveLabels).join("；")}。
必须忽略：${Object.values(filterLabels).join("；")}。
板块名称策略：保留主播原始称呼；仅在含义明确时补充标准名称，无法确认时不得猜测。
${promptEnd}`;

export function materializeParserPrompt(spec: ParserSpec): string {
  if ("schemaVersion" in spec) return spec.prompt;
  const normalization =
    spec.normalization === "preserve"
      ? "只保留主播原话"
      : spec.normalization === "strict"
        ? "仅在名称明确时规范化"
        : "保留主播原话，可建议标准名称；低置信度不强制归类";
  return `${promptStart}
关注范围：${spec.objectives.map((value) => objectiveLabels[value]).join("；")}。
必须忽略：${spec.filters.map((value) => filterLabels[value]).join("；")}。
板块名称策略：${normalization}。
${promptEnd}
${spec.advancedPrompt ? `附加规则：${spec.advancedPrompt}` : ""}`;
}
