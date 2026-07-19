import { useEffect, useRef, useState } from "react";
import type { AsrEvent } from "../../shared/contracts";

interface HistoryEvent extends AsrEvent {
  id?: number;
  occurredAt: string;
}

interface HistoryPage {
  items: HistoryEvent[];
  nextCursor?: number;
}

interface AsrFeedProps {
  roomId: string;
  liveEvents: AsrEvent[];
  listBefore: (roomId: string, options: { limit: number; beforeId?: number }) => Promise<unknown>;
}

const MAX_RENDERED_ITEMS = 200;

export function AsrFeed({ roomId, liveEvents, listBefore }: AsrFeedProps) {
  const [items, setItems] = useState<HistoryEvent[]>([]);
  const [cursor, setCursor] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);

  useEffect(() => {
    setItems([]);
    setCursor(undefined);
    setHistoryVisible(false);
    followingRef.current = true;
  }, [roomId]);

  useEffect(() => {
    setItems((current) => mergeEvents(current, liveEvents.map((event) => ({ ...event, occurredAt: event.occurredAt ?? new Date().toISOString() }))));
  }, [liveEvents]);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed && followingRef.current) feed.scrollTop = feed.scrollHeight;
  }, [items]);

  async function loadOlder() {
    if (loading || (historyVisible && !cursor)) return;
    const feed = feedRef.current;
    const previousHeight = feed?.scrollHeight ?? 0;
    setLoading(true);
    try {
      const page = await listBefore(roomId, historyVisible ? { limit: 100, beforeId: cursor } : { limit: 50 }) as HistoryPage;
      setItems((current) => mergeEvents(page.items ?? [], current));
      setCursor(page.nextCursor);
      setHistoryVisible(true);
      requestAnimationFrame(() => { if (feed) feed.scrollTop = feed.scrollHeight - previousHeight; });
    } finally { setLoading(false); }
  }

  function handleScroll() {
    const feed = feedRef.current;
    if (!feed) return;
    followingRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 32;
    if (feed.scrollTop <= 8) void loadOlder();
  }

  return <div className="asr-feed" ref={feedRef} onScroll={handleScroll} data-testid="asr-feed">
    {!historyVisible && <button className="asr-history-button" type="button" onClick={() => void loadOlder()}>查看历史记录</button>}
    {historyVisible && <div className="asr-history-label">已加载历史记录</div>}
    {loading && items.length > 0 && <div className="history-loading">正在加载更早记录...</div>}
    {items.length === 0 && !loading && <div className="asr-empty">正在等待主播说话…</div>}
    {items.map((item) => <div className={`asr-row ${item.isFinal ? "final" : "partial"}`} key={`${item.sessionId}:${item.segmentId}`} data-segment={item.segmentId}>
      <time dateTime={item.occurredAt}>{formatNaturalTime(item.occurredAt)}</time>
      <span>{item.text}</span>
      <small>{item.isFinal ? "已记录" : "记录中"}</small>
    </div>)}
  </div>;
}

function mergeEvents(...groups: HistoryEvent[][]): HistoryEvent[] {
  const merged = new Map<string, HistoryEvent>();
  for (const item of groups.flat()) {
    const key = `${item.sessionId}:${item.segmentId}`;
    const existing = merged.get(key);
    if (!existing?.isFinal) merged.set(key, item);
  }
  return [...merged.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).slice(-MAX_RENDERED_ITEMS);
}

function formatNaturalTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}
