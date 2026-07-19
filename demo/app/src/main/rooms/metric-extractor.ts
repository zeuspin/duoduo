export type MetricField = "viewerCount" | "followerCount" | "totalViewerCount" | "likeCount";
export type MetricSource = "visible_text" | "accessibility" | "structured_data";

export interface MetricCandidate {
  text: string;
  source: MetricSource;
}

export interface MetricDatum {
  raw: string;
  source: MetricSource;
}

export interface ExtractedMetrics {
  viewerCount?: number;
  followerCount?: number;
  totalViewerCount?: number;
  likeCount?: number;
  raw: Partial<Record<MetricField, string>>;
  evidence: Partial<Record<MetricField, MetricDatum>>;
  quality: "complete" | "partial" | "missing";
}

interface MetricInput {
  bodyText: string;
  candidates: MetricCandidate[];
}

const patterns: Record<MetricField, RegExp[]> = {
  viewerCount: [/(?:在线观众\s*[·・]?|在线|观看中)\s*([\d,.]+\s*[万亿]?)/, /([\d,.]+\s*[万亿]?)\s*人(?:在线|观看)/],
  followerCount: [/(?:粉丝|关注者)\s*([\d,.]+\s*[万亿]?)/, /([\d,.]+\s*[万亿]?)\s*(?:粉丝|关注者)/],
  totalViewerCount: [/(?:累计观看|本场观看)\s*([\d,.]+\s*[万亿]?)/],
  likeCount: [/(?:点赞|获赞)\s*([\d,.]+\s*[万亿]?)/, /([\d,.]+\s*[万亿]?)\s*(?:点赞|获赞)/],
};

const sourcePriority: Record<MetricSource, number> = {
  accessibility: 3,
  structured_data: 2,
  visible_text: 1,
};

export function parseCompactCount(value: string): number | undefined {
  const match = value.replaceAll(",", "").match(/(\d+(?:\.\d+)?)\s*([万亿]?)/);
  if (!match) return undefined;
  const multiplier = match[2] === "亿" ? 100_000_000 : match[2] === "万" ? 10_000 : 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
}

export function extractRoomMetrics(input: MetricInput): ExtractedMetrics {
  const candidates = [...input.candidates, { text: input.bodyText, source: "visible_text" as const }]
    .filter((candidate) => candidate.text.trim())
    .sort((left, right) => sourcePriority[right.source] - sourcePriority[left.source]);
  const raw: Partial<Record<MetricField, string>> = {};
  const evidence: Partial<Record<MetricField, MetricDatum>> = {};
  const values: Partial<Record<MetricField, number>> = {};

  for (const field of Object.keys(patterns) as MetricField[]) {
    for (const candidate of candidates) {
      const captured = patterns[field].map((pattern) => candidate.text.match(pattern)?.[1]).find(Boolean)?.replaceAll(/\s/g, "");
      if (!captured) continue;
      const parsed = parseCompactCount(captured);
      if (parsed === undefined) continue;
      raw[field] = captured;
      evidence[field] = { raw: captured, source: candidate.source };
      values[field] = parsed;
      break;
    }
  }

  const available = Object.keys(values).length;
  return {
    ...values,
    raw,
    evidence,
    quality: available === 4 ? "complete" : available > 0 ? "partial" : "missing",
  };
}
