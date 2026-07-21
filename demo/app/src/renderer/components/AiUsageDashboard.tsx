import { useEffect, useState } from "react";
import type { AiUsageQuery } from "../../shared/contracts";

type Group = { key: string; calls: number; totalTokens: number; asrDurationSeconds: number; estimatedCostMicros: number };
type Dashboard = {
  summary: { calls: number; runs: number; promptTokens: number; completionTokens: number; totalTokens: number; asrDurationSeconds: number; estimatedCostMicros: number; usageMissingCalls: number; priceMissingCalls: number };
  byFeature: Group[]; byRoom: Group[]; byModel: Group[];
  calls: Array<{ id: string; startedAt: string; featureKey: string; usageKind: "production" | "test"; apiKind: string; model: string; status: string; totalTokens: number; asrDurationSeconds: number; estimatedCostMicros: number | null; costStatus: string }>;
};
type UsageRoom = { roomId: string; name: string; avatarVersion?: string };

const featureLabels: Record<string, string> = { live_asr: "直播语音转文字", live_insight: "直播观点提炼", parser_test: "分析规则测试", connection_test: "连接测试" };
const money = (micros: number) => `¥${(micros / 1_000_000).toFixed(4)}`;
const count = (value: number) => new Intl.NumberFormat("zh-CN").format(value);
const dateInput = (date: Date) => date.toISOString().slice(0, 10);

export function AiUsageDashboard({ rooms = [] }: { rooms?: UsageRoom[] }) {
  const [from, setFrom] = useState(() => { const date = new Date(); date.setDate(date.getDate() - 29); return dateInput(date); });
  const [to, setTo] = useState(() => dateInput(new Date()));
  const [kind, setKind] = useState<"all" | "production" | "test">("all");
  const [data, setData] = useState<Dashboard>();
  const [error, setError] = useState("");
  useEffect(() => {
    const query: AiUsageQuery = { from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T00:00:00`).getTime() === new Date(from).getTime() ? new Date(`${to}T23:59:59.999`).toISOString() : new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000).toISOString(), ...(kind === "all" ? {} : { usageKind: kind }) };
    void window.duoduo.aiUsage.getDashboard(query).then((value) => { setData(value as Dashboard); setError(""); }).catch((reason) => setError(String(reason)));
  }, [from, to, kind]);
  const summary = data?.summary;
  const roomsById = new Map(rooms.map((room) => [room.roomId, room]));
  return <main className="ai-usage-dashboard">
    <div className="heading"><div><h1>AI 用量</h1><p>统计经百炼统一调用层确认返回的 Token、语音计费时长与目录价估算。</p></div><div className="usage-filters"><input aria-label="开始日期" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /><span>至</span><input aria-label="结束日期" type="date" value={to} onChange={(event) => setTo(event.target.value)} /><select aria-label="调用类型" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="all">全部调用</option><option value="production">正式调用</option><option value="test">测试调用</option></select></div></div>
    {error && <div className="usage-warning">读取失败：{error}</div>}
    <section className="usage-summary">
      <Metric label="估算费用" value={money(summary?.estimatedCostMicros ?? 0)} note="按百炼公开目录价估算" />
      <Metric label="Token 总计" value={count(summary?.totalTokens ?? 0)} note={`输入 ${count(summary?.promptTokens ?? 0)} · 输出 ${count(summary?.completionTokens ?? 0)}`} />
      <Metric label="语音计费时长" value={`${count(summary?.asrDurationSeconds ?? 0)} 秒`} note="以服务端返回 duration 为准" />
      <Metric label="调用次数" value={count(summary?.calls ?? 0)} note={`${summary?.runs ?? 0} 个关联任务`} />
    </section>
    {!!((summary?.usageMissingCalls ?? 0) + (summary?.priceMissingCalls ?? 0)) && <div className="usage-warning">有 {summary?.usageMissingCalls ?? 0} 次调用缺少服务端用量，{summary?.priceMissingCalls ?? 0} 次调用缺少已确认价格；这些费用未计入估算。</div>}
    <div className="usage-breakdowns"><Breakdown title="按当前功能" items={data?.byFeature ?? []} label={(key) => featureLabels[key] ?? key} /><Breakdown title="按模型" items={data?.byModel ?? []} /><RoomBreakdown items={data?.byRoom ?? []} roomsById={roomsById} /></div>
    <section className="usage-table"><h2>调用明细</h2><div className="usage-table-row usage-table-head"><span>时间 / 功能</span><span>模型</span><span>用量</span><span>估算费用</span><span>状态</span></div>{data?.calls.map((call) => <div className="usage-table-row" key={call.id}><span><b>{new Date(call.startedAt).toLocaleString("zh-CN")}</b><small>{featureLabels[call.featureKey] ?? call.featureKey} · {call.usageKind === "test" ? "测试" : "正式"}</small></span><span>{call.model}</span><span>{call.apiKind === "chat_completions" ? `${count(call.totalTokens)} Token` : `${count(call.asrDurationSeconds)} 秒`}</span><span>{call.estimatedCostMicros === null ? "未估算" : money(call.estimatedCostMicros)}</span><span>{call.status}</span></div>)}{!data?.calls.length && <div className="usage-empty">所选时间范围暂无调用记录</div>}</section>
  </main>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <article><small>{label}</small><strong>{value}</strong><p>{note}</p></article>; }
function Breakdown({ title, items, label = (key) => key }: { title: string; items: Group[]; label?: (key: string) => string }) { return <section><h2>{title}</h2>{items.slice(0, 8).map((item) => <div key={item.key}><span><b>{label(item.key)}</b><small>{item.calls} 次 · {item.totalTokens ? `${count(item.totalTokens)} Token` : `${count(item.asrDurationSeconds)} 秒`}</small></span><strong>{money(item.estimatedCostMicros)}</strong></div>)}{!items.length && <p>暂无数据</p>}</section>; }
function RoomBreakdown({ items, roomsById }: { items: Group[]; roomsById: Map<string, UsageRoom> }) {
  return <section className="usage-room-breakdown"><h2>按直播间</h2>{items.slice(0, 8).map((item) => {
    const room = roomsById.get(item.key);
    const name = item.key === "未关联" ? "未关联直播间" : room?.name ?? `直播间 ${item.key}`;
    return <div key={item.key}>
      <div className="usage-room-identity">
        {room?.avatarVersion ? <img src={`duoduo-avatar://${room.roomId}?v=${encodeURIComponent(room.avatarVersion)}`} alt={`${name}头像`} /> : <span className="usage-room-avatar" aria-hidden="true">{name.slice(0, 1)}</span>}
        <span><b title={name}>{name}</b><small>{item.calls} 次 · {item.totalTokens ? `${count(item.totalTokens)} Token` : `${count(item.asrDurationSeconds)} 秒`}</small></span>
      </div>
      <strong>{money(item.estimatedCostMicros)}</strong>
    </div>;
  })}{!items.length && <p>暂无数据</p>}</section>;
}
