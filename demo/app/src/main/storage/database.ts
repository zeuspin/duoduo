import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { MarketInsightSchema, ParserDefinitionSchema, ParserSpecSchema, ParserTestRunSchema, ParserVersionSchema, RoomInputSchema, RoomParserBindingSchema, RoomSchema, RoomSnapshotSchema, normalizeDouyinUrl, type AsrEvent, type MarketInsight, type ParserDefinition, type ParserSpec, type ParserTestRun, type ParserVersion, type Room, type RoomInput, type RoomParserBinding, type RoomSnapshot } from "../../shared/contracts";
import { DataMaintenance } from "./data-maintenance";

export interface StoredAsrEvent extends AsrEvent {
  occurredAt: string;
  id: number;
}

export interface AsrPage {
  items: StoredAsrEvent[];
  nextCursor?: number;
}

export interface InsightPage { items: MarketInsight[]; nextCursor?: number }

export const BUILT_IN_MARKET_PARSER_SPEC: ParserSpec = ParserSpecSchema.parse({
  name: "市场观点与情绪提炼",
  description: "提炼板块方向、大盘指标、量价资金、市场情绪、条件判断和风险信号",
  objectives: ["sector_direction", "market_indicator", "volume_and_funds", "market_sentiment", "conditional_view", "risk_signal"],
  filters: ["greeting", "audience_question", "unendorsed_quote", "advertising", "unsupported_sentiment", "duplicate_view"],
  normalization: "suggest",
  model: "qwen-plus",
  advancedPrompt: "",
});

