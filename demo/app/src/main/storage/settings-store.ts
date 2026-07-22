import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AsrProviderConfigSchema, DataRetentionSettingsSchema, DouyinAccessStateSchema, InsightNotificationSettingsSchema, LlmProviderConfigSchema, MonitoringSettingsSchema, type AsrProviderConfig, type DataRetentionSettings, type DouyinAccessState, type InsightNotificationSettings, type LlmProviderConfig, type MonitoringSettings } from "../../shared/contracts";
import { DEFAULT_AGENT_MODEL_ID, DEFAULT_ANALYSIS_MODEL_ID, DEFAULT_ASR_MODEL_ID, isModelAvailable } from "../../shared/bailian-model-catalog";

export interface StringCipher {
  encryptString(value: string): string;
  decryptString(value: string): string;
}

interface SettingsDocument {
  provider?: AsrProviderConfig;
  llmProvider?: LlmProviderConfig;
  insightNotifications?: InsightNotificationSettings;
  monitoring?: MonitoringSettings;
  douyinAccessState?: DouyinAccessState;
  dataRetention?: DataRetentionSettings;
  secrets: Record<string, string>;
}

export class SettingsStore {
  private writeQueue: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string, private readonly cipher: StringCipher) {}

  async getConfig(): Promise<AsrProviderConfig | undefined> {
    return (await this.read()).provider;
  }

  async getSecret(secretId: string): Promise<string | undefined> {
    const encrypted = (await this.read()).secrets[secretId];
    return encrypted ? this.cipher.decryptString(encrypted) : undefined;
  }

  async getLlmConfig(): Promise<LlmProviderConfig | undefined> { return (await this.read()).llmProvider; }

  async ensureDefaultBailianLlm(): Promise<boolean> {
    const document = await this.read();
    if (!document.provider) return false;
    if (document.llmProvider?.secretId === document.provider.secretId) return false;
    document.llmProvider = {
      type: "bailian",
      analysisModel: DEFAULT_ANALYSIS_MODEL_ID,
      agentModel: DEFAULT_AGENT_MODEL_ID,
      secretId: document.provider.secretId,
    };
    await this.write(document);
    return true;
  }

  async getInsightNotifications(): Promise<InsightNotificationSettings> { return (await this.read()).insightNotifications ?? { timeoutSeconds: 30 }; }
  async getMonitoringSettings(): Promise<MonitoringSettings> { return (await this.read()).monitoring ?? { monitoredCheckSeconds: 30, preparedCheckMinutes: 5 }; }
  async getDouyinAccessState(): Promise<DouyinAccessState> {
    const state = (await this.read()).douyinAccessState ?? { mode: "normal" as const };
    if (state.mode === "normal" || state.mode === "verification_paused") return state;
    return { mode: "verification_paused", roomId: state.roomId, taskType: state.taskType, triggeredAt: state.triggeredAt, reason: "verification_required" };
  }
  async getDataRetention(): Promise<DataRetentionSettings> { return (await this.read()).dataRetention ?? { observationDays: 30, aggregateDays: 365, asrDays: 90, logDays: 30 }; }

  async save(config: AsrProviderConfig, secret?: string): Promise<void> {
    const parsed = AsrProviderConfigSchema.parse(config);
    const document = await this.read();
    document.provider = parsed;
    if (secret && parsed.secretId) document.secrets[parsed.secretId] = this.cipher.encryptString(secret);
    await this.write(document);
  }

  async saveLlm(config: LlmProviderConfig, secret?: string): Promise<void> {
    const parsed = LlmProviderConfigSchema.parse(config);
    const document = await this.read();
    document.llmProvider = parsed;
    if (secret && parsed.secretId) document.secrets[parsed.secretId] = this.cipher.encryptString(secret);
    await this.write(document);
  }

  async saveInsightNotifications(value: InsightNotificationSettings): Promise<void> {
    const document = await this.read();
    document.insightNotifications = InsightNotificationSettingsSchema.parse(value);
    await this.write(document);
  }

  async saveMonitoringSettings(value: MonitoringSettings): Promise<void> {
    const document = await this.read();
    document.monitoring = MonitoringSettingsSchema.parse(value);
    await this.write(document);
  }

  async saveDouyinAccessState(value: DouyinAccessState): Promise<void> {
    const document = await this.read();
    document.douyinAccessState = DouyinAccessStateSchema.parse(value);
    await this.write(document);
  }

  async saveDataRetention(value: DataRetentionSettings): Promise<void> {
    const document = await this.read();
    document.dataRetention = DataRetentionSettingsSchema.parse(value);
    await this.write(document);
  }

  private async read(): Promise<SettingsDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Record<string, unknown>;
      return {
        provider: normalizeProvider(parsed.provider),
        llmProvider: normalizeLlmProvider(parsed.llmProvider),
        insightNotifications: parsed.insightNotifications ? InsightNotificationSettingsSchema.parse(parsed.insightNotifications) : undefined,
        monitoring: parsed.monitoring ? MonitoringSettingsSchema.parse(parsed.monitoring) : undefined,
        douyinAccessState: parsed.douyinAccessState ? DouyinAccessStateSchema.parse(parsed.douyinAccessState) : undefined,
        dataRetention: parsed.dataRetention ? DataRetentionSettingsSchema.parse(parsed.dataRetention) : undefined,
        secrets: typeof parsed.secrets === "object" && parsed.secrets ? parsed.secrets as Record<string, string> : {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { secrets: {} };
      throw error;
    }
  }

  private write(document: SettingsDocument): Promise<void> {
    const operation = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    this.writeQueue = operation.catch(() => undefined);
    return operation;
  }
}

function normalizeProvider(value: unknown): AsrProviderConfig | undefined {
  if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "bailian") return undefined;
  const input = value as { model?: unknown; secretId?: unknown };
  if (typeof input.secretId !== "string" || !input.secretId) return undefined;
  const model = typeof input.model === "string" && isModelAvailable("asr_extraction", input.model)
    ? input.model
    : DEFAULT_ASR_MODEL_ID;
  return AsrProviderConfigSchema.parse({ type: "bailian", model, secretId: input.secretId });
}

function normalizeLlmProvider(value: unknown): LlmProviderConfig | undefined {
  if (!value || typeof value !== "object" || (value as { type?: unknown }).type !== "bailian") return undefined;
  const input = value as { model?: unknown; analysisModel?: unknown; agentModel?: unknown; secretId?: unknown };
  if (typeof input.secretId !== "string" || !input.secretId) return undefined;
  const requestedAnalysisModel = input.analysisModel ?? input.model;
  return LlmProviderConfigSchema.parse({
    type: "bailian",
    analysisModel: typeof requestedAnalysisModel === "string" && isModelAvailable("asr_analysis", requestedAnalysisModel)
      ? requestedAnalysisModel
      : DEFAULT_ANALYSIS_MODEL_ID,
    agentModel: typeof input.agentModel === "string" && isModelAvailable("analyzer_agent", input.agentModel)
      ? input.agentModel
      : DEFAULT_AGENT_MODEL_ID,
    secretId: input.secretId,
  });
}
