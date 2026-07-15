import type { AsrProviderConfig } from "../../shared/contracts";
import { BailianProvider } from "./bailian-provider";
import { DuoduoStreamingAsrProvider } from "./generic-provider";
import type { AsrProvider } from "./types";

export function createAsrProvider(config: AsrProviderConfig, secret?: string): AsrProvider {
  if (config.type === "bailian") {
    if (!secret) throw new Error("ASR_SECRET_MISSING");
    return new BailianProvider({ apiKey: secret });
  }
  if (config.auth !== "none" && !secret) throw new Error("ASR_SECRET_MISSING");
  return new DuoduoStreamingAsrProvider({ endpoint: config.endpoint, auth: config.auth, secret });
}
