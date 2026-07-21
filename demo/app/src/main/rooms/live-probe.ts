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
  profileTrigger?: boolean;
  profileCandidateDiagnostics?: ProfileCandidateDiagnostic[];
  profilePageDiagnostics?: ProfilePageDiagnostic;
}

export type ProfileEvidenceStatus = "trigger_missing" | "popup_missing" | "followers_missing" | "found";

export interface ProfileCandidateDiagnostic {
  tag: string;
  attributes: Record<string, string>;
  ancestors: Array<{ tag: string; attributes: Record<string, string> }>;
}

export interface ProfilePageDiagnostic {
  pageUrl?: string;
  pageTitle?: string;
  anchorName?: string;
  liveNicknamePresent?: boolean;
  textMarkers?: Partial<Record<"fans" | "following" | "live" | "verification" | "login", boolean>>;
  dataE2eInventory?: Array<{ name: string; count: number }>;
  keyNodes?: Record<string, ProfileCandidateDiagnostic & { nearbyDataE2e?: string[] }>;
}

interface ProfileCardEvidence {
  status: ProfileEvidenceStatus;
  text?: string;
  avatar?: string;
  liveDescription?: string;
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
  liveDescription?: string;
  profileEvidenceStatus?: ProfileEvidenceStatus;
  profileCandidateDiagnostics?: ProfileCandidateDiagnostic[];
  profilePageDiagnostics?: ProfilePageDiagnostic;
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
  liveDescription?: string;
  profileEvidenceStatus?: ProfileEvidenceStatus;
  profileCandidateDiagnostics?: ProfileCandidateDiagnostic[];
  profilePageDiagnostics?: ProfilePageDiagnostic;
}

const PROFILE_DIAGNOSTIC_ALLOWED_ATTRIBUTES = new Set([
  "class",
  "data-e2e",
  "role",
  "aria-label",
  "aria-describedby",
  "aria-controls",
]);

function trimDiagnosticValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, 120) : undefined;
}

function sanitizeDiagnosticNode(node: unknown): { tag: string; attributes: Record<string, string> } | undefined {
  if (!node || typeof node !== "object") return undefined;
  const source = node as { tag?: unknown; attributes?: unknown };
  const tag = trimDiagnosticValue(source.tag)?.toUpperCase();
  if (!tag) return undefined;
  const rawAttributes = source.attributes && typeof source.attributes === "object" ? source.attributes as Record<string, unknown> : {};
  const attributes = Object.fromEntries(
    Object.entries(rawAttributes)
      .filter(([name]) => PROFILE_DIAGNOSTIC_ALLOWED_ATTRIBUTES.has(name))
      .flatMap(([name, value]) => {
        const trimmed = trimDiagnosticValue(value);
        return trimmed ? [[name, trimmed]] : [];
      }),
  );
  return { tag, attributes };
}

export function sanitizeProfileCandidateDiagnostics(candidates: unknown): ProfileCandidateDiagnostic[] {
  if (!Array.isArray(candidates)) return [];
  return candidates.slice(0, 8).flatMap((candidate) => {
    const node = sanitizeDiagnosticNode(candidate);
    if (!node) return [];
    const ancestors = Array.isArray((candidate as { ancestors?: unknown }).ancestors)
      ? ((candidate as { ancestors: unknown[] }).ancestors).slice(0, 4).flatMap((ancestor) => {
        const sanitized = sanitizeDiagnosticNode(ancestor);
        return sanitized ? [sanitized] : [];
      })
      : [];
    return [{ ...node, ancestors }];
  });
}

