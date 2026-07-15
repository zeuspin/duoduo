import type { LlmProviderConfig } from "../../shared/contracts";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider";

export function createLlmProvider(config: LlmProviderConfig, secret?: string) {
  if (config.secretId && !secret) throw new Error("LLM_SECRET_MISSING");
  return new OpenAiCompatibleProvider({ endpoint: config.endpoint, model: config.model, auth: config.type === "bailian" ? "bearer" : config.auth, secret });
}
