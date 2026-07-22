import { describe, expect, it } from "vitest";
import { ANALYZER_AGENT_SYSTEM_PROMPT, sanitizeAnalyzerAgentResponse } from "../../src/main/insights/analyzer-agent-prompt";

const draft = {
  name: "重要信息记录",
  purpose: "记录重要信息",
  resultTypes: [{ id: "important_event", label: "重要信息", definition: "主播明确强调的信息" }],
  fields: [],
  inclusionRules: ["主播明确强调"],
  exclusionRules: [],
  alertRules: [],
};

describe("analyzer agent system prompt", () => {
  it("treats analyzers as reusable and forbids room-scope questions", () => {
    expect(ANALYZER_AGENT_SYSTEM_PROMPT).toContain("分析器是可复用定义");
    expect(ANALYZER_AGENT_SYSTEM_PROMPT).toContain("严禁询问");
    expect(ANALYZER_AGENT_SYSTEM_PROMPT).toContain("当前直播间还是所有直播间");
    expect(ANALYZER_AGENT_SYSTEM_PROMPT).toContain("不得询问是否需要按直播间类型区分标准");
    expect(ANALYZER_AGENT_SYSTEM_PROMPT).toContain("样本直播间只用于发布前验证");
  });

  it("asks at most two necessary questions and infers ordinary fields", () => {
    expect(ANALYZER_AGENT_SYSTEM_PROMPT).toContain("每次最多两个问题");
    expect(ANALYZER_AGENT_SYSTEM_PROMPT).toContain("合理推断记录字段");
  });

  it("removes room-scope questions even if a model returns them", () => {
    expect(sanitizeAnalyzerAgentResponse({
      status: "needs_clarification",
      draft,
      questions: ["是否适用于当前直播间还是所有直播间？", "哪些内容算重要信息？"],
    }).questions).toEqual(["哪些内容算重要信息？"]);
  });

  it("uses a complete draft instead of asking only a room-scope question", () => {
    expect(sanitizeAnalyzerAgentResponse({
      status: "needs_clarification",
      draft,
      questions: ["是否需要区分不同直播间类型？"],
    }).status).toBe("ready");
  });
});
