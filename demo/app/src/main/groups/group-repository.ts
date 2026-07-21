import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { RoomGroupSchema, type RoomGroup } from "../../shared/contracts";

export class GroupRepository {
  constructor(private readonly database: DatabaseSync) {}

  migrateExistingRooms(resetMonitoring: boolean): void {
    const rooms = this.database
      .prepare("SELECT room_id FROM rooms ORDER BY created_at,room_id")
      .all() as Array<{ room_id: string }>;
    const requiredCount = Math.max(1, Math.ceil(rooms.length / 9));
    let groups = this.database
      .prepare("SELECT id,name FROM room_groups ORDER BY position,created_at")
      .all() as Array<{ id: string; name: string }>;
    for (let index = groups.length; index < requiredCount; index++) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const name = `分组 ${index + 1}`;
      this.database
        .prepare(
          "INSERT INTO room_groups(id,name,parser_id,position,created_at,updated_at) VALUES(?,?,NULL,?,?,?)",
        )
        .run(id, name, index, now, now);
    }
    groups = this.database
      .prepare("SELECT id,name FROM room_groups ORDER BY position,created_at")
      .all() as Array<{ id: string; name: string }>;
    this.transaction(() => {
      rooms.forEach((room, index) => {
        const group =
          groups[Math.min(Math.floor(index / 9), groups.length - 1)];
        if (resetMonitoring)
          this.database
            .prepare(
              "UPDATE rooms SET group_id=?,position_in_group=? WHERE room_id=?",
            )
            .run(group.id, index % 9, room.room_id);
        else
          this.database
            .prepare(
              "UPDATE rooms SET group_id=COALESCE(group_id,?),position_in_group=COALESCE(position_in_group,?) WHERE room_id=?",
            )
            .run(group.id, index % 9, room.room_id);
      });
      if (resetMonitoring)
        this.database.prepare("UPDATE rooms SET monitoring=0").run();
    });
  }

  list(): RoomGroup[] {
    return (
      this.database
        .prepare(
          `SELECT g.*,COUNT(r.room_id) AS room_count FROM room_groups g LEFT JOIN rooms r ON r.group_id=g.id
      GROUP BY g.id ORDER BY g.position,g.created_at`,
        )
        .all() as Record<string, unknown>[]
    ).map(rowToGroup);
  }

  get(id: string): RoomGroup | undefined {
    return this.list().find((group) => group.id === id);
  }

  create(requestedName: string, parserId: string | null = null): RoomGroup {
    const name = requestedName.trim();
    if (!name || name.length > 30) throw new Error("GROUP_NAME_INVALID");
    if (
      this.database.prepare("SELECT 1 FROM room_groups WHERE name=?").get(name)
    )
      throw new Error("GROUP_NAME_EXISTS");
    if (
      parserId &&
      !this.database
        .prepare(
          "SELECT 1 FROM parser_definitions WHERE id=? AND deleted_at IS NULL",
        )
        .get(parserId)
    )
      throw new Error("PARSER_NOT_FOUND");
    const id = randomUUID();
    const now = new Date().toISOString();
    const position = Number(
      (
        this.database
          .prepare(
            "SELECT COALESCE(MAX(position),-1)+1 AS value FROM room_groups",
          )
          .get() as { value: number }
      ).value,
    );
    this.database
      .prepare(
        "INSERT INTO room_groups(id,name,parser_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(id, name, parserId, position, now, now);
    return this.get(id)!;
  }

  rename(id: string, requestedName: string): RoomGroup {
    const name = requestedName.trim();
    if (!name || name.length > 30) throw new Error("GROUP_NAME_INVALID");
    try {
      const result = this.database
        .prepare("UPDATE room_groups SET name=?,updated_at=? WHERE id=?")
        .run(name, new Date().toISOString(), id);
      if (!result.changes) throw new Error("GROUP_NOT_FOUND");
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE"))
        throw new Error("GROUP_NAME_EXISTS");
      throw error;
    }
    return this.get(id)!;
  }

  remove(id: string): void {
    if (!this.get(id)) throw new Error("GROUP_NOT_FOUND");
    this.assertStopped(id);
    if (
      this.database
        .prepare("SELECT 1 FROM rooms WHERE group_id=? LIMIT 1")
        .get(id)
    )
      throw new Error("GROUP_NOT_EMPTY");
    if (this.list().length === 1) throw new Error("LAST_GROUP_REQUIRED");
    this.database.prepare("DELETE FROM room_groups WHERE id=?").run(id);
  }

  moveRoom(
    roomId: string,
    targetGroupId: string,
    requestedPosition?: number,
  ): void {
    this.transaction(() => {
      const room = this.database
        .prepare("SELECT group_id FROM rooms WHERE room_id=?")
        .get(roomId) as { group_id: string } | undefined;
      if (!room) throw new Error("ROOM_NOT_FOUND");
      if (!this.get(targetGroupId)) throw new Error("GROUP_NOT_FOUND");
      this.assertStopped(room.group_id);
      this.assertStopped(targetGroupId);
      if (room.group_id !== targetGroupId) {
        const count = Number(
          (
            this.database
              .prepare("SELECT COUNT(*) AS value FROM rooms WHERE group_id=?")
              .get(targetGroupId) as { value: number }
          ).value,
        );
        if (count >= 9) throw new Error("GROUP_ROOM_LIMIT_REACHED");
      }
      const position =
        requestedPosition ??
        Number(
          (
            this.database
              .prepare(
                "SELECT COUNT(*) AS value FROM rooms WHERE group_id=? AND room_id<>?",
              )
              .get(targetGroupId, roomId) as { value: number }
          ).value,
        );
      this.database
        .prepare(
          "UPDATE rooms SET group_id=?,position_in_group=?,updated_at=? WHERE room_id=?",
        )
        .run(
          targetGroupId,
          Math.max(0, position),
          new Date().toISOString(),
          roomId,
        );
      this.normalize(room.group_id);
      this.normalize(targetGroupId);
    });
  }

  setParser(id: string, parserId: string | null): RoomGroup {
    this.assertStopped(id);
    if (
      parserId &&
      !this.database
        .prepare(
          "SELECT 1 FROM parser_definitions WHERE id=? AND deleted_at IS NULL",
        )
        .get(parserId)
    )
      throw new Error("PARSER_NOT_FOUND");
    const result = this.database
      .prepare("UPDATE room_groups SET parser_id=?,updated_at=? WHERE id=?")
      .run(parserId, new Date().toISOString(), id);
    if (!result.changes) throw new Error("GROUP_NOT_FOUND");
    return this.get(id)!;
  }

  private normalize(groupId: string): void {
    const rows = this.database
      .prepare(
        "SELECT room_id FROM rooms WHERE group_id=? ORDER BY position_in_group,created_at,room_id",
      )
      .all(groupId) as Array<{ room_id: string }>;
    rows.forEach((row, index) =>
      this.database
        .prepare("UPDATE rooms SET position_in_group=? WHERE room_id=?")
        .run(index, row.room_id),
    );
  }

  private assertStopped(groupId: string): void {
    if (
      this.database
        .prepare(
          "SELECT 1 FROM group_runs WHERE group_id=? AND status IN ('starting','running','stopping','stop_failed')",
        )
        .get(groupId)
    )
      throw new Error("RUNNING_GROUP_LOCKED");
  }

  private transaction(action: () => void): void {
    this.database.exec("SAVEPOINT group_repository");
    try {
      action();
      this.database.exec("RELEASE group_repository");
    } catch (error) {
      this.database.exec("ROLLBACK TO group_repository");
      this.database.exec("RELEASE group_repository");
      throw error;
    }
  }
}

function rowToGroup(row: Record<string, unknown>): RoomGroup {
  return RoomGroupSchema.parse({
    id: row.id,
    name: row.name,
    parserId: row.parser_id ?? null,
    position: Number(row.position),
    roomCount: Number(row.room_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
