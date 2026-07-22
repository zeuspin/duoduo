import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "../..");
const reportPath = resolve(root, "reports/bailian-model-scene-evaluation.json");
const endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const models = [
  { id: "qwen-flash-2025-07-28", input: 0.15, output: 1.5 },
  { id: "qwen3.5-flash-2026-02-23", input: 0.2, output: 2 },
  { id: "deepseek-v4-flash", input: 1, output: 2 },
  { id: "qwen3.7-plus-2026-05-26", input: 2, output: 8 },
  { id: "deepseek-v4-pro", input: 12, output: 24 },
];

const analysisSystem = `你是直播内容证据提取器。只记录输入中明确表达且有逐字证据的信息，不补充外部事实。
严格返回 JSON 对象：{"records":[{"type":"snake_case","subject":"主题","summary":"摘要","evidence":["从输入原样复制的证据"],"importance":"normal|high","attributes":{}}]}。
无有效内容时返回 {"records":[]}。evidence 必须是输入的连续原文。不要输出 JSON 以外的内容。`;

const analysisCases = [
  {
    id: "stock-conditional-risk",
    domain: "stock_finance",
    input: "光伏现在先别追，等中报风险释放完、成交量重新放大以后再看。今天即使反弹也只能当轮动。",
    minRecords: 1,
    expectedTerms: ["光伏", "中报"],
  },
  {
    id: "stock-explicit-view",
    domain: "stock_finance",
    input: "我明确看好算力，但如果下午成交额跌到八千亿以下，我会把这个判断改成谨慎。",
    minRecords: 1,
    expectedTerms: ["算力", "八千亿"],
  },
  {
    id: "stock-noise",
    domain: "stock_finance",
    input: "新来的朋友点点关注，给主播点个赞。大家午饭吃了吗？我们等会继续聊。",
    maxRecords: 0,
    expectedTerms: [],
  },
  {
    id: "commerce-price-promise",
    domain: "ecommerce",
    input: "这款防晒霜直播间到手价七十九元，今天下单再送一支十毫升旅行装，晚上十二点活动结束。",
    minRecords: 1,
    expectedTerms: ["七十九元", "旅行装", "十二点"],
  },
  {
    id: "commerce-service-limit",
    domain: "ecommerce",
    input: "新疆和西藏暂时不包邮，其他地区四十八小时内发货；开封使用后不支持七天无理由退货。",
    minRecords: 1,
    expectedTerms: ["不包邮", "四十八小时", "不支持七天无理由"],
  },
  {
    id: "commerce-noise",
    domain: "ecommerce",
    input: "宝宝们晚上好，刚进来的先停留一下，喜欢主播的点点关注，咱们马上开始。",
    maxRecords: 0,
    expectedTerms: [],
  },
];

const agentSystem = `你是内容分析器创建 Agent。把非技术用户的描述整理成结构化草稿；信息不足时只提出必要问题，不擅自补全业务规则。
严格返回 JSON 对象：{"status":"ready|needs_clarification","draft":{"name":"名称","purpose":"目标","resultTypes":[{"id":"snake_case","label":"中文标签","definition":"定义"}],"fields":[{"id":"snake_case","label":"中文标签","type":"string|number|boolean|enum|string_array"}],"inclusionRules":["规则"],"exclusionRules":["规则"],"alertRules":["规则"]},"questions":["问题"]}。
不要输出 JSON 以外的内容。`;

