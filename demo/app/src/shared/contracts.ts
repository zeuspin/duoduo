import { z } from "zod";
import { isModelAvailable } from "./bailian-model-catalog";

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const ScheduleSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1),
  ranges: z.array(z.object({ start: TimeSchema, end: TimeSchema })).min(1),
});

export const RoomInputSchema = z.object({
  url: z.string().min(1),
  schedule: ScheduleSchema.nullable().default(null),
  groupId: z.string().min(1),
});

export const RoomSchema = z.object({
  roomId: z.string(),
  canonicalUrl: z.url(),
  schedule: ScheduleSchema.nullable(),
  monitoring: z.boolean(),
  autoMonitorOnLive: z.boolean().default(false),
  groupId: z.string().min(1),
  positionInGroup: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const RoomGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(30),
  parserId: z.string().min(1).nullable(),
  position: z.number().int().nonnegative(),
  roomCount: z.number().int().min(0).max(9),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const GroupRunStatusSchema = z.enum([
  "starting",
  "running",
  "stopping",
  "stopped",
  "start_failed",
  "stop_failed",
  "interrupted",
]);
export const GroupRunSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  status: GroupRunStatusSchema,
  startedAt: z.string().datetime(),
  stopRequestedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  error: z.string().optional(),
});
export const GroupStopProgressSchema = z.object({
  groupId: z.string().min(1),
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failedRoomIds: z.array(z.string()),
});
export const GroupRefreshProgressSchema = z.object({
  groupId: z.string().min(1),
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  currentRoomId: z.string().optional(),
  queuedRoomIds: z.array(z.string()),
});
export const GroupRefreshResultSchema = z.object({
  groupId: z.string().min(1),
  total: z.number().int().nonnegative(),
  failedRoomIds: z.array(z.string()),
  completedAt: z.string().datetime(),
});
export const GroupSnapshotSchema = z.object({
  groups: z.array(RoomGroupSchema),
  activeRun: GroupRunSchema.optional(),
  lastInterruptedRun: GroupRunSchema.optional(),
  stopProgress: GroupStopProgressSchema.optional(),
  refreshProgress: GroupRefreshProgressSchema.optional(),
  lastRefreshResult: GroupRefreshResultSchema.optional(),
});

export const AsrProviderConfigSchema = z.object({
  type: z.literal("bailian"),
  model: z.string().refine((model) => isModelAvailable("asr_extraction", model), {
    message: "ASR_MODEL_NOT_AVAILABLE",
  }),
  secretId: z.string().min(1),
});

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

export const LlmProviderConfigSchema = z.object({
  type: z.literal("bailian"),
  analysisModel: z.string().refine(
    (model) => isModelAvailable("asr_analysis", model),
    { message: "ANALYSIS_MODEL_NOT_AVAILABLE" },
  ),
  agentModel: z.string().refine(
    (model) => isModelAvailable("analyzer_agent", model),
    { message: "AGENT_MODEL_NOT_AVAILABLE" },
  ),
  secretId: z.string().min(1),
});

export const InsightNotificationSettingsSchema = z.object({
  timeoutSeconds: z.union([
    z.literal(10),
    z.literal(30),
    z.literal(60),
    z.null(),
  ]),
});

export const MonitoringSettingsSchema = z.object({
  monitoredCheckSeconds: z.union([
    z.literal(15),
    z.literal(30),
    z.literal(60),
    z.literal(120),
  ]),
  preparedCheckMinutes: z
    .union([
      z.literal(1),
      z.literal(3),
      z.literal(5),
      z.literal(10),
      z.literal(15),
      z.literal(30),
    ])
    .default(5),
});

