import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AsrProviderConfigSchema, DataRetentionSettingsSchema, InsightNotificationSettingsSchema, LlmProviderConfigSchema, MonitoringSettingsSchema, type AsrProviderConfig, type DataRetentionSettings, type InsightNotificationSettings, type LlmProviderConfig, type MonitoringSettings } from "../../shared/contracts";

export interface StringCipher {
  encryptString(value: string): string;
  decryptString(value: string): string;
}

interface SettingsDocument {
  provider?: AsrProviderConfig;
  llmProvider?: LlmProviderConfig;
  insightNotifications?: InsightNotificationSettings;
  monitoring?: MonitoringSettings;
  dataRetention?: DataRetentionSettings;
  secrets: Record<string, string>;
}

export class SettingsStore {
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
    if (document.llmProvider || document.provider?.type !== "bailian") return false;
    document.llmProvider = { type: "bailian", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus", secretId: document.provider.secretId };
    await this.write(document);
    return true;
  }

  async getInsightNotifications(): Promise<InsightNotificationSettings> { return (await this.read()).insightNotifications ?? { timeoutSeconds: 30 }; }
  async getMonitoringSettings(): Promise<MonitoringSettings> { return (await this.read()).monitoring ?? { monitoredCheckSeconds: 30, preparedCheckMinutes: 5 }; }
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

  async saveDataRetention(value: DataRetentionSettings): Promise<void> {
    const document = await this.read();
    document.dataRetention = DataRetentionSettingsSchema.parse(value);
    await this.write(document);
  }

  private async read(): Promise<SettingsDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as SettingsDocument;
      return { provider: parsed.provider ? AsrProviderConfigSchema.parse(parsed.provider) : undefined, llmProvider: parsed.llmProvider ? LlmProviderConfigSchema.parse(parsed.llmProvider) : undefined, insightNotifications: parsed.insightNotifications ? InsightNotificationSettingsSchema.parse(parsed.insightNotifications) : undefined, monitoring: parsed.monitoring ? MonitoringSettingsSchema.parse(parsed.monitoring) : undefined, dataRetention: parsed.dataRetention ? DataRetentionSettingsSchema.parse(parsed.dataRetention) : undefined, secrets: parsed.secrets ?? {} };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { secrets: {} };
      throw error;
    }
  }

  private async write(document: SettingsDocument): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, this.filePath);
  }
}
