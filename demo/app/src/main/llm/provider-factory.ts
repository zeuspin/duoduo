import type { LlmProviderConfig } from "../../shared/contracts";
import { OpenAiCompatibleProvider } from "./openai-compatible-provider";
import type { AiUsageGateway } from "../usage/usage-gateway";
import type { AiCallContext } from "../usage/types";

const BAILIAN_CHAT_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

export function createLlmProvider(config: LlmProviderConfig, model: string, secret?: string, gateway?: AiUsageGateway, context?: AiCallContext) {
  if (!secret) throw new Error("LLM_SECRET_MISSING");
  const provider = new OpenAiCompatibleProvider({ endpoint: BAILIAN_CHAT_ENDPOINT, model, auth: "bearer", secret });
  return gateway && context ? gateway.meterLlm(provider, context) : provider;
}