export const DouyinTaskTypeSchema = z.enum([
  "verification_recovery_check",
  "user_play",
  "monitor_start",
  "manual_probe",
  "avatar_refresh",
  "monitor_reconnect",
  "startup_probe",
]);
export const DouyinAccessStateSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("normal") }),
  z.object({
    mode: z.literal("verification_paused"),
    roomId: z.string().min(1),
    taskType: DouyinTaskTypeSchema,
    triggeredAt: z.string().datetime(),
    reason: z.enum(["verification_required", "suspected_verification"]),
  }),
  z.object({
    mode: z.literal("recovery_checking"),
    roomId: z.string().min(1),
    taskType: DouyinTaskTypeSchema,
    triggeredAt: z.string().datetime(),
  }),
  z.object({
    mode: z.literal("recovery_ready"),
    roomId: z.string().min(1),
    taskType: DouyinTaskTypeSchema,
    triggeredAt: z.string().datetime(),
  }),
]);

export const PreparedProbeSourceSchema = z.enum([
  "startup",
  "scheduled",
  "manual",
  "initial",
  "manual_batch",
]);
export const ProbeRequestStateSchema = z.discriminatedUnion("phase", [
  z.object({
    roomId: z.string().min(1),
    requestType: z.enum(["manual", "initial"]),
    phase: z.enum(["queued", "running"]),
  }),
  z.object({
    roomId: z.string().min(1),
    requestType: z.literal("manual"),
    phase: z.literal("cooldown"),
    cooldownUntil: z.string().datetime(),
  }),
]);
export const PreparedProbeStateSchema = z.object({
  mode: z.enum(["idle", "running"]),
  currentRoomId: z.string().min(1).optional(),
  queuedRoomIds: z.array(z.string().min(1)),
  batch: z
    .object({
      source: z.enum(["startup", "manual_batch"]),
      total: z.number().int().nonnegative(),
      completed: z.number().int().nonnegative(),
    })
    .optional(),
  nextRunAt: z.string().datetime().optional(),
  lastCompletedAt: z.string().datetime().optional(),
  estimatedCompletionAt: z.string().datetime().optional(),
  manualProbes: z.array(ProbeRequestStateSchema).default([]),
});

export const DataRetentionSettingsSchema = z.object({
  observationDays: z.number().int().min(1).max(3650),
  aggregateDays: z.number().int().min(1).max(3650),
  asrDays: z.number().int().min(1).max(3650),
  logDays: z.number().int().min(1).max(3650),
});

export const AiUsageQuerySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    usageKind: z.enum(["production", "test"]).optional(),
    apiKind: z.enum(["chat_completions", "asr_realtime"]).optional(),
    roomId: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
  })
  .refine((value) => value.from < value.to, {
    message: "AI_USAGE_INVALID_RANGE",
  });

export const DataCategorySchema = z.enum([
  "observations",
  "aggregates",
  "asr",
  "insights",
  "sessions",
]);
export const CleanupRequestSchema = z.object({
  category: DataCategorySchema,
  before: z.string().datetime(),
  roomId: z.string().min(1).optional(),
});
export const CleanupPreviewSchema = z.object({
  token: z.string().min(1),
  category: DataCategorySchema,
  count: z.number().int().nonnegative(),
  before: z.string().datetime(),
  roomId: z.string().optional(),
});
export const StorageUsageSchema = z.object({
  databaseBytes: z.number().int().nonnegative(),
  walBytes: z.number().int().nonnegative(),
  avatarBytes: z.number().int().nonnegative(),
  coverBytes: z.number().int().nonnegative(),
  logBytes: z.number().int().nonnegative(),
  categories: z.array(
    z.object({
      category: DataCategorySchema,
      count: z.number().int().nonnegative(),
      oldestAt: z.string().optional(),
      newestAt: z.string().optional(),
    }),
  ),
});

