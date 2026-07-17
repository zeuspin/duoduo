import { extractRoomMetrics, parseCompactCount, type MetricCandidate, type MetricDatum } from "./metric-extractor";

export { parseCompactCount } from "./metric-extractor";

export interface ProbeEvidence {
  hasVideo: boolean;
  videoReadyState: number;
  text: string;
  title?: string;
  cover?: string;
  anchorName?: string;
  avatar?: string;
  metricRaw?: Record<string, string>;
  metricCandidates?: MetricCandidate[];
  avatarCandidates?: Array<{ source: string; width: number; height: number; label: string }>;
}

export interface CurrentRoomEvidence extends ProbeEvidence {
  currentTime: number;
  paused: boolean;
  audioTrackState?: string;
  viewerCount?: number;
  followerCount?: number;
  totalViewerCount?: number;
  likeCount?: number;
  metricEvidence?: Partial<Record<"viewerCount" | "followerCount" | "totalViewerCount" | "likeCount", MetricDatum>>;
  metricQuality?: "complete" | "partial" | "missing";
}

export type LiveStatus = "live" | "offline" | "login_required" | "verification_required" | "timeout" | "page_error";

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
  metricEvidence?: Partial<Record<"viewerCount" | "followerCount" | "totalViewerCount" | "likeCount", MetricDatum>>;
  metricQuality?: "complete" | "partial" | "missing";
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
  if (/请完成下列验证后继续|安全验证|验证码/.test(evidence.text)) return "verification_required";
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
  const evidence = await evaluateNow<CurrentRoomEvidence>(webContents, `(() => {
    const video = document.querySelector('video');
    const track = window.__duoduoCaptureStream?.getAudioTracks?.()[0];
    const metricCandidates = Array.from(document.querySelectorAll('[aria-label],[title],[data-e2e*="fans" i],[data-e2e*="viewer" i],[data-e2e*="like" i]')).slice(0, 100).flatMap((item) => {
      const values = [item.getAttribute('aria-label'), item.getAttribute('title'), item.textContent].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim().slice(0, 160));
      return [...new Set(values)].map((value) => ({ text: value, source: item.hasAttribute('aria-label') || item.hasAttribute('title') ? 'accessibility' : 'visible_text' }));
    });
    return { hasVideo: Boolean(video), videoReadyState: video?.readyState ?? 0, currentTime: video?.currentTime ?? 0, paused: video?.paused ?? true, audioTrackState: track?.readyState, text: document.body?.innerText?.slice(0, 20000) ?? '', metricCandidates };
  })()`);
  const metrics = extractRoomMetrics({ bodyText: evidence.text, candidates: evidence.metricCandidates ?? [] });
  return { ...evidence, viewerCount: metrics.viewerCount, followerCount: metrics.followerCount, totalViewerCount: metrics.totalViewerCount, likeCount: metrics.likeCount, metricRaw: metrics.raw, metricEvidence: metrics.evidence, metricQuality: metrics.quality };
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
        const avatar = document.querySelector('img[class*="avatar" i], img[class*="author" i], img[alt*="头像"], img[alt*="主播"]')?.src;
        const avatarCandidates = Array.from(document.images).map((item) => ({ source: item.currentSrc || item.src, width: item.naturalWidth || item.width, height: item.naturalHeight || item.height, label: [item.alt, item.className].filter((value) => typeof value === 'string').join(' ').slice(0, 160) })).filter((item) => item.source && item.width >= 24 && item.height >= 24).slice(0, 40);
        const metricCandidates = Array.from(document.querySelectorAll('[aria-label],[title],[data-e2e*="fans" i],[data-e2e*="viewer" i],[data-e2e*="like" i]')).slice(0, 100).flatMap((item) => {
          const values = [item.getAttribute('aria-label'), item.getAttribute('title'), item.textContent].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim().slice(0, 160));
          return [...new Set(values)].map((value) => ({ text: value, source: item.hasAttribute('aria-label') || item.hasAttribute('title') ? 'accessibility' : 'visible_text' }));
        });
        return { hasVideo: Boolean(video), videoReadyState: video?.readyState ?? 0, text, title: pageTitle, anchorName: pageTitle?.split(/[｜|-]/)[0]?.trim(), cover: image?.content, avatar, avatarCandidates, metricCandidates };
      })()`);
      if (classifyProbe(evidence) !== "page_error") break;
    }
    const metrics = extractRoomMetrics({ bodyText: evidence.text, candidates: evidence.metricCandidates ?? [] });
    const avatar = evidence.avatar && /^https?:\/\//.test(evidence.avatar) ? evidence.avatar : selectAvatarCandidate(evidence.avatarCandidates ?? []);
    return { status: classifyProbe(evidence), title: evidence.title, anchorName: evidence.anchorName, cover: evidence.cover ? new URL(evidence.cover, url).toString() : undefined, avatar, viewerCount: metrics.viewerCount, followerCount: metrics.followerCount, totalViewerCount: metrics.totalViewerCount, likeCount: metrics.likeCount, metricRaw: metrics.raw, metricEvidence: metrics.evidence, metricQuality: metrics.quality };
  } catch (error) {
    if (error instanceof Error && error.message === "PROBE_TIMEOUT") { webContents.stop(); return { status: "timeout" }; }
    return { status: "page_error" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
