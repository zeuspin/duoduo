import { describe, expect, it } from "vitest";
import {
  AsrEventSchema,
  AsrProviderConfigSchema,
  LlmProviderConfigSchema,
  InsightNotificationSettingsSchema,
  MarketInsightSchema,
  ParserSpecSchema,
  PreparedProbeStateSchema,
  RoomInputSchema,
  DataRetentionSettingsSchema,
  DouyinAccessStateSchema,
  MonitoringSettingsSchema,
  RoomSchema,
  RoomSnapshotSchema,
  RoomIntelligenceSchema,
  normalizeDouyinUrl,
} from "../../src/shared/contracts";

describe("room contracts", () => {
  it("defaults auto monitoring off while requiring an explicit group", () => {
    const parsed = RoomSchema.parse({
      roomId: "123",
      canonicalUrl: "https://live.douyin.com/123",
      schedule: null,
      probeIntervalMinutes: null,
      monitoring: false,
      groupId: "group-a",
      positionInGroup: 0,
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    });
    expect(parsed.autoMonitorOnLive).toBe(false);
  });

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
      groupId: "group-a",
      schedule: { days: [1, 3, 5], ranges: [{ start: "09:00", end: "12:00" }, { start: "19:00", end: "23:30" }] },
    });
    expect(parsed.schedule?.ranges).toHaveLength(2);
  });

  it("accepts an uncertain schedule", () => {
    const parsed = RoomInputSchema.parse({
      url: "https://live.douyin.com/123456",
      groupId: "group-a",
      schedule: null,
    });
    expect(parsed.schedule).toBeNull();
  });

  it("requires an explicit target group for every room input", () => {
    expect(() =>
      RoomInputSchema.parse({
        url: "https://live.douyin.com/123456",
        schedule: null,
      }),
    ).toThrow();
  });

  it("separates access protection from reliable room data", () => {
    const checkedAt = "2026-07-15T10:00:00.000Z";
    const observedAt = "2026-07-15T09:55:00.000Z";
    expect(DouyinAccessStateSchema.parse({ mode: "verification_paused", roomId: "123", taskType: "manual_probe", triggeredAt: checkedAt, reason: "verification_required" })).toMatchObject({ mode: "verification_paused", roomId: "123" });
    expect(RoomSnapshotSchema.parse({ roomId: "123", status: "timeout", checkedAt, lastReliableStatus: "live", lastReliableStatusAt: observedAt, metricsObservedAt: observedAt, viewerCount: 42 })).toMatchObject({ viewerCount: 42, metricsObservedAt: observedAt });
  });

  it("distinguishes user monitoring starts from automatic reconnects", () => {
    const parsed = DouyinAccessStateSchema.parse({ mode: "verification_paused", roomId: "123", taskType: "monitor_start", triggeredAt: "2026-07-17T06:00:00.000Z", reason: "verification_required" });
    expect(parsed).toMatchObject({ mode: "verification_paused", taskType: "monitor_start" });
  });

  it("keeps monitoring settings limited to in-page health checks", () => {
    expect(MonitoringSettingsSchema.parse({ monitoredCheckSeconds: 30 })).toEqual({ monitoredCheckSeconds: 30 });
  });

  it("validates bounded metric evidence without page data", () => {
    const parsed = RoomSnapshotSchema.parse({
      roomId: "123",
      status: "live",
      viewerCount: 23_000,
      metricEvidence: { viewerCount: { raw: "2.3万", source: "accessibility" } },
      checkedAt: "2026-07-17T06:00:00.000Z",
    });
    expect(parsed.metricEvidence).toEqual({ viewerCount: { raw: "2.3万", source: "accessibility" } });
  });

  it("accepts an optional live profile description", () => {
    const parsed = RoomSnapshotSchema.parse({ roomId: "123", status: "live", liveDescription: "每周日 18:00", checkedAt: "2026-07-18T06:00:00.000Z" });
    expect(parsed.liveDescription).toBe("每周日 18:00");
  });

  it("validates transparent local intelligence with evidence-based sessions", () => {
    const parsed = RoomIntelligenceSchema.parse({
      roomId: "123",
      generatedAt: "2026-07-17T06:00:00.000Z",
      currentMetrics: { followerCount: 1_264_000, observedAt: "2026-07-17T05:55:00.000Z" },
      labels: [{ kind: "audience_scale", text: "百万级粉丝", explanation: "最近可信粉丝数为 126.4 万", observedAt: "2026-07-17T05:55:00.000Z", sampleCount: 1 }],
      allLabels: [{ kind: "audience_scale", text: "百万级粉丝", explanation: "最近可信粉丝数为 126.4 万", observedAt: "2026-07-17T05:55:00.000Z", sampleCount: 1 }],
      sevenDay: { days: 7, sampleCount: 2, sessionCount: 1, points: [{ at: "2026-07-17T05:00:00.000Z", viewerCount: 23_000 }] },
      thirtyDay: { days: 30, sampleCount: 2, sessionCount: 1, points: [{ at: "2026-07-17T05:00:00.000Z", viewerCount: 23_000 }] },
      sessions: [{ id: 1, status: "ended", firstLiveAt: "2026-07-17T03:00:00.000Z", lastLiveAt: "2026-07-17T04:59:00.000Z", firstOfflineAt: "2026-07-17T05:00:00.000Z", observedDurationMinutes: 120 }],
    });
    expect(parsed.labels[0].text).toBe("百万级粉丝");
    expect(parsed.sessions[0].observedDurationMinutes).toBe(120);
  });

  it("validates prepared-room probe progress", () => {
    expect(PreparedProbeStateSchema.parse({
      mode: "running",
      currentRoomId: "123",
      queuedRoomIds: ["456"],
      batch: { source: "manual_batch", total: 2, completed: 0 },
    })).toMatchObject({ mode: "running", currentRoomId: "123" });
  });

  it("validates observable manual and initial probe request states", () => {
    const base = { mode: "running" as const, queuedRoomIds: [] as string[] };
    expect(PreparedProbeStateSchema.parse({
      ...base,
      manualProbes: [
        { roomId: "a", requestType: "initial", phase: "queued" },
        { roomId: "b", requestType: "manual", phase: "running" },
        { roomId: "c", requestType: "manual", phase: "cooldown", cooldownUntil: "2026-07-18T12:00:00.000Z" },
      ],
    }).manualProbes).toHaveLength(3);
    expect(() => PreparedProbeStateSchema.parse({
      ...base,
      manualProbes: [{ roomId: "a", requestType: "initial", phase: "cooldown", cooldownUntil: "2026-07-18T12:00:00.000Z" }],
    })).toThrow();
  });
});