export const ParserObjectiveSchema = z.enum([
  "sector_direction",
  "market_indicator",
  "volume_and_funds",
  "market_sentiment",
  "conditional_view",
  "risk_signal",
]);
export const ParserFilterSchema = z.enum([
  "greeting",
  "audience_question",
  "unendorsed_quote",
  "advertising",
  "unsupported_sentiment",
  "duplicate_view",
]);
const AnalyzerDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  purpose: z.string().trim().min(1).max(500),
  resultTypes: z.array(
    z.object({
      id: z.string().regex(/^[a-z][a-z0-9_]*$/),
      label: z.string().trim().min(1).max(40),
      definition: z.string().trim().min(1).max(300),
    }),
  ).max(20),
  fields: z.array(
    z.object({
      id: z.string().regex(/^[a-z][a-z0-9_]*$/),
      label: z.string().trim().min(1).max(40),
      type: z.enum(["string", "number", "boolean", "enum", "string_array"]),
    }),
  ).max(30),
  inclusionRules: z.array(z.string().trim().min(1).max(500)).max(30),
  exclusionRules: z.array(z.string().trim().min(1).max(500)).max(30),
  alertRules: z.array(z.string().trim().min(1).max(500)).max(20),
});
export const LegacyParserSpecSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300),
  objectives: z.array(ParserObjectiveSchema).min(1),
  filters: z.array(ParserFilterSchema),
  normalization: z.enum(["preserve", "suggest", "strict"]),
  model: z.string().min(1),
  advancedPrompt: z.string().max(12_000).default(""),
});
export const ParserSpecV2Schema = z.object({
  schemaVersion: z.literal(2),
  name: z.string().trim().min(1).max(80),
  model: z.string().min(1),
  prompt: z.string().trim().min(1).max(20_000),
});
export const ParserSpecV3Schema = z.object({
  schemaVersion: z.literal(3),
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(1).max(20_000),
});
export const ParserSpecV4Schema = z.object({
  schemaVersion: z.literal(4),
  name: z.string().trim().min(1).max(80),
  definition: AnalyzerDefinitionSchema,
});
export const ParserSpecSchema = z.union([
  ParserSpecV4Schema,
  ParserSpecV3Schema,
  ParserSpecV2Schema,
  LegacyParserSpecSchema,
]);

export const AnalyzerAgentMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4_000),
});
export const AnalyzerAgentRequestSchema = z.object({
  messages: z.array(AnalyzerAgentMessageSchema).min(1).max(20),
});
export const AnalyzerAgentDraftSchema = AnalyzerDefinitionSchema;
export const AnalyzerAgentResponseSchema = z.object({
  status: z.enum(["ready", "needs_clarification"]),
  draft: AnalyzerAgentDraftSchema,
  questions: z.array(z.string().trim().min(1).max(500)).max(5),
}).superRefine((value, context) => {
  if (value.status === "needs_clarification" && value.questions.length === 0)
    context.addIssue({
      code: "custom",
      path: ["questions"],
      message: "澄清状态必须包含问题",
    });
  if (
    value.status === "ready" &&
    (value.draft.resultTypes.length === 0 || value.draft.inclusionRules.length === 0)
  )
    context.addIssue({
      code: "custom",
      path: ["draft"],
      message: "可测试草稿必须包含结果类型和收录规则",
    });
});

export const AnalyzerSampleOptionSchema = z.object({
  roomId: z.string().min(1),
  label: z.string().min(1).max(200),
  status: z.enum(["live", "offline", "checking", "unavailable"]),
  source: z.enum(["history", "live_waiting", "no_asr"]),
  captureState: z.enum(["idle", "checking", "connecting", "audio_ready", "text_ready"]),
  asrCount: z.number().int().nonnegative(),
  lastAsrAt: z.string().datetime().optional(),
});
export const AnalyzerSampleListSchema = z.object({
  samples: z.array(AnalyzerSampleOptionSchema),
});
export const AnalyzerDraftTestRequestSchema = z.object({
  draft: AnalyzerAgentDraftSchema,
  roomId: z.string().min(1),
});
const AnalyzerTestFieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);
export const AnalyzerTestRecordSchema = z.object({
  resultTypeId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  resultTypeLabel: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(800),
  fields: z.record(z.string(), AnalyzerTestFieldValueSchema),
  evidence: z.array(z.string().trim().min(1)).min(1).max(8),
  sourceAsrIds: z.array(z.number().int().positive()).min(1),
  confidence: z.number().min(0).max(1),
  alertLevel: z.enum(["none", "normal", "important"]),
});
export const AnalyzerDraftTestResponseSchema = z.object({
  status: z.enum(["passed", "inconclusive"]),
  roomId: z.string().min(1),
  sampleCount: z.number().int().positive(),
  sampleCharacters: z.number().int().positive(),
  records: z.array(AnalyzerTestRecordSchema).max(30),
  checks: z.object({
    schemaValid: z.literal(true),
    evidenceGrounded: z.literal(true),
    resultTypesValid: z.literal(true),
  }),
  message: z.string().min(1).max(500),
  testToken: z.string().uuid().optional(),
});
export const AnalyzerPublishRequestSchema = z.object({
  draft: AnalyzerAgentDraftSchema,
  testToken: z.string().uuid(),
});

