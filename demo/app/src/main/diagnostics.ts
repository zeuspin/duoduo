import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

const secretKey = /secret|token|authorization|api[-_]?key|password/i;

function redact(value: unknown, key = ""): unknown {
  if (secretKey.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  return typeof value === "string" && value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
}

export function formatDiagnostic(event: string, details: Record<string, unknown> = {}, now = new Date()): string {
  return `${JSON.stringify({ at: now.toISOString(), event, ...redact(details) as Record<string, unknown> })}\n`;
}

export function decideRendererRecovery(previousCrashAt: number | undefined, now: number, cooldownMs: number): { action: "reload" | "show_error"; crashAt: number } {
  return { action: previousCrashAt === undefined || now - previousCrashAt >= cooldownMs ? "reload" : "show_error", crashAt: now };
}

export function monitoringFingerprint(rooms: Array<{ roomId: string; state: unknown; liveStatus: unknown; error?: unknown; [key: string]: unknown }>): string {
  return JSON.stringify([...rooms].sort((a, b) => a.roomId.localeCompare(b.roomId)).map(({ roomId, state, liveStatus, error }) => ({ roomId, state, liveStatus, error })));
}

export interface NetworkErrorEvent { url: string; error: string; resourceType: string }

export function createNetworkErrorSampler(intervalMs: number): { shouldLog(event: NetworkErrorEvent, now?: number): boolean } {
  const lastLogged = new Map<string, number>();
  return {
    shouldLog(event, now = Date.now()) {
      let host: string;
      try { host = new URL(event.url).host; }
      catch { host = "invalid-url"; }
      const key = `${host}\n${event.error}\n${event.resourceType}`;
      const previous = lastLogged.get(key);
      if (previous !== undefined && now - previous < intervalMs) return false;
      lastLogged.set(key, now);
      return true;
    },
  };
}

export function createDiagnosticLog(path: string, maxBytes = 2 * 1024 * 1024): (event: string, details?: Record<string, unknown>) => Promise<void> {
  let write = Promise.resolve();
  return (event, details = {}) => {
    write = write.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      const size = await stat(path).then((value) => value.size).catch(() => 0);
      if (size >= maxBytes) await rename(path, `${path}.1`).catch(() => undefined);
      await appendFile(path, formatDiagnostic(event, details));
    }).catch(() => undefined);
    return write;
  };
}