export class DuoduoDatabase {
  readonly rooms: SqliteRoomRepository;
  readonly asr: SqliteAsrRepository;
  readonly snapshots: SqliteSnapshotRepository;
  readonly parsers: SqliteParserRepository;
  readonly insights: SqliteInsightRepository;
  readonly parserTests: SqliteParserTestRepository;
  readonly maintenance: DataMaintenance;

  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        canonical_url TEXT NOT NULL,
        schedule_json TEXT,
        probe_interval_minutes INTEGER,
        monitoring INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
        viewer_count INTEGER,
        follower_count INTEGER,
        total_viewer_count INTEGER,
        like_count INTEGER,
        metric_raw_json TEXT,
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
      CREATE TABLE IF NOT EXISTS parser_test_runs (
        id TEXT PRIMARY KEY,
        parser_id TEXT NOT NULL REFERENCES parser_definitions(id),
        published_version_id INTEGER NOT NULL REFERENCES parser_versions(id),
        draft_version_id INTEGER NOT NULL REFERENCES parser_versions(id),
        room_id TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        sample_asr_ids_json TEXT NOT NULL,
        status TEXT NOT NULL,
        published_results_json TEXT NOT NULL DEFAULT '[]',
        draft_results_json TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
    `);
    for (const column of [
      "avatar_path TEXT", "viewer_count INTEGER", "follower_count INTEGER", "total_viewer_count INTEGER",
      "like_count INTEGER", "metric_raw_json TEXT", "metric_quality TEXT",
    ]) {
      try { this.database.exec(`ALTER TABLE room_snapshots ADD COLUMN ${column}`); } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
      }
    }
    this.rooms = new SqliteRoomRepository(this.database);
    this.asr = new SqliteAsrRepository(this.database);
    this.snapshots = new SqliteSnapshotRepository(this.database);
    this.parsers = new SqliteParserRepository(this.database);
    this.insights = new SqliteInsightRepository(this.database);
    this.parserTests = new SqliteParserTestRepository(this.database);
    this.maintenance = new DataMaintenance(this.database);
    this.parsers.ensureBuiltIn();
  }

  async migrateLegacyRooms(path: string): Promise<void> {
    if ((await this.rooms.list()).length > 0) return;
    try {
      const legacy = RoomSchema.array().parse(JSON.parse(await readFile(path, "utf8")));
      for (const room of legacy) this.rooms.insertExisting(room);
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
      this.database.exec(`
        INSERT OR IGNORE INTO rooms SELECT * FROM imported.rooms;
        INSERT OR IGNORE INTO room_snapshots SELECT * FROM imported.room_snapshots;
        INSERT INTO room_observations(room_id,status,viewer_count,follower_count,total_viewer_count,like_count,metric_raw_json,metric_quality,checked_at,error)
          SELECT i.room_id,i.status,i.viewer_count,i.follower_count,i.total_viewer_count,i.like_count,i.metric_raw_json,i.metric_quality,i.checked_at,i.error FROM imported.room_observations i
          WHERE NOT EXISTS (SELECT 1 FROM room_observations x WHERE x.room_id=i.room_id AND x.checked_at=i.checked_at AND x.status=i.status);
        INSERT OR IGNORE INTO room_hourly_aggregates SELECT * FROM imported.room_hourly_aggregates;
        INSERT INTO live_sessions(room_id,status,previous_offline_at,first_live_at,last_live_at,first_offline_at,peak_viewer_count,average_viewer_count,unknown_since,unknown_count)
          SELECT i.room_id,i.status,i.previous_offline_at,i.first_live_at,i.last_live_at,i.first_offline_at,i.peak_viewer_count,i.average_viewer_count,i.unknown_since,i.unknown_count FROM imported.live_sessions i
          WHERE NOT EXISTS (SELECT 1 FROM live_sessions x WHERE x.room_id=i.room_id AND x.first_live_at=i.first_live_at);
        INSERT OR IGNORE INTO asr_segments SELECT * FROM imported.asr_segments;
      `);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    finally { this.database.exec("DETACH DATABASE imported"); }
  }
}

class SqliteRoomRepository {
  constructor(private readonly database: DatabaseSync) {}

  async list(): Promise<Room[]> {
    const rows = this.database.prepare("SELECT * FROM rooms ORDER BY created_at").all() as Record<string, unknown>[];
    return rows.map(rowToRoom);
  }

  async add(input: RoomInput): Promise<Room> {
    const parsed = RoomInputSchema.parse(input);
    const normalized = normalizeDouyinUrl(parsed.url);
    if (this.database.prepare("SELECT 1 FROM rooms WHERE room_id = ?").get(normalized.roomId)) throw new Error("ROOM_EXISTS");
    const now = new Date().toISOString();
    const room = RoomSchema.parse({ ...normalized, schedule: parsed.schedule, probeIntervalMinutes: parsed.probeIntervalMinutes, monitoring: false, createdAt: now, updatedAt: now });
    this.insertExisting(room);
    return room;
  }

  async update(roomId: string, input: RoomInput): Promise<Room> {
    const parsed = RoomInputSchema.parse(input);
    const normalized = normalizeDouyinUrl(parsed.url);
    if (normalized.roomId !== roomId) throw new Error("ROOM_ID_IMMUTABLE");
    const existing = this.database.prepare("SELECT * FROM rooms WHERE room_id = ?").get(roomId) as Record<string, unknown> | undefined;
    if (!existing) throw new Error("ROOM_NOT_FOUND");
    const updated = RoomSchema.parse({ ...rowToRoom(existing), canonicalUrl: normalized.canonicalUrl, schedule: parsed.schedule, probeIntervalMinutes: parsed.probeIntervalMinutes, updatedAt: new Date().toISOString() });
    this.database.prepare("UPDATE rooms SET canonical_url=?, schedule_json=?, probe_interval_minutes=?, updated_at=? WHERE room_id=?").run(updated.canonicalUrl, encodeSchedule(updated.schedule), updated.probeIntervalMinutes, updated.updatedAt, roomId);
    return updated;
  }

  async remove(roomId: string): Promise<void> {
    this.database.prepare("DELETE FROM rooms WHERE room_id = ?").run(roomId);
  }

  async setMonitoring(roomId: string, monitoring: boolean): Promise<Room> {
    const existing = this.database.prepare("SELECT * FROM rooms WHERE room_id = ?").get(roomId) as Record<string, unknown> | undefined;
    if (!existing) throw new Error("ROOM_NOT_FOUND");
    const updatedAt = new Date().toISOString();
    this.database.prepare("UPDATE rooms SET monitoring=?, updated_at=? WHERE room_id=?").run(monitoring ? 1 : 0, updatedAt, roomId);
    return RoomSchema.parse({ ...rowToRoom(existing), monitoring, updatedAt });
  }

  insertExisting(room: Room): void {
    this.database.prepare("INSERT OR IGNORE INTO rooms(room_id,canonical_url,schedule_json,probe_interval_minutes,monitoring,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(room.roomId, room.canonicalUrl, encodeSchedule(room.schedule), room.probeIntervalMinutes, room.monitoring ? 1 : 0, room.createdAt, room.updatedAt);
  }
}

class SqliteAsrRepository {
  constructor(private readonly database: DatabaseSync) {}

  insert(event: Omit<StoredAsrEvent, "id">): StoredAsrEvent | undefined {
    if (!event.isFinal) return undefined;
    this.database.prepare("INSERT OR IGNORE INTO asr_segments(room_id,session_id,segment_id,start_ms,end_ms,text,occurred_at) VALUES(?,?,?,?,?,?,?)").run(event.roomId, event.sessionId, event.segmentId, event.startMs, event.endMs, event.text, event.occurredAt);
    const row = this.database.prepare("SELECT * FROM asr_segments WHERE room_id=? AND session_id=? AND segment_id=?").get(event.roomId, event.sessionId, event.segmentId) as Record<string, unknown>;
    return rowToAsr(row);
  }

  listBefore(roomId: string, options: { limit: number; beforeId?: number }): AsrPage {
    const limit = Math.max(1, Math.min(options.limit, 100));
    const rows = (options.beforeId
      ? this.database.prepare("SELECT * FROM asr_segments WHERE room_id=? AND id<? ORDER BY id DESC LIMIT ?").all(roomId, options.beforeId, limit)
      : this.database.prepare("SELECT * FROM asr_segments WHERE room_id=? ORDER BY id DESC LIMIT ?").all(roomId, limit)) as Record<string, unknown>[];
    rows.reverse();
    const items = rows.map(rowToAsr);
    return { items, ...(items.length === limit ? { nextCursor: items[0].id } : {}) };
  }
}

class SqliteSnapshotRepository {
  constructor(private readonly database: DatabaseSync) {}

  upsert(snapshot: RoomSnapshot): void {
    const parsed = RoomSnapshotSchema.parse(snapshot);
    const existing = this.database.prepare("SELECT * FROM room_snapshots WHERE room_id=?").get(parsed.roomId) as Record<string, unknown> | undefined;
    this.database.prepare(`INSERT INTO room_snapshots(room_id,status,title,anchor_name,cover_path,avatar_path,viewer_count,follower_count,total_viewer_count,like_count,metric_raw_json,metric_quality,checked_at,error)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(room_id) DO UPDATE SET status=excluded.status,title=excluded.title,anchor_name=excluded.anchor_name,cover_path=excluded.cover_path,avatar_path=excluded.avatar_path,viewer_count=excluded.viewer_count,follower_count=excluded.follower_count,total_viewer_count=excluded.total_viewer_count,like_count=excluded.like_count,metric_raw_json=excluded.metric_raw_json,metric_quality=excluded.metric_quality,checked_at=excluded.checked_at,error=excluded.error`).run(
      parsed.roomId,
      parsed.status,
      parsed.title ?? optionalString(existing?.title),
      parsed.anchorName ?? optionalString(existing?.anchor_name),
      parsed.coverPath ?? optionalString(existing?.cover_path),
      parsed.avatarPath ?? optionalString(existing?.avatar_path),
      parsed.viewerCount ?? null,
      parsed.followerCount ?? null,
      parsed.totalViewerCount ?? null,
      parsed.likeCount ?? null,
      parsed.metricRaw ? JSON.stringify(parsed.metricRaw) : null,
      parsed.metricQuality ?? null,
      parsed.checkedAt,
      parsed.error ?? null,
    );
  }

  list(): RoomSnapshot[] {
    const rows = this.database.prepare("SELECT * FROM room_snapshots ORDER BY room_id").all() as Record<string, unknown>[];
    return rows.map(rowToSnapshot);
  }

  record(snapshot: RoomSnapshot): void {
    const parsed = RoomSnapshotSchema.parse(snapshot);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.upsert(parsed);
      this.database.prepare(`INSERT INTO room_observations(room_id,status,viewer_count,follower_count,total_viewer_count,like_count,metric_raw_json,metric_quality,checked_at,error) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        parsed.roomId, parsed.status, parsed.viewerCount ?? null, parsed.followerCount ?? null, parsed.totalViewerCount ?? null, parsed.likeCount ?? null, parsed.metricRaw ? JSON.stringify(parsed.metricRaw) : null, parsed.metricQuality ?? null, parsed.checkedAt, parsed.error ?? null,
      );
      this.updateSession(parsed);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  listHistory(roomId: string, limit: number): RoomSnapshot[] {
    const rows = this.database.prepare("SELECT * FROM room_observations WHERE room_id=? ORDER BY checked_at LIMIT ?").all(roomId, Math.max(1, Math.min(limit, 1000))) as Record<string, unknown>[];
    return rows.map(rowToObservation);
  }

