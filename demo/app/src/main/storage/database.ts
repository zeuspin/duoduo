import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ImmutableParserSchema,
  ContentRecordSchema,
  MarketInsightSchema,
  ParserDefinitionSchema,
  ParserSpecSchema,
  ParserVersionSchema,
  RoomInputSchema,
  RoomParserBindingSchema,
  RoomSchema,
  RoomSnapshotSchema,
  normalizeDouyinUrl,
  type AsrEvent,
  type ImmutableParser,
  type ContentRecord,
  type MarketInsight,
  type ParserDefinition,
  type ParserSpec,
  type ParserVersion,
  type Room,
  type RoomInput,
  type RoomParserBinding,
  type RoomSnapshot,
} from "../../shared/contracts";
import { DataMaintenance } from "./data-maintenance";
import { AiUsageRepository } from "../usage/usage-repository";
import { GroupRepository } from "../groups/group-repository";
import { GroupRunRepository } from "../groups/group-run-repository";
import { ProbeAccessRepository } from "../rooms/probe-access-repository";
import { DEFAULT_PARSER_PROMPT } from "../../shared/parser-prompt";

export interface StoredAsrEvent extends AsrEvent {
  occurredAt: string;
  id: number;
}

export interface AsrPage {
  items: StoredAsrEvent[];
  nextCursor?: number;
}

export interface InsightPage {
  items: MarketInsight[];
  nextCursor?: number;
}

export interface ContentRecordPage {
  items: ContentRecord[];
  nextCursor?: number;
}

export const BUILT_IN_MARKET_PARSER_SPEC: ParserSpec = ParserSpecSchema.parse({
  schemaVersion: 3,
  name: "股票盯盘直播内容洞察",
  prompt: DEFAULT_PARSER_PROMPT,
});