export const ImmutableParserSchema = z.object({
  id: z.string().min(1),
  spec: ParserSpecSchema,
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().optional(),
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

export const RoomParserBindingSchema = z.object({
  roomId: z.string().min(1),
  parserId: z.string().min(1),
  parserVersionId: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});
export const InsightNatureSchema = z.enum([
  "explicit",
  "conditional",
  "quote",
  "inference",
  "fact",
]);
export const InsightSubjectKindSchema = z.enum([
  "market",
  "sector",
  "indicator",
  "style",
  "sentiment",
]);
export const InsightDirectionSchema = z.enum([
  "positive",
  "neutral",
  "cautious",
  "risk",
]);
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
  id: z.number().int().positive(),
  roomId: z.string().min(1),
  parserId: z.string().min(1),
  parserVersionId: z.number().int().positive(),
  sourceAsrIds: z.array(z.number().int().positive()).min(1),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export const ContentRecordSchema = z.object({
  id: z.number().int().positive(),
  roomId: z.string().min(1),
  parserId: z.string().min(1),
  parserVersionId: z.number().int().positive(),
  resultTypeId: z.string().regex(/^[a-z][a-z0-9_]*$/),
  resultTypeLabel: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  summary: z.string().max(800),
  fields: z.record(z.string(), AnalyzerTestFieldValueSchema),
  evidence: z.array(z.string().min(1)).min(1).max(8),
  sourceAsrIds: z.array(z.number().int().positive()).min(1),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  alertLevel: z.enum(["none", "normal", "important"]),
  createdAt: z.string().datetime(),
});

export const RoomRuntimeSchema = z.object({
  roomId: z.string(),
  state: z.enum([
    "idle",
    "starting",
    "monitoring",
    "waiting_for_live",
    "recovering",
    "stopped",
    "error",
  ]),
  liveStatus: z.enum([
    "checking",
    "live",
    "offline",
    "login_required",
    "verification_required",
    "timeout",
    "page_error",
  ]),
  error: z.string().optional(),
  audioReady: z.boolean().optional(),
  asr: z.array(AsrEventSchema),
});

export const MetricDatumSchema = z.object({
  raw: z.string().min(1).max(160),
  source: z.enum(["visible_text", "accessibility", "structured_data"]),
});

export const MetricEvidenceSchema = z.object({
  viewerCount: MetricDatumSchema.optional(),
  followerCount: MetricDatumSchema.optional(),
  totalViewerCount: MetricDatumSchema.optional(),
  likeCount: MetricDatumSchema.optional(),
});

export const RoomSnapshotSchema = z.object({
  roomId: z.string(),
  status: z.enum([
    "checking",
    "live",
    "offline",
    "login_required",
    "verification_required",
    "timeout",
    "page_error",
  ]),
  title: z.string().optional(),
  anchorName: z.string().optional(),
  coverPath: z.string().optional(),
  avatarPath: z.string().optional(),
  liveDescription: z.string().trim().min(1).max(500).optional(),
  viewerCount: z.number().int().nonnegative().optional(),
  followerCount: z.number().int().nonnegative().optional(),
  totalViewerCount: z.number().int().nonnegative().optional(),
  likeCount: z.number().int().nonnegative().optional(),
  metricRaw: z.record(z.string(), z.string()).optional(),
  metricEvidence: MetricEvidenceSchema.optional(),
  metricQuality: z.enum(["complete", "partial", "missing"]).optional(),
  lastReliableStatus: z.enum(["live", "offline"]).optional(),
  lastReliableStatusAt: z.string().datetime().optional(),
  metricsObservedAt: z.string().datetime().optional(),
  checkedAt: z.string().datetime(),
  error: z.string().optional(),
});

export const TransparentLabelSchema = z.object({
  kind: z.enum([
    "audience_scale",
    "recent_heat",
    "growth",
    "activity",
    "duration",
    "insufficient_data",
  ]),
  text: z.string().min(1).max(80),
  explanation: z.string().min(1).max(500),
  observedAt: z.string().datetime().optional(),
  sampleCount: z.number().int().nonnegative(),
  comparisonCount: z.number().int().nonnegative().optional(),
});

const CurrentRoomMetricsSchema = z.object({
  viewerCount: z.number().int().nonnegative().optional(),
  followerCount: z.number().int().nonnegative().optional(),
  totalViewerCount: z.number().int().nonnegative().optional(),
  likeCount: z.number().int().nonnegative().optional(),
  observedAt: z.string().datetime().optional(),
  quality: z.enum(["complete", "partial", "missing"]).optional(),
  evidence: MetricEvidenceSchema.optional(),
});

const RoomMetricPointSchema = z.object({
  at: z.string().datetime(),
  viewerCount: z.number().int().nonnegative().optional(),
  followerCount: z.number().int().nonnegative().optional(),
  totalViewerCount: z.number().int().nonnegative().optional(),
  likeCount: z.number().int().nonnegative().optional(),
});

export const RoomPeriodSummarySchema = z.object({
  days: z.union([z.literal(7), z.literal(30)]),
  sampleCount: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative(),
  averageViewerCount: z.number().nonnegative().optional(),
  peakViewerCount: z.number().int().nonnegative().optional(),
  points: z.array(RoomMetricPointSchema),
});

export const RoomSessionSummarySchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["live", "end_pending", "ended"]),
  previousOfflineAt: z.string().datetime().optional(),
  firstLiveAt: z.string().datetime(),
  lastLiveAt: z.string().datetime(),
  firstOfflineAt: z.string().datetime().optional(),
  peakViewerCount: z.number().nonnegative().optional(),
  averageViewerCount: z.number().nonnegative().optional(),
  observedDurationMinutes: z.number().nonnegative().optional(),
});

