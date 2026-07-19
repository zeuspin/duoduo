import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { calculateCatalogCost } from "./pricing";
import type { AiCallContext, AiCallStatus, ConfirmedLlmUsage } from "./types";
import type { AiUsageQuery } from "../../shared/contracts";

export class AiUsageRepository {
  constructor(private readonly database: DatabaseSync) {}

  startRun(input: { id?: string; featureKey: string; usageKind: "production" | "test"; roomId?: string; parserId?: string; parserVersionId?: number }): string {
    const id = input.id ?? randomUUID();
    this.database.prepare("INSERT INTO ai_runs(id,feature_key,usage_kind,room_id,parser_id,parser_version_id,status,started_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id, input.featureKey, input.usageKind, input.roomId ?? null, input.parserId ?? null, input.parserVersionId ?? null, "running", new Date().toISOString());
    return id;
  }

  finishRun(id: string, status: "succeeded" | "failed" | "interrupted"): void {
    const result = this.database.prepare("UPDATE ai_runs SET status=?,completed_at=? WHERE id=?").run(status, new Date().toISOString(), id);
    if (!result.changes) throw new Error("AI_RUN_NOT_FOUND");
  }

  startCall(context: AiCallContext): string {
    const id = randomUUID();
    this.database.prepare(`INSERT INTO ai_calls(id,run_id,provider,feature_key,usage_kind,room_id,parser_id,parser_version_id,api_kind,requested_model,region,thinking_enabled,status,started_at,retry_of_call_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, context.runId ?? null, "bailian", context.featureKey, context.usageKind, context.roomId ?? null, context.parserId ?? null, context.parserVersionId ?? null, context.apiKind, context.requestedModel, context.region, context.thinkingEnabled === undefined ? null : Number(context.thinkingEnabled), "running", new Date().toISOString(), context.retryOfCallId ?? null);
    return id;
  }

  completeLlm(callId: string, usage: ConfirmedLlmUsage): void {
    assertCount(usage.promptTokens); assertCount(usage.completionTokens); assertCount(usage.totalTokens);
    const call = this.requireCall(callId);
    this.transaction(() => {
      this.database.prepare("UPDATE ai_calls SET returned_model=?,provider_request_id=?,status='succeeded',completed_at=?,latency_ms=CAST((julianday(?) - julianday(started_at))*86400000 AS INTEGER) WHERE id=?")
        .run(usage.returnedModel, usage.responseId, new Date().toISOString(), new Date().toISOString(), callId);
      this.upsertUsage(callId, "prompt_tokens", usage.promptTokens, "token");
      this.upsertUsage(callId, "completion_tokens", usage.completionTokens, "token");
      this.upsertUsage(callId, "total_tokens", usage.totalTokens, "token");
      this.saveCost(callId, calculateCatalogCost({ apiKind: "chat_completions", model: String(call.requested_model), region: "cn-beijing", thinkingEnabled: Boolean(call.thinking_enabled), promptTokens: usage.promptTokens, completionTokens: usage.completionTokens }));
    });
  }

  updateAsrDuration(callId: string, taskId: string, durationSeconds: number): void {
    assertCount(durationSeconds);
    const call = this.requireCall(callId);
    this.transaction(() => {
      this.database.prepare("UPDATE ai_calls SET provider_request_id=? WHERE id=?").run(taskId, callId);
      this.upsertUsage(callId, "billing_duration", durationSeconds, "second");
      this.saveCost(callId, calculateCatalogCost({ apiKind: "paraformer_realtime", model: String(call.requested_model), region: "cn-beijing", billingDurationSeconds: durationSeconds }));
    });
  }

  linkProviderRequest(callId: string, requestId: string): void {
    this.requireCall(callId);
    this.database.prepare("UPDATE ai_calls SET provider_request_id=? WHERE id=?").run(requestId, callId);
  }

  finishCall(callId: string, status: Exclude<AiCallStatus, "running">, errorCode?: string): void {
    this.requireCall(callId);
    this.transaction(() => {
      const now = new Date().toISOString();
      this.database.prepare("UPDATE ai_calls SET status=?,error_code=?,completed_at=?,latency_ms=CAST((julianday(?) - julianday(started_at))*86400000 AS INTEGER) WHERE id=?").run(status, errorCode ?? null, now, now, callId);
      const hasCost = this.database.prepare("SELECT 1 AS found FROM ai_call_costs WHERE call_id=?").get(callId);
      if (!hasCost) this.database.prepare("INSERT INTO ai_call_costs(call_id,status,currency,calculated_at) VALUES(?,'usage_missing','CNY',?)").run(callId, now);
    });
  }

  markRunningInterrupted(): number {
    const now = new Date().toISOString();
    const result = this.database.prepare("UPDATE ai_calls SET status='interrupted',completed_at=?,error_code='APP_RESTARTED' WHERE status='running'").run(now);
    this.database.prepare("INSERT OR IGNORE INTO ai_call_costs(call_id,status,currency,calculated_at) SELECT id,'usage_missing','CNY',? FROM ai_calls WHERE status='interrupted'").run(now);
    return Number(result.changes);
  }

  getCall(callId: string): any | undefined {
    const row = this.database.prepare("SELECT * FROM ai_calls WHERE id=?").get(callId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const usageRows = this.database.prepare("SELECT metric,value FROM ai_call_usage WHERE call_id=? ORDER BY metric").all(callId) as Array<{ metric: string; value: number }>;
    const cost = this.database.prepare("SELECT status,input_cost_micros,output_cost_micros,total_cost_micros,currency,pricing_rule_key FROM ai_call_costs WHERE call_id=?").get(callId) as Record<string, unknown> | undefined;
    return {
      id: row.id, featureKey: row.feature_key, usageKind: row.usage_kind, apiKind: row.api_kind, requestedModel: row.requested_model,
      returnedModel: row.returned_model, providerRequestId: row.provider_request_id, status: row.status, errorCode: row.error_code,
      usage: Object.fromEntries(usageRows.map((item) => [item.metric, item.value])),
      cost: cost ? { status: cost.status, inputCostMicros: cost.input_cost_micros ?? null, outputCostMicros: cost.output_cost_micros ?? null, totalCostMicros: cost.total_cost_micros ?? null, currency: cost.currency, ruleKey: cost.pricing_rule_key ?? null } : undefined,
    };
  }

  getDashboard(query: AiUsageQuery): any {
    const where = ["c.started_at>=?", "c.started_at<?"];
    const parameters: Array<string> = [query.from, query.to];
    for (const [column, value] of [["c.usage_kind", query.usageKind], ["c.api_kind", query.apiKind], ["c.room_id", query.roomId], ["c.requested_model", query.model]] as const) {
      if (value) { where.push(`${column}=?`); parameters.push(value); }
    }
    const rows = this.database.prepare(`SELECT c.*,co.status AS cost_status,co.total_cost_micros,
      COALESCE((SELECT value FROM ai_call_usage WHERE call_id=c.id AND metric='prompt_tokens'),0) AS prompt_tokens,
      COALESCE((SELECT value FROM ai_call_usage WHERE call_id=c.id AND metric='completion_tokens'),0) AS completion_tokens,
      COALESCE((SELECT value FROM ai_call_usage WHERE call_id=c.id AND metric='total_tokens'),0) AS total_tokens,
      COALESCE((SELECT value FROM ai_call_usage WHERE call_id=c.id AND metric='billing_duration'),0) AS billing_duration
      FROM ai_calls c LEFT JOIN ai_call_costs co ON co.call_id=c.id WHERE ${where.join(" AND ")} ORDER BY c.started_at DESC`).all(...parameters) as Record<string, any>[];
    const runIds = new Set(rows.map((row) => row.run_id).filter(Boolean));
    const summary = rows.reduce((value, row) => ({
      calls: value.calls + 1, runs: runIds.size, promptTokens: value.promptTokens + row.prompt_tokens,
      completionTokens: value.completionTokens + row.completion_tokens, totalTokens: value.totalTokens + row.total_tokens,
      asrDurationSeconds: value.asrDurationSeconds + row.billing_duration,
      estimatedCostMicros: value.estimatedCostMicros + (row.cost_status === "calculated" ? row.total_cost_micros ?? 0 : 0),
      usageMissingCalls: value.usageMissingCalls + Number(row.cost_status === "usage_missing"),
      priceMissingCalls: value.priceMissingCalls + Number(row.cost_status === "price_missing"),
    }), { calls: 0, runs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, asrDurationSeconds: 0, estimatedCostMicros: 0, usageMissingCalls: 0, priceMissingCalls: 0 });
    type Group = { key: string; calls: number; totalTokens: number; asrDurationSeconds: number; estimatedCostMicros: number };
    const group = (key: "feature_key" | "room_id" | "requested_model"): Group[] => {
      const groups = new Map<string, Group>();
      for (const row of rows) {
        const name = String(row[key] ?? "未关联"); const current = groups.get(name) ?? { key: name, calls: 0, totalTokens: 0, asrDurationSeconds: 0, estimatedCostMicros: 0 };
        current.calls++; current.totalTokens += row.total_tokens; current.asrDurationSeconds += row.billing_duration; if (row.cost_status === "calculated") current.estimatedCostMicros += row.total_cost_micros ?? 0; groups.set(name, current);
      }
      return [...groups.values()].sort((a, b) => b.estimatedCostMicros - a.estimatedCostMicros);
    };
    return { summary, byFeature: group("feature_key"), byRoom: group("room_id"), byModel: group("requested_model"), calls: rows.map((row) => ({ id: row.id, startedAt: row.started_at, completedAt: row.completed_at ?? undefined, featureKey: row.feature_key, usageKind: row.usage_kind, roomId: row.room_id ?? undefined, apiKind: row.api_kind, model: row.returned_model ?? row.requested_model, status: row.status, promptTokens: row.prompt_tokens, completionTokens: row.completion_tokens, totalTokens: row.total_tokens, asrDurationSeconds: row.billing_duration, estimatedCostMicros: row.cost_status === "calculated" ? row.total_cost_micros : null, costStatus: row.cost_status ?? "usage_missing" })) };
  }

  private requireCall(callId: string): Record<string, unknown> {
    const row = this.database.prepare("SELECT * FROM ai_calls WHERE id=?").get(callId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("AI_CALL_NOT_FOUND");
    return row;
  }

  private upsertUsage(callId: string, metric: string, value: number, unit: string): void {
    this.database.prepare("INSERT INTO ai_call_usage(call_id,metric,value,unit) VALUES(?,?,?,?) ON CONFLICT(call_id,metric) DO UPDATE SET value=excluded.value,unit=excluded.unit").run(callId, metric, value, unit);
  }

  private saveCost(callId: string, result: ReturnType<typeof calculateCatalogCost>): void {
    const now = new Date().toISOString();
    if (result.status === "price_missing") {
      this.database.prepare("INSERT INTO ai_call_costs(call_id,status,currency,calculated_at) VALUES(?,'price_missing','CNY',?) ON CONFLICT(call_id) DO UPDATE SET status='price_missing',pricing_rule_key=NULL,input_cost_micros=NULL,output_cost_micros=NULL,total_cost_micros=NULL,calculated_at=excluded.calculated_at").run(callId, now);
      return;
    }
    this.database.prepare(`INSERT INTO ai_call_costs(call_id,pricing_rule_key,input_cost_micros,output_cost_micros,total_cost_micros,status,currency,calculated_at)
      VALUES(?,?,?,?,?,'calculated','CNY',?) ON CONFLICT(call_id) DO UPDATE SET pricing_rule_key=excluded.pricing_rule_key,input_cost_micros=excluded.input_cost_micros,output_cost_micros=excluded.output_cost_micros,total_cost_micros=excluded.total_cost_micros,status='calculated',calculated_at=excluded.calculated_at`)
      .run(callId, result.ruleKey, result.inputCostMicros, result.outputCostMicros, result.totalCostMicros, now);
  }

  private transaction(action: () => void): void {
    this.database.exec("BEGIN IMMEDIATE");
    try { action(); this.database.exec("COMMIT"); }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
}

function assertCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("AI_USAGE_INVALID");
}
