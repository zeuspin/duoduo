import { afterEach, describe, expect, it } from "vitest";
import { DuoduoDatabase } from "../../src/main/storage/database";

const databases: DuoduoDatabase[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
const memoryDatabase = () => { const database = new DuoduoDatabase(":memory:"); databases.push(database); return database; };

describe("AI usage dashboard query", () => {
  it("aggregates confirmed usage and exposes missing estimates separately", () => {
    const repository = memoryDatabase().aiUsage;
    const llm = repository.startCall({ featureKey: "live_insight", usageKind: "production", apiKind: "chat_completions", requestedModel: "qwen-plus", region: "cn-beijing", thinkingEnabled: false, roomId: "100" });
    repository.completeLlm(llm, { responseId: "r1", returnedModel: "qwen-plus", promptTokens: 1000, completionTokens: 500, totalTokens: 1500 });
    const unknown = repository.startCall({ featureKey: "connection_test", usageKind: "test", apiKind: "chat_completions", requestedModel: "unknown", region: "cn-beijing", thinkingEnabled: false });
    repository.completeLlm(unknown, { responseId: "r2", returnedModel: "unknown", promptTokens: 2, completionTokens: 1, totalTokens: 3 });

    const result = repository.getDashboard({ from: "2000-01-01T00:00:00.000Z", to: "2100-01-01T00:00:00.000Z" });
    expect(result.summary).toEqual(expect.objectContaining({ calls: 2, promptTokens: 1002, completionTokens: 501, totalTokens: 1503, estimatedCostMicros: 1800, priceMissingCalls: 1 }));
    expect(result.byFeature).toEqual(expect.arrayContaining([expect.objectContaining({ key: "live_insight", calls: 1 })]));
    expect(result.calls).toHaveLength(2);
  });

  it("creates a run before calls reference it and counts it once", () => {
    const repository = memoryDatabase().aiUsage;
    repository.startRun({ id: "run-1", featureKey: "parser_test", usageKind: "test", roomId: "100" });
    const call = repository.startCall({ runId: "run-1", featureKey: "parser_test", usageKind: "test", apiKind: "chat_completions", requestedModel: "qwen-plus", region: "cn-beijing", thinkingEnabled: false });
    repository.finishCall(call, "provider_failed");
    repository.finishRun("run-1", "failed");
    expect(repository.getDashboard({ from: "2000-01-01T00:00:00.000Z", to: "2100-01-01T00:00:00.000Z" }).summary.runs).toBe(1);
  });
});
