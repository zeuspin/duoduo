import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import type { RoomIntelligence, RoomIntelligenceSummary, RoomPeriodSummary, RoomSessionSummary, TransparentLabel } from "../../shared/contracts";

function count(value: number | undefined): string {
  return value === undefined ? "—" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function labelTitle(label: TransparentLabel): string {
  const comparison = label.comparisonCount === undefined ? "" : `；对比 ${label.comparisonCount} 个主播`;
  return `${label.explanation}（依据 ${label.sampleCount} 条记录${comparison}）`;
}

const qualityText = { complete: "数据完整", partial: "部分数据", missing: "暂无数据" } as const;

export function RoomIntelligenceBadges({ summary, status, showCurrentMetric = true, onOpen }: { summary?: RoomIntelligenceSummary; status?: string; loading?: boolean; showCurrentMetric?: boolean; onOpen(): void }) {
  if (!summary) return null;
  const { currentMetrics } = summary;
  const labels = summary.labels.filter((label) => label.kind !== "insufficient_data");
  if ((!showCurrentMetric || currentMetrics.viewerCount === undefined) && labels.length === 0) return null;
  return <div className="room-intelligence-compact">
    {showCurrentMetric && currentMetrics.viewerCount !== undefined && <div className="room-current-metrics">
      {currentMetrics.viewerCount !== undefined && <span>{status === "live" ? "当前在线" : "上次在线"} {count(currentMetrics.viewerCount)}</span>}
    </div>}
    <div className="room-labels">
      {labels.map((label) => <button className={`room-label room-label-${label.kind}`} key={`${label.kind}-${label.text}`} type="button" title={labelTitle(label)} aria-label={`${label.text}，查看标签说明`} onClick={onOpen}>{label.text}</button>)}
    </div>
  </div>;
}

function PeriodCard({ period }: { period: RoomPeriodSummary }) {
  return <article className="intelligence-period">
    <h3>近 {period.days} 天</h3>
    <dl>
      <div><dt>数据记录</dt><dd>{period.sampleCount}</dd></div>
      <div><dt>已观测场次</dt><dd>{period.sessionCount}</dd></div>
      <div><dt>平均在线</dt><dd>{count(period.averageViewerCount)}</dd></div>
      <div><dt>峰值在线</dt><dd>{count(period.peakViewerCount)}</dd></div>
    </dl>
  </article>;
}

function durationText(minutes: number | undefined): string {
  if (minutes === undefined) return "观测中";
  if (minutes < 60) return `${Math.round(minutes)}分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest ? `${hours}小时${rest}分钟` : `${hours}小时`;
}

function SessionRow({ session }: { session: RoomSessionSummary }) {
  const formatEvidenceTime = (value: string) => new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
  const started = formatEvidenceTime(session.firstLiveAt);
  return <li><div><b>{started}</b><span>{session.status === "ended" ? "已结束" : "持续观测"}</span></div><p>观测时长 {durationText(session.observedDurationMinutes)} · 平均在线 {count(session.averageViewerCount)} · 峰值 {count(session.peakViewerCount)}</p><p className="session-evidence">开播证据：{session.previousOfflineAt ? `${formatEvidenceTime(session.previousOfflineAt)} 离线 → ` : "此前离线时间未知 → "}{formatEvidenceTime(session.firstLiveAt)} 直播</p><p className="session-evidence">停播证据：{formatEvidenceTime(session.lastLiveAt)} 直播 → {session.firstOfflineAt ? `${formatEvidenceTime(session.firstOfflineAt)} 离线` : "尚未观测到离线"}</p></li>;
}

function ViewerTrend({ period }: { period: RoomPeriodSummary }) {
  const points = period.points.map((point) => ({ at: Date.parse(point.at), viewerCount: point.viewerCount }));
  if (!points.some((point) => point.viewerCount !== undefined)) return <div className="intelligence-empty">近 {period.days} 天尚无在线人数记录</div>;
  return <div className="intelligence-chart" aria-label={`近 ${period.days} 天在线人数趋势`}>
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="#e9edf2" strokeDasharray="3 3" />
        <XAxis dataKey="at" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(value) => new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value))} tick={{ fontSize: 9 }} />
        <YAxis width={48} tickFormatter={(value) => count(Number(value))} tick={{ fontSize: 9 }} />
        <ChartTooltip labelFormatter={(value) => new Date(Number(value)).toLocaleString("zh-CN", { hour12: false })} formatter={(value) => [count(Number(value)), "在线人数"]} />
        <Line type="monotone" dataKey="viewerCount" connectNulls={false} stroke="#4f7df3" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  </div>;
}

export function RoomIntelligenceDrawer({ roomName, details, onClose }: { roomName: string; details: RoomIntelligence; onClose(): void }) {
  const [trendDays, setTrendDays] = useState<7 | 30>(7);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => { window.removeEventListener("keydown", closeOnEscape); returnFocusTo?.focus(); };
  }, []);
  return <aside className="intelligence-drawer" role="dialog" aria-label={`${roomName}数据详情`}>
    <div className="intelligence-head"><div><b>{roomName}</b><span>本地数据详情 · 生成于 {new Date(details.generatedAt).toLocaleString("zh-CN", { hour12: false })}</span></div><button type="button" title="关闭数据详情" onClick={onClose}><X /></button></div>
    <div className="intelligence-content">
      <section><h2>最近一次记录</h2><div className="intelligence-current"><span>在线人数<b>{count(details.currentMetrics.viewerCount)}</b></span><span>关注数量<b>{count(details.currentMetrics.followerCount)}</b></span><span>累计观看<b>{count(details.currentMetrics.totalViewerCount)}</b></span><span>点赞数量<b>{count(details.currentMetrics.likeCount)}</b></span></div>{details.currentMetrics.observedAt && <small>记录时间：{new Date(details.currentMetrics.observedAt).toLocaleString("zh-CN", { hour12: false })}{details.currentMetrics.quality ? ` · 数据完整度：${qualityText[details.currentMetrics.quality]}` : ""}</small>}</section>
      <section><h2>标签说明</h2><div className="intelligence-evidence">{details.allLabels.map((label) => <article key={`${label.kind}-${label.text}`}><b>{label.text}</b><p>{label.explanation}</p><small>{label.sampleCount} 条记录{label.comparisonCount === undefined ? "" : ` · 本地对比 ${label.comparisonCount} 个主播`}</small></article>)}</div></section>
      <section><h2>阶段统计</h2><div className="intelligence-periods"><PeriodCard period={details.sevenDay} /><PeriodCard period={details.thirtyDay} /></div><div className="intelligence-trend-head"><b>在线人数趋势</b><div><button className={trendDays === 7 ? "active" : ""} type="button" onClick={() => setTrendDays(7)}>7 天</button><button className={trendDays === 30 ? "active" : ""} type="button" onClick={() => setTrendDays(30)}>30 天</button></div></div><ViewerTrend period={trendDays === 7 ? details.sevenDay : details.thirtyDay} /></section>
      <section><h2>开播记录</h2><p className="intelligence-disclaimer">以下是软件实际记录到的时间，不等同于平台完整直播时长；未开播或验证暂停期间不会推算缺失数据。</p>{details.sessions.length ? <ul className="intelligence-sessions">{details.sessions.slice(-20).reverse().map((session) => <SessionRow session={session} key={session.id} />)}</ul> : <div className="intelligence-empty">尚未形成完整开播记录</div>}</section>
    </div>
  </aside>;
}