  listSessions(roomId: string): Array<Record<string, unknown>> {
    return (this.database.prepare("SELECT * FROM live_sessions WHERE room_id=? ORDER BY first_live_at").all(roomId) as Record<string, unknown>[]).map((row) => ({
      id: Number(row.id), roomId: String(row.room_id), status: String(row.status), previousOfflineAt: optionalString(row.previous_offline_at), firstLiveAt: String(row.first_live_at), lastLiveAt: String(row.last_live_at), firstOfflineAt: optionalString(row.first_offline_at), peakViewerCount: optionalNumber(row.peak_viewer_count), averageViewerCount: optionalNumber(row.average_viewer_count),
    }));
  }

  private updateSession(snapshot: RoomSnapshot): void {
    const active = this.database.prepare("SELECT * FROM live_sessions WHERE room_id=? AND status!='ended' ORDER BY id DESC LIMIT 1").get(snapshot.roomId) as Record<string, unknown> | undefined;
    if (snapshot.status === "live") {
      if (!active) {
        const previous = this.database.prepare("SELECT checked_at FROM room_observations WHERE room_id=? AND status='offline' AND checked_at<? ORDER BY checked_at DESC LIMIT 1").get(snapshot.roomId, snapshot.checkedAt) as Record<string, unknown> | undefined;
        this.database.prepare("INSERT INTO live_sessions(room_id,status,previous_offline_at,first_live_at,last_live_at,peak_viewer_count,average_viewer_count) VALUES(?,?,?,?,?,?,?)").run(snapshot.roomId, "live", optionalString(previous?.checked_at), snapshot.checkedAt, snapshot.checkedAt, snapshot.viewerCount ?? null, snapshot.viewerCount ?? null);
      } else {
        const stats = this.database.prepare("SELECT MAX(viewer_count) peak, AVG(viewer_count) average FROM room_observations WHERE room_id=? AND status='live' AND checked_at>=?").get(snapshot.roomId, String(active.first_live_at)) as Record<string, unknown>;
        this.database.prepare("UPDATE live_sessions SET status='live',last_live_at=?,peak_viewer_count=?,average_viewer_count=?,unknown_since=NULL,unknown_count=0 WHERE id=?").run(snapshot.checkedAt, optionalNumber(stats.peak) ?? null, optionalNumber(stats.average) ?? null, Number(active.id));
      }
      return;
    }
    if (!active) return;
    if (snapshot.status === "offline") {
      this.database.prepare("UPDATE live_sessions SET status='ended',first_offline_at=?,unknown_since=NULL,unknown_count=0 WHERE id=?").run(snapshot.checkedAt, Number(active.id));
      return;
    }
    const count = Number(active.unknown_count ?? 0) + 1;
    const since = optionalString(active.unknown_since) ?? snapshot.checkedAt;
    const elapsed = Date.parse(snapshot.checkedAt) - Date.parse(since);
    this.database.prepare("UPDATE live_sessions SET status=?,unknown_since=?,unknown_count=? WHERE id=?").run(count >= 3 && elapsed >= 600_000 ? "end_pending" : String(active.status), since, count, Number(active.id));
  }
}

