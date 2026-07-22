import { afterEach, describe, expect, it } from "vitest";
import { DuoduoDatabase } from "../../src/main/storage/database";

const databases: DuoduoDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function memoryDatabase() {
  const database = new DuoduoDatabase(":memory:");
  databases.push(database);
  return database;
}

describe("AiUsageRepository", () => {
  it("stores confirmed LLM usage and catalog cost without content fields", () => {
    const repository = memoryDatabase().aiUsage;
    const callId = repository.startCall({ featureKey: "live_insight", usageKind: "production", apiKind: "chat_completions", requestedModel: "qwen-plus", region: "cn-beijing", thinkingEnabled: false });
    repository.completeLlm(callId, { responseId: "chatcmpl-1", returnedModel: "qwen-plus", promptTokens: 1000, completionTokens: 500, totalTokens: 1500 });

    expect(repository.getCall(callId)).toEqual(expect.objectContaining({ status: "succeeded", providerRequestId: "chatcmpl-1", returnedModel: "qwen-plus", usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 }, cost: expect.objectContaining({ status: "calculated", inputCostMicros: 800, outputCostMicros: 1000, totalCostMicros: 1800 }) }));
    expect(Object.keys(repository.getCall(callId)!)).not.toEqual(expect.arrayContaining(["prompt", "response", "content"]));
  });

  it("replaces cumulative ASR duration instead of summing final sentences", () => {
    const repository = memoryDatabase().aiUsage;
    const callId = repository.startCall({ featureKey: "live_asr", usageKind: "production", apiKind: "asr_realtime", requestedModel: "paraformer-realtime-v2", region: "cn-beijing" });
    repository.updateAsrDuration(callId, "task-1", 3);
    repository.updateAsrDuration(callId, "task-1", 8);
    repository.finishCall(callId, "succeeded");

    expect(repository.getCall(callId)).toEqual(expect.objectContaining({ providerRequestId: "task-1", usage: { billing_duration: 8 }, cost: expect.objectContaining({ status: "calculated", totalCostMicros: 1920 }) }));
  });

  it("does not estimate unknown model prices", () => {
    const repository = memoryDatabase().aiUsage;
    const callId = repository.startCall({ featureKey: "live_insight", usageKind: "production", apiKind: "chat_completions", requestedModel: "other-model", region: "cn-beijing", thinkingEnabled: false });
    repository.completeLlm(callId, { responseId: "chatcmpl-2", returnedModel: "other-model", promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(repository.getCall(callId)?.cost).toEqual(expect.objectContaining({ status: "price_missing", totalCostMicros: null }));
  });

  it("marks completed calls without provider usage as usage missing", () => {
    const repository = memoryDatabase().aiUsage;
    const callId = repository.startCall({ featureKey: "connection_test", usageKind: "test", apiKind: "asr_realtime", requestedModel: "paraformer-realtime-v2", region: "cn-beijing" });
    repository.finishCall(callId, "provider_failed", "CLIENT_ERROR");
    expect(repository.getCall(callId)).toEqual(expect.objectContaining({ status: "provider_failed", errorCode: "CLIENT_ERROR", cost: expect.objectContaining({ status: "usage_missing" }) }));
  });

  it("marks abandoned running calls interrupted", () => {
    const repository = memoryDatabase().aiUsage;
    const callId = repository.startCall({ featureKey: "live_asr", usageKind: "production", apiKind: "asr_realtime", requestedModel: "paraformer-realtime-v2", region: "cn-beijing" });
    expect(repository.markRunningInterrupted()).toBe(1);
    expect(repository.getCall(callId)?.status).toBe("interrupted");
  });
});
