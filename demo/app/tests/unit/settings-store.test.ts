import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    await store.saveLlm({ type: "bailian", analysisModel: "qwen-plus", agentModel: "qwen3.5-flash-2026-02-23", secretId: "llm-main" }, "plain-llm-key");
    expect(await store.getLlmConfig()).toMatchObject({ type: "bailian", analysisModel: "qwen-plus", agentModel: "qwen3.5-flash-2026-02-23", secretId: "llm-main" });
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
    expect(await store.getLlmConfig()).toEqual({ type: "bailian", analysisModel: "qwen-plus", agentModel: "qwen3.5-flash-2026-02-23", secretId: "bailian-main" });
    expect(await store.ensureDefaultBailianLlm()).toBe(false);
    expect(await readFile(path, "utf8")).not.toContain("one-shared-key");
  });

  it("keeps the legacy qwen-plus model when normalizing old LLM settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-settings-"));
    const path = join(dir, "settings.json");
    await writeFile(path, JSON.stringify({
      llmProvider: { type: "bailian", model: "qwen-plus", secretId: "bailian-main" },
      secrets: {},
    }));
    expect(await new SettingsStore(path, cipher).getLlmConfig()).toEqual({
      type: "bailian",
      analysisModel: "qwen-plus",
      agentModel: "qwen3.5-flash-2026-02-23",
      secretId: "bailian-main",
    });
  });

  it("replaces a conflicting LLM key reference with the Bailian key from system settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-settings-")); const path = join(dir, "settings.json"); const store = new SettingsStore(path, cipher);
    await store.saveLlm({ type: "bailian", analysisModel: "qwen-plus", agentModel: "qwen3.5-flash-2026-02-23", secretId: "llm-main" }, "old-key");
    await store.save({ type: "bailian", model: "paraformer-realtime-v2", secretId: "bailian-main" }, "shared-key");

    expect(await store.ensureDefaultBailianLlm()).toBe(true);
    expect(await store.getLlmConfig()).toMatchObject({ type: "bailian", secretId: "bailian-main" });
    expect(await store.getSecret("bailian-main")).toBe("shared-key");
  });

  it("persists monitoring intervals with safe defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-settings-"));
    const path = join(dir, "settings.json");
    const store = new SettingsStore(path, cipher);
    expect(await store.getMonitoringSettings()).toEqual({ monitoredCheckSeconds: 30, preparedCheckMinutes: 5 });
    await store.saveMonitoringSettings({ monitoredCheckSeconds: 15, preparedCheckMinutes: 10 });
    expect(await new SettingsStore(path, cipher).getMonitoringSettings()).toEqual({ monitoredCheckSeconds: 15, preparedCheckMinutes: 10 });
    await expect(store.saveMonitoringSettings({ monitoredCheckSeconds: 1 } as never)).rejects.toThrow();
  });

  it("persists verification pause and normalizes interrupted recovery after restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-settings-"));
    const path = join(dir, "settings.json");
    const store = new SettingsStore(path, cipher);
    const triggeredAt = "2026-07-15T10:00:00.000Z";
    await store.saveDouyinAccessState({ mode: "recovery_ready", roomId: "123", taskType: "manual_probe", triggeredAt });
    expect(await new SettingsStore(path, cipher).getDouyinAccessState()).toEqual({ mode: "verification_paused", roomId: "123", taskType: "manual_probe", triggeredAt, reason: "verification_required" });
  });

  it("serializes consecutive access-state file replacements", async () => {
    const dir = await mkdtemp(join(tmpdir(), "duoduo-settings-"));
    const path = join(dir, "settings.json");
    const store = new SettingsStore(path, cipher);
    const triggeredAt = "2026-07-15T10:00:00.000Z";
    await expect(Promise.all([
      store.saveDouyinAccessState({ mode: "recovery_checking", roomId: "123", taskType: "manual_probe", triggeredAt }),
      store.saveDouyinAccessState({ mode: "verification_paused", roomId: "123", taskType: "manual_probe", triggeredAt, reason: "verification_required" }),
    ])).resolves.toHaveLength(2);
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
