import type { DatabaseSync } from "node:sqlite";

export class ProbeAccessRepository {
  constructor(private readonly database: DatabaseSync) {}
  lastStartedAt(roomId: string): string | undefined { return this.get(roomId)?.lastStartedAt; }
  recordStartedAt(roomId: string, at: string): void {
    this.database.prepare("INSERT INTO room_probe_access(room_id,last_started_at) VALUES(?,?) ON CONFLICT(room_id) DO UPDATE SET last_started_at=excluded.last_started_at").run(roomId, at);
  }
  recordCompleted(roomId: string, result: string, at: string): void {
    this.database.prepare("UPDATE room_probe_access SET last_completed_at=?,last_result=? WHERE room_id=?").run(at, result, roomId);
  }
  get(roomId: string): { lastStartedAt: string; lastCompletedAt?: string; lastResult?: string } | undefined {
    const row = this.database.prepare("SELECT * FROM room_probe_access WHERE room_id=?").get(roomId) as Record<string, unknown> | undefined;
    return row ? { lastStartedAt: String(row.last_started_at), ...(row.last_completed_at ? { lastCompletedAt: String(row.last_completed_at) } : {}), ...(row.last_result ? { lastResult: String(row.last_result) } : {}) } : undefined;
  }
}
