import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SettingsStore } from "../../src/main/storage/settings-store";

const cipher = {
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`).toString("base64"),
  decryptString: (value: string) => Buffer.from(value, "base64").toString().replace("encrypted:", ""),
};

describe("SettingsStore", () => {
  it("restores provider settings while keeping secrets encrypted on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-settings-"));
    const path = join(dir, "settings.json");
    const store = new SettingsStore(path, cipher);
    await store.save({ type: "bailian", model: "paraformer-realtime-v2", secretId: "main" }, "plain-test-key");

    expect(await store.getConfig()).toMatchObject({ type: "bailian", secretId: "main" });
    expect(await store.getSecret("main")).toBe("plain-test-key");
    expect(await readFile(path, "utf8")).not.toContain("plain-test-key");
  });

  it("stores LLM configuration separately and never writes its plaintext key", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-settings-"));
    const path = join(dir, "settings.json");
    const store = new SettingsStore(path, cipher);
    await store.saveLlm({ type: "bailian", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus", secretId: "llm-main" }, "plain-llm-key");
    expect(await store.getLlmConfig()).toMatchObject({ type: "bailian", model: "qwen-plus", secretId: "llm-main" });
    expect(await store.getSecret("llm-main")).toBe("plain-llm-key");
    expect(await readFile(path, "utf8")).not.toContain("plain-llm-key");
  });

  it("persists the global insight notification timeout", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-settings-"));
    const path = join(dir, "settings.json");
    const store = new SettingsStore(path, cipher);
    expect(await store.getInsightNotifications()).toEqual({ timeoutSeconds: 30 });
    await store.saveInsightNotifications({ timeoutSeconds: null });
    expect(await new SettingsStore(path, cipher).getInsightNotifications()).toEqual({ timeoutSeconds: null });
    await expect(store.saveInsightNotifications({ timeoutSeconds: 20 } as never)).rejects.toThrow();
  });

  it("creates a separate default LLM config from an existing Bailian ASR key reference", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-settings-")); const path = join(dir, "settings.json"); const store = new SettingsStore(path, cipher);
    await store.save({ type: "bailian", model: "paraformer-realtime-v2", secretId: "bailian-main" }, "one-shared-key");
    expect(await store.ensureDefaultBailianLlm()).toBe(true);
    expect(await store.getLlmConfig()).toEqual({ type: "bailian", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus", secretId: "bailian-main" });
    expect(await store.ensureDefaultBailianLlm()).toBe(false);
    expect(await readFile(path, "utf8")).not.toContain("one-shared-key");
  });

  it("persists monitoring intervals with safe defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-settings-"));
    const path = join(dir, "settings.json");
    const store = new SettingsStore(path, cipher);
    expect(await store.getMonitoringSettings()).toEqual({ monitoredCheckSeconds: 30, preparedCheckMinutes: 5 });
    await store.saveMonitoringSettings({ monitoredCheckSeconds: 15, preparedCheckMinutes: 10 });
    expect(await new SettingsStore(path, cipher).getMonitoringSettings()).toEqual({ monitoredCheckSeconds: 15, preparedCheckMinutes: 10 });
    await expect(store.saveMonitoringSettings({ monitoredCheckSeconds: 1, preparedCheckMinutes: 1 } as never)).rejects.toThrow();
  });

  it("persists bounded data retention with safe defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-settings-"));
    const path = join(dir, "settings.json");
    const store = new SettingsStore(path, cipher);
    expect(await store.getDataRetention()).toEqual({ observationDays: 30, aggregateDays: 365, asrDays: 90, logDays: 30 });
    await store.saveDataRetention({ observationDays: 14, aggregateDays: 180, asrDays: 60, logDays: 7 });
    expect(await new SettingsStore(path, cipher).getDataRetention()).toEqual({ observationDays: 14, aggregateDays: 180, asrDays: 60, logDays: 7 });
    await expect(store.saveDataRetention({ observationDays: 0, aggregateDays: 365, asrDays: 90, logDays: 30 })).rejects.toThrow();
  });
});
