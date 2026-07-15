export interface ProbeEvidence {
  hasVideo: boolean;
  videoReadyState: number;
  text: string;
  title?: string;
  cover?: string;
  anchorName?: string;
  avatar?: string;
  metricRaw?: Record<string, string>;
  avatarCandidates?: Array<{ source: string; width: number; height: number; label: string }>;
}

export interface CurrentRoomEvidence extends ProbeEvidence {
  currentTime: number;
  paused: boolean;
  audioTrackState?: string;
}

export type LiveStatus = "live" | "offline" | "login_required" | "timeout" | "page_error";

export interface RoomProbeResult {
  status: LiveStatus;
  title?: string;
  cover?: string;
  anchorName?: string;
  avatar?: string;
  viewerCount?: number;
  followerCount?: number;
  totalViewerCount?: number;
  likeCount?: number;
  metricRaw?: Record<string, string>;
  metricQuality?: "complete" | "partial" | "missing";
}

export function parseCompactCount(value: string): number | undefined {
  const match = value.replaceAll(",", "").match(/(\d+(?:\.\d+)?)\s*([万亿]?)/);
  if (!match) return undefined;
  const multiplier = match[2] === "亿" ? 100_000_000 : match[2] === "万" ? 10_000 : 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : undefined;
}

export function selectAvatarCandidate(candidates: Array<{ source: string; width: number; height: number; label: string }>): string | undefined {
  return candidates.map((candidate) => {
    let url: URL;
    try { url = new URL(candidate.source); } catch { return undefined; }
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    const description = `${candidate.label} ${url.pathname}`.toLowerCase();
    if (/logo|qrcode|qr[-_]?code|二维码|扫码|favicon|emoji|icon/.test(description)) return undefined;
    const ratio = candidate.width / candidate.height;
    if (candidate.width < 32 || candidate.height < 32 || candidate.width > 800 || candidate.height > 800 || ratio < 0.8 || ratio > 1.25) return undefined;
    const labelScore = /avatar|头像|主播|author|user|head/.test(description) ? 1000 : 0;
    const sizeScore = Math.min(candidate.width, candidate.height) - Math.abs(candidate.width - candidate.height) * 2;
    return { source: url.toString(), score: labelScore + sizeScore };
  }).filter((item): item is { source: string; score: number } => Boolean(item)).sort((left, right) => right.score - left.score)[0]?.source;
}

export function classifyProbe(evidence: ProbeEvidence): LiveStatus {
  if (/登录后|扫码登录|手机号登录/.test(evidence.text)) return "login_required";
  if (/直播已结束|暂未开播|休息中|已下播/.test(evidence.text)) return "offline";
  if (evidence.hasVideo && evidence.videoReadyState >= 2) return "live";
  return "page_error";
}

export function classifyCurrentHealth(evidence: CurrentRoomEvidence, previousTime: number | undefined): "live" | "offline" | "unknown" {
  if (/直播已结束|暂未开播|休息中|已下播/.test(evidence.text)) return "offline";
  if (evidence.audioTrackState === "ended") return "offline";
  if (evidence.hasVideo && evidence.videoReadyState >= 2 && !evidence.paused && evidence.audioTrackState === "live" && previousTime !== undefined && evidence.currentTime > previousTime + 0.1) return "live";
  return "unknown";
}

export async function inspectCurrentRoom(webContents: ProbeWebContents): Promise<CurrentRoomEvidence> {
  return evaluateNow<CurrentRoomEvidence>(webContents, `(() => {
    const video = document.querySelector('video');
    const track = window.__duoduoCaptureStream?.getAudioTracks?.()[0];
    return { hasVideo: Boolean(video), videoReadyState: video?.readyState ?? 0, currentTime: video?.currentTime ?? 0, paused: video?.paused ?? true, audioTrackState: track?.readyState, text: document.body?.innerText?.slice(0, 20000) ?? '' };
  })()`);
}

export interface ProbeWebContents {
  loadURL(url: string): Promise<void>;
  executeJavaScript<T>(code: string, userGesture?: boolean): Promise<T>;
  stop(): void;
  once?(event: "dom-ready", listener: () => void): unknown;
  debugger?: { isAttached(): boolean; attach(version?: string): void; detach(): void; sendCommand(method: string, params?: object): Promise<any> };
}

