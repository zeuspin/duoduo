import type { LlmCompletion, LlmProvider, LlmRequest } from "../llm/types";
import type { AiUsageRepository } from "./usage-repository";
import type { AiCallContext, AiCallStatus } from "./types";
import type { AsrUsageMeter } from "../asr/bailian-provider";

export class AiUsageGateway {
  constructor(private readonly repository: AiUsageRepository) {}

  meterLlm(provider: LlmProvider, context: AiCallContext): LlmProvider {
    const complete = async (request: LlmRequest): Promise<LlmCompletion> => {
      const callId = this.repository.startCall(context);
      try {
        const result = await provider.complete(request);
        this.repository.completeLlm(callId, result.metering);
        return { ...result, metering: { ...result.metering, callId, markBusinessOutputInvalid: () => this.repository.finishCall(callId, "business_output_invalid", "INSIGHT_OUTPUT_INVALID") } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.repository.finishCall(callId, classifyFailure(message), stableErrorCode(message));
        throw error;
      }
    };
    return {
      complete,
      testConnection: async () => {
        const startedAt = Date.now();
        await complete({ system: "Return JSON only.", user: '{"ping":true}', temperature: 0 });
        return { ok: true, message: "连接成功", latencyMs: Date.now() - startedAt };
      },
    };
  }

  createAsrMeter(context: AiCallContext, roomId: string, taskId: string): AsrUsageMeter {
    const callId = this.repository.startCall({ ...context, roomId: context.roomId ?? (roomId.startsWith("connection-test-") ? undefined : roomId) });
    this.repository.linkProviderRequest(callId, taskId);
    let terminal = false;
    return {
      duration: (seconds) => { if (!terminal) this.repository.updateAsrDuration(callId, taskId, seconds); },
      succeed: () => { if (!terminal) { terminal = true; this.repository.finishCall(callId, "succeeded"); } },
      fail: (status, errorCode) => { if (!terminal) { terminal = true; this.repository.finishCall(callId, status, errorCode); } },
    };
  }
}

function classifyFailure(message: string): Exclude<AiCallStatus, "running" | "succeeded" | "business_output_invalid"> {
  if (/abort|timeout/i.test(message)) return "timed_out";
  if (/LLM_HTTP_/i.test(message)) return "http_failed";
  return "provider_failed";
}

function stableErrorCode(message: string): string {
  return message.match(/(?:LLM_[A-Z0-9_]+|BAILIAN_[A-Z0-9_]+)/)?.[0] ?? "AI_PROVIDER_ERROR";
}
