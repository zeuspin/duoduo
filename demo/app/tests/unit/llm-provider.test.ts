import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleProvider } from "../../src/main/llm/openai-compatible-provider";

describe("OpenAiCompatibleProvider", () => {
  it("maps model requests and parses structured JSON content", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: '{"insights":[]}' } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new OpenAiCompatibleProvider({ endpoint: "https://llm.example/v1/chat/completions", model: "market-model", auth: "bearer", secret: "secret-value" }, fetcher);
    await expect(provider.complete({ system: "rules", user: "ASR", temperature: 0.1 })).resolves.toEqual({ insights: [] });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://llm.example/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-value");
    expect(String(init.body)).toContain("market-model");
  });

  it("uses X-API-Key and redacts the secret from HTTP errors", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response("secret-value denied", { status: 401 }));
    const provider = new OpenAiCompatibleProvider({ endpoint: "https://llm.example/v1/chat/completions", model: "market-model", auth: "x-api-key", secret: "secret-value" }, fetcher);
    await expect(provider.complete({ system: "rules", user: "ASR" })).rejects.not.toThrow("secret-value");
    expect((fetcher.mock.calls[0][1].headers as Record<string, string>)["X-API-Key"]).toBe("secret-value");
  });

  it("fails closed on non-JSON model content", async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 }));
    const provider = new OpenAiCompatibleProvider({ endpoint: "https://llm.example/v1/chat/completions", model: "market-model", auth: "none" }, fetcher);
    await expect(provider.complete({ system: "rules", user: "ASR" })).rejects.toThrow("LLM_INVALID_JSON");
  });
});