export class SqliteParserRepository {
  constructor(private readonly database: DatabaseSync) {}

  ensureBuiltIn(): void {
    const now = new Date().toISOString();
    this.database.prepare("INSERT OR IGNORE INTO parser_definitions(id,name,description,built_in,created_at) VALUES(?,?,?,?,?)").run("market-insight", BUILT_IN_MARKET_PARSER_SPEC.name, BUILT_IN_MARKET_PARSER_SPEC.description, 1, now);
    const exists = this.database.prepare("SELECT 1 FROM parser_versions WHERE parser_id=?").get("market-insight");
    if (!exists) this.database.prepare("INSERT INTO parser_versions(parser_id,version,state,spec_json,created_at,published_at) VALUES(?,?,?,?,?,?)").run("market-insight", 1, "published", JSON.stringify(BUILT_IN_MARKET_PARSER_SPEC), now, now);
  }

  list(): ParserDefinition[] {
    const definitions = this.database.prepare("SELECT * FROM parser_definitions ORDER BY built_in DESC, created_at").all() as Record<string, unknown>[];
    return definitions.map((definition) => {
      const versions = this.database.prepare("SELECT * FROM parser_versions WHERE parser_id=? AND state IN ('published','draft') ORDER BY version").all(String(definition.id)) as Record<string, unknown>[];
      return ParserDefinitionSchema.parse({
        id: definition.id, name: definition.name, description: definition.description, builtIn: Boolean(definition.built_in), createdAt: definition.created_at,
        publishedVersion: versions.find((version) => version.state === "published") ? rowToParserVersion(versions.find((version) => version.state === "published")!) : undefined,
        draftVersion: versions.find((version) => version.state === "draft") ? rowToParserVersion(versions.find((version) => version.state === "draft")!) : undefined,
      });
    });
  }