export async function evaluateNow<T>(webContents: ProbeWebContents, expression: string): Promise<T> {
  if (!webContents.debugger) return webContents.executeJavaScript<T>(expression);
  const attachedHere = !webContents.debugger.isAttached();
  if (attachedHere) webContents.debugger.attach("1.3");
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await webContents.debugger.sendCommand("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (!response.exceptionDetails && response.result.type !== "undefined") return response.result.value as T;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error("PAGE_EVALUATION_FAILED");
  } finally { if (attachedHere && webContents.debugger.isAttached()) webContents.debugger.detach(); }
}

export async function probeRoom(webContents: ProbeWebContents, url: string, timeoutMs = 20_000): Promise<RoomProbeResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const domReady = webContents.once ? new Promise<void>((resolve) => webContents.once!("dom-ready", resolve)) : new Promise<void>((resolve) => setTimeout(resolve, Math.min(4_000, timeoutMs / 2)));
    const navigation = webContents.loadURL(url);
    await Promise.race([
      domReady,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("PROBE_TIMEOUT")), timeoutMs); }),
    ]);
    navigation.catch(() => undefined);
    let evidence: ProbeEvidence = { hasVideo: false, videoReadyState: 0, text: "" };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1_000 : 500));
      evidence = await evaluateNow<ProbeEvidence>(webContents, `(() => {
        const video = document.querySelector('video');
        const image = document.querySelector('meta[property="og:image"]');
        const pageTitle = document.querySelector('meta[property="og:title"]')?.content || document.title;
        const text = document.body?.innerText?.slice(0, 20000) ?? '';
        const pick = (patterns) => patterns.map((pattern) => text.match(pattern)?.[1]).find(Boolean);
        const avatar = document.querySelector('img[class*="avatar" i], img[class*="author" i], img[alt*="头像"], img[alt*="主播"]')?.src;
        const avatarCandidates = Array.from(document.images).map((item) => ({ source: item.currentSrc || item.src, width: item.naturalWidth || item.width, height: item.naturalHeight || item.height, label: [item.alt, item.className].filter((value) => typeof value === 'string').join(' ').slice(0, 160) })).filter((item) => item.source && item.width >= 24 && item.height >= 24).slice(0, 40);
        const metricRaw = {
          viewerCount: pick([/(?:在线|观看中)\s*([\d,.]+\s*[万亿]?)/, /([\d,.]+\s*[万亿]?)\s*(?:人在线|人观看)/]),
          followerCount: pick([/(?:粉丝|关注者)\s*([\d,.]+\s*[万亿]?)/, /([\d,.]+\s*[万亿]?)\s*(?:粉丝|关注者)/]),
          totalViewerCount: pick([/(?:累计观看|本场观看)\s*([\d,.]+\s*[万亿]?)/]),
          likeCount: pick([/(?:点赞|获赞)\s*([\d,.]+\s*[万亿]?)/, /([\d,.]+\s*[万亿]?)\s*(?:点赞|获赞)/]),
        };
        return { hasVideo: Boolean(video), videoReadyState: video?.readyState ?? 0, text, title: pageTitle, anchorName: pageTitle?.split(/[｜|-]/)[0]?.trim(), cover: image?.content, avatar, avatarCandidates, metricRaw };
      })()`);
      if (classifyProbe(evidence) !== "page_error") break;
    }
    const raw = Object.fromEntries(Object.entries(evidence.metricRaw ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    const metrics = {
      viewerCount: raw.viewerCount ? parseCompactCount(raw.viewerCount) : undefined,
      followerCount: raw.followerCount ? parseCompactCount(raw.followerCount) : undefined,
      totalViewerCount: raw.totalViewerCount ? parseCompactCount(raw.totalViewerCount) : undefined,
      likeCount: raw.likeCount ? parseCompactCount(raw.likeCount) : undefined,
    };
    const available = Object.values(metrics).filter((value) => value !== undefined).length;
    const avatar = evidence.avatar && /^https?:\/\//.test(evidence.avatar) ? evidence.avatar : selectAvatarCandidate(evidence.avatarCandidates ?? []);
    return { status: classifyProbe(evidence), title: evidence.title, anchorName: evidence.anchorName, cover: evidence.cover ? new URL(evidence.cover, url).toString() : undefined, avatar, ...metrics, metricRaw: raw, metricQuality: available === 4 ? "complete" : available > 0 ? "partial" : "missing" };
  } catch (error) {
    if (error instanceof Error && error.message === "PROBE_TIMEOUT") { webContents.stop(); return { status: "timeout" }; }
    return { status: "page_error" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
