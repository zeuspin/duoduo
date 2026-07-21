import { X } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import type { MarketInsight } from "../../shared/contracts";

export function InsightNotificationRail({ items, timeoutSeconds, roomName, roomAvatar, onOpen, onDismiss }: { items: MarketInsight[]; timeoutSeconds: 10 | 30 | 60 | null; roomName(roomId: string): string; roomAvatar?(roomId: string): string | undefined; onOpen(item: MarketInsight): void; onDismiss(id: number): void }) {
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const ids = new Set(items.map((item) => item.id));
    for (const [id, timer] of timers.current) if (!ids.has(id) || timeoutSeconds === null) { clearTimeout(timer); timers.current.delete(id); }
    if (timeoutSeconds !== null) for (const item of items) if (!timers.current.has(item.id)) timers.current.set(item.id, setTimeout(() => { timers.current.delete(item.id); onDismiss(item.id); }, timeoutSeconds * 1_000));
  }, [items, timeoutSeconds, onDismiss]);
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); }, []);
  if (!items.length) return null;
  return <div className="insight-notification-rail" aria-label="新观点提醒"><div className="insight-notification-track">{items.slice(0, 20).map((item) => {
    const name = roomName(item.roomId);
    const avatar = roomAvatar?.(item.roomId);
    return <article className={item.alertLevel === "important" ? "important" : ""} key={item.id}><button className="insight-notification-open" onClick={() => onOpen(item)}>{avatar ? <img className="insight-notification-avatar" src={avatar} alt="" /> : <span className="insight-notification-avatar fallback" aria-hidden="true">{name.slice(0, 1)}</span>}<span className="insight-notification-content"><span className="insight-notification-identity"><strong>{name}</strong><time>{formatTime(item.startedAt)}</time></span><b>{item.summary}</b></span></button><button className="insight-notification-close" aria-label={`关闭${item.summary}`} onClick={() => onDismiss(item.id)}><X /></button></article>;
  })}</div></div>;
}

function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value)); }