const agentCases = [
  {
    id: "stock-alert",
    domain: "stock_finance",
    input: "我想盯主播对板块方向的明确判断。提到看好、回避或者观点发生反转时记录板块、方向、条件和原话；观点反转要提醒我。寒暄和让人点赞不要记录。",
    expectedStatus: "ready",
    expectedTerms: ["板块", "方向", "条件", "反转"],
  },
  {
    id: "stock-ambiguous",
    domain: "stock_finance",
    input: "主播提到重要股票信息时提醒我。",
    expectedStatus: "needs_clarification",
    expectedTerms: ["重要"],
  },
  {
    id: "commerce-promotion",
    domain: "ecommerce",
    input: "主播公布价格、优惠、赠品或活动截止时间时记录商品名和对应信息；价格低于一百元或者说库存不足时马上提醒。不要记录点赞关注话术。",
    expectedStatus: "ready",
    expectedTerms: ["价格", "优惠", "赠品", "库存"],
  },
  {
    id: "commerce-claim",
    domain: "ecommerce",
    input: "我要记录主播对产品功效的承诺，保留产品名、功效原话和限制条件。涉及治疗疾病的说法必须提醒。",
    expectedStatus: "ready",
    expectedTerms: ["产品", "功效", "限制", "治疗"],
  },
  {
    id: "commerce-ambiguous-competitor",
    domain: "ecommerce",
    input: "提到竞品就提醒我，并记录成竞品信息。",
    expectedStatus: "needs_clarification",
    expectedTerms: ["竞品"],
  },
  {
    id: "cross-domain-evidence",
    domain: "stock_finance,ecommerce",
    input: "无论哪类直播，保存的结果都必须保留主播逐字原话，不能把系统推测写成主播结论。",
    expectedStatus: "ready",
    expectedTerms: ["原话", "推测"],
  },
];

const apiKey = await loadApiKey();
if (!apiKey) throw new Error("BAILIAN_API_KEY is required in the repository .env");

const results = [];
for (const model of models) {
  const analysis = await evaluateScene(model, "asr_analysis", analysisSystem, analysisCases, scoreAnalysis);
  const agent = await evaluateScene(model, "analyzer_agent", agentSystem, agentCases, scoreAgent);
  results.push({ modelId: model.id, pricing: { inputCnyPerMillion: model.input, outputCnyPerMillion: model.output }, analysis, agent });
  process.stdout.write(`${model.id}: analysis=${analysis.score.toFixed(1)} agent=${agent.score.toFixed(1)}\n`);
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  provider: "bailian",
  region: "cn-beijing",
  domains: ["stock_finance", "ecommerce"],
  gates: {
    asr_analysis: {
      minimumScore: 95,
      requiresAllSchemaValid: true,
      requiresAllEvidenceGrounded: true,
      requiresEveryNoiseCaseRejected: true,
      minimumTermCoveragePerPositiveCase: 0.75,
    },
    analyzer_agent: {
      minimumScore: 85,
      requiresAllSchemaValid: true,
      requiresEveryAmbiguousCaseToRequestClarification: true,
      requiresUsableDraftForEverySpecifiedCase: true,
      minimumTermCoveragePerCase: 0.75,
    },
  },
  results,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`report=${reportPath}\n`);

async function evaluateScene(model, scene, system, cases, scorer) {
  const runs = [];
  for (const testCase of cases) {
    const startedAt = Date.now();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: model.id,
          enable_thinking: false,
          temperature: 0,
          max_tokens: 1500,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content: testCase.input }],
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(`HTTP_${response.status}:${String(body?.message ?? body?.code ?? "unknown")}`);
      const content = body?.choices?.[0]?.message?.content;
      const output = JSON.parse(stripFence(String(content ?? "")));
      const scored = scorer(testCase, output);
      runs.push({ id: testCase.id, domain: testCase.domain, latencyMs: Date.now() - startedAt, ...scored, usage: normalizeUsage(body?.usage) });
    } catch (error) {
      runs.push({ id: testCase.id, domain: testCase.domain, latencyMs: Date.now() - startedAt, schemaValid: false, evidenceGrounded: false, score: 0, error: safeError(error) });
    }
  }
  const score = runs.reduce((sum, run) => sum + run.score, 0) / runs.length;
  const promptTokens = runs.reduce((sum, run) => sum + (run.usage?.promptTokens ?? 0), 0);
  const completionTokens = runs.reduce((sum, run) => sum + (run.usage?.completionTokens ?? 0), 0);
  const estimatedCostCny = promptTokens * model.input / 1_000_000 + completionTokens * model.output / 1_000_000;
  const passed = scene === "asr_analysis"
    ? score >= 95 && runs.every((run) =>
        run.schemaValid && run.evidenceGrounded && run.countCorrect && run.termCoverage >= 0.75)
    : score >= 85 && runs.every((run) =>
        run.schemaValid && run.termCoverage >= 0.75 &&
        (run.expectedStatus === "needs_clarification" ? run.ambiguityHandled : run.hasUsableDraft));
  return { score, passed, estimatedCostCny, promptTokens, completionTokens, runs };
}

