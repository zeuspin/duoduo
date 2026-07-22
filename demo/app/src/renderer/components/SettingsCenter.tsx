import {
  Bell,
  Broadcast,
  HardDrives,
  Key,
  Palette,
} from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  AsrProviderConfig,
  DataRetentionSettings,
  InsightNotificationSettings,
  LlmProviderConfig,
  MonitoringSettings,
} from "../../shared/contracts";
import {
  DEFAULT_AGENT_MODEL_ID,
  DEFAULT_ANALYSIS_MODEL_ID,
  DEFAULT_ASR_MODEL_ID,
} from "../../shared/bailian-model-catalog";
import { themes, type ThemeId } from "../theme";
import { ModelSelector } from "./ModelSelector";

export type SettingsSection =
  | "appearance"
  | "monitoring"
  | "ai"
  | "notifications"
  | "storage";

interface SettingsCenterProps {
  section: SettingsSection;
  onSectionChange(section: SettingsSection): void;
  theme: ThemeId;
  onThemeChange(theme: ThemeId): void;
  provider?: AsrProviderConfig;
  onProviderChange(provider: AsrProviderConfig): void;
  monitoring: MonitoringSettings;
  onMonitoringChange(settings: MonitoringSettings): void;
  notificationTimeout: InsightNotificationSettings["timeoutSeconds"];
  onNotificationTimeoutChange(
    value: InsightNotificationSettings["timeoutSeconds"],
  ): void;
  onMessage(message: string): void;
}

const retentionDefaults: DataRetentionSettings = {
  observationDays: 30,
  aggregateDays: 365,
  asrDays: 90,
  logDays: 30,
};

export const settingsSectionMeta: Record<
  SettingsSection,
  { label: string; description: string; icon: ReactNode }
> = {
  appearance: {
    label: "外观",
    description: "主题与界面显示",
    icon: <Palette />,
  },
  monitoring: {
    label: "直播监看",
    description: "状态更新与开播检查",
    icon: <Broadcast />,
  },
  ai: {
    label: "AI 服务",
    description: "语音与内容分析凭据",
    icon: <Key />,
  },
  notifications: {
    label: "提醒通知",
    description: "新观点提醒行为",
    icon: <Bell />,
  },
  storage: {
    label: "数据与存储",
    description: "本地数据保留周期",
    icon: <HardDrives />,
  },
};

