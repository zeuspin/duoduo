export type PricingInput =
  | { apiKind: "chat_completions"; model: string; region: "cn-beijing"; thinkingEnabled: boolean; promptTokens: number; completionTokens: number }
  | { apiKind: "asr_realtime"; model: string; region: "cn-beijing"; billingDurationSeconds: number };

export type PricingResult =
  | { status: "calculated"; ruleKey: string; inputCostMicros: number; outputCostMicros: number; totalCostMicros: number; currency: "CNY" }
  | { status: "price_missing" };

export type AiUsageKind = "production" | "test";
export type AiApiKind = "chat_completions" | "asr_realtime";
export type AiCallStatus = "running" | "succeeded" | "http_failed" | "provider_failed" | "timed_out" | "cancelled" | "interrupted" | "business_output_invalid";

export interface AiCallContext {
  featureKey: string;
  usageKind: AiUsageKind;
  apiKind: AiApiKind;
  requestedModel: string;
  region: "cn-beijing";
  thinkingEnabled?: boolean;
  runId?: string;
  roomId?: string;
  parserId?: string;
  parserVersionId?: number;
  retryOfCallId?: string;
}

export interface ConfirmedLlmUsage {
  responseId: string;
  returnedModel: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}