function scoreAnalysis(testCase, output) {
  const records = Array.isArray(output?.records) ? output.records : undefined;
  if (!records) return { schemaValid: false, evidenceGrounded: false, score: 0 };
  const schemaValid = records.every((record) =>
    record && typeof record.type === "string" && typeof record.subject === "string" &&
    typeof record.summary === "string" && Array.isArray(record.evidence) &&
    ["normal", "high"].includes(record.importance) && record.attributes && typeof record.attributes === "object",
  );
  const evidenceGrounded = records.every((record) => record.evidence.length > 0 && record.evidence.every((quote) => typeof quote === "string" && testCase.input.includes(quote)));
  const countCorrect = testCase.maxRecords === 0 ? records.length === 0 : records.length >= (testCase.minRecords ?? 0);
  const serialized = JSON.stringify(output);
  const termCoverage = testCase.expectedTerms.length === 0
    ? 1
    : testCase.expectedTerms.filter((term) => serialized.includes(term)).length / testCase.expectedTerms.length;
  const score = (schemaValid ? 30 : 0) + (evidenceGrounded ? 30 : 0) + (countCorrect ? 20 : 0) + termCoverage * 20;
  return { schemaValid, evidenceGrounded, countCorrect, termCoverage, score };
}

function scoreAgent(testCase, output) {
  const draft = output?.draft;
  const schemaValid = ["ready", "needs_clarification"].includes(output?.status) && draft &&
    typeof draft.name === "string" && typeof draft.purpose === "string" &&
    Array.isArray(draft.resultTypes) && Array.isArray(draft.fields) &&
    Array.isArray(draft.inclusionRules) && Array.isArray(draft.exclusionRules) &&
    Array.isArray(draft.alertRules) && Array.isArray(output.questions);
  if (!schemaValid) return { schemaValid: false, evidenceGrounded: true, score: 0 };
  const statusCorrect = output.status === testCase.expectedStatus;
  const asksWhenNeeded = testCase.expectedStatus !== "needs_clarification" || output.questions.length > 0;
  const ambiguityHandled = testCase.expectedStatus !== "needs_clarification" ||
    (output.status === "needs_clarification" && output.questions.length > 0);
  const serialized = JSON.stringify(output);
  const termCoverage = testCase.expectedTerms.filter((term) => serialized.includes(term)).length / testCase.expectedTerms.length;
  const hasUsableDraft = draft.resultTypes.length > 0 && draft.inclusionRules.length > 0;
  const behaviorCorrect = testCase.expectedStatus === "needs_clarification"
    ? ambiguityHandled
    : hasUsableDraft;
  const score = 30 + (behaviorCorrect ? 35 : 0) + (asksWhenNeeded ? 15 : 0) + termCoverage * 20;
  return { schemaValid, evidenceGrounded: true, expectedStatus: testCase.expectedStatus, statusCorrect, asksWhenNeeded, ambiguityHandled, hasUsableDraft, termCoverage, score };
}

async function loadApiKey() {
  if (process.env.BAILIAN_API_KEY) return process.env.BAILIAN_API_KEY;
  const env = await readFile(resolve(root, "../.env"), "utf8").catch(() => "");
  const line = env.split(/\r?\n/).find((value) => value.startsWith("BAILIAN_API_KEY="));
  return line?.slice("BAILIAN_API_KEY=".length).trim().replace(/^['"]|['"]$/g, "");
}

function normalizeUsage(usage) {
  if (!usage) return undefined;
  return {
    promptTokens: Number(usage.prompt_tokens ?? 0),
    completionTokens: Number(usage.completion_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? 0),
  };
}

function stripFence(value) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function safeError(error) {
  return (error instanceof Error ? error.message : String(error)).replaceAll(apiKey, "[REDACTED]").slice(0, 500);
}
