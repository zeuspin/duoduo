import { describe, expect, it } from "vitest";
import {
  AsrEventSchema,
  AsrProviderConfigSchema,
  LlmProviderConfigSchema,
  InsightNotificationSettingsSchema,
  MarketInsightSchema,
  ParserTestRunSchema,
  RoomInputSchema,
  DataRetentionSettingsSchema,
  normalizeDouyinUrl,
} from "../../src/shared/contracts";

describe("room contracts", () => {
  it("validates bounded retention settings", () => {
    expect(DataRetentionSettingsSchema.parse({ observationDays: 30, aggregateDays: 365, asrDays: 90, logDays: 30 }).aggregateDays).toBe(365);
    expect(() => DataRetentionSettingsSchema.parse({ observationDays: -1, aggregateDays: 365, asrDays: 90, logDays: 30 })).toThrow();
  });
  it("normalizes a Douyin room URL and strips extra parameters", () => {
    expect(normalizeDouyinUrl("https://live.douyin.com/123456?foo=bar")).toEqual({
      roomId: "123456",
      canonicalUrl: "https://live.douyin.com/123456",
    });
    expect(normalizeDouyinUrl("https://live.douyin.com/591958226292/?from_search=true&is_aweme_tied=1#player")).toEqual({
      roomId: "591958226292",
      canonicalUrl: "https://live.douyin.com/591958226292",
    });
  });

  it("rejects non-Douyin and malformed room URLs", () => {
    expect(() => normalizeDouyinUrl("https://example.com/123")).toThrow("INVALID_ROOM_URL");
    expect(() => normalizeDouyinUrl("https://live.douyin.com/not-a-room")).toThrow("INVALID_ROOM_URL");
    expect(() => normalizeDouyinUrl("https://live.douyin.com/123/extra?foo=bar")).toThrow("INVALID_ROOM_URL");
  });

  it("validates weekly schedules with multiple ranges", () => {
    const parsed = RoomInputSchema.parse({
      url: "https://live.douyin.com/123456",
      schedule: { days: [1, 3, 5], ranges: [{ start: "09:00", end: "12:00" }, { start: "19:00", end: "23:30" }] },
    });
    expect(parsed.schedule?.ranges).toHaveLength(2);
  });

  it("accepts an uncertain schedule", () => {
    const parsed = RoomInputSchema.parse({
      url: "https://live.douyin.com/123456",
      schedule: null,
    });
    expect(parsed.schedule).toBeNull();
  });
});

describe("LLM parser contracts", () => {
  it("accepts only supported insight notification timeouts", () => {
    expect(InsightNotificationSettingsSchema.parse({ timeoutSeconds: null }).timeoutSeconds).toBeNull();
    for (const timeoutSeconds of [10, 30, 60]) expect(InsightNotificationSettingsSchema.parse({ timeoutSeconds }).timeoutSeconds).toBe(timeoutSeconds);
    expect(() => InsightNotificationSettingsSchema.parse({ timeoutSeconds: 20 })).toThrow();
  });
  it("accepts Bailian and OpenAI-compatible model providers without secrets", () => {
    expect(LlmProviderConfigSchema.parse({ type: "bailian", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus", secretId: "llm-main" }).type).toBe("bailian");
    const compatible = LlmProviderConfigSchema.parse({ type: "openai-compatible", endpoint: "https://llm.example/v1/chat/completions", model: "market-model", auth: "x-api-key", secretId: "custom-main" });
    expect(compatible.type === "openai-compatible" && compatible.auth).toBe("x-api-key");
    expect(() => LlmProviderConfigSchema.parse({ type: "openai-compatible", endpoint: "ws://bad", model: "x", auth: "bearer" })).toThrow();
  });

  it("requires natural time and supporting evidence on every insight", () => {
    const insight = MarketInsightSchema.parse({ id: 1, roomId: "123", parserId: "market-insight", parserVersionId: 1, nature: "conditional", subjectKind: "sector", subjectOriginal: "科技", direction: "cautious", summary: "科技方向暂难形成持续主线", rationale: "成交额没有放大", conditions: ["下午成交额未放大"], evidence: ["科技这个方向大概率还是轮动"], sourceAsrIds: [3], startedAt: "2026-07-13T02:30:00.000Z", endedAt: "2026-07-13T02:30:10.000Z", confidence: 0.91, alertLevel: "normal", createdAt: "2026-07-13T02:30:12.000Z" });
    expect(insight.evidence).toEqual(["科技这个方向大概率还是轮动"]);
    expect(() => MarketInsightSchema.parse({ ...insight, evidence: [] })).toThrow();
  });

  it("separates draft evaluation runs from formal insight state", () => {
    const run = ParserTestRunSchema.parse({ id: "run-1", parserId: "market-insight", publishedVersionId: 1, draftVersionId: 2, roomId: "123", sampleAsrIds: [1, 2], status: "completed", publishedResults: [], draftResults: [], createdAt: "2026-07-13T02:30:00.000Z", completedAt: "2026-07-13T02:30:03.000Z" });
    expect(run.status).toBe("completed");
  });
});

describe("ASR contracts", () => {
  it("accepts both built-in provider modes", () => {
    expect(AsrProviderConfigSchema.parse({ type: "bailian", model: "paraformer-realtime-v2", secretId: "main" }).type).toBe("bailian");
    expect(AsrProviderConfigSchema.parse({ type: "duoduo-streaming-asr-v1", endpoint: "wss://asr.example/ws", auth: "bearer", secretId: "gateway" }).type).toBe("duoduo-streaming-asr-v1");
  });

  it("requires room-scoped timestamped ASR events", () => {
    const event = AsrEventSchema.parse({ roomId: "123", sessionId: "s1", segmentId: "g1", startMs: 0, endMs: 500, text: "你好", isFinal: true });
    expect(event.roomId).toBe("123");
  });
});