export class DuoduoDatabase {
  readonly rooms: SqliteRoomRepository;
  readonly asr: SqliteAsrRepository;
  readonly snapshots: SqliteSnapshotRepository;
  readonly parsers: SqliteParserRepository;
  readonly insights: SqliteInsightRepository;
  readonly contentRecords: SqliteContentRecordRepository;
  readonly maintenance: DataMaintenance;
  readonly aiUsage: AiUsageRepository;
  readonly groups: GroupRepository;
  readonly groupRuns: GroupRunRepository;
  readonly probeAccess: ProbeAccessRepository;

  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;",
    );
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS room_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        parser_id TEXT REFERENCES parser_definitions(id),
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_migrations (
        key TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        canonical_url TEXT NOT NULL,
        schedule_json TEXT,
        probe_interval_minutes INTEGER,
        monitoring INTEGER NOT NULL DEFAULT 0,
        auto_monitor_on_live INTEGER NOT NULL DEFAULT 0,
        group_id TEXT REFERENCES room_groups(id),
        position_in_group INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS group_runs (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES room_groups(id),
        status TEXT NOT NULL CHECK(status IN ('starting','running','stopping','stopped','start_failed','stop_failed','interrupted')),
        started_at TEXT NOT NULL,
        stop_requested_at TEXT,
        completed_at TEXT,
        error TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_group_run ON group_runs((1)) WHERE status IN ('starting','running','stopping','stop_failed');
      CREATE TABLE IF NOT EXISTS room_probe_access (
        room_id TEXT PRIMARY KEY,
        last_started_at TEXT NOT NULL,
        last_completed_at TEXT,
        last_result TEXT
      );
      CREATE TABLE IF NOT EXISTS asr_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        segment_id TEXT NOT NULL,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        text TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE(room_id, session_id, segment_id)
      );
      CREATE INDEX IF NOT EXISTS asr_room_id_index ON asr_segments(room_id, id DESC);
      CREATE TABLE IF NOT EXISTS room_snapshots (
        room_id TEXT PRIMARY KEY REFERENCES rooms(room_id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        title TEXT,
        anchor_name TEXT,
        cover_path TEXT,
        avatar_path TEXT,
        live_description TEXT,
        viewer_count INTEGER,
        follower_count INTEGER,
        total_viewer_count INTEGER,
        like_count INTEGER,
        metric_raw_json TEXT,
        metric_evidence_json TEXT,
        metric_quality TEXT,
        checked_at TEXT NOT NULL,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS room_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        viewer_count INTEGER,
        follower_count INTEGER,
        total_viewer_count INTEGER,
        like_count INTEGER,
        metric_raw_json TEXT,
        metric_evidence_json TEXT,
        metric_quality TEXT,
        checked_at TEXT NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS observations_room_time_index ON room_observations(room_id, checked_at DESC);
      CREATE TABLE IF NOT EXISTS room_hourly_aggregates (
        room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        hour_started_at TEXT NOT NULL,
        sample_count INTEGER NOT NULL,
        min_viewer_count INTEGER,
        max_viewer_count INTEGER,
        average_viewer_count REAL,
        PRIMARY KEY(room_id,hour_started_at)
      );
      CREATE TABLE IF NOT EXISTS live_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('live','end_pending','ended')),
        previous_offline_at TEXT,
        first_live_at TEXT NOT NULL,
        last_live_at TEXT NOT NULL,
        first_offline_at TEXT,
        peak_viewer_count INTEGER,
        average_viewer_count REAL,
        unknown_since TEXT,
        unknown_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS sessions_room_time_index ON live_sessions(room_id, first_live_at DESC);
      CREATE TABLE IF NOT EXISTS parser_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 0,
        immutable_spec_json TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS parser_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parser_id TEXT NOT NULL REFERENCES parser_definitions(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('draft','published','archived')),
        spec_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        published_at TEXT,
        UNIQUE(parser_id, version)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS parser_one_draft_index ON parser_versions(parser_id) WHERE state='draft';
      CREATE UNIQUE INDEX IF NOT EXISTS parser_one_published_index ON parser_versions(parser_id) WHERE state='published';
      CREATE TABLE IF NOT EXISTS room_parser_bindings (
        room_id TEXT PRIMARY KEY REFERENCES rooms(room_id) ON DELETE CASCADE,
        parser_id TEXT NOT NULL REFERENCES parser_definitions(id),
        parser_version_id INTEGER NOT NULL REFERENCES parser_versions(id),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS market_insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        parser_id TEXT NOT NULL REFERENCES parser_definitions(id),
        parser_version_id INTEGER NOT NULL REFERENCES parser_versions(id),
        nature TEXT NOT NULL,
        subject_kind TEXT NOT NULL,
        subject_original TEXT NOT NULL,
        subject_normalized TEXT,
        direction TEXT NOT NULL,
        summary TEXT NOT NULL,
        rationale TEXT NOT NULL,
        conditions_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        source_asr_ids_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        confidence REAL NOT NULL,
        alert_level TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS insights_room_id_index ON market_insights(room_id, id DESC);
      CREATE TABLE IF NOT EXISTS content_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        parser_id TEXT NOT NULL REFERENCES parser_definitions(id),
        parser_version_id INTEGER NOT NULL REFERENCES parser_versions(id),
        result_type_id TEXT NOT NULL,
        result_type_label TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        fields_json TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        source_asr_ids_json TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        confidence REAL NOT NULL,
        alert_level TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS content_records_room_id_index ON content_records(room_id, id DESC);
      CREATE TABLE IF NOT EXISTS ai_runs (
        id TEXT PRIMARY KEY,
        feature_key TEXT NOT NULL,
        usage_kind TEXT NOT NULL CHECK(usage_kind IN ('production','test')),
        room_id TEXT,
        parser_id TEXT,
        parser_version_id INTEGER,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS ai_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT REFERENCES ai_runs(id),
        provider TEXT NOT NULL,
        feature_key TEXT NOT NULL,
        usage_kind TEXT NOT NULL CHECK(usage_kind IN ('production','test')),
        room_id TEXT,
        parser_id TEXT,
        parser_version_id INTEGER,
        api_kind TEXT NOT NULL,
        requested_model TEXT NOT NULL,
        returned_model TEXT,
        region TEXT NOT NULL,
        provider_request_id TEXT,
        thinking_enabled INTEGER,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        latency_ms INTEGER,
        error_code TEXT,
        retry_of_call_id TEXT REFERENCES ai_calls(id)
      );
      CREATE INDEX IF NOT EXISTS ai_calls_started_index ON ai_calls(started_at DESC);
      CREATE INDEX IF NOT EXISTS ai_calls_feature_index ON ai_calls(feature_key,started_at DESC);
      CREATE INDEX IF NOT EXISTS ai_calls_room_index ON ai_calls(room_id,started_at DESC);
      CREATE INDEX IF NOT EXISTS ai_calls_model_index ON ai_calls(requested_model,started_at DESC);
      CREATE TABLE IF NOT EXISTS ai_call_usage (
        call_id TEXT NOT NULL REFERENCES ai_calls(id) ON DELETE CASCADE,
        metric TEXT NOT NULL,
        value INTEGER NOT NULL,
        unit TEXT NOT NULL,
        PRIMARY KEY(call_id,metric)
      );
      CREATE TABLE IF NOT EXISTS ai_call_costs (
        call_id TEXT PRIMARY KEY REFERENCES ai_calls(id) ON DELETE CASCADE,
        pricing_rule_key TEXT,
        input_cost_micros INTEGER,
        output_cost_micros INTEGER,
        total_cost_micros INTEGER,
        status TEXT NOT NULL CHECK(status IN ('calculated','usage_missing','price_missing')),
        currency TEXT NOT NULL,
        calculated_at TEXT NOT NULL
      );
    `);
    for (const column of [
      "avatar_path TEXT",
      "viewer_count INTEGER",
      "follower_count INTEGER",
      "total_viewer_count INTEGER",
      "like_count INTEGER",
      "metric_raw_json TEXT",
      "metric_evidence_json TEXT",
      "metric_quality TEXT",
      "last_reliable_status TEXT",
      "last_reliable_status_at TEXT",
      "metrics_observed_at TEXT",
      "live_description TEXT",
    ]) {
      try {
        this.database.exec(`ALTER TABLE room_snapshots ADD COLUMN ${column}`);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("duplicate column name")
        )
          throw error;
      }
    }
    try {
      this.database.exec(
        "ALTER TABLE rooms ADD COLUMN probe_interval_minutes INTEGER",
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("duplicate column name")
      )
        throw error;
    }
    try {
      this.database.exec(
        "ALTER TABLE rooms ADD COLUMN auto_monitor_on_live INTEGER NOT NULL DEFAULT 0",
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("duplicate column name")
      )
        throw error;
    }
    const roomColumns = new Set(
      (
        this.database.prepare("PRAGMA table_info(rooms)").all() as Array<
          Record<string, unknown>
        >
      ).map((row) => String(row.name)),
    );
    const hadGroupId = roomColumns.has("group_id");
    if (!hadGroupId)
      this.database.exec(
        "ALTER TABLE rooms ADD COLUMN group_id TEXT REFERENCES room_groups(id)",
      );
    if (!roomColumns.has("position_in_group"))
      this.database.exec(
        "ALTER TABLE rooms ADD COLUMN position_in_group INTEGER",
      );
    try {
      this.database.exec(
        "ALTER TABLE room_observations ADD COLUMN metric_evidence_json TEXT",
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes("duplicate column name")
      )
        throw error;
    }
    for (const column of ["immutable_spec_json TEXT", "deleted_at TEXT"]) {
      try {
        this.database.exec(
          `ALTER TABLE parser_definitions ADD COLUMN ${column}`,
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("duplicate column name")
        )
          throw error;
      }
    }
    this.database
      .exec(`UPDATE room_snapshots SET metrics_observed_at=NULL,metric_raw_json=NULL
      WHERE viewer_count IS NULL AND follower_count IS NULL AND total_viewer_count IS NULL AND like_count IS NULL
      AND (metric_raw_json IS NULL OR metric_raw_json='{}')`);
    this.groups = new GroupRepository(this.database);
    this.groups.migrateExistingRooms(!hadGroupId);
    this.groupRuns = new GroupRunRepository(this.database);
    this.probeAccess = new ProbeAccessRepository(this.database);
    this.rooms = new SqliteRoomRepository(this.database);
    this.asr = new SqliteAsrRepository(this.database);
    this.snapshots = new SqliteSnapshotRepository(this.database);
    this.parsers = new SqliteParserRepository(this.database);
    this.insights = new SqliteInsightRepository(this.database);
    this.contentRecords = new SqliteContentRecordRepository(this.database);
    this.maintenance = new DataMaintenance(this.database);
    this.aiUsage = new AiUsageRepository(this.database);
    this.aiUsage.markRunningInterrupted();
    this.parsers.ensureBuiltIn();
    this.parsers.migrateImmutableDefinitions();
    this.parsers.resetToSystemAnalyzerV3Once();
  }

  async migrateLegacyRooms(path: string): Promise<void> {
    if ((await this.rooms.list()).length > 0) return;
    try {
      const raw = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(raw)) throw new Error("LEGACY_ROOMS_INVALID");
      const initialGroupId = this.groups.list()[0]?.id;
      if (!initialGroupId) throw new Error("GROUP_REQUIRED");
      const legacy = raw.map((room, index) =>
        RoomSchema.parse({
          ...(room as Record<string, unknown>),
          groupId: initialGroupId,
          positionInGroup: index,
        }),
      );
      for (const room of legacy) this.rooms.insertExisting(room);
      this.groups.migrateExistingRooms(true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  close(): void {
    this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.database.close();
  }

  mergeFrom(path: string): void {
    this.database.prepare("ATTACH DATABASE ? AS imported").run(path);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const tableColumns = (
        table: "rooms" | "room_snapshots" | "room_observations",
      ) =>
        new Set(
          (
            this.database
              .prepare(`PRAGMA imported.table_info(${table})`)
              .all() as Array<Record<string, unknown>>
          ).map((row) => String(row.name)),
        );
      const roomSource = tableColumns("rooms");
      const snapshotSource = tableColumns("room_snapshots");
      const observationSource = tableColumns("room_observations");
      const source = (available: Set<string>, column: string) =>
        available.has(column) ? `i.${column}` : "NULL";
      const snapshotColumns = [
        "room_id",
        "status",
        "title",
        "anchor_name",
        "cover_path",
        "avatar_path",
        "live_description",
        "viewer_count",
        "follower_count",
        "total_viewer_count",
        "like_count",
        "metric_raw_json",
        "metric_evidence_json",
        "metric_quality",
        "last_reliable_status",
        "last_reliable_status_at",
        "metrics_observed_at",
        "checked_at",
        "error",
      ];
      const observationColumns = [
        "room_id",
        "status",
        "viewer_count",
        "follower_count",
        "total_viewer_count",
        "like_count",
        "metric_raw_json",
        "metric_evidence_json",
        "metric_quality",
        "checked_at",
        "error",
      ];
      const roomColumns = [
        "room_id",
        "canonical_url",
        "schedule_json",
        "probe_interval_minutes",
        "monitoring",
        "auto_monitor_on_live",
        "created_at",
        "updated_at",
      ];
      const roomColumnSource = (column: string) =>
        roomSource.has(column)
          ? `i.${column}`
          : column === "auto_monitor_on_live"
            ? "0"
            : "NULL";
      this.database.exec(`
        INSERT OR IGNORE INTO rooms(${roomColumns.join(",")})
          SELECT ${roomColumns.map(roomColumnSource).join(",")} FROM imported.rooms i;
        INSERT OR IGNORE INTO room_snapshots(${snapshotColumns.join(",")})
          SELECT ${snapshotColumns.map((column) => source(snapshotSource, column)).join(",")} FROM imported.room_snapshots i;
        INSERT INTO room_observations(${observationColumns.join(",")})
          SELECT ${observationColumns.map((column) => source(observationSource, column)).join(",")} FROM imported.room_observations i
          WHERE NOT EXISTS (SELECT 1 FROM room_observations x WHERE x.room_id=i.room_id AND x.checked_at=i.checked_at AND x.status=i.status);
        INSERT OR IGNORE INTO room_hourly_aggregates SELECT * FROM imported.room_hourly_aggregates;
        INSERT INTO live_sessions(room_id,status,previous_offline_at,first_live_at,last_live_at,first_offline_at,peak_viewer_count,average_viewer_count,unknown_since,unknown_count)
          SELECT i.room_id,i.status,i.previous_offline_at,i.first_live_at,i.last_live_at,i.first_offline_at,i.peak_viewer_count,i.average_viewer_count,i.unknown_since,i.unknown_count FROM imported.live_sessions i
          WHERE NOT EXISTS (SELECT 1 FROM live_sessions x WHERE x.room_id=i.room_id AND x.first_live_at=i.first_live_at);
        INSERT OR IGNORE INTO asr_segments SELECT * FROM imported.asr_segments;
      `);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    } finally {
      this.database.exec("DETACH DATABASE imported");
    }
  }
}

class SqliteRoomRepository {
  constructor(private readonly database: DatabaseSync) {}

  async list(): Promise<Room[]> {
    const rows = this.database
      .prepare("SELECT * FROM rooms ORDER BY created_at")
      .all() as Record<string, unknown>[];
    return rows.map(rowToRoom);
  }

  async add(input: RoomInput): Promise<Room> {
    const parsed = RoomInputSchema.parse(input);
    const normalized = normalizeDouyinUrl(parsed.url);
    if (
      this.database
        .prepare("SELECT 1 FROM rooms WHERE room_id = ?")
        .get(normalized.roomId)
    )
      throw new Error("ROOM_EXISTS");
    const now = new Date().toISOString();
    const groupId = parsed.groupId;
    this.database.exec("SAVEPOINT room_add");
    try {
      if (
        !this.database
          .prepare("SELECT 1 FROM room_groups WHERE id=?")
          .get(groupId)
      )
        throw new Error("GROUP_NOT_FOUND");
      if (
        this.database
          .prepare(
            "SELECT 1 FROM group_runs WHERE group_id=? AND status IN ('starting','running','stopping','stop_failed')",
          )
          .get(groupId)
      )
        throw new Error("RUNNING_GROUP_LOCKED");
      const count = Number(
        (
          this.database
            .prepare("SELECT COUNT(*) AS value FROM rooms WHERE group_id=?")
            .get(groupId) as { value: number }
        ).value,
      );
      if (count >= 9) throw new Error("GROUP_ROOM_LIMIT_REACHED");
      const room = RoomSchema.parse({
        ...normalized,
        schedule: parsed.schedule,
        monitoring: false,
        autoMonitorOnLive: false,
        groupId,
        positionInGroup: count,
        createdAt: now,
        updatedAt: now,
      });
      this.insertExisting(room);
      this.database.exec("RELEASE room_add");
      return room;
    } catch (error) {
      this.database.exec("ROLLBACK TO room_add");
      this.database.exec("RELEASE room_add");
      throw error;
    }
  }

  async update(roomId: string, input: RoomInput): Promise<Room> {
    const parsed = RoomInputSchema.parse(input);
    const normalized = normalizeDouyinUrl(parsed.url);
    if (normalized.roomId !== roomId) throw new Error("ROOM_ID_IMMUTABLE");
    const existing = this.database
      .prepare("SELECT * FROM rooms WHERE room_id = ?")
      .get(roomId) as Record<string, unknown> | undefined;
    if (!existing) throw new Error("ROOM_NOT_FOUND");
    const updated = RoomSchema.parse({
      ...rowToRoom(existing),
      canonicalUrl: normalized.canonicalUrl,
      schedule: parsed.schedule,
      updatedAt: new Date().toISOString(),
    });
    this.database
      .prepare(
        "UPDATE rooms SET canonical_url=?, schedule_json=?, updated_at=? WHERE room_id=?",
      )
      .run(
        updated.canonicalUrl,
        encodeSchedule(updated.schedule),
        updated.updatedAt,
        roomId,
      );
    return updated;
  }

  async remove(roomId: string): Promise<void> {
    const room = this.database
      .prepare("SELECT group_id FROM rooms WHERE room_id=?")
      .get(roomId) as { group_id: string } | undefined;
    if (!room) throw new Error("ROOM_NOT_FOUND");
    if (
      this.database
        .prepare(
          "SELECT 1 FROM group_runs WHERE group_id=? AND status IN ('starting','running','stopping','stop_failed')",
        )
        .get(room.group_id)
    )
      throw new Error("RUNNING_GROUP_LOCKED");
    this.database.prepare("DELETE FROM rooms WHERE room_id = ?").run(roomId);
    const remaining = this.database
      .prepare(
        "SELECT room_id FROM rooms WHERE group_id=? ORDER BY position_in_group,created_at,room_id",
      )
      .all(room.group_id) as Array<{ room_id: string }>;
    remaining.forEach((item, index) =>
      this.database
        .prepare("UPDATE rooms SET position_in_group=? WHERE room_id=?")
        .run(index, item.room_id),
    );
  }

  async setMonitoring(roomId: string, monitoring: boolean): Promise<Room> {
    const existing = this.database
      .prepare("SELECT * FROM rooms WHERE room_id = ?")
      .get(roomId) as Record<string, unknown> | undefined;
    if (!existing) throw new Error("ROOM_NOT_FOUND");
    const updatedAt = new Date().toISOString();
    this.database
      .prepare("UPDATE rooms SET monitoring=?, updated_at=? WHERE room_id=?")
      .run(monitoring ? 1 : 0, updatedAt, roomId);
    return RoomSchema.parse({ ...rowToRoom(existing), monitoring, updatedAt });
  }

  async setAutoMonitorOnLive(
    roomId: string,
    autoMonitorOnLive: boolean,
  ): Promise<Room> {
    const existing = this.database
      .prepare("SELECT * FROM rooms WHERE room_id = ?")
      .get(roomId) as Record<string, unknown> | undefined;
    if (!existing) throw new Error("ROOM_NOT_FOUND");
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        "UPDATE rooms SET auto_monitor_on_live=?, updated_at=? WHERE room_id=?",
      )
      .run(autoMonitorOnLive ? 1 : 0, updatedAt, roomId);
    return RoomSchema.parse({
      ...rowToRoom(existing),
      autoMonitorOnLive,
      updatedAt,
    });
  }

  insertExisting(room: Room): void {
    const requestedGroup = this.database
      .prepare("SELECT id FROM room_groups WHERE id=?")
      .get(room.groupId) as { id: string } | undefined;
    const groupId =
      requestedGroup?.id ??
      (
        this.database
          .prepare("SELECT id FROM room_groups ORDER BY position LIMIT 1")
          .get() as { id: string }
      ).id;
    this.database
      .prepare(
        "INSERT OR IGNORE INTO rooms(room_id,canonical_url,schedule_json,monitoring,auto_monitor_on_live,group_id,position_in_group,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        room.roomId,
        room.canonicalUrl,
        encodeSchedule(room.schedule),
        room.monitoring ? 1 : 0,
        room.autoMonitorOnLive ? 1 : 0,
        groupId,
        room.positionInGroup,
        room.createdAt,
        room.updatedAt,
      );
  }
}

class SqliteAsrRepository {
  constructor(private readonly database: DatabaseSync) {}

  insert(event: Omit<StoredAsrEvent, "id">): StoredAsrEvent | undefined {
    if (!event.isFinal) return undefined;
    this.database
      .prepare(
        "INSERT OR IGNORE INTO asr_segments(room_id,session_id,segment_id,start_ms,end_ms,text,occurred_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        event.roomId,
        event.sessionId,
        event.segmentId,
        event.startMs,
        event.endMs,
        event.text,
        event.occurredAt,
      );
    const row = this.database
      .prepare(
        "SELECT * FROM asr_segments WHERE room_id=? AND session_id=? AND segment_id=?",
      )
      .get(event.roomId, event.sessionId, event.segmentId) as Record<
      string,
      unknown
    >;
    return rowToAsr(row);
  }

  listBefore(
    roomId: string,
    options: { limit: number; beforeId?: number },
  ): AsrPage {
    const limit = Math.max(1, Math.min(options.limit, 100));
    const rows = (
      options.beforeId
        ? this.database
            .prepare(
              "SELECT * FROM asr_segments WHERE room_id=? AND id<? ORDER BY id DESC LIMIT ?",
            )
            .all(roomId, options.beforeId, limit)
        : this.database
            .prepare(
              "SELECT * FROM asr_segments WHERE room_id=? ORDER BY id DESC LIMIT ?",
            )
            .all(roomId, limit)
    ) as Record<string, unknown>[];
    rows.reverse();
    const items = rows.map(rowToAsr);
    return {
      items,
      ...(items.length === limit ? { nextCursor: items[0].id } : {}),
    };
  }
}

class SqliteSnapshotRepository {
  constructor(private readonly database: DatabaseSync) {}

  setAvatarIfMissing(roomId: string, avatarPath: string): boolean {
    const result = this.database
      .prepare(
        "UPDATE room_snapshots SET avatar_path=? WHERE room_id=? AND avatar_path IS NULL",
      )
      .run(avatarPath, roomId);
    return Number(result.changes) === 1;
  }

  replaceAvatar(roomId: string, avatarPath: string): void {
    const result = this.database
      .prepare("UPDATE room_snapshots SET avatar_path=? WHERE room_id=?")
      .run(avatarPath, roomId);
    if (Number(result.changes) !== 1)
      throw new Error("ROOM_SNAPSHOT_NOT_FOUND");
  }

  upsert(snapshot: RoomSnapshot): void {
    const parsed = RoomSnapshotSchema.parse(snapshot);
    const existing = this.database
      .prepare("SELECT * FROM room_snapshots WHERE room_id=?")
      .get(parsed.roomId) as Record<string, unknown> | undefined;
    const reliable = parsed.status === "live" || parsed.status === "offline";
    const updateMetrics = parsed.status === "live";
    const updateProfile = parsed.status === "live";
    const observedMetrics =
      parsed.viewerCount !== undefined ||
      parsed.followerCount !== undefined ||
      parsed.totalViewerCount !== undefined ||
      parsed.likeCount !== undefined;
    this.database
      .prepare(
        `INSERT INTO room_snapshots(room_id,status,title,anchor_name,cover_path,avatar_path,live_description,viewer_count,follower_count,total_viewer_count,like_count,metric_raw_json,metric_evidence_json,metric_quality,last_reliable_status,last_reliable_status_at,metrics_observed_at,checked_at,error)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(room_id) DO UPDATE SET status=excluded.status,title=excluded.title,anchor_name=excluded.anchor_name,cover_path=excluded.cover_path,avatar_path=excluded.avatar_path,live_description=excluded.live_description,viewer_count=excluded.viewer_count,follower_count=excluded.follower_count,total_viewer_count=excluded.total_viewer_count,like_count=excluded.like_count,metric_raw_json=excluded.metric_raw_json,metric_evidence_json=excluded.metric_evidence_json,metric_quality=excluded.metric_quality,last_reliable_status=excluded.last_reliable_status,last_reliable_status_at=excluded.last_reliable_status_at,metrics_observed_at=excluded.metrics_observed_at,checked_at=excluded.checked_at,error=excluded.error`,
      )
      .run(
        parsed.roomId,
        parsed.status,
        updateProfile
          ? (parsed.title ?? optionalString(existing?.title))
          : optionalString(existing?.title),
        updateProfile
          ? (parsed.anchorName ?? optionalString(existing?.anchor_name))
          : optionalString(existing?.anchor_name),
        updateProfile
          ? (parsed.coverPath ?? optionalString(existing?.cover_path))
          : optionalString(existing?.cover_path),
        updateProfile
          ? (parsed.avatarPath ?? optionalString(existing?.avatar_path))
          : optionalString(existing?.avatar_path),
        updateProfile
          ? (parsed.liveDescription ??
              optionalString(existing?.live_description))
          : optionalString(existing?.live_description),
        updateMetrics
          ? (parsed.viewerCount ??
              optionalNumber(existing?.viewer_count) ??
              null)
          : (optionalNumber(existing?.viewer_count) ?? null),
        updateMetrics
          ? (parsed.followerCount ??
              optionalNumber(existing?.follower_count) ??
              null)
          : (optionalNumber(existing?.follower_count) ?? null),
        updateMetrics
          ? (parsed.totalViewerCount ??
              optionalNumber(existing?.total_viewer_count) ??
              null)
          : (optionalNumber(existing?.total_viewer_count) ?? null),
        updateMetrics
          ? (parsed.likeCount ?? optionalNumber(existing?.like_count) ?? null)
          : (optionalNumber(existing?.like_count) ?? null),
        updateMetrics && parsed.metricRaw
          ? JSON.stringify(parsed.metricRaw)
          : optionalString(existing?.metric_raw_json),
        updateMetrics && parsed.metricEvidence
          ? JSON.stringify(parsed.metricEvidence)
          : optionalString(existing?.metric_evidence_json),
        updateMetrics
          ? (parsed.metricQuality ?? optionalString(existing?.metric_quality))
          : optionalString(existing?.metric_quality),
        reliable
          ? parsed.status
          : optionalString(existing?.last_reliable_status),
        reliable
          ? parsed.checkedAt
          : optionalString(existing?.last_reliable_status_at),
        updateMetrics && observedMetrics
          ? parsed.checkedAt
          : optionalString(existing?.metrics_observed_at),
        parsed.checkedAt,
        parsed.error ?? null,
      );
  }

  list(): RoomSnapshot[] {
    const rows = this.database
      .prepare("SELECT * FROM room_snapshots ORDER BY room_id")
      .all() as Record<string, unknown>[];
    return rows.map(rowToSnapshot);
  }

  record(snapshot: RoomSnapshot): void {
    const parsed = RoomSnapshotSchema.parse(snapshot);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.upsert(parsed);
      this.database
        .prepare(
          `INSERT INTO room_observations(room_id,status,viewer_count,follower_count,total_viewer_count,like_count,metric_raw_json,metric_evidence_json,metric_quality,checked_at,error) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          parsed.roomId,
          parsed.status,
          parsed.viewerCount ?? null,
          parsed.followerCount ?? null,
          parsed.totalViewerCount ?? null,
          parsed.likeCount ?? null,
          parsed.metricRaw ? JSON.stringify(parsed.metricRaw) : null,
          parsed.metricEvidence ? JSON.stringify(parsed.metricEvidence) : null,
          parsed.metricQuality ?? null,
          parsed.checkedAt,
          parsed.error ?? null,
        );
      this.updateSession(parsed);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listHistory(roomId: string, limit: number): RoomSnapshot[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM room_observations WHERE room_id=? ORDER BY checked_at LIMIT ?",
      )
      .all(roomId, Math.max(1, Math.min(limit, 1000))) as Record<
      string,
      unknown
    >[];
    return rows.map(rowToObservation);
  }

  listHistorySince(
    roomId: string,
    since: string,
    limit: number,
  ): RoomSnapshot[] {
    const rows = this.database
      .prepare(
        "SELECT * FROM room_observations WHERE room_id=? AND checked_at>=? ORDER BY checked_at DESC LIMIT ?",
      )
      .all(roomId, since, Math.max(1, Math.min(limit, 5_000))) as Record<
      string,
      unknown
    >[];
    rows.reverse();
    return rows.map(rowToObservation);
  }

  listSessions(roomId: string): Array<Record<string, unknown>> {
    return (
      this.database
        .prepare(
          "SELECT * FROM live_sessions WHERE room_id=? ORDER BY first_live_at",
        )
        .all(roomId) as Record<string, unknown>[]
    ).map((row) => ({
      id: Number(row.id),
      roomId: String(row.room_id),
      status: String(row.status),
      previousOfflineAt: optionalString(row.previous_offline_at),
      firstLiveAt: String(row.first_live_at),
      lastLiveAt: String(row.last_live_at),
      firstOfflineAt: optionalString(row.first_offline_at),
      peakViewerCount: optionalNumber(row.peak_viewer_count),
      averageViewerCount: optionalNumber(row.average_viewer_count),
    }));
  }

  private updateSession(snapshot: RoomSnapshot): void {
    const active = this.database
      .prepare(
        "SELECT * FROM live_sessions WHERE room_id=? AND status!='ended' ORDER BY id DESC LIMIT 1",
      )
      .get(snapshot.roomId) as Record<string, unknown> | undefined;
    if (snapshot.status === "live") {
      if (!active) {
        const previous = this.database
          .prepare(
            "SELECT checked_at FROM room_observations WHERE room_id=? AND status='offline' AND checked_at<? ORDER BY checked_at DESC LIMIT 1",
          )
          .get(snapshot.roomId, snapshot.checkedAt) as
          Record<string, unknown> | undefined;
        this.database
          .prepare(
            "INSERT INTO live_sessions(room_id,status,previous_offline_at,first_live_at,last_live_at,peak_viewer_count,average_viewer_count) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            snapshot.roomId,
            "live",
            optionalString(previous?.checked_at),
            snapshot.checkedAt,
            snapshot.checkedAt,
            snapshot.viewerCount ?? null,
            snapshot.viewerCount ?? null,
          );
      } else {
        const stats = this.database
          .prepare(
            "SELECT MAX(viewer_count) peak, AVG(viewer_count) average FROM room_observations WHERE room_id=? AND status='live' AND checked_at>=?",
          )
          .get(snapshot.roomId, String(active.first_live_at)) as Record<
          string,
          unknown
        >;
        this.database
          .prepare(
            "UPDATE live_sessions SET status='live',last_live_at=?,peak_viewer_count=?,average_viewer_count=?,unknown_since=NULL,unknown_count=0 WHERE id=?",
          )
          .run(
            snapshot.checkedAt,
            optionalNumber(stats.peak) ?? null,
            optionalNumber(stats.average) ?? null,
            Number(active.id),
          );
      }
      return;
    }
    if (!active) return;
    if (snapshot.status === "offline") {
      this.database
        .prepare(
          "UPDATE live_sessions SET status='ended',first_offline_at=?,unknown_since=NULL,unknown_count=0 WHERE id=?",
        )
        .run(snapshot.checkedAt, Number(active.id));
      return;
    }
    return;
  }
}