  getVersion(versionId: number): ParserVersion | undefined {
    const row = this.database.prepare("SELECT * FROM parser_versions WHERE id=?").get(versionId) as Record<string, unknown> | undefined;
    return row ? rowToParserVersion(row) : undefined;
  }

  createDraft(parserId: string): ParserVersion {
    const parser = this.list().find((item) => item.id === parserId);
    if (!parser?.publishedVersion) throw new Error("PARSER_NOT_FOUND");
    if (parser.draftVersion) throw new Error("PARSER_DRAFT_EXISTS");
    const now = new Date().toISOString();
    const result = this.database.prepare("INSERT INTO parser_versions(parser_id,version,state,spec_json,created_at) VALUES(?,?,?,?,?)").run(parserId, parser.publishedVersion.version + 1, "draft", JSON.stringify(parser.publishedVersion.spec), now);
    return ParserVersionSchema.parse({ id: Number(result.lastInsertRowid), parserId, version: parser.publishedVersion.version + 1, state: "draft", spec: parser.publishedVersion.spec, createdAt: now });
  }

  updateDraft(versionId: number, spec: ParserSpec): ParserVersion {
    const current = this.getVersion(versionId);
    if (!current || current.state !== "draft") throw new Error("PARSER_VERSION_NOT_DRAFT");
    const parsed = ParserSpecSchema.parse(spec);
    this.database.prepare("UPDATE parser_versions SET spec_json=? WHERE id=?").run(JSON.stringify(parsed), versionId);
    this.database.prepare("UPDATE parser_definitions SET name=?,description=? WHERE id=?").run(parsed.name, parsed.description, current.parserId);
    return { ...current, spec: parsed };
  }

  publish(parserId: string, versionId: number): ParserVersion {
    const draft = this.getVersion(versionId);
    if (!draft || draft.parserId !== parserId || draft.state !== "draft") throw new Error("PARSER_VERSION_NOT_DRAFT");
    const publishedAt = new Date().toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.prepare("UPDATE parser_versions SET state='archived' WHERE parser_id=? AND state='published'").run(parserId);
      this.database.prepare("UPDATE parser_versions SET state='published',published_at=? WHERE id=?").run(publishedAt, versionId);
      this.database.prepare("UPDATE room_parser_bindings SET parser_version_id=?,updated_at=? WHERE parser_id=?").run(versionId, publishedAt, parserId);
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
    return ParserVersionSchema.parse({ ...draft, state: "published", publishedAt });
  }

  removeDraft(parserId: string): void { this.database.prepare("DELETE FROM parser_versions WHERE parser_id=? AND state='draft'").run(parserId); }

  bindRoom(roomId: string, parserId: string | null, parserVersionId: number | null): RoomParserBinding | undefined {
    if (!parserId || !parserVersionId) { this.database.prepare("DELETE FROM room_parser_bindings WHERE room_id=?").run(roomId); return undefined; }
    const version = this.getVersion(parserVersionId);
    if (!version || version.parserId !== parserId || version.state !== "published") throw new Error("PARSER_VERSION_NOT_PUBLISHED");
    const updatedAt = new Date().toISOString();
    this.database.prepare(`INSERT INTO room_parser_bindings(room_id,parser_id,parser_version_id,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(room_id) DO UPDATE SET parser_id=excluded.parser_id,parser_version_id=excluded.parser_version_id,updated_at=excluded.updated_at`).run(roomId, parserId, parserVersionId, updatedAt);
    return RoomParserBindingSchema.parse({ roomId, parserId, parserVersionId, updatedAt });
  }

  getBinding(roomId: string): RoomParserBinding | undefined {
    const row = this.database.prepare("SELECT * FROM room_parser_bindings WHERE room_id=?").get(roomId) as Record<string, unknown> | undefined;
    return row ? rowToBinding(row) : undefined;
  }