export function sanitizeProfilePageDiagnostics(value: unknown): ProfilePageDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  let pageUrl: string | undefined;
  if (typeof raw.pageUrl === "string") {
    try {
      const url = new URL(raw.pageUrl);
      pageUrl = `${url.origin}${url.pathname}`.slice(0, 160);
    } catch {
      pageUrl = raw.pageUrl.split("?")[0]?.slice(0, 160);
    }
  }
  const textMarkers = raw.textMarkers && typeof raw.textMarkers === "object"
    ? Object.fromEntries(
      Object.entries(raw.textMarkers as Record<string, unknown>)
        .filter(([name]) => ["fans", "following", "live", "verification", "login"].includes(name))
        .map(([name, marker]) => [name, Boolean(marker)]),
    )
    : undefined;
  const dataE2eInventory = Array.isArray(raw.dataE2eInventory)
    ? raw.dataE2eInventory.slice(0, 40).flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const source = item as Record<string, unknown>;
      const name = trimDiagnosticValue(source.name);
      const count = typeof source.count === "number" && Number.isFinite(source.count) ? Math.max(0, Math.floor(source.count)) : undefined;
      return name && count !== undefined ? [{ name, count }] : [];
    })
    : undefined;
  const keyNodes = raw.keyNodes && typeof raw.keyNodes === "object"
    ? Object.fromEntries(
      Object.entries(raw.keyNodes as Record<string, unknown>).flatMap(([name, node]) => {
        const sanitizedName = trimDiagnosticValue(name);
        const sanitizedNode = sanitizeDiagnosticNode(node);
        if (!sanitizedName || !sanitizedNode || !node || typeof node !== "object") return [];
        const source = node as { ancestors?: unknown; nearbyDataE2e?: unknown };
        const ancestors = Array.isArray(source.ancestors)
          ? source.ancestors.slice(0, 4).flatMap((ancestor) => {
            const sanitized = sanitizeDiagnosticNode(ancestor);
            return sanitized ? [sanitized] : [];
          })
          : [];
        const nearbyDataE2e = Array.isArray(source.nearbyDataE2e)
          ? source.nearbyDataE2e.flatMap((item) => {
            const trimmed = trimDiagnosticValue(item);
            return trimmed ? [trimmed] : [];
          }).slice(0, 16)
          : undefined;
        return [[sanitizedName, { ...sanitizedNode, ancestors, nearbyDataE2e }]];
      }),
    )
    : undefined;
  return {
    pageUrl,
    pageTitle: trimDiagnosticValue(raw.pageTitle),
    anchorName: trimDiagnosticValue(raw.anchorName)?.slice(0, 80),
    liveNicknamePresent: typeof raw.liveNicknamePresent === "boolean" ? raw.liveNicknamePresent : undefined,
    textMarkers,
    dataE2eInventory,
    keyNodes,
  };
}

export function shouldIncludeProfileDiagnosticElement(candidate: { width: number; height: number }): boolean {
  const ratio = candidate.width && candidate.height ? candidate.width / candidate.height : 0;
  return candidate.width >= 24 && candidate.height >= 24 && candidate.width <= 240 && candidate.height <= 240 && ratio >= 0.75 && ratio <= 1.35;
}

export function shouldSkipProfileDiagnosticElement(candidate: { selfDataE2e?: string; ancestorDataE2e?: string }): boolean {
  return /gift|gifts/i.test(`${candidate.selfDataE2e ?? ""} ${candidate.ancestorDataE2e ?? ""}`);
}

export function isSafeTopLeftProfileTriggerCandidate(candidate: {
  tagName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  selfDataE2e?: string;
  ancestorDataE2e?: string;
  className?: string;
  text?: string;
}): boolean {
  const label = `${candidate.selfDataE2e ?? ""} ${candidate.ancestorDataE2e ?? ""} ${candidate.className ?? ""} ${candidate.text ?? ""}`.toLowerCase();
  if (/gift|gifts|navigation|tab-|followbutton|fullscreen-back|searchbar|notice|im-entry/.test(label)) return false;
  if (/关注|已关注|粉丝团/.test(candidate.text ?? "")) return false;
  const ratio = candidate.width && candidate.height ? candidate.width / candidate.height : 0;
  const avatarSized = candidate.width >= 32 && candidate.height >= 32 && candidate.width <= 96 && candidate.height <= 96 && ratio >= 0.75 && ratio <= 1.35;
  const topLeftHeaderArea = candidate.x >= 48 && candidate.x <= 220 && candidate.y >= 0 && candidate.y <= 120;
  const visualOrClickable = ["IMG", "BUTTON", "A", "DIV"].includes(candidate.tagName.toUpperCase());
  return avatarSized && topLeftHeaderArea && visualOrClickable;
}

export function isFullscreenOrTheaterClass(className: string | undefined): boolean {
  return /__playerIsFull|__fullScreenOrTheaterOn/.test(className ?? "");
}

