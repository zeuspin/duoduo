import { describe, expect, it, vi } from "vitest";
import { buildMarketSystemPrompt } from "../../src/main/insights/market-prompt";
import { InsightEngine } from "../../src/main/insights/insight-engine";
import type { ParserVersion } from "../../src/shared/contracts";

const version: ParserVersion = { id: 1, parserId: "market-insight", version: 1, state: "published", createdAt: "2026-07-13T02:00:00.000Z", publishedAt: "2026-07-13T02:00:00.000Z", spec: { name: "市场观点与情绪提炼", description: "", objectives: ["sector_direction", "market_indicator", "market_sentiment"], filters: ["greeting", "audience_question", "unendorsed_quote"], normalization: "suggest", model: "qwen-plus", advancedPrompt: "" } };
const asr = [
  { id: 11, roomId: "123", sessionId: "s", segmentId: "a", startMs: 0, endMs: 5000, text: "今天指数虽然是红的，但是量没有明显放出来。", isFinal: true as const, occurredAt: "2026-07-13T02:30:00.000Z" },
  { id: 12, roomId: "123", sessionId: "s", segmentId: "b", startMs: 5000, endMs: 10000, text: "现在市场情绪只能算修复，还不能说反转。", isFinal: true as const, occurredAt: "2026-07-13T02:30:05.000Z" },
];

describe("market insight prompt", () => {
  it("requires conservative nature labels and verbatim evidence", () => {
    const prompt = buildMarketSystemPrompt(version.spec);
    for (const word of ["明确观点", "条件观点", "转述", "系统推断", "事实描述", "噪音", "逐字证据"]) expect(prompt).toContain(word);
  });
});

describe("InsightEngine", () => {
  it("maps valid evidence back to ASR ids and natural time", async () => {
    const provider = { complete: vi.fn(async () => ({ insights: [{ nature: "explicit", subjectKind: "market", subjectOriginal: "大盘", direction: "cautious", summary: "市场处于修复阶段，尚不能确认反转", rationale: "量能未放大", conditions: [], evidence: ["现在市场情绪只能算修复，还不能说反转。"], confidence: 0.96, alertLevel: "important" }] })), testConnection: vi.fn() };
    const result = await new InsightEngine(provider).analyze("123", version, asr);
    expect(result[0]).toMatchObject({ roomId: "123", parserVersionId: 1, sourceAsrIds: [12], startedAt: "2026-07-13T02:30:05.000Z", evidence: ["现在市场情绪只能算修复，还不能说反转。"] });
  });

  it("drops unsupported evidence instead of persisting hallucinations", async () => {
    const provider = { complete: vi.fn(async () => ({ insights: [{ nature: "explicit", subjectKind: "sector", subjectOriginal: "科技", direction: "positive", summary: "看好科技", rationale: "", conditions: [], evidence: ["科技将成为主线"], confidence: 0.9, alertLevel: "important" }] })), testConnection: vi.fn() };
    await expect(new InsightEngine(provider).analyze("123", version, asr)).resolves.toEqual([]);
  });

  it("accepts empty output for noise and rejects malformed shape", async () => {
    const empty = { complete: vi.fn(async () => ({ insights: [] })), testConnection: vi.fn() };
    await expect(new InsightEngine(empty).analyze("123", version, asr)).resolves.toEqual([]);
    const malformed = { complete: vi.fn(async () => ({ answer: "none" })), testConnection: vi.fn() };
    await expect(new InsightEngine(malformed).analyze("123", version, asr)).rejects.toThrow("INSIGHT_OUTPUT_INVALID");
  });

  it("normalizes a single evidence string returned by compatible models", async () => {
    const provider = { complete: vi.fn(async () => ({ insights: [{ nature: "explicit", subjectKind: "market", subjectOriginal: "大盘", direction: "cautious", summary: "市场仍是修复", rationale: "", conditions: "", evidence: "现在市场情绪只能算修复，还不能说反转。", confidence: 0.9, alertLevel: "normal" }] })), testConnection: vi.fn() };
    const result = await new InsightEngine(provider).analyze("123", version, asr);
    expect(result[0].evidence).toEqual(["现在市场情绪只能算修复，还不能说反转。"]);
  });

  it("normalizes null conditions returned by compatible models", async () => {
    const provider = { complete: vi.fn(async () => ({ insights: [{ nature: "explicit", subjectKind: "market", subjectOriginal: "大盘", direction: "cautious", summary: "市场仍是修复", rationale: "", conditions: null, evidence: "现在市场情绪只能算修复，还不能说反转。", confidence: 0.9, alertLevel: "normal" }] })), testConnection: vi.fn() };
    const result = await new InsightEngine(provider).analyze("123", version, asr);
    expect(result[0].conditions).toEqual([]);
  });

  it("maps verbatim evidence spanning adjacent ASR segments", async () => {
    const provider = { complete: vi.fn(async () => ({ insights: [{ nature: "explicit", subjectKind: "market", subjectOriginal: "大盘", direction: "cautious", summary: "量能不足，仍是修复", rationale: "", conditions: [], evidence: ["量没有明显放出来现在市场情绪只能算修复"], confidence: 0.9, alertLevel: "normal" }] })), testConnection: vi.fn() };
    const result = await new InsightEngine(provider).analyze("123", version, asr);
    expect(result[0].sourceAsrIds).toEqual([11, 12]);
  });

  it("keeps valid candidates when another candidate has unsupported evidence", async () => {
    const provider = { complete: vi.fn(async () => ({ insights: [
      { nature: "explicit", subjectKind: "market", subjectOriginal: "大盘", direction: "cautious", summary: "市场仍是修复", rationale: "", conditions: [], evidence: ["现在市场情绪只能算修复，还不能说反转。"], confidence: 0.9, alertLevel: "normal" },
      { nature: "explicit", subjectKind: "sector", subjectOriginal: "科技", direction: "positive", summary: "科技主升", rationale: "", conditions: [], evidence: ["输入中不存在的句子"], confidence: 0.9, alertLevel: "important" },
    ] })), testConnection: vi.fn() };
    const result = await new InsightEngine(provider).analyze("123", version, asr);
    expect(result.map((item) => item.summary)).toEqual(["市场仍是修复"]);
  });
});