  listBindings(): RoomParserBinding[] {
    return (this.database.prepare("SELECT * FROM room_parser_bindings ORDER BY room_id").all() as Record<string, unknown>[]).map(rowToBinding);
  }
}

export class SqliteInsightRepository {
  constructor(private readonly database: DatabaseSync) {}

  insert(input: Omit<MarketInsight, "id">): MarketInsight {
    const parsed = MarketInsightSchema.omit({ id: true }).parse(input);
    const result = this.database.prepare(`INSERT INTO market_insights(room_id,parser_id,parser_version_id,nature,subject_kind,subject_original,subject_normalized,direction,summary,rationale,conditions_json,evidence_json,source_asr_ids_json,started_at,ended_at,confidence,alert_level,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(parsed.roomId, parsed.parserId, parsed.parserVersionId, parsed.nature, parsed.subjectKind, parsed.subjectOriginal, parsed.subjectNormalized ?? null, parsed.direction, parsed.summary, parsed.rationale, JSON.stringify(parsed.conditions), JSON.stringify(parsed.evidence), JSON.stringify(parsed.sourceAsrIds), parsed.startedAt, parsed.endedAt, parsed.confidence, parsed.alertLevel, parsed.createdAt);
    return MarketInsightSchema.parse({ ...parsed, id: Number(result.lastInsertRowid) });
  }

  hasDuplicate(candidate: Pick<MarketInsight, "roomId" | "parserVersionId" | "nature" | "subjectOriginal" | "direction" | "summary" | "sourceAsrIds">): boolean {
    return this.list({ roomId: candidate.roomId, limit: 100 }).items.some((existing) => {
      if (existing.parserVersionId !== candidate.parserVersionId) return false;
      if (existing.summary === candidate.summary) return true;
      if (existing.nature !== candidate.nature || existing.subjectOriginal !== candidate.subjectOriginal || existing.direction !== candidate.direction) return false;
      return candidate.sourceAsrIds.some((id) => existing.sourceAsrIds.includes(id));
    });
  }

  list(options: { roomId?: string; limit: number; beforeId?: number }): InsightPage {
    const limit = Math.max(1, Math.min(options.limit, 100));
    const clauses: string[] = []; const params: Array<string | number> = [];
    if (options.roomId) { clauses.push("room_id=?"); params.push(options.roomId); }
    if (options.beforeId) { clauses.push("id<?"); params.push(options.beforeId); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database.prepare(`SELECT * FROM market_insights ${where} ORDER BY id DESC LIMIT ?`).all(...params, limit) as Record<string, unknown>[];
    const items = rows.map(rowToInsight);
    return { items, ...(items.length === limit ? { nextCursor: items.at(-1)!.id } : {}) };
  }
}

export class SqliteParserTestRepository {
  constructor(private readonly database: DatabaseSync) {}

  insert(run: ParserTestRun): ParserTestRun {
    const parsed = ParserTestRunSchema.parse(run);
    this.database.prepare(`INSERT INTO parser_test_runs(id,parser_id,published_version_id,draft_version_id,room_id,sample_asr_ids_json,status,published_results_json,draft_results_json,error,created_at,completed_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(parsed.id, parsed.parserId, parsed.publishedVersionId, parsed.draftVersionId, parsed.roomId, JSON.stringify(parsed.sampleAsrIds), parsed.status, JSON.stringify(parsed.publishedResults), JSON.stringify(parsed.draftResults), parsed.error ?? null, parsed.createdAt, parsed.completedAt ?? null);
    return parsed;
  }

  update(run: ParserTestRun): ParserTestRun {
    const parsed = ParserTestRunSchema.parse(run);
    this.database.prepare("UPDATE parser_test_runs SET status=?,published_results_json=?,draft_results_json=?,error=?,completed_at=? WHERE id=?").run(parsed.status, JSON.stringify(parsed.publishedResults), JSON.stringify(parsed.draftResults), parsed.error ?? null, parsed.completedAt ?? null, parsed.id);
    return parsed;
  }

  list(parserId?: string): ParserTestRun[] {
    const rows = (parserId ? this.database.prepare("SELECT * FROM parser_test_runs WHERE parser_id=? ORDER BY created_at DESC").all(parserId) : this.database.prepare("SELECT * FROM parser_test_runs ORDER BY created_at DESC").all()) as Record<string, unknown>[];
    return rows.map(rowToParserTestRun);
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
    roomId: row.room_id, status: row.status, title: row.title ?? undefined, anchorName: row.anchor_name ?? undefined,
    coverPath: row.cover_path ?? undefined, avatarPath: row.avatar_path ?? undefined,
    viewerCount: optionalNumber(row.viewer_count), followerCount: optionalNumber(row.follower_count), totalViewerCount: optionalNumber(row.total_viewer_count), likeCount: optionalNumber(row.like_count),
    metricRaw: row.metric_raw_json ? JSON.parse(String(row.metric_raw_json)) : undefined, metricQuality: row.metric_quality ?? undefined,
    checkedAt: row.checked_at, error: row.error ?? undefined,
  });
}

function rowToObservation(row: Record<string, unknown>): RoomSnapshot {
  return RoomSnapshotSchema.parse({
    roomId: row.room_id, status: row.status, viewerCount: optionalNumber(row.viewer_count), followerCount: optionalNumber(row.follower_count),
    totalViewerCount: optionalNumber(row.total_viewer_count), likeCount: optionalNumber(row.like_count),
    metricRaw: row.metric_raw_json ? JSON.parse(String(row.metric_raw_json)) : undefined, metricQuality: row.metric_quality ?? undefined,
    checkedAt: row.checked_at, error: row.error ?? undefined,
  });
}

function encodeSchedule(schedule: Room["schedule"]): string | null {
  return schedule ? JSON.stringify(schedule) : null;
}

function rowToRoom(row: Record<string, unknown>): Room {
  return RoomSchema.parse({ roomId: row.room_id, canonicalUrl: row.canonical_url, schedule: row.schedule_json ? JSON.parse(String(row.schedule_json)) : null, probeIntervalMinutes: row.probe_interval_minutes === null ? null : Number(row.probe_interval_minutes), monitoring: Boolean(row.monitoring), createdAt: row.created_at, updatedAt: row.updated_at });
}

function rowToAsr(row: Record<string, unknown>): StoredAsrEvent {
  return { id: Number(row.id), roomId: String(row.room_id), sessionId: String(row.session_id), segmentId: String(row.segment_id), startMs: Number(row.start_ms), endMs: Number(row.end_ms), text: String(row.text), isFinal: true, occurredAt: String(row.occurred_at) };
}

function rowToParserVersion(row: Record<string, unknown>): ParserVersion {
  return ParserVersionSchema.parse({ id: Number(row.id), parserId: row.parser_id, version: Number(row.version), state: row.state, spec: JSON.parse(String(row.spec_json)), createdAt: row.created_at, publishedAt: row.published_at ?? undefined });
}

function rowToBinding(row: Record<string, unknown>): RoomParserBinding {
  return RoomParserBindingSchema.parse({ roomId: row.room_id, parserId: row.parser_id, parserVersionId: Number(row.parser_version_id), updatedAt: row.updated_at });
}

function rowToInsight(row: Record<string, unknown>): MarketInsight {
  return MarketInsightSchema.parse({ id: Number(row.id), roomId: row.room_id, parserId: row.parser_id, parserVersionId: Number(row.parser_version_id), nature: row.nature, subjectKind: row.subject_kind, subjectOriginal: row.subject_original, subjectNormalized: row.subject_normalized ?? undefined, direction: row.direction, summary: row.summary, rationale: row.rationale, conditions: JSON.parse(String(row.conditions_json)), evidence: JSON.parse(String(row.evidence_json)), sourceAsrIds: JSON.parse(String(row.source_asr_ids_json)), startedAt: row.started_at, endedAt: row.ended_at, confidence: Number(row.confidence), alertLevel: row.alert_level, createdAt: row.created_at });
}

function rowToParserTestRun(row: Record<string, unknown>): ParserTestRun {
  return ParserTestRunSchema.parse({ id: row.id, parserId: row.parser_id, publishedVersionId: Number(row.published_version_id), draftVersionId: Number(row.draft_version_id), roomId: row.room_id, sampleAsrIds: JSON.parse(String(row.sample_asr_ids_json)), status: row.status, publishedResults: JSON.parse(String(row.published_results_json)), draftResults: JSON.parse(String(row.draft_results_json)), error: row.error ?? undefined, createdAt: row.created_at, completedAt: row.completed_at ?? undefined });
}