async function inspectProfileCard(webContents: ProbeWebContents): Promise<ProfileCardEvidence> {
  try {
    const initial = await evaluateNow<ProfileCardEvidence>(webContents, `(async () => {
      const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
      const isFullscreenOrTheaterClass = (className) => /__playerIsFull|__fullScreenOrTheaterOn/.test(className || '');
      const livingContainer = () => document.querySelector('[data-e2e="living-container"]');
      if (isFullscreenOrTheaterClass(livingContainer()?.className)) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
        document.body?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true }));
        for (let attempt = 0; attempt < 10; attempt += 1) {
          if (!isFullscreenOrTheaterClass(livingContainer()?.className)) break;
          await sleep(100);
        }
      }
      const isSafeTopLeftProfileTriggerCandidate = (element) => {
        const bounds = element.getBoundingClientRect();
        const selfDataE2e = element.getAttribute?.('data-e2e') || '';
        const ancestorDataE2e = Array.from(element.closest?.('[data-e2e], [class*="gift" i], [class*="tab-" i]') ? [element.closest('[data-e2e], [class*="gift" i], [class*="tab-" i]')] : [])
          .map((item) => item?.getAttribute?.('data-e2e') || item?.className || '')
          .join(' ');
        const text = element.textContent?.trim().slice(0, 40) || '';
        const className = typeof element.className === 'string' ? element.className : '';
        const label = [selfDataE2e, ancestorDataE2e, className, text].join(' ').toLowerCase();
        if (/gift|gifts|navigation|tab-|followbutton|fullscreen-back|searchbar|notice|im-entry/.test(label)) return false;
        if (/关注|已关注|粉丝团/.test(text)) return false;
        const ratio = bounds.width && bounds.height ? bounds.width / bounds.height : 0;
        const avatarSized = bounds.width >= 32 && bounds.height >= 32 && bounds.width <= 96 && bounds.height <= 96 && ratio >= 0.75 && ratio <= 1.35;
        const topLeftHeaderArea = bounds.x >= 48 && bounds.x <= 220 && bounds.y >= 0 && bounds.y <= 120;
        return avatarSized && topLeftHeaderArea;
      };
      const findTrigger = () => document.querySelector('[data-e2e="rooom-info-bar-anchor"],[data-e2e="room-info-bar-anchor"]') || Array.from(document.querySelectorAll('img,button,a,div'))
        .find((element) => isSafeTopLeftProfileTriggerCandidate(element));
      let trigger;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        trigger = findTrigger();
        if (trigger) break;
        await sleep(250);
      }
      if (!trigger) return { status: 'trigger_missing' };
      const isVisible = (element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
      };
      const readProfile = () => {
        const linkedIds = [trigger.getAttribute('aria-describedby'), trigger.getAttribute('aria-controls')].filter(Boolean);
        const linked = linkedIds.map((id) => document.getElementById(id)).filter(Boolean);
        const visible = Array.from(document.querySelectorAll('[role="dialog"],[role="tooltip"],[role="status"],[class*="popover" i],[class*="profile" i],[data-radix-popper-content-wrapper]')).filter(isVisible);
        const candidates = [...new Set([...linked, ...visible])].map((element) => ({ element, text: element.textContent?.trim() ?? '' })).filter((item) => item.text);
        if (!candidates.length) return { status: 'popup_missing' };
        const relevant = candidates.filter((item) => /粉丝|关注者/.test(item.text)).sort((left, right) => left.text.length - right.text.length)[0];
        if (!relevant) return { status: 'followers_missing', text: candidates.sort((left, right) => left.text.length - right.text.length)[0].text };
        const { element: popup, text } = relevant;
        const description = text.match(/直播介绍[：:]\s*(.*?)(?=粉丝团|$)/)?.[1]?.trim();
        return { status: 'found', text, avatar: popup.querySelector('.avatar img, img[class*="avatar" i], img[alt*="头像"]')?.src, liveDescription: description || undefined };
      };
      const existing = readProfile();
      if (existing.status === 'found') return existing;
      const makeMouseEvent = (eventName) => {
        if (typeof MouseEvent === 'function') return new MouseEvent(eventName, { bubbles: true, cancelable: true, view: window });
        const event = document.createEvent('MouseEvents');
        event.initMouseEvent(eventName, true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
        return event;
      };
      const closeProfileHover = () => {
        for (const eventName of ['pointerout', 'mouseout', 'mouseleave', 'pointerleave']) trigger.dispatchEvent(makeMouseEvent(eventName));
      };
      for (const eventName of ['pointerenter', 'mouseenter', 'mouseover']) trigger.dispatchEvent(makeMouseEvent(eventName));
      let latest = existing;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const profile = readProfile();
        latest = profile;
        if (profile.status === 'found') {
          closeProfileHover();
          return profile;
        }
        await sleep(100);
      }
      closeProfileHover();
      return latest;
    })()`);
    if (initial.status === "found" || initial.status !== "popup_missing" || !webContents.debugger) return initial;

    const hoverTarget = await evaluateNow<{ x: number; y: number } | undefined>(webContents, `(() => {
      const trigger = document.querySelector('[data-e2e="rooom-info-bar-anchor"],[data-e2e="room-info-bar-anchor"]');
      if (!trigger) return undefined;
      const bounds = trigger.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return undefined;
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`);
    if (!hoverTarget) return initial;

    const attachedHere = !webContents.debugger.isAttached();
    if (attachedHere) webContents.debugger.attach("1.3");
    try {
      await webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1, button: "none" });
      await webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: hoverTarget.x, y: hoverTarget.y, button: "none" });
      await new Promise((resolve) => setTimeout(resolve, 800));
    } finally {
      if (attachedHere && webContents.debugger.isAttached()) webContents.debugger.detach();
    }

    const hovered = await evaluateNow<ProfileCardEvidence>(webContents, `(async () => {
      const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
      const isVisible = (element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
      };
      const readProfile = () => {
        const trigger = document.querySelector('[data-e2e="rooom-info-bar-anchor"],[data-e2e="room-info-bar-anchor"]');
        const linkedIds = [trigger?.getAttribute('aria-describedby'), trigger?.getAttribute('aria-controls'), trigger?.getAttribute('data-popupid')].filter(Boolean);
        const linked = linkedIds.map((id) => document.getElementById(id)).filter(Boolean);
        const visible = Array.from(document.querySelectorAll('[role="dialog"],[role="tooltip"],[role="status"],[class*="popover" i],[class*="profile" i],[data-radix-popper-content-wrapper]')).filter(isVisible);
        const candidates = [...new Set([...linked, ...visible])].map((element) => ({ element, text: element.textContent?.trim() ?? '' })).filter((item) => item.text);
        if (!candidates.length) return { status: 'popup_missing' };
        const relevant = candidates.filter((item) => /粉丝|关注者/.test(item.text)).sort((left, right) => left.text.length - right.text.length)[0];
        if (!relevant) return { status: 'followers_missing', text: candidates.sort((left, right) => left.text.length - right.text.length)[0].text };
        const { element: popup, text } = relevant;
        const description = text.match(/直播介绍[：:]\s*(.*?)(?=粉丝团|$)/)?.[1]?.trim();
        return { status: 'found', text, avatar: popup.querySelector('.avatar img, img[class*="avatar" i], img[alt*="头像"]')?.src, liveDescription: description || undefined };
      };
      let latest = readProfile();
      for (let attempt = 0; attempt < 15; attempt += 1) {
        latest = readProfile();
        if (latest.status === 'found') return latest;
        await sleep(100);
      }
      return latest;
    })()`);
    if (webContents.debugger) {
      const attachedForDismiss = !webContents.debugger.isAttached();
      if (attachedForDismiss) webContents.debugger.attach("1.3");
      try {
        await webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1, button: "none" });
      } finally {
        if (attachedForDismiss && webContents.debugger.isAttached()) webContents.debugger.detach();
      }
    }
    return hovered;
  } catch {
    return { status: "popup_missing" };
  }
}

