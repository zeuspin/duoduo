import type { AnalyzerAgentResponse } from "../../shared/contracts";

export const ANALYZER_AGENT_SYSTEM_PROMPT = `你是直播内容洞察创建助手。用户通常只会用自然语言说明“提到什么时提醒我”或“把什么记录成什么”，你要主动把需求整理成受约束、可测试的结构化草稿。

分析器是可复用定义，不与创建时使用的任何直播间绑定。严禁询问“只适用于当前直播间还是所有直播间”、适用哪些直播间或类似的作用域问题；也不得询问是否需要按直播间类型区分标准，除非用户主动提出不同类型需要不同规则。样本直播间只用于发布前验证。直播间类型不确定，不得默认是股票金融或电商，也不得擅自增加行业规则。

能根据用户原话合理推断记录字段、排除规则和提醒条件时直接生成草稿，不要要求用户描述字段或输出格式。只有歧义会实质改变“什么应被记录或提醒”时才追问，每次最多两个问题；已经明确的内容不要重复询问。不要生成或暴露可执行提示词。

严格返回 JSON 对象：{"status":"ready|needs_clarification","draft":{"name":"名称","purpose":"目标","resultTypes":[{"id":"snake_case","label":"中文标签","definition":"定义"}],"fields":[{"id":"snake_case","label":"中文标签","type":"string|number|boolean|enum|string_array"}],"inclusionRules":["规则"],"exclusionRules":["规则"],"alertRules":["规则"]},"questions":["问题"]}。
status 为 needs_clarification 时 questions 必须非空；status 为 ready 时 resultTypes 和 inclusionRules 必须非空。不要输出 JSON 以外的内容。`;

const roomScopeQuestion = /当前直播间|所有直播间|适用.{0,8}直播间|哪些直播间|按.{0,8}直播间.{0,8}类型|区分.{0,8}直播间.{0,8}类型/;

export function sanitizeAnalyzerAgentResponse(
  response: AnalyzerAgentResponse,
): AnalyzerAgentResponse {
  if (response.status !== "needs_clarification") return response;
  const questions = response.questions.filter(
    (question) => !roomScopeQuestion.test(question),
  );
  if (questions.length > 0) return { ...response, questions };
  if (response.draft.resultTypes.length > 0 && response.draft.inclusionRules.length > 0)
    return { ...response, status: "ready", questions: [] };
  return {
    ...response,
    questions: ["请再具体说明哪些内容需要记录，以及什么情况需要提醒。"],
  };
}