export function SettingsCenter({
  section,
  onSectionChange,
  theme,
  onThemeChange,
  provider,
  onProviderChange,
  monitoring,
  onMonitoringChange,
  notificationTimeout,
  onNotificationTimeoutChange,
  onMessage,
}: SettingsCenterProps) {
  const [asrModel, setAsrModel] = useState(provider?.model ?? DEFAULT_ASR_MODEL_ID);
  const [apiKey, setApiKey] = useState("");
  const [llmConfig, setLlmConfig] = useState<LlmProviderConfig>();
  const [analysisModel, setAnalysisModel] = useState(DEFAULT_ANALYSIS_MODEL_ID);
  const [agentModel, setAgentModel] = useState(DEFAULT_AGENT_MODEL_ID);
  const [retention, setRetention] = useState(retentionDefaults);

  useEffect(() => {
    let active = true;
    void window.duoduo.llm.get().then((value) => {
      if (!active) return;
      const config = value as LlmProviderConfig | undefined;
      setLlmConfig(config);
      if (!config) return;
      setAnalysisModel(config.analysisModel);
      setAgentModel(config.agentModel);
    });
    void window.duoduo.data.getRetention().then((value) => {
      if (active) setRetention(value as DataRetentionSettings);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!provider) return;
    setAsrModel(provider.model);
  }, [provider]);

  const asrDraft = (): AsrProviderConfig => ({
    type: "bailian",
    model: asrModel,
    secretId: "bailian-main",
  });

  const llmDraft = (): LlmProviderConfig => ({
    type: "bailian",
    analysisModel,
    agentModel,
    secretId: "bailian-main",
  });

  async function saveAi(event: FormEvent) {
    event.preventDefault();
    const asr = asrDraft();
    const llm = llmDraft();
    await window.duoduo.settings.saveAsrProvider(asr, apiKey || undefined);
    await window.duoduo.llm.save(llm);
    onProviderChange(asr);
    setLlmConfig(llm);
    setApiKey("");
    onMessage("百炼凭据与三类系统模型已保存");
  }

  async function testAi() {
    try {
      const asrResult = (await window.duoduo.settings.testAsrProvider(
        asrDraft(),
        apiKey,
      )) as { message?: string } | undefined;
      const llmResult = (await window.duoduo.llm.test(
        llmDraft(),
        apiKey,
      )) as { message?: string } | undefined;
      onMessage(`${asrResult?.message ?? "ASR 已连接"}；${llmResult?.message ?? "文本模型已连接"}`);
    } catch (error) {
      onMessage(`百炼连接失败：${String(error)}`);
    }
  }

  async function saveMonitoring(event: FormEvent) {
    event.preventDefault();
    const saved = (await window.duoduo.settings.saveMonitoring(
      monitoring,
    )) as MonitoringSettings;
    onMonitoringChange(saved);
    onMessage("直播监看设置已保存并立即生效");
  }

  async function saveNotifications(event: FormEvent) {
    event.preventDefault();
    await window.duoduo.settings.saveInsightNotifications({
      timeoutSeconds: notificationTimeout,
    });
    onMessage("提醒通知设置已保存");
  }

  async function saveRetention(event: FormEvent) {
    event.preventDefault();
    await window.duoduo.data.saveRetention(retention);
    onMessage("数据保留规则已保存");
  }

  const summary = (item: SettingsSection) => {
    if (item === "appearance")
      return themes.find((candidate) => candidate.id === theme)?.name ?? "";
    if (item === "monitoring")
      return `每 ${monitoring.preparedCheckMinutes} 分钟`;
    if (item === "ai")
      return provider || llmConfig ? "已配置" : "未配置";
    if (item === "notifications")
      return notificationTimeout === null
        ? "不自动关闭"
        : `${notificationTimeout} 秒`;
    return `${retention.asrDays} 天`;
  };

  return (
    <main className="settings-center">
      <div className="heading settings-heading">
        <div>
          <h1>系统设置</h1>
          <p>集中管理应用行为、服务凭据和本地数据规则。</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-subnav" aria-label="设置分类">
          {(Object.keys(settingsSectionMeta) as SettingsSection[]).map((item) => (
            <button
              className={section === item ? "active" : ""}
              type="button"
              aria-current={section === item ? "page" : undefined}
              onClick={() => onSectionChange(item)}
              key={item}
            >
              <span className="settings-subnav-icon">{settingsSectionMeta[item].icon}</span>
              <span>
                <b>{settingsSectionMeta[item].label}</b>
                <small>{settingsSectionMeta[item].description}</small>
              </span>
              <em>{summary(item)}</em>
            </button>
          ))}
        </nav>
        <section className="settings-content" aria-label={settingsSectionMeta[section].label}>

          {section === "appearance" && (
            <section className="settings-panel">
              <SettingIntro
                title="界面主题"
                description="选择适合当前环境的界面风格，修改会立即应用并自动保存。"
                status="自动保存"
              />
              <div className="theme-options settings-theme-options" role="radiogroup" aria-label="界面主题">
                {themes.map((item) => (
                  <button
                    className={theme === item.id ? "selected" : ""}
                    type="button"
                    role="radio"
                    aria-checked={theme === item.id}
                    onClick={() => onThemeChange(item.id)}
                    key={item.id}
                  >
                    <span className="theme-swatch" aria-hidden="true">
                      {item.colors.map((color) => (
                        <i style={{ background: color }} key={color} />
                      ))}
                    </span>
                    <span>
                      <b>{item.name}</b>
                      <small>{item.description}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {section === "monitoring" && (
            <form className="settings-panel" onSubmit={saveMonitoring}>
              <SettingIntro
                title="状态更新频率"
                description="统一控制实时监看和未开播直播间的状态更新节奏。"
              />
              <div className="settings-fields">
                <SettingSelect label="直播状态更新速度" note="实时监看优先读取现有页面，不额外刷新抖音页面。">
                  <select
                    aria-label="直播状态更新速度"
                    value={monitoring.monitoredCheckSeconds}
                    onChange={(event) =>
                      onMonitoringChange({
                        ...monitoring,
                        monitoredCheckSeconds: Number(event.target.value) as MonitoringSettings["monitoredCheckSeconds"],
                      })
                    }
                  >
                    {[15, 30, 60, 120].map((seconds) => (
                      <option value={seconds} key={seconds}>约 {seconds} 秒内</option>
                    ))}
                  </select>
                </SettingSelect>
                <SettingSelect label="未监看直播间检查频率" note="所有直播间统一使用该频率，并按全局队列依次检查。">
                  <select
                    aria-label="未监看直播间检查频率"
                    value={monitoring.preparedCheckMinutes}
                    onChange={(event) =>
                      onMonitoringChange({
                        ...monitoring,
                        preparedCheckMinutes: Number(event.target.value) as MonitoringSettings["preparedCheckMinutes"],
                      })
                    }
                  >
                    {[1, 3, 5, 10, 15, 30].map((minutes) => (
                      <option value={minutes} key={minutes}>每 {minutes} 分钟</option>
                    ))}
                  </select>
                </SettingSelect>
              </div>
              <SettingsActions><button className="primary" type="submit">保存监看设置</button></SettingsActions>
            </form>
          )}

          {section === "ai" && (
            <form className="settings-stack" onSubmit={saveAi}>
              <section className="settings-panel">
                <SettingIntro
                  title="百炼服务"
                  description="当前版本仅依赖阿里云百炼，三类模型共用同一个 API Key。"
                  status={provider && llmConfig ? "已配置" : "未配置"}
                />
                <div className="settings-fields">
                  <SettingInput label="API Key" note={provider ? "已保存凭据；留空则继续使用。" : "凭据会通过系统安全存储加密保存。"}>
                    <input type="password" required={!provider} autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={provider ? "已配置，输入新值可替换" : "请输入百炼 API Key"} />
                  </SettingInput>
                </div>
              </section>

              <section className="settings-panel">
                <SettingIntro
                  title="ASR 提取模型"
                  description="实时把直播声音转换为带时间信息的文字。"
                />
                <ModelSelector scene="asr_extraction" value={asrModel} onChange={setAsrModel} />
              </section>

              <section className="settings-panel">
                <SettingIntro
                  title="内容分析模型"
                  description="把 ASR 文字按内容洞察规则转为有原文证据的结构化记录。"
                />
                <ModelSelector scene="asr_analysis" value={analysisModel} onChange={setAnalysisModel} />
              </section>

              <section className="settings-panel">
                <SettingIntro
                  title="分析器创建 Agent 模型"
                  description="通过对话理解用户需求、追问缺失信息并生成符合系统规范的分析器草稿。"
                />
                <ModelSelector scene="analyzer_agent" value={agentModel} onChange={setAgentModel} />
              </section>

              <section className="settings-panel settings-ai-actions">
                <SettingsActions><button type="button" onClick={() => void testAi()}>测试百炼连接</button><button className="primary" type="submit">保存 AI 设置</button></SettingsActions>
              </section>
            </form>
          )}

          {section === "notifications" && (
            <form className="settings-panel" onSubmit={saveNotifications}>
              <SettingIntro title="新观点提醒" description="控制观点提醒在界面中保留的时间。" />
              <div className="settings-fields">
                <SettingSelect label="自动关闭时间" note="选择永不自动关闭后，需要手动关闭每条提醒。">
                  <select aria-label="新观点提醒自动关闭" value={notificationTimeout ?? "never"} onChange={(event) => onNotificationTimeoutChange(event.target.value === "never" ? null : Number(event.target.value) as 10 | 30 | 60)}>
                    <option value="never">永不自动关闭</option><option value="10">10 秒</option><option value="30">30 秒</option><option value="60">60 秒</option>
                  </select>
                </SettingSelect>
              </div>
              <SettingsActions><button className="primary" type="submit">保存提醒设置</button></SettingsActions>
            </form>
          )}

          {section === "storage" && (
            <form className="settings-panel" onSubmit={saveRetention}>
              <SettingIntro title="自动保留" description="到期数据会按维护策略清理；手动清理、备份与恢复仍在数据管理中完成。" />
              <div className="retention-settings-grid">
                {([['observationDays', '分钟记录'], ['aggregateDays', '小时汇总'], ['asrDays', '直播文字记录'], ['logDays', '运行记录']] as const).map(([key, label]) => (
                  <label key={key}><span>{label}<small>保留天数</small></span><span><input type="number" min="1" required value={retention[key]} onChange={(event) => setRetention({ ...retention, [key]: Number(event.target.value) })} /> 天</span></label>
                ))}
              </div>
              <SettingsActions><button className="primary" type="submit">保存保留规则</button></SettingsActions>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}

function SettingIntro({ title, description, status }: { title: string; description: string; status?: string }) {
  return <div className="setting-intro"><div><h3>{title}</h3><p>{description}</p></div>{status && <span>{status}</span>}</div>;
}

function SettingSelect({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return <label className="setting-row"><span><b>{label}</b>{note && <small>{note}</small>}</span>{children}</label>;
}

function SettingInput({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return <label className="setting-row"><span><b>{label}</b>{note && <small>{note}</small>}</span>{children}</label>;
}

function SettingsActions({ children }: { children: ReactNode }) {
  return <footer className="settings-actions">{children}</footer>;
}
