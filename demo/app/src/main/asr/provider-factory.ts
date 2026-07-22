import type { AsrProviderConfig } from "../../shared/contracts";
import { BailianProvider } from "./bailian-provider";
import type { AsrProvider } from "./types";
import type { AiUsageGateway } from "../usage/usage-gateway";
import type { AiCallContext } from "../usage/types";

export function createAsrProvider(config: AsrProviderConfig, secret?: string, gateway?: AiUsageGateway, context?: AiCallContext): AsrProvider {
  if (!secret) throw new Error("ASR_SECRET_MISSING");
  return new BailianProvider({ apiKey: secret, model: config.model, ...(gateway && context ? { meter: (roomId, taskId) => gateway.createAsrMeter(context, roomId, taskId) } : {}) });
}
