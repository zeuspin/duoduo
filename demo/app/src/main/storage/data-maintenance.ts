import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CleanupRequestSchema, type CleanupPreview, type CleanupRequest, type DataRetentionSettings } from "../../shared/contracts";

export interface HourlyAggregate { roomId: string; hourStartedAt: string; sampleCount: number; minViewerCount?: number; maxViewerCount?: number; averageViewerCount?: number }
export interface CategoryUsage { category: "observations" | "aggregates" | "asr" | "insights" | "sessions"; count: number; oldestAt?: string; newestAt?: string }

const categoryTables = {
  observations: [["room_observations", "checked_at"]],
  aggregates: [["room_hourly_aggregates", "hour_started_at"]],
  asr: [["asr_segments", "occurred_at"]],
  insights: [["market_insights", "created_at"], ["content_records", "created_at"]],
  sessions: [["live_sessions", "first_live_at"]],
} as const;

export class DataMaintenance {
  private readonly previews = new Map<string, string>();
  constructor(private readonly database: DatabaseSync) {}

  previewCleanup(input: CleanupRequest): CleanupPreview {
    const request = CleanupRequestSchema.parse(input);
    const params = request.roomId ? [request.before, request.roomId] : [request.before];
    const count = categoryTables[request.category].reduce((sum, [table, time]) => {
      const where = `${time}<?${request.roomId ? " AND room_id=?" : ""}`;
      const row = this.database.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${where}`).get(...params) as Record<string, unknown>;
      return sum + Number(row.count);
    }, 0);
    const preview = { token: randomUUID(), ...request, count };
    this.previews.set(preview.token, JSON.stringify(request));
    return preview;
  }

  executeCleanup(input: CleanupRequest, token: string): number {
    const request = CleanupRequestSchema.parse(input);
    if (this.previews.get(token) !== JSON.stringify(request)) throw new Error("CLEANUP_PREVIEW_MISMATCH");
    this.previews.delete(token);
    const params = request.roomId ? [request.before, request.roomId] : [request.before];
    this.database.exec("BEGIN IMMEDIATE");
    try {
      let removed = 0;
      for (const [table, time] of categoryTables[request.category]) {
        const where = `${time}<?${request.roomId ? " AND room_id=?" : ""}`;
        if (request.category === "observations") this.aggregateObservations(where, params);
        removed += Number(this.database.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...params).changes);
      }
      this.database.exec("COMMIT");
      return removed;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  listAggregates(roomId: string): HourlyAggregate[] {
    return (this.database.prepare("SELECT * FROM room_hourly_aggregates WHERE room_id=? ORDER BY hour_started_at").all(roomId) as Record<string, unknown>[]).map((row) => ({ roomId: String(row.room_id), hourStartedAt: String(row.hour_started_at), sampleCount: Number(row.sample_count), minViewerCount: numberOrUndefined(row.min_viewer_count), maxViewerCount: numberOrUndefined(row.max_viewer_count), averageViewerCount: numberOrUndefined(row.average_viewer_count) }));
  }

  getCategoryUsage(): CategoryUsage[] {
    return (Object.keys(categoryTables) as CategoryUsage["category"][]).map((category) => {
      const rows = categoryTables[category].map(([table, time]) =>
        this.database.prepare(`SELECT COUNT(*) count,MIN(${time}) oldest,MAX(${time}) newest FROM ${table}`).get() as Record<string, unknown>,
      );
      const times = rows.flatMap((row) => [row.oldest, row.newest]).filter((value): value is string => typeof value === "string");
      return { category, count: rows.reduce((sum, row) => sum + Number(row.count), 0), ...(times.length ? { oldestAt: [...times].sort()[0], newestAt: [...times].sort().at(-1) } : {}) };
    });
  }

  checkpoint(): void { this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)"); }
  compact(): void { this.database.exec("VACUUM"); }
  runAutomaticRetention(settings: DataRetentionSettings, now = new Date()): number {
    let removed = 0;
    for (const [category, days] of [["observations", settings.observationDays], ["aggregates", settings.aggregateDays], ["asr", settings.asrDays]] as const) {
      const request: CleanupRequest = { category, before: new Date(now.getTime() - days * 86_400_000).toISOString() };
      const preview = this.previewCleanup(request);
      removed += this.executeCleanup(request, preview.token);
    }
    return removed;
  }

  private aggregateObservations(where: string, params: string[]): void {
    this.database.prepare(`INSERT INTO room_hourly_aggregates(room_id,hour_started_at,sample_count,min_viewer_count,max_viewer_count,average_viewer_count)
      SELECT room_id,substr(checked_at,1,13)||':00:00.000Z',COUNT(*),MIN(viewer_count),MAX(viewer_count),AVG(viewer_count) FROM room_observations WHERE ${where} GROUP BY room_id,substr(checked_at,1,13)
      ON CONFLICT(room_id,hour_started_at) DO UPDATE SET sample_count=excluded.sample_count,min_viewer_count=excluded.min_viewer_count,max_viewer_count=excluded.max_viewer_count,average_viewer_count=excluded.average_viewer_count`).run(...params);
  }
}

function numberOrUndefined(value: unknown): number | undefined { return typeof value === "number" ? value : undefined; }
