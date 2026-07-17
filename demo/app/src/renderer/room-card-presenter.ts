import type { RoomSnapshot } from "../shared/contracts";

const invalidRememberedName = /验证码|安全验证|中间页|扫码登录/;

export function roomDisplayName(snapshot: RoomSnapshot | undefined, roomId: string): string {
  return [snapshot?.anchorName, snapshot?.title].find((value) => value && !invalidRememberedName.test(value)) ?? `直播间 ${roomId}`;
}

export function probeDetail(snapshot: RoomSnapshot | undefined): string | undefined {
  if (!snapshot) return "等待首次检测";
  if (snapshot.status === "verification_required") return "安全验证已暂停更新";
  if (snapshot.status === "login_required") return "需要登录抖音";
  if (snapshot.status === "timeout") return "页面响应超时";
  if (snapshot.status === "page_error") return "页面解析失败";
  return undefined;
}

export function probeFreshness(checkedAt: string, targetMinutes: number, now = Date.now()): { label: string; stale: boolean } {
  const minutes = Math.max(0, Math.floor((now - Date.parse(checkedAt)) / 60_000));
  const age = minutes < 1 ? "刚刚" : `${minutes} 分钟前`;
  const stale = minutes > targetMinutes * 2;
  return { label: stale ? `已过期 · ${age}` : age, stale };
}

export function compactCount(value: number | undefined): string {
  if (value === undefined) return "待获取";
  if (value >= 100_000_000) return `${Number((value / 100_000_000).toFixed(1))} 亿`;
  if (value >= 10_000) return `${Number((value / 10_000).toFixed(1))} 万`;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

export function compactCheckedAt(checkedAt: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(checkedAt)) / 60_000));
  if (minutes < 1) return "刚刚检测";
  if (minutes < 120) return `${minutes} 分钟前检测`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} 小时前检测`;
  return `${Math.floor(hours / 24)} 天前检测`;
}
