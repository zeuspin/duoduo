import { useEffect, useRef, useState } from "react";
import type { MarketInsight } from "../../shared/contracts";

const natureLabels: Record<MarketInsight["nature"], string> = { explicit: "明确观点", conditional: "条件观点", quote: "转述", inference: "系统推断", fact: "事实描述" };

export function LiveInsightPanel({ roomId, enabled, llmConfigured, focusInsightId }: { roomId: string; enabled: boolean; llmConfigured: boolean; focusInsightId?: number }) {
  const [items, setItems] = useState<MarketInsight[]>([]);
  const [cursor, setCursor] = useState<number>();
  const [loading, setLoading] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);

  const refresh = async () => {
    const page = await window.duoduo.insights.list({ roomId, limit: 20 }) as { items: MarketInsight[]; nextCursor?: number };
    setItems([...page.items].reverse()); setCursor(page.nextCursor);
  };
  useEffect(() => { void refresh(); return window.duoduo.insights.subscribe(() => void refresh()); }, [roomId]);
  useEffect(() => {
    if (!focusInsightId) return;
    requestAnimationFrame(() => { const target = document.getElementById(`room-insight-${focusInsightId}`); if (typeof target?.scrollIntoView === "function") target.scrollIntoView({ block: "center", behavior: "smooth" }); });
  }, [focusInsightId, items]);
  useEffect(() => { const feed = feedRef.current; if (feed && followingRef.current) feed.scrollTop = feed.scrollHeight; }, [items]);

  async function loadOlder() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await window.duoduo.insights.list({ roomId, limit: 20, beforeId: cursor }) as { items: MarketInsight[]; nextCursor?: number };
      setItems((current) => [[...page.items].reverse(), current].flat().filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index));
      setCursor(page.nextCursor);
    } finally { setLoading(false); }
  }

  return <div className="live-insight-feed" ref={feedRef} onScroll={(event) => { const feed = event.currentTarget; followingRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 32; if (feed.scrollTop <= 8) void loadOlder(); }}>
    <div className={`live-parser-state ${enabled && llmConfigured ? "enabled" : "disabled"}`}>{!enabled ? "未启用解析器，ASR 仍正常运行；已有观点继续保留" : !llmConfigured ? "模型服务未配置，ASR 正常运行但暂不产生观点" : "正在提炼后续 ASR：静默 8 秒或最长等待 60 秒"}</div>
    {loading && <div className="live-insight-loading">正在加载更早观点...</div>}
    {items.length === 0 ? <div className="live-insight-empty">尚未产生观点</div> : items.map((item) => <article id={`room-insight-${item.id}`} className={`live-insight-item ${focusInsightId === item.id ? "focused" : ""}`} key={item.id}>
      <div className="live-insight-meta"><time>{formatTime(item.startedAt)}</time><span className={item.alertLevel}>{item.alertLevel === "important" ? "重点关注" : "普通关注"} · {natureLabels[item.nature]}</span></div>
      <h3>{item.summary}</h3>
      {item.conditions.length > 0 && <p className="live-insight-conditions">成立条件：{item.conditions.join("；")}</p>}
      <blockquote>证据：“{item.evidence.join("；")}”</blockquote>
      <small>置信度 {Math.round(item.confidence * 100)}% · 解析器版本记录 #{item.parserVersionId}</small>
    </article>)}
  </div>;
}

function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value)); }