export class SqliteParserRepository {
  constructor(private readonly database: DatabaseSync) {}

  ensureBuiltIn(): void {
    const now = new Date().toISOString();
    this.database
      .prepare(
        "INSERT OR IGNORE INTO parser_definitions(id,name,description,built_in,created_at) VALUES(?,?,?,?,?)",
      )
      .run(
        "market-insight",
        BUILT_IN_MARKET_PARSER_SPEC.name,
        "schemaVersion" in BUILT_IN_MARKET_PARSER_SPEC
          ? ""
          : BUILT_IN_MARKET_PARSER_SPEC.description,
        1,
        now,
      );
    const exists = this.database
      .prepare("SELECT 1 FROM parser_versions WHERE parser_id=?")
      .get("market-insight");
    if (!exists)
      this.database
        .prepare(
          "INSERT INTO parser_versions(parser_id,version,state,spec_json,created_at,published_at) VALUES(?,?,?,?,?,?)",
        )
        .run(
          "market-insight",
          1,
          "published",
          JSON.stringify(BUILT_IN_MARKET_PARSER_SPEC),
          now,
          now,
        );
  }

  migrateImmutableDefinitions(): void {
    const rows = this.database
      .prepare(
        `SELECT d.id,v.spec_json FROM parser_definitions d JOIN parser_versions v ON v.parser_id=d.id AND v.state='published'
      WHERE d.immutable_spec_json IS NULL`,
      )
      .all() as Array<{ id: string; spec_json: string }>;
    for (const row of rows)
      this.database
        .prepare(
          "UPDATE parser_definitions SET immutable_spec_json=?,built_in=0 WHERE id=?",
        )
        .run(row.spec_json, row.id);
  }