export const RoomIntelligenceSummarySchema = z.object({
  roomId: z.string().min(1),
  generatedAt: z.string().datetime(),
  currentMetrics: CurrentRoomMetricsSchema,
  labels: z.array(TransparentLabelSchema).max(3),
});

export const RoomIntelligenceSchema = RoomIntelligenceSummarySchema.extend({
  allLabels: z.array(TransparentLabelSchema),
  sevenDay: RoomPeriodSummarySchema,
  thirtyDay: RoomPeriodSummarySchema,
  sessions: z.array(RoomSessionSummarySchema),
});

export type RoomInput = z.input<typeof RoomInputSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type RoomGroup = z.infer<typeof RoomGroupSchema>;
export type GroupRun = z.infer<typeof GroupRunSchema>;
export type GroupStopProgress = z.infer<typeof GroupStopProgressSchema>;
export type GroupRefreshProgress = z.infer<typeof GroupRefreshProgressSchema>;
export type GroupRefreshResult = z.infer<typeof GroupRefreshResultSchema>;
export type GroupSnapshot = z.infer<typeof GroupSnapshotSchema>;
export type AsrProviderConfig = z.infer<typeof AsrProviderConfigSchema>;
export type LlmProviderConfig = z.infer<typeof LlmProviderConfigSchema>;
export type InsightNotificationSettings = z.infer<
  typeof InsightNotificationSettingsSchema
