import { useEffect, useMemo, useState } from "react";
import type { MarketInsight, Room } from "../../shared/contracts";

const natureLabels: Record<MarketInsight["nature"], string> = { explicit: "明确观点", conditional: "条件观点", quote: "转述", inference: "系统推断", fact: "事实描述" };

export function InsightCenter({ rooms }: { rooms: Room[] }) {
  const [items, setItems] = useState<MarketInsight[]>([]); const [roomId, setRoomId] = useState("");
  const load = async () => { const page = await window.duoduo.insights.list({ ...(roomId ? { roomId } : {}), limit: 50 }) as { items: MarketInsight[] }; setItems(page.items); };
  useEffect(() => { void load(); return window.duoduo.insights.subscribe(() => void load()); }, [roomId]);
  const important = items.filter((item) => item.alertLevel === "important").length;
  const sentiment = useMemo(() => items.find((item) => item.subjectKind === "sentiment")?.direction ?? items[0]?.direction, [items]);
  return <div className="insight-page"><div className="heading"><div><h1>观点中心</h1><p>优先阅读有效观点，并随时核验主播原话。内容来自主播观点，不构成投资建议。</p></div><select aria-label="筛选直播间" value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="">全部直播间观点</option>{rooms.map((room) => <option value={room.roomId} key={room.roomId}>直播间 {room.roomId}</option>)}</select></div><div className="insight-summary"><div><b>{items.length}</b><span>有效观点</span></div><div><b>{important}</b><span>重点关注</span></div><div><b>{sentiment ? directionLabel(sentiment) : "暂无"}</b><span>当前判断</span></div></div><section className="insight-stream">{items.length === 0 ? <div className="insight-empty">尚未产生有效观点，直播文字仍会正常保存。</div> : items.map((item) => <article className={`insight-row ${item.nature === "inference" ? "low-confidence" : ""}`} key={item.id}><time>{formatNaturalTime(item.startedAt)}</time><div><h2>{item.summary}</h2><p>{item.rationale}</p>{item.conditions.length > 0 && <p className="conditions">成立条件：{item.conditions.join("；")}</p>}<blockquote>主播原话：“{item.evidence.join("；")}”</blockquote><small>直播间 {item.roomId} · 分析规则版本 #{item.parserVersionId} · 可信程度 {Math.round(item.confidence * 100)}%</small></div><span className={`insight-level ${item.alertLevel}`}>{item.alertLevel === "important" ? "重点关注" : "普通关注"}<br />{natureLabels[item.nature]}</span></article>)}</section></div>;
}

function formatNaturalTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value)); }
function directionLabel(value: MarketInsight["direction"]) { return ({ positive: "偏强", neutral: "中性", cautious: "谨慎", risk: "风险" } as const)[value]; }
