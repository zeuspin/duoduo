export interface LlmRequest { system: string; user: string; temperature?: number }
export interface LlmCompletion {
  output: unknown;
  metering: { responseId: string; returnedModel: string; promptTokens: number; completionTokens: number; totalTokens: number; callId?: string; markBusinessOutputInvalid?: () => void };
}
export interface ConnectionTestResult { ok: boolean; message: string; latencyMs: number }
export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmCompletion>;
  testConnection(): Promise<ConnectionTestResult>;
}
