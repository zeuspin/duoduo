import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { GroupRunSchema, type GroupRun } from "../../shared/contracts";

export class GroupRunRepository {
  constructor(private readonly database: DatabaseSync) {}

  start(groupId: string): GroupRun {
    if (
      !this.database
        .prepare("SELECT 1 FROM room_groups WHERE id=?")
        .get(groupId)
    )
      throw new Error("GROUP_NOT_FOUND");
    const id = randomUUID();
    const now = new Date().toISOString();
    try {
      this.database
        .prepare(
          "INSERT INTO group_runs(id,group_id,status,started_at) VALUES(?,?,'starting',?)",
        )
        .run(id, groupId, now);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE"))
        throw new Error("ANOTHER_GROUP_RUNNING");
      throw error;
    }
    return this.get(id)!;
  }

  markRunning(id: string): GroupRun {
    return this.transition(id, ["starting"], "running");
  }
  requestStop(id: string): GroupRun {
    return this.transition(
      id,
      ["starting", "running", "stop_failed"],
      "stopping",
      { stopRequestedAt: new Date().toISOString() },
    );
  }
  finishStop(id: string): GroupRun {
    return this.transition(id, ["stopping"], "stopped", {
      completedAt: new Date().toISOString(),
      error: null,
    });
  }
  failStart(id: string, error: string): GroupRun {
    return this.transition(id, ["starting"], "start_failed", {
      completedAt: new Date().toISOString(),
      error,
    });
  }
  failStop(id: string, error: string): GroupRun {
    return this.transition(id, ["stopping"], "stop_failed", { error });
  }
  active(): GroupRun | undefined {
    const row = this.database
      .prepare(
        "SELECT * FROM group_runs WHERE status IN ('starting','running','stopping','stop_failed') ORDER BY started_at DESC LIMIT 1",
      )
      .get() as Record<string, unknown> | undefined;
    return row ? rowToRun(row) : undefined;
  }
  latestInterrupted(): GroupRun | undefined {
    const row = this.database
      .prepare("SELECT * FROM group_runs ORDER BY started_at DESC LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    return row?.status === "interrupted" ? rowToRun(row) : undefined;
  }
  get(id: string): GroupRun | undefined {
    const row = this.database
      .prepare("SELECT * FROM group_runs WHERE id=?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToRun(row) : undefined;
  }
  interruptOnStartup(): number {
    const result = this.database
      .prepare(
        "UPDATE group_runs SET status='interrupted',completed_at=?,error='APP_RESTARTED' WHERE status IN ('starting','running','stopping','stop_failed')",
      )
      .run(new Date().toISOString());
    return Number(result.changes);
  }

  private transition(
    id: string,
    from: string[],
    status: string,
    fields: {
      stopRequestedAt?: string;
      completedAt?: string;
      error?: string | null;
    } = {},
  ): GroupRun {
    const current = this.get(id);
    if (!current) throw new Error("GROUP_RUN_NOT_FOUND");
    if (!from.includes(current.status))
      throw new Error("GROUP_RUN_INVALID_TRANSITION");
    this.database
      .prepare(
        "UPDATE group_runs SET status=?,stop_requested_at=COALESCE(?,stop_requested_at),completed_at=COALESCE(?,completed_at),error=? WHERE id=?",
      )
      .run(
        status,
        fields.stopRequestedAt ?? null,
        fields.completedAt ?? null,
        fields.error === undefined ? (current.error ?? null) : fields.error,
        id,
      );
    return this.get(id)!;
  }
}

function rowToRun(row: Record<string, unknown>): GroupRun {
  return GroupRunSchema.parse({
    id: row.id,
    groupId: row.group_id,
    status: row.status,
    startedAt: row.started_at,
    stopRequestedAt: row.stop_requested_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    error: row.error ?? undefined,
  });
}
