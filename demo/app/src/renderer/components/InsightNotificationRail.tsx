import { X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
export interface InsightNotificationItem {
  key: string;
  kind: "market" | "content";
  id: number;
  roomId: string;
  startedAt: string;
  summary: string;
  alertLevel: "none" | "normal" | "important";
}

export function InsightNotificationRail({ items, timeoutSeconds, roomName, roomAvatar, onOpen, onDismiss }: { items: InsightNotificationItem[]; timeoutSeconds: 10 | 30 | 60 | null; roomName(roomId: string): string; roomAvatar?(roomId: string): string | undefined; onOpen(item: InsightNotificationItem): void; onDismiss(key: string): void }) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const keys = new Set(items.map((item) => item.key));
    for (const [key, timer] of timers.current) if (!keys.has(key) || timeoutSeconds === null) { clearTimeout(timer); timers.current.delete(key); }
    if (timeoutSeconds !== null) for (const item of items) if (!timers.current.has(item.key)) timers.current.set(item.key, setTimeout(() => { timers.current.delete(item.key); onDismiss(item.key); }, timeoutSeconds * 1_000));
  }, [items, timeoutSeconds, onDismiss]);
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); }, []);
  if (!items.length) return null;
  return <div className="insight-notification-rail" aria-label="新观点提醒"><div className="insight-notification-track">{items.slice(0, 20).map((item) => {
    const name = roomName(item.roomId);
    const avatar = roomAvatar?.(item.roomId);
    return <article className={item.alertLevel === "important" ? "important" : ""} key={item.key}><button className="insight-notification-open" onClick={() => onOpen(item)}>{avatar ? <img className="insight-notification-avatar" src={avatar} alt="" /> : <span className="insight-notification-avatar fallback" aria-hidden="true">{name.slice(0, 1)}</span>}<span className="insight-notification-content"><span className="insight-notification-identity"><strong>{name}</strong><time>{formatTime(item.startedAt)}</time></span><b>{item.summary}</b><small>{item.kind === "content" ? "内容洞察提醒" : "观点提醒"}</small></span></button><button className="insight-notification-close" aria-label={`关闭${item.summary}`} onClick={() => onDismiss(item.key)}><X /></button></article>;
  })}</div></div>;
}

function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value)); }
