import type { AsrProviderConfig } from "../../shared/contracts";
import { BailianProvider } from "./bailian-provider";
import { DuoduoStreamingAsrProvider } from "./generic-provider";
import type { AsrProvider } from "./types";
import type { AiUsageGateway } from "../usage/usage-gateway";
import type { AiCallContext } from "../usage/types";

export function createAsrProvider(config: AsrProviderConfig, secret?: string, gateway?: AiUsageGateway, context?: AiCallContext): AsrProvider {
  if (config.type === "bailian") {
    if (!secret) throw new Error("ASR_SECRET_MISSING");
    return new BailianProvider({ apiKey: secret, ...(gateway && context ? { meter: (roomId, taskId) => gateway.createAsrMeter(context, roomId, taskId) } : {}) });
  }
  if (config.auth !== "none" && !secret) throw new Error("ASR_SECRET_MISSING");
  return new DuoduoStreamingAsrProvider({ endpoint: config.endpoint, auth: config.auth, secret });
}
