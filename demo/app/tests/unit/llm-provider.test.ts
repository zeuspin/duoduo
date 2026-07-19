import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleProvider } from "../../src/main/llm/openai-compatible-provider";

describe("OpenAiCompatibleProvider", () => {
  it("maps model requests and parses structured JSON content", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: "chatcmpl-1", model: "market-model-v1", choices: [{ message: { content: '{"insights":[]}' } }], usage: { prompt_tokens: 26, completion_tokens: 8, total_tokens: 34 } }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new OpenAiCompatibleProvider({ endpoint: "https://llm.example/v1/chat/completions", model: "market-model", auth: "bearer", secret: "secret-value" }, fetcher);
    await expect(provider.complete({ system: "rules", user: "ASR", temperature: 0.1 })).resolves.toEqual({ output: { insights: [] }, metering: { responseId: "chatcmpl-1", returnedModel: "market-model-v1", promptTokens: 26, completionTokens: 8, totalTokens: 34 } });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-value");
    expect(String(init.body)).toContain("market-model");
    expect(JSON.parse(String(init.body)).enable_thinking).toBe(false);
  });

  it("uses X-API-Key and redacts the secret from HTTP errors", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response("secret-value denied", { status: 401 }));
    const provider = new OpenAiCompatibleProvider({ endpoint: "https://llm.example/v1/chat/completions", model: "market-model", auth: "x-api-key", secret: "secret-value" }, fetcher);
    await expect(provider.complete({ system: "rules", user: "ASR" })).rejects.not.toThrow("secret-value");
    expect((fetcher.mock.calls[0][1].headers as Record<string, string>)["X-API-Key"]).toBe("secret-value");
  });

  it("fails closed on non-JSON model content", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ id: "chatcmpl-2", model: "market-model", choices: [{ message: { content: "not json" } }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }), { status: 200 }));
    const provider = new OpenAiCompatibleProvider({ endpoint: "https://llm.example/v1/chat/completions", model: "market-model", auth: "none" }, fetcher);
    await expect(provider.complete({ system: "rules", user: "ASR" })).rejects.toThrow("LLM_INVALID_JSON");
  });

  it("rejects a successful response without confirmed usage", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "chatcmpl-3", model: "market-model", choices: [{ message: { content: "{}" } }] }), { status: 200 }));
    const provider = new OpenAiCompatibleProvider({ endpoint: "https://llm.example/v1/chat/completions", model: "market-model", auth: "none" }, fetcher);
    await expect(provider.complete({ system: "rules", user: "ASR" })).rejects.toThrow("LLM_USAGE_INVALID");
  });
});