>;
export type MonitoringSettings = z.infer<typeof MonitoringSettingsSchema>;
export type DouyinTaskType = z.infer<typeof DouyinTaskTypeSchema>;
export type DouyinAccessState = z.infer<typeof DouyinAccessStateSchema>;
export type PreparedProbeSource = z.infer<typeof PreparedProbeSourceSchema>;
export type ProbeRequestState = z.infer<typeof ProbeRequestStateSchema>;
export type PreparedProbeState = z.infer<typeof PreparedProbeStateSchema>;
export type DataRetentionSettings = z.infer<typeof DataRetentionSettingsSchema>;
export type AiUsageQuery = z.infer<typeof AiUsageQuerySchema>;
export type CleanupRequest = z.infer<typeof CleanupRequestSchema>;
export type CleanupPreview = z.infer<typeof CleanupPreviewSchema>;
export type StorageUsage = z.infer<typeof StorageUsageSchema>;
export type AsrEvent = z.infer<typeof AsrEventSchema>;
export type RoomRuntime = z.infer<typeof RoomRuntimeSchema>;
export type RoomSnapshot = z.infer<typeof RoomSnapshotSchema>;
export type TransparentLabel = z.infer<typeof TransparentLabelSchema>;
export type RoomMetricPoint = z.infer<typeof RoomMetricPointSchema>;
export type RoomPeriodSummary = z.infer<typeof RoomPeriodSummarySchema>;
export type RoomSessionSummary = z.infer<typeof RoomSessionSummarySchema>;
export type RoomIntelligenceSummary = z.infer<
  typeof RoomIntelligenceSummarySchema
>;
export type RoomIntelligence = z.infer<typeof RoomIntelligenceSchema>;
export type ParserSpec = z.infer<typeof ParserSpecSchema>;
export type LegacyParserSpec = z.infer<typeof LegacyParserSpecSchema>;
export type ParserSpecV2 = z.infer<typeof ParserSpecV2Schema>;
export type ParserSpecV3 = z.infer<typeof ParserSpecV3Schema>;
export type ParserSpecV4 = z.infer<typeof ParserSpecV4Schema>;
export type AnalyzerAgentMessage = z.infer<typeof AnalyzerAgentMessageSchema>;
export type AnalyzerAgentRequest = z.infer<typeof AnalyzerAgentRequestSchema>;
export type AnalyzerAgentDraft = z.infer<typeof AnalyzerAgentDraftSchema>;
export type AnalyzerAgentResponse = z.infer<typeof AnalyzerAgentResponseSchema>;
export type AnalyzerSampleOption = z.infer<typeof AnalyzerSampleOptionSchema>;
export type AnalyzerSampleList = z.infer<typeof AnalyzerSampleListSchema>;
export type AnalyzerDraftTestRequest = z.infer<typeof AnalyzerDraftTestRequestSchema>;
export type AnalyzerTestRecord = z.infer<typeof AnalyzerTestRecordSchema>;
export type AnalyzerDraftTestResponse = z.infer<typeof AnalyzerDraftTestResponseSchema>;
export type AnalyzerPublishRequest = z.infer<typeof AnalyzerPublishRequestSchema>;
export type ImmutableParser = z.infer<typeof ImmutableParserSchema>;
export type ParserVersion = z.infer<typeof ParserVersionSchema>;
export type ParserDefinition = z.infer<typeof ParserDefinitionSchema>;
export type RoomParserBinding = z.infer<typeof RoomParserBindingSchema>;
export type MarketInsightCandidate = z.infer<
  typeof MarketInsightCandidateSchema
>;
export type MarketInsight = z.infer<typeof MarketInsightSchema>;
export type ContentRecord = z.infer<typeof ContentRecordSchema>;

export function normalizeDouyinUrl(value: string): {
  roomId: string;
  canonicalUrl: string;
} {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/(\d+)\/?$/);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "live.douyin.com" ||
      !match
    ) {
      throw new Error();
    }
    return {
      roomId: match[1],
      canonicalUrl: `https://live.douyin.com/${match[1]}`,
    };
  } catch {
    throw new Error("INVALID_ROOM_URL");
  }
}
