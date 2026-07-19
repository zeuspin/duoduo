import { describe, expect, it, vi } from "vitest";
import { DuoduoDatabase } from "../../src/main/storage/database";
import { AiUsageGateway } from "../../src/main/usage/usage-gateway";

describe("AiUsageGateway", () => {
  it("records a successful LLM call without exposing content to storage", async () => {
    const database = new DuoduoDatabase(":memory:");
    const provider = { complete: vi.fn(async () => ({ output: { insights: [] }, metering: { responseId: "r1", returnedModel: "qwen-plus", promptTokens: 10, completionTokens: 5, totalTokens: 15 } })), testConnection: vi.fn() };
    const metered = new AiUsageGateway(database.aiUsage).meterLlm(provider, { featureKey: "live_insight", usageKind: "production", apiKind: "chat_completions", requestedModel: "qwen-plus", region: "cn-beijing", thinkingEnabled: false });
    const result = await metered.complete({ system: "secret prompt", user: "secret transcript" });
    const call = database.aiUsage.getCall(result.metering.callId!);
    expect(call).toEqual(expect.objectContaining({ status: "succeeded", usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    expect(JSON.stringify(call)).not.toContain("secret");
    database.close();
  });

  it("marks schema-invalid business output after preserving usage", async () => {
    const database = new DuoduoDatabase(":memory:");
    const provider = { complete: vi.fn(async () => ({ output: {}, metering: { responseId: "r2", returnedModel: "qwen-plus", promptTokens: 10, completionTokens: 5, totalTokens: 15 } })), testConnection: vi.fn() };
    const result = await new AiUsageGateway(database.aiUsage).meterLlm(provider, { featureKey: "live_insight", usageKind: "production", apiKind: "chat_completions", requestedModel: "qwen-plus", region: "cn-beijing", thinkingEnabled: false }).complete({ system: "x", user: "y" });
    result.metering.markBusinessOutputInvalid?.();
    expect(database.aiUsage.getCall(result.metering.callId!)?.status).toBe("business_output_invalid");
    expect(database.aiUsage.getCall(result.metering.callId!)?.cost.status).toBe("calculated");
    database.close();
  });
});
