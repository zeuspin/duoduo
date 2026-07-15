export interface LlmRequest { system: string; user: string; temperature?: number }
export interface ConnectionTestResult { ok: boolean; message: string; latencyMs: number }
export interface LlmProvider {
  complete(request: LlmRequest): Promise<unknown>;
  testConnection(): Promise<ConnectionTestResult>;
}
