import { useEffect, useState } from "react";
import type { CleanupPreview, CleanupRequest, DataRetentionSettings, StorageUsage } from "../../shared/contracts";

const labels = { observations: "分钟快照", aggregates: "小时聚合", asr: "ASR 文本", insights: "业务观点", sessions: "直播场次" } as const;
const defaults: DataRetentionSettings = { observationDays: 30, aggregateDays: 365, asrDays: 90, logDays: 30 };

export function DataManagement() {
  const [usage, setUsage] = useState<StorageUsage>();
  const [retention, setRetention] = useState(defaults);
  const [category, setCategory] = useState<CleanupRequest["category"]>("observations");
  const [before, setBefore] = useState(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [preview, setPreview] = useState<CleanupPreview>();
  const [message, setMessage] = useState("");
  const refresh = async () => setUsage(await window.duoduo.data.getUsage() as StorageUsage);
  useEffect(() => { void refresh(); void window.duoduo.data.getRetention().then((value) => setRetention(value as DataRetentionSettings)); }, []);
  const request = (): CleanupRequest => ({ category, before: new Date(`${before}T00:00:00.000Z`).toISOString() });
  async function previewCleanup() { setPreview(await window.duoduo.data.previewCleanup(request()) as CleanupPreview); }
  async function executeCleanup() { if (!preview) return; const count = await window.duoduo.data.executeCleanup(request(), preview.token); setPreview(undefined); setMessage(`已清理 ${count} 条数据`); await refresh(); }
  async function saveRetention() { await window.duoduo.data.saveRetention(retention); setMessage("自动保留规则已保存"); }
  async function action(work: () => Promise<unknown>, success: string) { try { await work(); setMessage(success); await refresh(); } catch (error) { setMessage(`操作失败：${String(error)}`); } }
  return <main className="data-management"><div className="heading"><div><h1>数据管理</h1><p>查看占用、控制保留周期，并备份或恢复本地数据。</p></div></div>
    <section className="usage-grid"><Usage title="数据库" bytes={(usage?.databaseBytes ?? 0) + (usage?.walBytes ?? 0)} /><Usage title="主播头像" bytes={usage?.avatarBytes ?? 0} /><Usage title="直播画面" bytes={usage?.coverBytes ?? 0} /></section>
    <section className="data-panel"><h2>数据明细</h2>{usage?.categories.map((item) => <div className="data-row" key={item.category}><b>{labels[item.category]}</b><span>{item.count} 条</span><small>{item.oldestAt ? `${item.oldestAt.slice(0, 10)} 至 ${item.newestAt?.slice(0, 10)}` : "暂无数据"}</small></div>)}</section>
    <section className="data-panel"><h2>自动保留</h2><div className="retention-grid">{([['observationDays','分钟快照'],['aggregateDays','小时聚合'],['asrDays','ASR 文本'],['logDays','日志']] as const).map(([key,label]) => <label key={key}>{label}<input type="number" min="1" value={retention[key]} onChange={(event) => setRetention({ ...retention, [key]: Number(event.target.value) })} />天</label>)}</div><button onClick={() => void saveRetention()}>保存保留规则</button></section>
    <section className="data-panel"><h2>手动清理</h2><div className="cleanup-controls"><select aria-label="清理数据类型" value={category} onChange={(event) => { setCategory(event.target.value as typeof category); setPreview(undefined); }}>{Object.entries(labels).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select><input aria-label="清理截止日期" type="date" value={before} onChange={(event) => { setBefore(event.target.value); setPreview(undefined); }} /><button onClick={() => void previewCleanup()}>预览清理</button></div>{preview && <div className="cleanup-preview"><span>将清理 {preview.count} 条数据</span><button className="danger" onClick={() => void executeCleanup()}>确认清理</button></div>}</section>
    <section className="data-panel"><h2>备份与维护</h2><div className="backup-actions"><button onClick={() => void action(() => window.duoduo.data.exportBackup(), "备份已导出")}>导出完整备份</button><button onClick={() => void action(() => window.duoduo.data.importBackup("merge"), "备份已合并")}>合并导入</button><button onClick={() => void action(() => window.duoduo.data.importBackup("replace"), "备份已恢复，应用将重新启动")}>覆盖恢复</button><button onClick={() => void action(() => window.duoduo.data.compact(), "数据库已压缩")}>压缩数据库</button></div></section>
    {message && <p className="data-message">{message}</p>}
  </main>;
}

function Usage({ title, bytes }: { title: string; bytes: number }) { return <article><span>{title}</span><b>{formatBytes(bytes)}</b></article>; }
function formatBytes(bytes: number): string { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
