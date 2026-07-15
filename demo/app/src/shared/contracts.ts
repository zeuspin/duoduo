import { z } from "zod";

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const ScheduleSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1),
  ranges: z.array(z.object({ start: TimeSchema, end: TimeSchema })).min(1),
});

export const RoomInputSchema = z.object({
  url: z.string().min(1),
  schedule: ScheduleSchema.nullable().default(null),
  probeIntervalMinutes: z.number().int().refine((value) => [1, 3, 5, 10, 15, 30].includes(value)).nullable().default(null),
});

export const RoomSchema = z.object({
  roomId: z.string(),
  canonicalUrl: z.url(),
  schedule: ScheduleSchema.nullable(),
  probeIntervalMinutes: z.number().int().nullable().default(null),
  monitoring: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const AsrProviderConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("bailian"),
    model: z.literal("paraformer-realtime-v2"),
    secretId: z.string().min(1),
  }),
  z.object({
    type: z.literal("duoduo-streaming-asr-v1"),
    endpoint: z.url().refine((url) => url.startsWith("ws://") || url.startsWith("wss://")),
    auth: z.enum(["none", "bearer", "x-api-key"]),
    secretId: z.string().min(1).optional(),
  }),
]);

export const AsrEventSchema = z.object({
  roomId: z.string().min(1),
  sessionId: z.string().min(1),
  segmentId: z.string().min(1),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  text: z.string(),
  isFinal: z.boolean(),
  occurredAt: z.string().datetime().optional(),
});

const HttpUrlSchema = z.url().refine((url) => url.startsWith("https://") || url.startsWith("http://"));

export const LlmProviderConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("bailian"), endpoint: HttpUrlSchema, model: z.string().min(1), secretId: z.string().min(1) }),
  z.object({
    type: z.literal("openai-compatible"),
    endpoint: HttpUrlSchema,
    model: z.string().min(1),
    auth: z.enum(["none", "bearer", "x-api-key"]),
    secretId: z.string().min(1).optional(),
  }).superRefine((value, context) => {
    if (value.auth !== "none" && !value.secretId) context.addIssue({ code: "custom", message: "LLM_SECRET_REQUIRED", path: ["secretId"] });
  }),
]);

export const InsightNotificationSettingsSchema = z.object({
  timeoutSeconds: z.union([z.literal(10), z.literal(30), z.literal(60), z.null()]),
});

export const MonitoringSettingsSchema = z.object({
  monitoredCheckSeconds: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120)]),
  preparedCheckMinutes: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10), z.literal(15), z.literal(30)]),
});

export const DataRetentionSettingsSchema = z.object({
  observationDays: z.number().int().min(1).max(3650),
  aggregateDays: z.number().int().min(1).max(3650),
  asrDays: z.number().int().min(1).max(3650),
  logDays: z.number().int().min(1).max(3650),
});

export const DataCategorySchema = z.enum(["observations", "aggregates", "asr", "insights", "sessions"]);
export const CleanupRequestSchema = z.object({ category: DataCategorySchema, before: z.string().datetime(), roomId: z.string().min(1).optional() });
export const CleanupPreviewSchema = z.object({ token: z.string().min(1), category: DataCategorySchema, count: z.number().int().nonnegative(), before: z.string().datetime(), roomId: z.string().optional() });
export const StorageUsageSchema = z.object({
  databaseBytes: z.number().int().nonnegative(), walBytes: z.number().int().nonnegative(), avatarBytes: z.number().int().nonnegative(), coverBytes: z.number().int().nonnegative(), logBytes: z.number().int().nonnegative(),
  categories: z.array(z.object({ category: DataCategorySchema, count: z.number().int().nonnegative(), oldestAt: z.string().optional(), newestAt: z.string().optional() })),
});

export const ParserObjectiveSchema = z.enum(["sector_direction", "market_indicator", "volume_and_funds", "market_sentiment", "conditional_view", "risk_signal"]);
export const ParserFilterSchema = z.enum(["greeting", "audience_question", "unendorsed_quote", "advertising", "unsupported_sentiment", "duplicate_view"]);
export const ParserSpecSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300),
  objectives: z.array(ParserObjectiveSchema).min(1),
  filters: z.array(ParserFilterSchema),
  normalization: z.enum(["preserve", "suggest", "strict"]),
  model: z.string().min(1),
  advancedPrompt: z.string().max(12_000).default(""),
});

export const ParserVersionSchema = z.object({
  id: z.number().int().positive(),
  parserId: z.string().min(1),
  version: z.number().int().positive(),
  state: z.enum(["draft", "published", "archived"]),
  spec: ParserSpecSchema,
  createdAt: z.string().datetime(),
  publishedAt: z.string().datetime().optional(),
});

export const ParserDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  builtIn: z.boolean(),
  createdAt: z.string().datetime(),
  publishedVersion: ParserVersionSchema.optional(),
  draftVersion: ParserVersionSchema.optional(),
});

