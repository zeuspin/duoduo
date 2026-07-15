import type { LlmProvider, LlmRequest } from "./types";

export interface OpenAiCompatibleOptions {
  endpoint: string;
  model: string;
  auth: "none" | "bearer" | "x-api-key";
  secret?: string;
  timeoutMs?: number;
}

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(private readonly options: OpenAiCompatibleOptions, private readonly fetcher: Fetcher = fetch) {}

  async complete(request: LlmRequest): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.options.auth === "bearer" && this.options.secret) headers.Authorization = `Bearer ${this.options.secret}`;
      if (this.options.auth === "x-api-key" && this.options.secret) headers["X-API-Key"] = this.options.secret;
      const response = await this.fetcher(this.options.endpoint, {
        method: "POST", headers, signal: controller.signal,
        body: JSON.stringify({ model: this.options.model, temperature: request.temperature ?? 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }] }),
      });
      if (!response.ok) throw new Error(`LLM_HTTP_${response.status}`);
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("LLM_EMPTY_RESPONSE");
      try { return JSON.parse(stripFence(content)); }
      catch { throw new Error("LLM_INVALID_JSON"); }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(this.options.secret ? message.replaceAll(this.options.secret, "[REDACTED]") : message);
    } finally { clearTimeout(timer); }
  }

  async testConnection() {
    const startedAt = Date.now();
    await this.complete({ system: "Return JSON only.", user: '{"ping":true}', temperature: 0 });
    return { ok: true, message: "连接成功", latencyMs: Date.now() - startedAt };
  }
}

function stripFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}