  resetToSystemAnalyzerV3Once(): void {
    const migrationKey = "system-analyzer-v3-2026-07-21";
    if (this.database.prepare("SELECT 1 FROM app_migrations WHERE key=?").get(migrationKey)) return;
    const now = new Date().toISOString();
    const serialized = JSON.stringify(BUILT_IN_MARKET_PARSER_SPEC);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE room_groups SET parser_id=NULL").run();
      this.database.prepare("UPDATE parser_definitions SET deleted_at=? WHERE id<>?").run(now, "market-insight");
      this.database.prepare(
        "UPDATE parser_definitions SET name=?,description='',built_in=0,immutable_spec_json=?,deleted_at=NULL WHERE id=?",
      ).run(BUILT_IN_MARKET_PARSER_SPEC.name, serialized, "market-insight");
      this.database.prepare("UPDATE parser_versions SET spec_json=? WHERE parser_id=?").run(serialized, "market-insight");
      this.database.prepare("INSERT INTO app_migrations(key,applied_at) VALUES(?,?)").run(migrationKey, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  replaceSystemAnalyzer(input: ParserSpec): ImmutableParser {
    const spec = ParserSpecSchema.parse(input);
    const parserId = "market-insight";
    const now = new Date().toISOString();
    const current = this.database.prepare(
      "SELECT COALESCE(MAX(version),0) version FROM parser_versions WHERE parser_id=?",
    ).get(parserId) as { version: number };
    const nextVersion = Number(current.version) + 1;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare(
        "UPDATE parser_versions SET state='archived' WHERE parser_id=? AND state='published'",
      ).run(parserId);
      this.database.prepare(
        "DELETE FROM parser_versions WHERE parser_id=? AND state='draft'",
      ).run(parserId);
      const result = this.database.prepare(
        "INSERT INTO parser_versions(parser_id,version,state,spec_json,created_at,published_at) VALUES(?,?,'published',?,?,?)",
      ).run(parserId, nextVersion, JSON.stringify(spec), now, now);
      const versionId = Number(result.lastInsertRowid);
      this.database.prepare(
        "UPDATE parser_definitions SET name=?,description='',immutable_spec_json=?,deleted_at=NULL WHERE id=?",
      ).run(spec.name, JSON.stringify(spec), parserId);
      this.database.prepare(
        "UPDATE parser_definitions SET deleted_at=? WHERE id<>? AND deleted_at IS NULL",
      ).run(now, parserId);
      this.database.prepare(
        "UPDATE room_parser_bindings SET parser_version_id=?,updated_at=? WHERE parser_id=?",
      ).run(versionId, now, parserId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getImmutable(parserId)!;
  }

  createImmutable(input: ParserSpec): ImmutableParser {
    const spec = ParserSpecSchema.parse(input);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database.exec("SAVEPOINT immutable_parser");
    try {
      this.database
        .prepare(
          "INSERT INTO parser_definitions(id,name,description,built_in,immutable_spec_json,created_at) VALUES(?,?,?,0,?,?)",
        )
        .run(
          id,
          spec.name,
          "schemaVersion" in spec ? "" : spec.description,
          JSON.stringify(spec),
          now,
        );
      this.database
        .prepare(
          "INSERT INTO parser_versions(parser_id,version,state,spec_json,created_at,published_at) VALUES(?,1,'published',?,?,?)",
        )
        .run(id, JSON.stringify(spec), now, now);
      this.database.exec("RELEASE immutable_parser");
    } catch (error) {
      this.database.exec("ROLLBACK TO immutable_parser");
      this.database.exec("RELEASE immutable_parser");
      throw error;
    }
    return this.getImmutable(id)!;
  }

  copyImmutable(sourceId: string, input: ParserSpec): ImmutableParser {
    if (!this.getImmutable(sourceId)) throw new Error("PARSER_NOT_FOUND");
    return this.createImmutable(input);
  }

  listImmutable(): ImmutableParser[] {
    return (
      this.database
        .prepare(
          "SELECT id,immutable_spec_json,created_at,deleted_at FROM parser_definitions WHERE immutable_spec_json IS NOT NULL AND deleted_at IS NULL ORDER BY created_at,id",
        )
        .all() as Record<string, unknown>[]
    ).map(rowToImmutableParser);
  }

  getImmutable(id: string): ImmutableParser | undefined {
    const row = this.database
      .prepare(
        "SELECT id,immutable_spec_json,created_at,deleted_at FROM parser_definitions WHERE id=? AND immutable_spec_json IS NOT NULL",
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToImmutableParser(row) : undefined;
  }

  removeImmutable(id: string): void {
    if (!this.getImmutable(id)) throw new Error("PARSER_NOT_FOUND");
    const groups = this.database
      .prepare(
        "SELECT id,name FROM room_groups WHERE parser_id=? ORDER BY position",
      )
      .all(id) as Array<{ id: string; name: string }>;
    if (groups.length)
      throw new Error(
        `PARSER_IN_USE:${groups.map((group) => `${group.id}:${group.name}`).join(",")}`,
      );
    this.database
      .prepare("UPDATE parser_definitions SET deleted_at=? WHERE id=?")
      .run(new Date().toISOString(), id);
  }

  getForRoom(roomId: string): ImmutableParser | undefined {
    const row = this.database
      .prepare(
        `SELECT d.id,d.immutable_spec_json,d.created_at,d.deleted_at FROM rooms r JOIN room_groups g ON g.id=r.group_id
      JOIN parser_definitions d ON d.id=g.parser_id WHERE r.room_id=?`,
      )
      .get(roomId) as Record<string, unknown> | undefined;
    return row ? rowToImmutableParser(row) : undefined;
  }

  list(): ParserDefinition[] {
    const definitions = this.database
      .prepare(
        "SELECT * FROM parser_definitions ORDER BY built_in DESC, created_at",
      )
      .all() as Record<string, unknown>[];
    return definitions.map((definition) => {
      const versions = this.database
        .prepare(
          "SELECT * FROM parser_versions WHERE parser_id=? AND state IN ('published','draft') ORDER BY version",
        )
        .all(String(definition.id)) as Record<string, unknown>[];
      return ParserDefinitionSchema.parse({
        id: definition.id,
        name: definition.name,
        description: definition.description,
        builtIn: Boolean(definition.built_in),
        createdAt: definition.created_at,
        publishedVersion: versions.find(
          (version) => version.state === "published",
        )
          ? rowToParserVersion(
              versions.find((version) => version.state === "published")!,
            )
          : undefined,
        draftVersion: versions.find((version) => version.state === "draft")
          ? rowToParserVersion(
              versions.find((version) => version.state === "draft")!,
            )
          : undefined,
      });
    });
  }

  getVersion(versionId: number): ParserVersion | undefined {
    const row = this.database
      .prepare("SELECT * FROM parser_versions WHERE id=?")
      .get(versionId) as Record<string, unknown> | undefined;
    return row ? rowToParserVersion(row) : undefined;
  }

  createDraft(parserId: string): ParserVersion {
    const parser = this.list().find((item) => item.id === parserId);
    if (!parser?.publishedVersion) throw new Error("PARSER_NOT_FOUND");
    if (parser.draftVersion) throw new Error("PARSER_DRAFT_EXISTS");
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        "INSERT INTO parser_versions(parser_id,version,state,spec_json,created_at) VALUES(?,?,?,?,?)",
      )
      .run(
        parserId,
        parser.publishedVersion.version + 1,
        "draft",
        JSON.stringify(parser.publishedVersion.spec),
        now,
      );
    return ParserVersionSchema.parse({
      id: Number(result.lastInsertRowid),
      parserId,
      version: parser.publishedVersion.version + 1,
      state: "draft",
      spec: parser.publishedVersion.spec,
      createdAt: now,
    });
  }

  updateDraft(versionId: number, spec: ParserSpec): ParserVersion {
    const current = this.getVersion(versionId);
    if (!current || current.state !== "draft")
      throw new Error("PARSER_VERSION_NOT_DRAFT");
    const parsed = ParserSpecSchema.parse(spec);
    this.database
      .prepare("UPDATE parser_versions SET spec_json=? WHERE id=?")
      .run(JSON.stringify(parsed), versionId);
    this.database
      .prepare("UPDATE parser_definitions SET name=?,description=? WHERE id=?")
      .run(
        parsed.name,
        "schemaVersion" in parsed ? "" : parsed.description,
        current.parserId,
      );
    return { ...current, spec: parsed };
  }

  publish(parserId: string, versionId: number): ParserVersion {
    const draft = this.getVersion(versionId);
    if (!draft || draft.parserId !== parserId || draft.state !== "draft")
      throw new Error("PARSER_VERSION_NOT_DRAFT");
    const publishedAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          "UPDATE parser_versions SET state='archived' WHERE parser_id=? AND state='published'",
        )
        .run(parserId);
      this.database
        .prepare(
          "UPDATE parser_versions SET state='published',published_at=? WHERE id=?",
        )
        .run(publishedAt, versionId);
      this.database
        .prepare(
          "UPDATE room_parser_bindings SET parser_version_id=?,updated_at=? WHERE parser_id=?",
        )
        .run(versionId, publishedAt, parserId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return ParserVersionSchema.parse({
      ...draft,
      state: "published",
      publishedAt,
    });
  }

  removeDraft(parserId: string): void {
    this.database
      .prepare(
        "DELETE FROM parser_versions WHERE parser_id=? AND state='draft'",
      )
      .run(parserId);
  }

  bindRoom(
    roomId: string,
    parserId: string | null,
    parserVersionId: number | null,
  ): RoomParserBinding | undefined {
    if (!parserId || !parserVersionId) {
      this.database
        .prepare("DELETE FROM room_parser_bindings WHERE room_id=?")
        .run(roomId);
      return undefined;
    }
    const version = this.getVersion(parserVersionId);
    if (
      !version ||
      version.parserId !== parserId ||
      version.state !== "published"
    )
      throw new Error("PARSER_VERSION_NOT_PUBLISHED");
    const updatedAt = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO room_parser_bindings(room_id,parser_id,parser_version_id,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(room_id) DO UPDATE SET parser_id=excluded.parser_id,parser_version_id=excluded.parser_version_id,updated_at=excluded.updated_at`,
      )
      .run(roomId, parserId, parserVersionId, updatedAt);
    return RoomParserBindingSchema.parse({
      roomId,
      parserId,
      parserVersionId,
      updatedAt,
    });
  }

  getBinding(roomId: string): RoomParserBinding | undefined {
    const row = this.database
      .prepare("SELECT * FROM room_parser_bindings WHERE room_id=?")
      .get(roomId) as Record<string, unknown> | undefined;
    return row ? rowToBinding(row) : undefined;
  }

  listBindings(): RoomParserBinding[] {
    return (
      this.database
        .prepare("SELECT * FROM room_parser_bindings ORDER BY room_id")
        .all() as Record<string, unknown>[]
    ).map(rowToBinding);
  }
}

export class SqliteInsightRepository {
  constructor(private readonly database: DatabaseSync) {}

  insert(input: Omit<MarketInsight, "id">): MarketInsight {
    const parsed = MarketInsightSchema.omit({ id: true }).parse(input);
    const result = this.database
      .prepare(
        `INSERT INTO market_insights(room_id,parser_id,parser_version_id,nature,subject_kind,subject_original,subject_normalized,direction,summary,rationale,conditions_json,evidence_json,source_asr_ids_json,started_at,ended_at,confidence,alert_level,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        parsed.roomId,
        parsed.parserId,
        parsed.parserVersionId,
        parsed.nature,
        parsed.subjectKind,
        parsed.subjectOriginal,
        parsed.subjectNormalized ?? null,
        parsed.direction,
        parsed.summary,
        parsed.rationale,
        JSON.stringify(parsed.conditions),
        JSON.stringify(parsed.evidence),
        JSON.stringify(parsed.sourceAsrIds),
        parsed.startedAt,
        parsed.endedAt,
        parsed.confidence,
        parsed.alertLevel,
        parsed.createdAt,
      );
    return MarketInsightSchema.parse({
      ...parsed,
      id: Number(result.lastInsertRowid),
    });
  }

  hasDuplicate(
    candidate: Pick<
      MarketInsight,
      | "roomId"
      | "parserVersionId"
      | "nature"
      | "subjectOriginal"
      | "direction"
      | "summary"
      | "sourceAsrIds"
    >,
  ): boolean {
    return this.list({ roomId: candidate.roomId, limit: 100 }).items.some(
      (existing) => {
        if (existing.parserVersionId !== candidate.parserVersionId)
          return false;
        if (existing.summary === candidate.summary) return true;
        if (
          existing.nature !== candidate.nature ||
          existing.subjectOriginal !== candidate.subjectOriginal ||
          existing.direction !== candidate.direction
        )
          return false;
        return candidate.sourceAsrIds.some((id) =>
          existing.sourceAsrIds.includes(id),
        );
      },
    );
  }

  list(options: {
    roomId?: string;
    limit: number;
    beforeId?: number;
  }): InsightPage {
    const limit = Math.max(1, Math.min(options.limit, 100));
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.roomId) {
      clauses.push("room_id=?");
      params.push(options.roomId);
    }
    if (options.beforeId) {
      clauses.push("id<?");
      params.push(options.beforeId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database
      .prepare(
        `SELECT * FROM market_insights ${where} ORDER BY id DESC LIMIT ?`,
      )
      .all(...params, limit) as Record<string, unknown>[];
    const items = rows.map(rowToInsight);
    return {
      items,
      ...(items.length === limit ? { nextCursor: items.at(-1)!.id } : {}),
    };
  }
}

export class SqliteContentRecordRepository {
  constructor(private readonly database: DatabaseSync) {}

  insert(input: Omit<ContentRecord, "id">): ContentRecord {
    const parsed = ContentRecordSchema.omit({ id: true }).parse(input);
    const result = this.database.prepare(
      `INSERT INTO content_records(room_id,parser_id,parser_version_id,result_type_id,result_type_label,title,summary,fields_json,evidence_json,source_asr_ids_json,started_at,ended_at,confidence,alert_level,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      parsed.roomId,
      parsed.parserId,
      parsed.parserVersionId,
      parsed.resultTypeId,
      parsed.resultTypeLabel,
      parsed.title,
      parsed.summary,
      JSON.stringify(parsed.fields),
      JSON.stringify(parsed.evidence),
      JSON.stringify(parsed.sourceAsrIds),
      parsed.startedAt,
      parsed.endedAt,
      parsed.confidence,
      parsed.alertLevel,
      parsed.createdAt,
    );
    return ContentRecordSchema.parse({
      ...parsed,
      id: Number(result.lastInsertRowid),
    });
  }

  hasDuplicate(candidate: Pick<ContentRecord, "roomId" | "parserVersionId" | "resultTypeId" | "title" | "sourceAsrIds">): boolean {
    return this.list({ roomId: candidate.roomId, limit: 100 }).items.some(
      (existing) =>
        existing.parserVersionId === candidate.parserVersionId &&
        (existing.title === candidate.title ||
          (existing.resultTypeId === candidate.resultTypeId &&
            candidate.sourceAsrIds.some((id) => existing.sourceAsrIds.includes(id)))),
    );
  }

  list(options: { roomId?: string; limit: number; beforeId?: number }): ContentRecordPage {
    const limit = Math.max(1, Math.min(options.limit, 100));
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.roomId) {
      clauses.push("room_id=?");
      params.push(options.roomId);
    }
    if (options.beforeId) {
      clauses.push("id<?");
      params.push(options.beforeId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database.prepare(
      `SELECT * FROM content_records ${where} ORDER BY id DESC LIMIT ?`,
    ).all(...params, limit) as Record<string, unknown>[];
    const items = rows.map(rowToContentRecord);
    return {
      items,
      ...(items.length === limit ? { nextCursor: items.at(-1)!.id } : {}),
    };
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function rowToSnapshot(row: Record<string, unknown>): RoomSnapshot {
  return RoomSnapshotSchema.parse({
    roomId: row.room_id,
    status: row.status,
    title: row.title ?? undefined,
    anchorName: row.anchor_name ?? undefined,
    coverPath: row.cover_path ?? undefined,
    avatarPath: row.avatar_path ?? undefined,
    liveDescription: row.live_description ?? undefined,
    viewerCount: optionalNumber(row.viewer_count),
    followerCount: optionalNumber(row.follower_count),
    totalViewerCount: optionalNumber(row.total_viewer_count),
    likeCount: optionalNumber(row.like_count),
    metricRaw: row.metric_raw_json
      ? JSON.parse(String(row.metric_raw_json))
      : undefined,
    metricEvidence: row.metric_evidence_json
      ? JSON.parse(String(row.metric_evidence_json))
      : undefined,
    metricQuality: row.metric_quality ?? undefined,
    lastReliableStatus: row.last_reliable_status ?? undefined,
    lastReliableStatusAt: row.last_reliable_status_at ?? undefined,
    metricsObservedAt: row.metrics_observed_at ?? undefined,
    checkedAt: row.checked_at,
    error: row.error ?? undefined,
  });
}

function rowToObservation(row: Record<string, unknown>): RoomSnapshot {
  return RoomSnapshotSchema.parse({
    roomId: row.room_id,
    status: row.status,
    viewerCount: optionalNumber(row.viewer_count),
    followerCount: optionalNumber(row.follower_count),
    totalViewerCount: optionalNumber(row.total_viewer_count),
    likeCount: optionalNumber(row.like_count),
    metricRaw: row.metric_raw_json
      ? JSON.parse(String(row.metric_raw_json))
      : undefined,
    metricEvidence: row.metric_evidence_json
      ? JSON.parse(String(row.metric_evidence_json))
      : undefined,
    metricQuality: row.metric_quality ?? undefined,
    checkedAt: row.checked_at,
    error: row.error ?? undefined,
  });
}

function encodeSchedule(schedule: Room["schedule"]): string | null {
  return schedule ? JSON.stringify(schedule) : null;
}

function rowToRoom(row: Record<string, unknown>): Room {
  return RoomSchema.parse({
    roomId: row.room_id,
    canonicalUrl: row.canonical_url,
    schedule: row.schedule_json ? JSON.parse(String(row.schedule_json)) : null,
    monitoring: Boolean(row.monitoring),
    autoMonitorOnLive: Boolean(row.auto_monitor_on_live),
    groupId: row.group_id,
    positionInGroup: Number(row.position_in_group),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function rowToAsr(row: Record<string, unknown>): StoredAsrEvent {
  return {
    id: Number(row.id),
    roomId: String(row.room_id),
    sessionId: String(row.session_id),
    segmentId: String(row.segment_id),
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    text: String(row.text),
    isFinal: true,
    occurredAt: String(row.occurred_at),
  };
}

function rowToParserVersion(row: Record<string, unknown>): ParserVersion {
  return ParserVersionSchema.parse({
    id: Number(row.id),
    parserId: row.parser_id,
    version: Number(row.version),
    state: row.state,
    spec: JSON.parse(String(row.spec_json)),
    createdAt: row.created_at,
    publishedAt: row.published_at ?? undefined,
  });
}

function rowToImmutableParser(row: Record<string, unknown>): ImmutableParser {
  return ImmutableParserSchema.parse({
    id: row.id,
    spec: JSON.parse(String(row.immutable_spec_json)),
    createdAt: row.created_at,
    deletedAt: row.deleted_at ?? undefined,
  });
}

function rowToBinding(row: Record<string, unknown>): RoomParserBinding {
  return RoomParserBindingSchema.parse({
    roomId: row.room_id,
    parserId: row.parser_id,
    parserVersionId: Number(row.parser_version_id),
    updatedAt: row.updated_at,
  });
}

function rowToInsight(row: Record<string, unknown>): MarketInsight {
  return MarketInsightSchema.parse({
    id: Number(row.id),
    roomId: row.room_id,
    parserId: row.parser_id,
    parserVersionId: Number(row.parser_version_id),
    nature: row.nature,
    subjectKind: row.subject_kind,
    subjectOriginal: row.subject_original,
    subjectNormalized: row.subject_normalized ?? undefined,
    direction: row.direction,
    summary: row.summary,
    rationale: row.rationale,
    conditions: JSON.parse(String(row.conditions_json)),
    evidence: JSON.parse(String(row.evidence_json)),
    sourceAsrIds: JSON.parse(String(row.source_asr_ids_json)),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    confidence: Number(row.confidence),
    alertLevel: row.alert_level,
    createdAt: row.created_at,
  });
}

function rowToContentRecord(row: Record<string, unknown>): ContentRecord {
  return ContentRecordSchema.parse({
    id: row.id,
    roomId: row.room_id,
    parserId: row.parser_id,
    parserVersionId: row.parser_version_id,
    resultTypeId: row.result_type_id,
    resultTypeLabel: row.result_type_label,
    title: row.title,
    summary: row.summary,
    fields: JSON.parse(String(row.fields_json)),
    evidence: JSON.parse(String(row.evidence_json)),
    sourceAsrIds: JSON.parse(String(row.source_asr_ids_json)),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    confidence: row.confidence,
    alertLevel: row.alert_level,
    createdAt: row.created_at,
  });
}
