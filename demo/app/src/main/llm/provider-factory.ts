import type { LlmProviderConfig } from "../../shared/contracts";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider";
import type { AiUsageGateway } from "../usage/usage-gateway";
import type { AiCallContext } from "../usage/types";

export function createLlmProvider(config: LlmProviderConfig, secret?: string, gateway?: AiUsageGateway, context?: AiCallContext) {
  if (config.secretId && !secret) throw new Error("LLM_SECRET_MISSING");
  const provider = new OpenAiCompatibleProvider({ endpoint: config.endpoint, model: config.model, auth: config.type === "bailian" ? "bearer" : config.auth, secret });
  return config.type === "bailian" && gateway && context ? gateway.meterLlm(provider, context) : provider;
}
