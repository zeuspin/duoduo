import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARSER_PROMPT,
  materializeParserPrompt,
} from "../../src/shared/parser-prompt";

describe("parser prompt materialization", () => {
  it("returns a visible-prompt parser instruction byte-for-byte", () => {
    const prompt = "第一行\n第二行：返回 JSON。";
    expect(
      materializeParserPrompt({
        schemaVersion: 2,
        name: "完整文本",
        model: "deepseek-v3.2",
        prompt,
      }),
    ).toBe(prompt);
  });

  it("deterministically restores every legacy option as visible text", () => {
    const prompt = materializeParserPrompt({
      name: "旧规则",
      description: "不属于提示词",
      objectives: ["sector_direction", "market_indicator"],
      filters: ["greeting", "advertising"],
      normalization: "strict",
      model: "qwen-plus",
      advancedPrompt: "只保留置信度大于 0.8 的结果",
    });
    expect(prompt).toContain("关注范围：板块方向与市场风格；大盘指标及主播对指标的解读。");
    expect(prompt).toContain("必须忽略：寒暄、点赞和关注引导；商品、课程和直播广告。");
    expect(prompt).toContain("板块名称策略：仅在名称明确时规范化。");
    expect(prompt).toContain("附加规则：只保留置信度大于 0.8 的结果");
    expect(prompt).not.toContain("不属于提示词");
  });

  it("ships a complete editable default prompt with no hidden option dependency", () => {
    expect(DEFAULT_PARSER_PROMPT).toContain("必须忽略：");
    expect(DEFAULT_PARSER_PROMPT).toContain("保留主播原始称呼；仅在含义明确时补充标准名称，无法确认时不得猜测");
    expect(DEFAULT_PARSER_PROMPT).toContain('返回 JSON 对象 {"insights": [...]}');
  });
});
