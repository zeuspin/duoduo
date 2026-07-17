import type {
  RoomIntelligence,
  RoomIntelligenceSummary,
  RoomMetricPoint,
  RoomPeriodSummary,
  RoomSessionSummary,
  RoomSnapshot,
  TransparentLabel,
} from "../../shared/contracts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const HISTORY_LIMIT = 5_000;

export interface StoredLiveSession {
  id: number;
  roomId: string;
  status: "live" | "end_pending" | "ended";
  previousOfflineAt?: string;
  firstLiveAt: string;
  lastLiveAt: string;
  firstOfflineAt?: string;
  peakViewerCount?: number;
  averageViewerCount?: number;
}

export interface RoomIntelligenceRepository {
  listRoomIds(): Promise<string[]>;
  listSnapshots(): RoomSnapshot[];
  listHistorySince(roomId: string, since: string, limit: number): RoomSnapshot[];
  listSessions(roomId: string): StoredLiveSession[];
}

function compactCount(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function mean(values: number[]): number | undefined {
  if (!values.length) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function inWindow(value: string, start: number, end: number): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= start && timestamp < end;
}

function viewerAverage(sessions: StoredLiveSession[], start: number, end: number): { average?: number; count: number } {
  const values = sessions
    .filter((session) => inWindow(session.firstLiveAt, start, end))
    .map((session) => session.averageViewerCount)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return { average: mean(values), count: values.length };
}

function observedDurationMinutes(session: StoredLiveSession): number | undefined {
  if (!session.firstOfflineAt) return undefined;
  const duration = Date.parse(session.firstOfflineAt) - Date.parse(session.firstLiveAt);
  return Number.isFinite(duration) && duration >= 0 ? duration / 60_000 : undefined;
}

function localDayKey(value: string): string {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function audienceScaleLabel(followerCount?: number, observedAt?: string): TransparentLabel | undefined {
  if (followerCount === undefined || followerCount < 100_000) return undefined;
  const text = followerCount >= 10_000_000
    ? "千万级粉丝"
    : followerCount >= 1_000_000
      ? "百万级粉丝"
      : "十万级粉丝";
  return {
    kind: "audience_scale",
    text,
    explanation: `最近一次采集到 ${compactCount(followerCount)} 名关注者；标签仅按公开阈值划分。`,
    observedAt,
    sampleCount: 1,
  };
}

interface RoomEvidence {
  sessions: StoredLiveSession[];
  recent: { average?: number; count: number };
  prior: { average?: number; count: number };
}

interface IntelligenceContext {
  now: number;
  nowIso: string;
  roomIds: string[];
  snapshotByRoom: Map<string, RoomSnapshot>;
  evidenceByRoom: Map<string, RoomEvidence>;
  comparisonCount: number;
  topQuartileRoomIds: Set<string>;
}

export class RoomIntelligenceService {
  constructor(private readonly repository: RoomIntelligenceRepository) {}

  async listSummaries(nowIso = new Date().toISOString()): Promise<RoomIntelligenceSummary[]> {
    const context = await this.context(nowIso);
    return context.roomIds.map((roomId) => this.summaryFor(roomId, context).summary);
  }

  async getDetails(roomId: string, nowIso = new Date().toISOString()): Promise<RoomIntelligence> {
    const context = await this.context(nowIso);
    if (!context.evidenceByRoom.has(roomId)) throw new Error("ROOM_NOT_FOUND");
    const { summary, allLabels } = this.summaryFor(roomId, context);
    const evidence = context.evidenceByRoom.get(roomId)!;
    const history = this.repository.listHistorySince(roomId, new Date(context.now - 30 * DAY_MS).toISOString(), HISTORY_LIMIT);
    return {
      ...summary,
      allLabels,
      sevenDay: this.periodSummary(7, history, evidence.sessions, context.now),
      thirtyDay: this.periodSummary(30, history, evidence.sessions, context.now),
      sessions: evidence.sessions.map((session) => this.sessionSummary(session)),
    };
  }

  private async context(nowIso: string): Promise<IntelligenceContext> {
    const now = Date.parse(nowIso);
    if (!Number.isFinite(now)) throw new Error("INVALID_GENERATED_AT");
    const roomIds = await this.repository.listRoomIds();
    const snapshotByRoom = new Map(this.repository.listSnapshots().map((snapshot) => [snapshot.roomId, snapshot]));
    const evidenceByRoom = new Map<string, RoomEvidence>();
    for (const roomId of roomIds) {
      const sessions = this.repository.listSessions(roomId);
      evidenceByRoom.set(roomId, {
        sessions,
        recent: viewerAverage(sessions, now - 7 * DAY_MS, now + 1),
        prior: viewerAverage(sessions, now - 14 * DAY_MS, now - 7 * DAY_MS),
      });
    }

    const comparable = [...evidenceByRoom.entries()]
      .filter(([, evidence]) => evidence.recent.count >= 2 && evidence.recent.average !== undefined)
      .map(([roomId, evidence]) => ({ roomId, average: evidence.recent.average! }))
      .sort((left, right) => right.average - left.average);
    const topQuartileRoomIds = comparable.length >= 5
      ? new Set(comparable.slice(0, Math.max(1, Math.floor(comparable.length * 0.25))).map((item) => item.roomId))
      : new Set<string>();

    return { now, nowIso, roomIds, snapshotByRoom, evidenceByRoom, comparisonCount: comparable.length, topQuartileRoomIds };
  }

  private summaryFor(roomId: string, context: IntelligenceContext): { summary: RoomIntelligenceSummary; allLabels: TransparentLabel[] } {
    const snapshot = context.snapshotByRoom.get(roomId);
    const evidence = context.evidenceByRoom.get(roomId)!;
    const generatedLabels = this.labelsForRoom(snapshot, evidence, context.comparisonCount, context.topQuartileRoomIds.has(roomId), context.now);
    const allLabels = generatedLabels;
    return {
      summary: {
        roomId,
        generatedAt: context.nowIso,
        currentMetrics: {
          viewerCount: snapshot?.viewerCount,
          followerCount: snapshot?.followerCount,
          totalViewerCount: snapshot?.totalViewerCount,
          likeCount: snapshot?.likeCount,
          observedAt: snapshot?.metricsObservedAt,
          quality: snapshot?.metricQuality,
          evidence: snapshot?.metricEvidence,
        },
        labels: allLabels.slice(0, 3),
      },
      allLabels,
    };
  }

  private labelsForRoom(
    snapshot: RoomSnapshot | undefined,
    evidence: RoomEvidence,
    comparisonCount: number,
    inTopQuartile: boolean,
    now: number,
  ): TransparentLabel[] {
    const labels: TransparentLabel[] = [];
    const audience = audienceScaleLabel(snapshot?.followerCount, snapshot?.metricsObservedAt);
    if (audience) labels.push(audience);

    if (inTopQuartile && evidence.recent.count >= 2 && evidence.recent.average !== undefined) {
      labels.push({
        kind: "recent_heat",
        text: "近期在线靠前",
        explanation: `最近 7 天 ${evidence.recent.count} 场直播，场均在线 ${compactCount(evidence.recent.average)} 人；在本地 ${comparisonCount} 个有数据主播中位于前 25%。`,
        observedAt: new Date(now).toISOString(),
        sampleCount: evidence.recent.count,
        comparisonCount,
      });
    }

    if (evidence.recent.count >= 2 && evidence.prior.count >= 2 && evidence.recent.average !== undefined && evidence.prior.average !== undefined && evidence.prior.average > 0) {
      const change = evidence.recent.average - evidence.prior.average;
      const ratio = change / evidence.prior.average;
      if (change >= 100 && ratio >= 0.3) {
        const percent = Math.round(ratio * 100);
        labels.push({
          kind: "growth",
          text: `近期升温 +${percent}%`,
          explanation: `最近 7 天场均在线 ${compactCount(evidence.recent.average)} 人，前 7 天为 ${compactCount(evidence.prior.average)} 人；增长 ${percent}%。`,
          observedAt: new Date(now).toISOString(),
          sampleCount: evidence.recent.count + evidence.prior.count,
        });
      }
    }

    const recentSessions = evidence.sessions.filter((session) => inWindow(session.firstLiveAt, now - 7 * DAY_MS, now + 1));
    const activeDays = new Set(recentSessions.map((session) => localDayKey(session.firstLiveAt))).size;
    if (activeDays >= 3) {
      labels.push({
        kind: "activity",
        text: `近7日开播${activeDays}天`,
        explanation: `最近 7 天已观测到 ${recentSessions.length} 场直播，分布在 ${activeDays} 个自然日。`,
        observedAt: new Date(now).toISOString(),
        sampleCount: recentSessions.length,
      });
    }

    const durations = evidence.sessions
      .filter((session) => inWindow(session.firstLiveAt, now - 30 * DAY_MS, now + 1))
      .map(observedDurationMinutes)
      .filter((value): value is number => value !== undefined);
    const typicalDuration = median(durations);
    if (durations.length >= 3 && typicalDuration !== undefined && typicalDuration >= 120) {
      labels.push({
        kind: "duration",
        text: "已观测长播",
        explanation: `最近 30 天 ${durations.length} 场完整记录的直播时长中位数为 ${Math.round(typicalDuration)} 分钟。`,
        observedAt: new Date(now).toISOString(),
        sampleCount: durations.length,
      });
    }
    return labels;
  }

  private periodSummary(days: 7 | 30, history: RoomSnapshot[], sessions: StoredLiveSession[], now: number): RoomPeriodSummary {
    const start = now - days * DAY_MS;
    const points: RoomMetricPoint[] = history
      .filter((snapshot) => inWindow(snapshot.checkedAt, start, now + 1))
      .filter((snapshot) => [snapshot.viewerCount, snapshot.followerCount, snapshot.totalViewerCount, snapshot.likeCount].some((value) => value !== undefined))
      .map((snapshot) => ({
        at: snapshot.metricsObservedAt ?? snapshot.checkedAt,
        viewerCount: snapshot.viewerCount,
        followerCount: snapshot.followerCount,
        totalViewerCount: snapshot.totalViewerCount,
        likeCount: snapshot.likeCount,
      }));
    const viewers = points.map((point) => point.viewerCount).filter((value): value is number => value !== undefined);
    return {
      days,
      sampleCount: points.length,
      sessionCount: sessions.filter((session) => inWindow(session.firstLiveAt, start, now + 1)).length,
      averageViewerCount: mean(viewers),
      peakViewerCount: viewers.length ? Math.max(...viewers) : undefined,
      points,
    };
  }

  private sessionSummary(session: StoredLiveSession): RoomSessionSummary {
    return {
      id: session.id,
      status: session.status,
      previousOfflineAt: session.previousOfflineAt,
      firstLiveAt: session.firstLiveAt,
      lastLiveAt: session.lastLiveAt,
      firstOfflineAt: session.firstOfflineAt,
      peakViewerCount: session.peakViewerCount,
      averageViewerCount: session.averageViewerCount,
      observedDurationMinutes: observedDurationMinutes(session),
    };
  }
}