export const RoomParserBindingSchema = z.object({ roomId: z.string().min(1), parserId: z.string().min(1), parserVersionId: z.number().int().positive(), updatedAt: z.string().datetime() });
export const InsightNatureSchema = z.enum(["explicit", "conditional", "quote", "inference", "fact"]);
export const InsightSubjectKindSchema = z.enum(["market", "sector", "indicator", "style", "sentiment"]);
export const InsightDirectionSchema = z.enum(["positive", "neutral", "cautious", "risk"]);
export const InsightAlertLevelSchema = z.enum(["none", "normal", "important"]);

export const MarketInsightCandidateSchema = z.object({
  nature: InsightNatureSchema,
  subjectKind: InsightSubjectKindSchema,
  subjectOriginal: z.string().min(1),
  subjectNormalized: z.string().min(1).optional(),
  direction: InsightDirectionSchema,
  summary: z.string().min(1).max(300),
  rationale: z.string().max(1000),
  conditions: z.array(z.string().min(1)).max(10),
  evidence: z.array(z.string().min(1)).min(1).max(8),
  confidence: z.number().min(0).max(1),
  alertLevel: InsightAlertLevelSchema,
});

export const MarketInsightSchema = MarketInsightCandidateSchema.extend({
  id: z.number().int().positive(), roomId: z.string().min(1), parserId: z.string().min(1), parserVersionId: z.number().int().positive(),
  sourceAsrIds: z.array(z.number().int().positive()).min(1), startedAt: z.string().datetime(), endedAt: z.string().datetime(), createdAt: z.string().datetime(),
});

export const ParserTestRunSchema = z.object({
  id: z.string().min(1), parserId: z.string().min(1), publishedVersionId: z.number().int().positive(), draftVersionId: z.number().int().positive(), roomId: z.string().min(1),
  sampleAsrIds: z.array(z.number().int().positive()).min(1), status: z.enum(["pending", "running", "completed", "failed"]),
  publishedResults: z.array(MarketInsightCandidateSchema), draftResults: z.array(MarketInsightCandidateSchema), error: z.string().optional(), createdAt: z.string().datetime(), completedAt: z.string().datetime().optional(),
});

export const RoomRuntimeSchema = z.object({
  roomId: z.string(),
  state: z.enum(["idle", "starting", "monitoring", "waiting_for_live", "recovering", "stopped", "error"]),
  liveStatus: z.enum(["checking", "live", "offline", "login_required", "timeout", "page_error"]),
  error: z.string().optional(),
  asr: z.array(AsrEventSchema),
});

export const RoomSnapshotSchema = z.object({
  roomId: z.string(),
  status: z.enum(["checking", "live", "offline", "login_required", "timeout", "page_error"]),
  title: z.string().optional(),
  anchorName: z.string().optional(),
  coverPath: z.string().optional(),
  avatarPath: z.string().optional(),
  viewerCount: z.number().int().nonnegative().optional(),
  followerCount: z.number().int().nonnegative().optional(),
  totalViewerCount: z.number().int().nonnegative().optional(),
  likeCount: z.number().int().nonnegative().optional(),
  metricRaw: z.record(z.string(), z.string()).optional(),
  metricQuality: z.enum(["complete", "partial", "missing"]).optional(),
  checkedAt: z.string().datetime(),
  error: z.string().optional(),
});

export type RoomInput = z.input<typeof RoomInputSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type AsrProviderConfig = z.infer<typeof AsrProviderConfigSchema>;
export type LlmProviderConfig = z.infer<typeof LlmProviderConfigSchema>;
export type InsightNotificationSettings = z.infer<typeof InsightNotificationSettingsSchema>;
export type MonitoringSettings = z.infer<typeof MonitoringSettingsSchema>;
export type DataRetentionSettings = z.infer<typeof DataRetentionSettingsSchema>;
export type CleanupRequest = z.infer<typeof CleanupRequestSchema>;
export type CleanupPreview = z.infer<typeof CleanupPreviewSchema>;
export type StorageUsage = z.infer<typeof StorageUsageSchema>;
export type AsrEvent = z.infer<typeof AsrEventSchema>;
export type RoomRuntime = z.infer<typeof RoomRuntimeSchema>;
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;
export type ParserSpec = z.infer<typeof ParserSpecSchema>;
export type ParserVersion = z.infer<typeof ParserVersionSchema>;
export type ParserDefinition = z.infer<typeof ParserDefinitionSchema>;
export type RoomParserBinding = z.infer<typeof RoomParserBindingSchema>;
export type MarketInsightCandidate = z.infer<typeof MarketInsightCandidateSchema>;
export type MarketInsight = z.infer<typeof MarketInsightSchema>;
export type ParserTestRun = z.infer<typeof ParserTestRunSchema>;

export function normalizeDouyinUrl(value: string): { roomId: string; canonicalUrl: string } {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/(\d+)\/?$/);
    if (url.protocol !== "https:" || url.hostname !== "live.douyin.com" || !match) {
      throw new Error();
    }
    return { roomId: match[1], canonicalUrl: `https://live.douyin.com/${match[1]}` };
  } catch {
    throw new Error("INVALID_ROOM_URL");
  }
}