function profileCandidateDiagnosticsExpression(): string {
  return `
    const sanitizeProfileDiagnosticValue = (value) => typeof value === 'string' ? value.replace(/\\s+/g, ' ').trim().slice(0, 120) : '';
    const readProfileDiagnosticAttrs = (element) => {
      const result = {};
      for (const name of ['class', 'data-e2e', 'role', 'aria-label', 'aria-describedby', 'aria-controls']) {
        const value = sanitizeProfileDiagnosticValue(element.getAttribute?.(name));
        if (value) result[name] = value;
      }
      return result;
    };
    const describeProfileDiagnosticNode = (element) => ({ tag: element.tagName, attributes: readProfileDiagnosticAttrs(element) });
    const profileDataE2eCounts = new Map();
    for (const element of Array.from(document.querySelectorAll('[data-e2e]')).slice(0, 200)) {
      const name = sanitizeProfileDiagnosticValue(element.getAttribute('data-e2e'));
      if (name) profileDataE2eCounts.set(name, (profileDataE2eCounts.get(name) || 0) + 1);
    }
    const profilePageDiagnostics = {
      pageUrl: location.href,
      pageTitle: document.title,
      anchorName: document.querySelector('[data-e2e="live-room-nickname"]')?.textContent?.trim() || undefined,
      liveNicknamePresent: Boolean(document.querySelector('[data-e2e="live-room-nickname"]')),
      textMarkers: {
        fans: /粉丝|关注者/.test(document.body?.innerText || ''),
        following: /关注/.test(document.body?.innerText || ''),
        live: /直播|在线/.test(document.body?.innerText || ''),
        verification: /安全验证|验证码|请完成下列验证/.test(document.body?.innerText || ''),
        login: /登录后|扫码登录|手机号登录/.test(document.body?.innerText || ''),
      },
      dataE2eInventory: Array.from(profileDataE2eCounts.entries()).map(([name, count]) => ({ name, count })).slice(0, 40),
    };
    const isInsideGiftArea = (element) => Boolean(element.closest('[data-e2e*="gift" i],[class*="gift" i]'));
    const isVisibleProfileSizedElement = (element) => {
      if (isInsideGiftArea(element)) return false;
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const ratio = bounds.width && bounds.height ? bounds.width / bounds.height : 0;
      const carriesVisualProfileCue = element.tagName === 'IMG' || style.backgroundImage !== 'none' || Boolean(element.querySelector?.('img')) || ['BUTTON', 'A'].includes(element.tagName);
      return style.display !== 'none' && style.visibility !== 'hidden' && carriesVisualProfileCue && bounds.width >= 24 && bounds.height >= 24 && bounds.width <= 240 && bounds.height <= 240 && ratio >= 0.75 && ratio <= 1.35;
    };
    const describeProfileDiagnosticElement = (element) => {
      const ancestors = [];
      let current = element.parentElement;
      for (let depth = 0; current && depth < 4; depth += 1, current = current.parentElement) ancestors.push(describeProfileDiagnosticNode(current));
      return { ...describeProfileDiagnosticNode(element), ancestors };
    };
    const describeProfileKeyNode = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return undefined;
      const scope = element.closest('[data-e2e],button,a,[role],[aria-label]') || element.parentElement || element;
      const nearbyDataE2e = Array.from(scope.querySelectorAll?.('[data-e2e]') || [])
        .map((item) => sanitizeProfileDiagnosticValue(item.getAttribute('data-e2e')))
        .filter(Boolean)
        .slice(0, 16);
      return { ...describeProfileDiagnosticElement(element), nearbyDataE2e };
    };
    profilePageDiagnostics.keyNodes = Object.fromEntries(Object.entries({
      'living-container': describeProfileKeyNode('[data-e2e="living-container"]'),
      'live-followbutton': describeProfileKeyNode('[data-e2e="live-followbutton"]'),
      'live-room-audience': describeProfileKeyNode('[data-e2e="live-room-audience"]'),
      'fullscreen-back': describeProfileKeyNode('[data-e2e="fullscreen-back"]'),
    }).filter(([, value]) => Boolean(value)));
    const nickname = document.querySelector('[data-e2e="live-room-nickname"]');
    const nicknameScope = nickname?.closest('[data-e2e],button,a,[role],[aria-label]') || nickname?.parentElement;
    const scopedElements = nicknameScope ? [nicknameScope, ...Array.from(nicknameScope.querySelectorAll('img,button,a,[data-e2e],[role],[aria-label]'))] : [];
    let profileCandidateDiagnostics = scopedElements
      .filter((element) => !isInsideGiftArea(element))
      .slice(0, 8)
      .map(describeProfileDiagnosticElement);
    if (!profileCandidateDiagnostics.length) {
      profileCandidateDiagnostics = Array.from(document.querySelectorAll('img,button,a,[data-e2e],[role],[aria-label]'))
      .filter((element) => {
        return isVisibleProfileSizedElement(element);
      })
      .slice(0, 8)
      .map(describeProfileDiagnosticElement);
    }
    if (!profileCandidateDiagnostics.length) {
      profileCandidateDiagnostics = Array.from(document.querySelectorAll('[data-e2e],button,a,[role],[aria-label]'))
        .filter((element) => !isInsideGiftArea(element))
        .slice(0, 8)
        .map(describeProfileDiagnosticElement);
    }
  `;
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
    const metricCandidates = Array.from(document.querySelectorAll('[aria-label],[title],[data-e2e="live-room-audience"],[data-e2e*="fans" i],[data-e2e*="viewer" i],[data-e2e*="like" i]')).slice(0, 100).flatMap((item) => {
      const values = [item.getAttribute('aria-label'), item.getAttribute('title'), item.textContent].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim().slice(0, 160));
      return [...new Set(values)].map((value) => ({ text: value, source: item.hasAttribute('aria-label') || item.hasAttribute('title') ? 'accessibility' : 'visible_text' }));
    });
    const audience = document.querySelector('[data-e2e="live-room-audience"]')?.textContent?.trim();
    if (audience) metricCandidates.push({ text: '在线 ' + audience, source: 'accessibility' });
    ${profileCandidateDiagnosticsExpression()}
    return { hasVideo: Boolean(video), videoReadyState: video?.readyState ?? 0, currentTime: video?.currentTime ?? 0, paused: video?.paused ?? true, audioTrackState: track?.readyState, text: document.body?.innerText?.slice(0, 20000) ?? '', metricCandidates, profileTrigger: Boolean(document.querySelector('[data-e2e="rooom-info-bar-anchor"],[data-e2e="room-info-bar-anchor"]')), profileCandidateDiagnostics, profilePageDiagnostics };
  })()`);
  const profile = evidence.profileTrigger ? await inspectProfileCard(webContents) : { status: "trigger_missing" as const };
  const metrics = extractRoomMetrics({ bodyText: [evidence.text, profile?.text].filter(Boolean).join("\n"), candidates: evidence.metricCandidates ?? [] });
  return { ...evidence, profileCandidateDiagnostics: sanitizeProfileCandidateDiagnostics(evidence.profileCandidateDiagnostics), profilePageDiagnostics: sanitizeProfilePageDiagnostics(evidence.profilePageDiagnostics), viewerCount: metrics.viewerCount, followerCount: metrics.followerCount, totalViewerCount: metrics.totalViewerCount, likeCount: metrics.likeCount, metricRaw: metrics.raw, metricEvidence: metrics.evidence, metricQuality: metrics.quality, liveDescription: profile.liveDescription, profileEvidenceStatus: profile.status };
}

export interface ProbeWebContents {
  loadURL(url: string): Promise<void>;
  executeJavaScript<T>(code: string, userGesture?: boolean): Promise<T>;
  stop(): void;
  once?(event: "dom-ready", listener: () => void): unknown;
  debugger?: { isAttached(): boolean; attach(version?: string): void; detach(): void; sendCommand(method: string, params?: object): Promise<any> };
}

export interface ProbeRoomOptions {
  beforeProfile?: (result: RoomProbeResult) => Promise<void> | void;
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

export async function probeRoom(webContents: ProbeWebContents, url: string, timeoutMs = 20_000, options: ProbeRoomOptions = {}): Promise<RoomProbeResult> {
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
        const anchorName = document.querySelector('[data-e2e="live-room-nickname"]')?.textContent?.trim() || pageTitle?.split(/[｜|-]/)[0]?.trim();
        const avatar = document.querySelector('[data-e2e="rooom-info-bar-anchor"] [data-e2e="live-avatar"] img')?.src || document.querySelector('img[class*="avatar" i], img[class*="author" i], img[alt*="头像"], img[alt*="主播"]')?.src;
        const avatarCandidates = Array.from(document.images).map((item) => ({ source: item.currentSrc || item.src, width: item.naturalWidth || item.width, height: item.naturalHeight || item.height, label: [item.alt, item.className].filter((value) => typeof value === 'string').join(' ').slice(0, 160) })).filter((item) => item.source && item.width >= 24 && item.height >= 24).slice(0, 40);
        const metricCandidates = Array.from(document.querySelectorAll('[aria-label],[title],[data-e2e="live-room-audience"],[data-e2e*="fans" i],[data-e2e*="viewer" i],[data-e2e*="like" i]')).slice(0, 100).flatMap((item) => {
          const values = [item.getAttribute('aria-label'), item.getAttribute('title'), item.textContent].filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim().slice(0, 160));
          return [...new Set(values)].map((value) => ({ text: value, source: item.hasAttribute('aria-label') || item.hasAttribute('title') ? 'accessibility' : 'visible_text' }));
        });
        const audience = document.querySelector('[data-e2e="live-room-audience"]')?.textContent?.trim();
        if (audience) metricCandidates.push({ text: '在线 ' + audience, source: 'accessibility' });
        ${profileCandidateDiagnosticsExpression()}
        return { hasVideo: Boolean(video), videoReadyState: video?.readyState ?? 0, text, title: pageTitle, anchorName, cover: image?.content, avatar, avatarCandidates, metricCandidates, profileTrigger: Boolean(document.querySelector('[data-e2e="rooom-info-bar-anchor"],[data-e2e="room-info-bar-anchor"]')), profileCandidateDiagnostics, profilePageDiagnostics };
      })()`);
      if (classifyProbe(evidence) !== "page_error") break;
    }
    const status = classifyProbe(evidence);
    const metricsBeforeProfile = extractRoomMetrics({ bodyText: evidence.text, candidates: evidence.metricCandidates ?? [] });
    const avatarBeforeProfile = evidence.avatar && /^https?:\/\//.test(evidence.avatar) ? evidence.avatar : selectAvatarCandidate(evidence.avatarCandidates ?? []);
    const beforeProfileResult: RoomProbeResult = {
      status,
      title: evidence.title,
      anchorName: evidence.anchorName,
      cover: evidence.cover ? new URL(evidence.cover, url).toString() : undefined,
      avatar: avatarBeforeProfile,
      viewerCount: metricsBeforeProfile.viewerCount,
      followerCount: metricsBeforeProfile.followerCount,
      totalViewerCount: metricsBeforeProfile.totalViewerCount,
      likeCount: metricsBeforeProfile.likeCount,
      metricRaw: metricsBeforeProfile.raw,
      metricEvidence: metricsBeforeProfile.evidence,
      metricQuality: metricsBeforeProfile.quality,
      profileCandidateDiagnostics: sanitizeProfileCandidateDiagnostics(evidence.profileCandidateDiagnostics),
      profilePageDiagnostics: sanitizeProfilePageDiagnostics(evidence.profilePageDiagnostics),
    };
    await options.beforeProfile?.(beforeProfileResult);
    const profile = status === "live" ? await inspectProfileCard(webContents) : undefined;
    const metrics = extractRoomMetrics({ bodyText: [evidence.text, profile?.text].filter(Boolean).join("\n"), candidates: evidence.metricCandidates ?? [] });
    const preferredAvatar = profile?.avatar ?? evidence.avatar;
    const avatar = preferredAvatar && /^https?:\/\//.test(preferredAvatar) ? preferredAvatar : selectAvatarCandidate(evidence.avatarCandidates ?? []);
    return { status, title: evidence.title, anchorName: evidence.anchorName, cover: evidence.cover ? new URL(evidence.cover, url).toString() : undefined, avatar, viewerCount: metrics.viewerCount, followerCount: metrics.followerCount, totalViewerCount: metrics.totalViewerCount, likeCount: metrics.likeCount, metricRaw: metrics.raw, metricEvidence: metrics.evidence, metricQuality: metrics.quality, liveDescription: profile?.liveDescription, profileEvidenceStatus: profile?.status, profileCandidateDiagnostics: sanitizeProfileCandidateDiagnostics(evidence.profileCandidateDiagnostics), profilePageDiagnostics: sanitizeProfilePageDiagnostics(evidence.profilePageDiagnostics) };
  } catch (error) {
    if (error instanceof Error && error.message === "PROBE_TIMEOUT") { webContents.stop(); return { status: "timeout" }; }
    return { status: "page_error" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