describe("LLM parser contracts", () => {
  it("accepts legacy and visible-prompt parser specs", () => {
    expect(
      ParserSpecSchema.parse({
        name: "旧解析器",
        description: "说明",
        objectives: ["sector_direction"],
        filters: ["advertising"],
        normalization: "suggest",
        model: "qwen-plus",
        advancedPrompt: "附加规则",
      }),
    ).toMatchObject({ name: "旧解析器", model: "qwen-plus" });
    expect(
      ParserSpecSchema.parse({
        schemaVersion: 2,
        name: "新解析器",
        model: "deepseek-v3.2",
        prompt: "返回 JSON 格式的观点。",
      }),
    ).toEqual({
      schemaVersion: 2,
      name: "新解析器",
      model: "deepseek-v3.2",
      prompt: "返回 JSON 格式的观点。",
    });
  });

  it("rejects empty prompts and unverified models for new parsers", () => {
    expect(() =>
      ParserSpecSchema.parse({
        schemaVersion: 2,
        name: "空提示词",
        model: "qwen-plus",
        prompt: "   ",
      }),
    ).toThrow();
    expect(() =>
      ParserSpecSchema.parse({
        schemaVersion: 2,
        name: "未知模型",
        model: "unknown-model",
        prompt: "返回 JSON",
      }),
    ).toThrow();
  });

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
