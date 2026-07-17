import type { RoomProbeResult } from "./live-probe";

type MetricSnapshot = Pick<RoomProbeResult, "viewerCount" | "followerCount" | "totalViewerCount" | "likeCount" | "metricRaw" | "metricQuality">;

interface MetricSamplerOptions {
  intervalMs: number;
  now?: () => number;
}

function fingerprint(snapshot: MetricSnapshot): string | undefined {
  const values = [snapshot.viewerCount, snapshot.followerCount, snapshot.totalViewerCount, snapshot.likeCount];
  return values.some((value) => value !== undefined) ? JSON.stringify(values) : undefined;
}

export class RoomMetricSampler {
  private readonly now: () => number;
  private lastAcceptedAt: number | undefined;
  private lastFingerprint: string | undefined;

  constructor(private readonly options: MetricSamplerOptions) {
    this.now = options.now ?? Date.now;
  }

  seed(snapshot: MetricSnapshot): void {
    this.lastAcceptedAt = this.now();
    this.lastFingerprint = fingerprint(snapshot);
  }

  accept(snapshot: MetricSnapshot): boolean {
    const nextFingerprint = fingerprint(snapshot);
    if (!nextFingerprint || snapshot.metricQuality === "missing") return false;
    const now = this.now();
    if (this.lastAcceptedAt !== undefined && now - this.lastAcceptedAt < this.options.intervalMs) return false;
    if (nextFingerprint === this.lastFingerprint) return false;
    this.lastAcceptedAt = now;
    this.lastFingerprint = nextFingerprint;
    return true;
  }
}
