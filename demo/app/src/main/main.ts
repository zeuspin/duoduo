import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  net,
  powerSaveBlocker,
  protocol,
  safeStorage,
  session,
  WebContentsView,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { z } from "zod";
import {
  AnalyzerDraftTestRequestSchema,
  AnalyzerAgentRequestSchema,
  AnalyzerAgentResponseSchema,
  AnalyzerPublishRequestSchema,
  AnalyzerSampleListSchema,
  AiUsageQuerySchema,
  AsrProviderConfigSchema,
  CleanupRequestSchema,
  DataRetentionSettingsSchema,
  InsightNotificationSettingsSchema,
  LlmProviderConfigSchema,
  MonitoringSettingsSchema,
  ParserSpecV4Schema,
  RoomInputSchema,
} from "../shared/contracts";
import { DuoduoDatabase, type StoredAsrEvent } from "./storage/database";
import { SettingsStore } from "./storage/settings-store";
import { createAsrProvider } from "./asr/provider-factory";
import { CaptureRouter } from "./audio/capture-router";
import { RoomManager } from "./rooms/room-manager";
import { RoomSession, type RoomNavigationGate } from "./rooms/room-session";
import { BailianProvider } from "./asr/bailian-provider";
import { ProbeScheduler } from "./rooms/probe-scheduler";
import {
  ProbeOrchestrator,
  type ProbeSource,
} from "./rooms/probe-orchestrator";
import { CoverCache } from "./rooms/cover-cache";
import { AvatarCache } from "./rooms/avatar-cache";
import { BackupService } from "./storage/backup-service";
import { probeRoom } from "./rooms/live-probe";
import type { RoomProbeResult } from "./rooms/live-probe";
import type {
  ContentRecord,
  GroupRefreshResult,
  GroupStopProgress,
  MarketInsight,
} from "../shared/contracts";
import { PlaybackController } from "./player/playback-controller";
import { createLlmProvider } from "./llm/provider-factory";
import { InsightEngine } from "./insights/insight-engine";
import { InsightCoordinator } from "./insights/insight-coordinator";
import { AnalyzerDraftEngine } from "./insights/analyzer-draft-engine";
import { AnalyzerTestPassStore } from "./insights/analyzer-test-pass-store";
import { ANALYZER_AGENT_SYSTEM_PROMPT, sanitizeAnalyzerAgentResponse } from "./insights/analyzer-agent-prompt";
import { mergeAnalyzerSampleEvents } from "./insights/analyzer-live-sample";
import {
  createDiagnosticLog,
  createNetworkErrorSampler,
  decideRendererRecovery,
  monitoringFingerprint,
} from "./diagnostics";
import {
  douyinPlatformPartitionName,
  roomPartitionName,
} from "./rooms/partitions";
import { DouyinAccessCoordinator } from "./rooms/douyin-access-coordinator";
import {
  acquireProcessLock,
  revealExistingWindow,
} from "./application-lifecycle";
import { EmbeddedVerificationController } from "./rooms/embedded-verification-controller";
import { inspectVerificationPage } from "./rooms/verification-page-inspector";
import type { Room } from "../shared/contracts";
import {
  isTrustedAvatarStatus,
  reconcileAvatarPaths,
} from "./rooms/avatar-reconciliation";
import {
  RoomIntelligenceService,
  type StoredLiveSession,
} from "./rooms/room-intelligence";
import { shouldAutoMonitor } from "./rooms/auto-monitor";
import { PreparedPageLeasePool } from "./rooms/prepared-page-lease";
import { AiUsageGateway } from "./usage/usage-gateway";
import { GroupRunService } from "./groups/group-run-service";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("log-level", "3");

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | undefined;
let shutdown: (() => Promise<void>) | undefined;
let persistentDiagnostic: ReturnType<typeof createDiagnosticLog> | undefined;
let lastMainRendererCrashAt: number | undefined;
const processLock = acquireProcessLock(
  join(app.getPath("userData"), "duoduo.pid"),
);
const hasSingleInstanceLock =
  processLock.acquired && app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  processLock.release();
  app.quit();
} else app.on("second-instance", () => revealExistingWindow(mainWindow));
app.on("will-quit", () => processLock.release());
const diagnosticLog = process.env.DUODUO_E2E_LOG;
function diagnostic(message: string, details: Record<string, unknown> = {}) {
  if (diagnosticLog)
    void appendFile(
      diagnosticLog,
      `${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`,
    );
  void persistentDiagnostic?.(message, details);
}
diagnostic("main-loaded");

function broadcastRooms(rooms: unknown) {
  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed()
  )
    mainWindow.webContents.send("rooms:changed", rooms);
}

function selectAnalyzerSample(
  events: StoredAsrEvent[],
  maxCharacters: number,
): StoredAsrEvent[] {
  const selected: StoredAsrEvent[] = [];
  let characters = 0;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (selected.length > 0 && characters + event.text.length > maxCharacters)
      break;
    selected.unshift(event);
    characters += event.text.length;
  }
  return selected;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1050,
    minHeight: 720,
    backgroundColor: "#f4f6fa",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    if (
      details.reason === "clean-exit" ||
      !mainWindow ||
      mainWindow.isDestroyed()
    )
      return;
    const recovery = decideRendererRecovery(
      lastMainRendererCrashAt,
      Date.now(),
      60_000,
    );
    lastMainRendererCrashAt = recovery.crashAt;
    diagnostic("main_renderer_gone", {
      reason: details.reason,
      exitCode: details.exitCode,
      action: recovery.action,
    });
    if (recovery.action === "reload")
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
      }, 500);
    else
      void mainWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent("<!doctype html><meta charset='utf-8'><style>body{font:16px system-ui;background:#f4f6fa;color:#172033;display:grid;place-items:center;height:100vh;margin:0}main{max-width:560px;padding:32px;background:white;border-radius:16px;box-shadow:0 8px 30px #0001}h1{font-size:22px}</style><main><h1>界面渲染进程连续异常</h1><p>系统已停止自动重载，避免反复白屏和资源消耗。请重新启动应用；故障记录已保存到 diagnostics.log。</p></main>")}`,
      );
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else
    await mainWindow.loadFile(
      join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  diagnostic("app-ready");
  const powerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  const userDataPath = app.getPath("userData");
  await applyPendingRestore(userDataPath);
  persistentDiagnostic = createDiagnosticLog(
    join(userDataPath, "diagnostics.log"),
  );
  diagnostic("diagnostics_ready");
  const databasePath = join(userDataPath, "duoduo.sqlite");
  const database = new DuoduoDatabase(databasePath);
  const aiUsageGateway = new AiUsageGateway(database.aiUsage);
  await database.migrateLegacyRooms(join(userDataPath, "rooms.json"));
  const rooms = database.rooms;
  const coverCache = new CoverCache(
    join(userDataPath, "covers"),
    (url) => net.fetch(url),
    (bytes) => nativeImage.createFromBuffer(bytes).toPNG(),
  );
  const avatarCache = new AvatarCache(
    join(userDataPath, "avatars"),
    (url) => net.fetch(url),
    (bytes) => nativeImage.createFromBuffer(bytes).toPNG(),
  );
  const repairedAvatarRoomIds = await reconcileAvatarPaths(
    (await rooms.list()).map((room) => room.roomId),
    avatarCache,
    database.snapshots,
  );
  if (repairedAvatarRoomIds.length)
    diagnostic("avatar_paths_reconciled", { roomIds: repairedAvatarRoomIds });
  const backupService = new BackupService(
    databasePath,
    join(userDataPath, "avatars"),
    join(userDataPath, "covers"),
  );
  const settings = new SettingsStore(
    join(app.getPath("userData"), "settings.json"),
    {
      encryptString(value) {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error("SECURE_STORAGE_UNAVAILABLE");
        return safeStorage.encryptString(value).toString("base64");
      },
      decryptString(value) {
        return safeStorage.decryptString(Buffer.from(value, "base64"));
      },
    },
  );
  await settings.ensureDefaultBailianLlm();
  const platformSession = session.fromPartition(douyinPlatformPartitionName, {
    cache: false,
  });
  platformSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  let roomIntelligenceRealRequestCount = 0;
  if (process.env.DUODUO_E2E_ROOM_INTELLIGENCE_REPORT) {
    platformSession.webRequest.onBeforeRequest(
      { urls: ["https://live.douyin.com/*"] },
      (_details, callback) => {
        roomIntelligenceRealRequestCount += 1;
        callback({ cancel: true });
      },
    );
  }
  const storedAccessState = await settings.getDouyinAccessState();
  const recentSnapshots = database.snapshots.list();
  const existingVerification = recentSnapshots.find(
    (item) => item.status === "verification_required",
  );
  const repeatedPageError =
    recentSnapshots.filter(
      (item) =>
        item.status === "page_error" &&
        Date.now() - Date.parse(item.checkedAt) < 30 * 60_000,
    ).length >= 3
      ? recentSnapshots.find((item) => item.status === "page_error")
      : undefined;
  const blockedSnapshot = existingVerification ?? repeatedPageError;
  const initialAccessState =
    storedAccessState.mode === "normal" && blockedSnapshot
      ? {
          mode: "verification_paused" as const,
          roomId: blockedSnapshot.roomId,
          taskType: "startup_probe" as const,
          triggeredAt: blockedSnapshot.checkedAt,
          reason: existingVerification
            ? ("verification_required" as const)
            : ("suspected_verification" as const),
        }
      : storedAccessState;
  const coordinator = new DouyinAccessCoordinator({
    initialState: initialAccessState,
    minimumGapMs: process.env.DUODUO_FIXTURE_ORIGIN ? 0 : 60_000,
    automaticBudgetPerHour: process.env.DUODUO_FIXTURE_ORIGIN
      ? Number.POSITIVE_INFINITY
      : 10,
    persistState: (state) => settings.saveDouyinAccessState(state),
  });
  const restoredAccessState = coordinator.getState();
  if (JSON.stringify(restoredAccessState) !== JSON.stringify(storedAccessState))
    await settings.saveDouyinAccessState(restoredAccessState);
  const broadcastAccessState = () => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("access:changed", coordinator.getState());
  };
  const unsubscribeAccess = coordinator.subscribe(() => broadcastAccessState());
  const verificationController = new EmbeddedVerificationController(() => {
    if (!mainWindow || mainWindow.isDestroyed())
      throw new Error("MAIN_WINDOW_UNAVAILABLE");
    const view = new WebContentsView({
      webPreferences: {
        session: platformSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    view.setBackgroundColor("#ffffff");
    view.setVisible(false);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.contentView.addChildView(view);
    return {
      async loadURL(url: string) {
        try {
          await view.webContents.loadURL(url);
        } catch (error) {
          if (view.webContents.isDestroyed()) throw error;
        }
      },
      setBounds(bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) {
        view.setBounds(bounds);
      },
      setVisible(visible: boolean) {
        view.setVisible(visible);
      },
      currentUrl() {
        return view.webContents.getURL();
      },
      async inspectBlockedState() {
        const startedAt = Date.now();
        const host = (() => {
          try {
            return new URL(view.webContents.getURL()).hostname;
          } catch {
            return "unknown";
          }
        })();
        const isLoading = view.webContents.isLoading();
        diagnostic("verification_check_started", { host, isLoading });
        try {
          const result = await inspectVerificationPage(
            view.webContents.mainFrame,
          );
          diagnostic("verification_check_completed", {
            host,
            isLoading,
            durationMs: Date.now() - startedAt,
            result,
          });
          return result;
        } catch (error) {
          diagnostic("verification_check_failed", {
            host,
            isLoading,
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
      destroy() {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) view.webContents.close();
      },
      isDestroyed() {
        return view.webContents.isDestroyed();
      },
    };
  });
  let monitoringSettings = await settings.getMonitoringSettings();
  const runRetention = async () => {
    const retention = await settings.getDataRetention();
    const removed = database.maintenance.runAutomaticRetention(retention);
    await pruneDiagnosticLog(
      join(userDataPath, "diagnostics.log"),
      retention.logDays,
    );
    return removed;
  };
  await runRetention();
  const retentionTimer = setInterval(() => {
    void runRetention();
  }, 86_400_000);
  const captureRouter = new CaptureRouter();
  const preparedPageLeases = new PreparedPageLeasePool();
  const networkErrorSampler = createNetworkErrorSampler(60_000);
  const broadcastInsights = () => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send(
        "insights:changed",
        database.insights.list({ limit: 50 }),
      );
  };
  const broadcastContentRecords = () => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send(
        "content-records:changed",
        database.contentRecords.list({ limit: 50 }),
      );
  };
  type RoutedAnalysis =
    | { kind: "market"; value: Omit<MarketInsight, "id"> }
    | { kind: "content"; value: Omit<ContentRecord, "id"> };
  const insightCoordinator = new InsightCoordinator<RoutedAnalysis>({
    analyze: async (roomId, events) => {
      const parser = database.parsers.getForRoom(roomId);
      if (!parser) return [];
      const version = database.parsers
        .list()
        .find((item) => item.id === parser.id)?.publishedVersion;
      if (!version || version.state !== "published")
        throw new Error("PARSER_VERSION_NOT_PUBLISHED");
      const config = await settings.getLlmConfig();
      if (!config) throw new Error("LLM_NOT_CONFIGURED");
      const smokeSecret =
        process.env.DUODUO_REAL_SMOKE === "1"
          ? process.env.DUODUO_SMOKE_API_KEY
          : undefined;
      const secret =
        smokeSecret ??
        (config.secretId
          ? await settings.getSecret(config.secretId)
          : undefined);
      const provider = createLlmProvider(
        config,
        config.analysisModel,
        secret,
        aiUsageGateway,
        {
          featureKey: "live_insight",
          usageKind: "production",
          apiKind: "chat_completions",
          requestedModel: config.analysisModel,
          region: "cn-beijing",
          thinkingEnabled: false,
          roomId,
          parserId: version.parserId,
          parserVersionId: version.id,
        },
      );
      if ("schemaVersion" in version.spec && version.spec.schemaVersion === 4)
        return (await new AnalyzerDraftEngine(provider).analyze(roomId, version, events))
          .map((value) => ({ kind: "content" as const, value }));
      return (await new InsightEngine(provider).analyze(roomId, version, events))
        .map((value) => ({ kind: "market" as const, value }));
    },
    persist: (analysis) => {
      if (analysis.kind === "content") {
        if (!database.contentRecords.hasDuplicate(analysis.value)) {
          database.contentRecords.insert(analysis.value);
          broadcastContentRecords();
        }
      } else if (!database.insights.hasDuplicate(analysis.value)) {
        database.insights.insert(analysis.value);
        broadcastInsights();
      }
    },
  });
  const persistProbeResult = async (
    roomId: string,
    result: RoomProbeResult,
    screenshot: Buffer,
  ) => {
    if (result.status === "live" && result.followerCount === undefined) {
      diagnostic("probe_follower_missing", {
        roomId,
        profileEvidenceStatus: result.profileEvidenceStatus,
        metricQuality: result.metricQuality,
        profileCandidateDiagnostics: result.profileCandidateDiagnostics,
        profilePageDiagnostics: result.profilePageDiagnostics,
      });
    }
    const existing = database.snapshots
      .list()
      .find((item) => item.roomId === roomId);
    const coverPath = await coverCache
      .updateForStatus(roomId, result.status, result.cover, screenshot)
      .catch(() => undefined);
    let avatarPath = existing?.avatarPath;
    if (!avatarPath && result.avatar && isTrustedAvatarStatus(result.status)) {
      const cachedPath = await avatarCache
        .ensure(roomId, result.avatar)
        .catch(() => undefined);
      if (cachedPath) {
        database.snapshots.setAvatarIfMissing(roomId, cachedPath);
        avatarPath = cachedPath;
      }
    }
    const metadata =
      result.status === "live"
        ? {
            title: result.title,
            anchorName: result.anchorName,
            coverPath,
            avatarPath,
            liveDescription: result.liveDescription,
            viewerCount: result.viewerCount,
            followerCount: result.followerCount,
            totalViewerCount: result.totalViewerCount,
            likeCount: result.likeCount,
            metricRaw: result.metricRaw,
            metricEvidence: result.metricEvidence,
            metricQuality: result.metricQuality,
          }
        : {};
    const failed =
      result.status === "page_error" ||
      result.status === "timeout" ||
      result.status === "verification_required";
    database.snapshots.record({
      roomId,
      status: result.status,
      ...metadata,
      checkedAt: new Date().toISOString(),
      ...(failed ? { error: `PROBE_${result.status.toUpperCase()}` } : {}),
    });
    if (avatarPath && isTrustedAvatarStatus(result.status))
      database.snapshots.setAvatarIfMissing(roomId, avatarPath);
  };
  const manager = new RoomManager(
    async (roomId, signal, reason) => {
      const room = (await rooms.list()).find((item) => item.roomId === roomId);
      if (!room) throw new Error("ROOM_NOT_FOUND");
      const smokeKey =
        process.env.DUODUO_REAL_SMOKE === "1"
          ? process.env.DUODUO_SMOKE_API_KEY
          : undefined;
      const config = smokeKey ? undefined : await settings.getConfig();
      if (!smokeKey && !config) throw new Error("ASR_NOT_CONFIGURED");
      const secret = config?.secretId
        ? await settings.getSecret(config.secretId)
        : undefined;
      const asrUsageContext = {
        featureKey: "live_asr",
        usageKind: "production" as const,
        apiKind: "asr_realtime" as const,
        requestedModel: config?.model ?? "paraformer-realtime-v2",
        region: "cn-beijing" as const,
        roomId,
      };
      const provider = smokeKey
        ? new BailianProvider({
            apiKey: smokeKey,
            meter: (meterRoomId, taskId) =>
              aiUsageGateway.createAsrMeter(
                asrUsageContext,
                meterRoomId,
                taskId,
              ),
          })
        : createAsrProvider(config!, secret, aiUsageGateway, asrUsageContext);
      const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
      const roomUrl = fixtureOrigin
        ? `${fixtureOrigin}/${roomId}`
        : room.canonicalUrl;
      const taskType =
        reason === "user_start" ? "monitor_start" : "monitor_reconnect";
      const traffic = reason === "user_start" ? "interactive" : "automatic";
      const navigationGate: RoomNavigationGate = (run) =>
        coordinator.submit({ roomId, type: taskType, traffic, run });
      const preparedPage =
        reason === "user_start" ? preparedPageLeases.take(roomId) : undefined;
      const monitoringSession = session.fromPartition(
        roomPartitionName(roomId),
        { cache: false },
      );
      return new RoomSession(
        roomId,
        roomUrl,
        provider,
        captureRouter,
        (event) => manager.appendAsr(event),
        signal,
        monitoringSession,
        navigationGate,
        async (result, screenshot) => {
          await persistProbeResult(roomId, result, screenshot);
          await broadcastSnapshot();
        },
        async (result) => {
          database.snapshots.record({
            roomId,
            status: "live",
            viewerCount: result.viewerCount,
            followerCount: result.followerCount,
            totalViewerCount: result.totalViewerCount,
            likeCount: result.likeCount,
            metricRaw: result.metricRaw,
            metricEvidence: result.metricEvidence,
            metricQuality: result.metricQuality,
            liveDescription: result.liveDescription,
            checkedAt: new Date().toISOString(),
          });
          await broadcastSnapshot();
        },
        (event) => {
          if (networkErrorSampler.shouldLog(event))
            diagnostic("room_network_error", { roomId, ...event });
        },
        monitoringSettings.monitoredCheckSeconds,
        300_000,
        Date.now,
        preparedPage,
        () => manager.markAudioReady(roomId),
      );
    },
    {
      persistFinalAsr: (event) => {
        const stored = database.asr.insert(event);
        if (stored) insightCoordinator.accept(stored);
      },
    },
  );

  const roomIntelligence = new RoomIntelligenceService({
    listRoomIds: async () => (await rooms.list()).map((room) => room.roomId),
    listSnapshots: () => database.snapshots.list(),
    listHistorySince: (roomId, since, limit) =>
      database.snapshots.listHistorySince(roomId, since, limit),
    listSessions: (roomId) =>
      database.snapshots.listSessions(roomId) as unknown as StoredLiveSession[],
  });

  const snapshot = async () => ({
    rooms: await rooms.list(),
    runtimes: manager.snapshot(),
    snapshots: database.snapshots.list(),
  });
  const broadcastSnapshot = async () => broadcastRooms(await snapshot());
  let closing = false;
  const pendingBroadcasts = new Set<Promise<void>>();
  const queueBroadcast = () => {
    if (closing) return;
    const task = broadcastSnapshot().finally(() =>
      pendingBroadcasts.delete(task),
    );
    pendingBroadcasts.add(task);
  };
  let lastMonitoringFingerprint: string | undefined;
  const unsubscribeManager = manager.subscribe((runtime) => {
    const fingerprint = monitoringFingerprint(runtime);
    if (fingerprint !== lastMonitoringFingerprint) {
      lastMonitoringFingerprint = fingerprint;
      diagnostic("monitoring_snapshot", {
        rooms: runtime.map(({ roomId, state, liveStatus, error }) => ({
          roomId,
          state,
          liveStatus,
          error,
        })),
      });
    }
    queueBroadcast();
  });
  const playback = new PlaybackController(async (roomId) => {
    if (!mainWindow || mainWindow.isDestroyed())
      throw new Error("MAIN_WINDOW_UNAVAILABLE");
    const view = new WebContentsView({
      webPreferences: {
        session: platformSession,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    view.setBackgroundColor("#111111");
    view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
    view.webContents.setAudioMuted(true);
    view.webContents.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    );
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.contentView.addChildView(view);
    return {
      roomId,
      async load(url: string) {
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            view.webContents.loadURL(url),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error("PLAYER_LOAD_TIMEOUT")),
                15_000,
              );
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        const accessState = await inspectVerificationPage(
          view.webContents.mainFrame,
        );
        if (accessState === "verification_required")
          throw new Error("PLAYER_VERIFICATION_REQUIRED");
        if (accessState === "login_required")
          throw new Error("PLAYER_LOGIN_REQUIRED");
        await view.webContents
          .executeJavaScript(
            "(() => { const video=document.querySelector('video'); if(video){video.muted=false;video.volume=1;void video.play().catch(()=>undefined)} return true })()",
          )
          .catch(() => undefined);
      },
      setMuted(value: boolean) {
        if (!view.webContents.isDestroyed())
          view.webContents.setAudioMuted(value);
      },
      setBounds(bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
      }) {
        view.setBounds(bounds);
      },
      destroy() {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) view.webContents.close();
      },
    };
  });
  playback.subscribe((state) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("player:changed", state);
  });
  const executePreparedProbe = async (roomId: string) => {
    const room = (await rooms.list()).find((item) => item.roomId === roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    database.probeAccess.recordStartedAt(roomId, new Date().toISOString());
    database.snapshots.upsert({
      roomId,
      status: "checking",
      checkedAt: new Date().toISOString(),
    });
    await broadcastSnapshot();
    const captureToken = randomUUID();
    const probeWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        session: platformSession,
        preload: join(__dirname, "room-capture.js"),
        additionalArguments: [`--duoduo-capture-token=${captureToken}`],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    let retainedForMonitoring = false;
    probeWindow.webContents.setAudioMuted(true);
    probeWindow.webContents.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
    );
    try {
      const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
      let screenshot: Buffer | undefined;
      const result = await probeRoom(
        probeWindow.webContents,
        fixtureOrigin ? `${fixtureOrigin}/${roomId}` : room.canonicalUrl,
        20_000,
        {
          beforeProfile: async (beforeProfileResult) => {
            screenshot =
              beforeProfileResult.status === "verification_required"
                ? Buffer.alloc(0)
                : (await probeWindow.capturePage()).toPNG();
          },
        },
      );
      database.probeAccess.recordCompleted(
        roomId,
        result.status,
        new Date().toISOString(),
      );
      const verificationRequired = result.status === "verification_required";
      await persistProbeResult(
        roomId,
        result,
        screenshot ??
          (verificationRequired
            ? Buffer.alloc(0)
            : (await probeWindow.capturePage()).toPNG()),
      );
      if (result.status === "live") {
        preparedPageLeases.put(roomId, {
          roomId,
          window: probeWindow,
          captureToken,
          probe: { ...result, status: "live" },
        });
        retainedForMonitoring = true;
      }
      return {
        value: {
          probeResult: result,
        },
        verificationRequired,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      database.snapshots.record({
        roomId,
        status: "page_error",
        checkedAt: new Date().toISOString(),
        error: `PROBE_EXECUTION_FAILED:${message}`,
      });
      database.probeAccess.recordCompleted(
        roomId,
        `error:${message}`,
        new Date().toISOString(),
      );
      diagnostic("prepared_probe_failed", { roomId, error: message });
      throw error;
    } finally {
      if (!retainedForMonitoring && !probeWindow.isDestroyed())
        probeWindow.destroy();
      await broadcastSnapshot();
    }
  };
  const probeOrchestrator = new ProbeOrchestrator<{
    probeResult: RoomProbeResult;
  }>({
    execute: async (task) => {
      const requested = task.source !== "scheduled";
      const result = await coordinator.submit({
        roomId: task.roomId,
        type: requested ? "manual_probe" : "startup_probe",
        traffic: requested ? "interactive" : "automatic",
        run: () => executePreparedProbe(task.roomId),
      });
      const latestRoom = (await rooms.list()).find(
        (item) => item.roomId === task.roomId,
      );
      const activeRun = database.groupRuns.active();
      const runStillValid = Boolean(
        task.runId &&
        activeRun?.id === task.runId &&
        activeRun.status === "running",
      );
      const autoMonitorRequested = Boolean(
        latestRoom &&
        shouldAutoMonitor(latestRoom, undefined, result.probeResult.status),
      );
      if (
        autoMonitorRequested &&
        latestRoom?.groupId === task.groupId &&
        runStillValid
      )
        await startRoomMonitoring(task.roomId, false);
      diagnostic("probe_auto_monitor_decision", {
        roomId: task.roomId,
        groupId: task.groupId,
        source: task.source,
        runId: task.runId,
        requested: autoMonitorRequested,
        accepted: Boolean(
          autoMonitorRequested &&
          latestRoom?.groupId === task.groupId &&
          runStillValid,
        ),
      });
      return result;
    },
    lastStartedAt: (roomId) => database.probeAccess.lastStartedAt(roomId),
    // The durable timestamp is written inside executePreparedProbe, exactly when a real page access starts.
    recordStartedAt: () => undefined,
    preempt: (task) => coordinator.cancelRoom(task.roomId),
    cooldownMs: process.env.DUODUO_FIXTURE_ORIGIN ? 0 : 60_000,
  });
  const unsubscribeProbeAccess = coordinator.subscribe((state) =>
    state.mode === "normal"
      ? probeOrchestrator.resume()
      : probeOrchestrator.pause(),
  );
  if (coordinator.getState().mode !== "normal") probeOrchestrator.pause();
  const probeScheduler = new ProbeScheduler(
    async (roomId, source) => {
      const latestRoom = (await rooms.list()).find(
        (item) => item.roomId === roomId,
      );
      if (!latestRoom) throw new Error("ROOM_NOT_FOUND");
      const activeRun = database.groupRuns.active();
      const probeSource: ProbeSource =
        source === "scheduled" || source === "startup"
          ? "scheduled"
          : source === "manual_batch"
            ? "group_refresh"
            : "room_refresh";
      if (
        probeSource === "scheduled" &&
        (activeRun?.status !== "running" ||
          activeRun.groupId !== latestRoom.groupId)
      )
        throw new Error("GROUP_RUN_STALE");
      const outcome = await probeOrchestrator.enqueue({
        roomId,
        groupId: latestRoom.groupId,
        source: probeSource,
        ...(activeRun?.status === "running" &&
        activeRun.groupId === latestRoom.groupId
          ? { runId: activeRun.id }
          : {}),
      });
      if (outcome.status === "completed") return outcome.value.probeResult;
      if (outcome.status === "cooldown") {
        diagnostic("probe_cooldown_reused", {
          roomId,
          groupId: latestRoom.groupId,
          source: probeSource,
          cooldownUntil: outcome.cooldownUntil,
        });
        return database.snapshots.list().find((item) => item.roomId === roomId);
      }
      if (outcome.status === "failed") throw outcome.error;
      return undefined;
    },
    {
      defaultIntervalMinutes: monitoringSettings.preparedCheckMinutes,
      maxConcurrency: 1,
      jitterRatio: 0.2,
      manualCooldownMs: 60_000,
    },
  );
  const schedulePreparedRoom = (room: Room) => {
    if (room.monitoring) {
      void probeScheduler.cancel(room.roomId);
      return;
    }
    probeScheduler.schedule(room.roomId, room);
  };
  async function startRoomMonitoring(
    roomId: string,
    waitForProbeCancellation = true,
  ) {
    if (coordinator.getState().mode !== "normal")
      throw new Error("ACCESS_VERIFICATION_PAUSED");
    const target = (await rooms.list()).find((item) => item.roomId === roomId);
    const activeRun = database.groupRuns.active();
    if (
      !target ||
      activeRun?.status !== "running" ||
      activeRun.groupId !== target.groupId
    )
      throw new Error("ROOM_GROUP_NOT_RUNNING");
    await rooms.setMonitoring(roomId, true);
    try {
      const cancellation = probeScheduler.cancel(roomId);
      if (waitForProbeCancellation) await cancellation;
      await manager.startMonitoring(roomId);
    } catch (error) {
      await rooms.setMonitoring(roomId, false);
      throw error;
    }
    await broadcastSnapshot();
  }
  const reschedulePreparedRooms = async () => {
    probeScheduler.setDefaultIntervalMinutes(
      monitoringSettings.preparedCheckMinutes,
    );
    const active = database.groupRuns.active();
    if (active?.status === "running")
      for (const room of (await rooms.list()).filter(
        (item) => item.groupId === active.groupId,
      ))
        schedulePreparedRoom(room);
  };
  let stopProgress: GroupStopProgress | undefined;
  let currentRefreshGroupId: string | undefined;
  let lastRefreshResult: GroupRefreshResult | undefined;
  let broadcastGroupSnapshot: () => void = () => undefined;
  const groupRunService = new GroupRunService(database.groupRuns, {
    startScheduling: async (groupId) => {
      for (const room of (await rooms.list()).filter(
        (item) => item.groupId === groupId && !item.monitoring,
      ))
        schedulePreparedRoom(room);
    },
    cancelRun: async (_runId) => {
      const active = database.groupRuns.active();
      probeOrchestrator.cancelRun(_runId);
      if (active)
        for (const room of (await rooms.list()).filter(
          (item) => item.groupId === active.groupId,
        )) {
          coordinator.cancelRoom(room.roomId);
          await probeScheduler.cancel(room.roomId);
        }
    },
    stopRooms: async (groupId, onProgress) => {
      const failed: string[] = [];
      const targets = (await rooms.list()).filter(
        (item) => item.groupId === groupId && item.monitoring,
      );
      let completed = 0;
      const report = () => {
        stopProgress = {
          groupId,
          total: targets.length,
          completed,
          failedRoomIds: [...failed],
        };
        onProgress?.({
          total: targets.length,
          completed,
          failedRoomIds: [...failed],
        });
        broadcastGroupSnapshot();
      };
      report();
      await Promise.all(
        targets.map(async (room) => {
          try {
            await manager.stopMonitoring(room.roomId);
            await rooms.setMonitoring(room.roomId, false);
          } catch {
            failed.push(room.roomId);
          } finally {
            completed += 1;
            report();
          }
        }),
      );
      await broadcastSnapshot();
      return failed;
    },
  });
  const broadcastProbeState = (state = probeScheduler.state()) => {
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed()
    )
      mainWindow.webContents.send("rooms:probe-state", state);
    broadcastGroupSnapshot();
  };
  const unsubscribeProbeState = probeScheduler.subscribe(broadcastProbeState);
  protocol.handle("duoduo-cover", (request) => {
    if (closing) return new Response(null, { status: 410 });
    const roomId = new URL(request.url).hostname;
    const coverPath = database.snapshots
      .list()
      .find((item) => item.roomId === roomId)?.coverPath;
    return coverPath
      ? net.fetch(pathToFileURL(coverPath).toString())
      : new Response(null, { status: 404 });
  });
  protocol.handle("duoduo-avatar", (request) => {
    if (closing) return new Response(null, { status: 410 });
    const roomId = new URL(request.url).hostname;
    const avatarPath = database.snapshots
      .list()
      .find((item) => item.roomId === roomId)?.avatarPath;
    return avatarPath
      ? net.fetch(pathToFileURL(avatarPath).toString())
      : new Response(null, { status: 404 });
  });
  shutdown = async () => {
    closing = true;
    clearInterval(retentionTimer);
    unsubscribeManager();
    unsubscribeAccess();
    unsubscribeProbeAccess();
    unsubscribeProbeState();
    playback.stop();
    await probeScheduler.stop();
    preparedPageLeases.dispose();
    await coordinator.stop();
    verificationController.dispose();
    await insightCoordinator.shutdown();
    await manager.shutdown();
    await Promise.allSettled(pendingBroadcasts);
    protocol.unhandle("duoduo-cover");
    protocol.unhandle("duoduo-avatar");
    database.close();
    if (powerSaveBlocker.isStarted(powerBlockerId))
      powerSaveBlocker.stop(powerBlockerId);
  };

  ipcMain.handle("settings:get-asr-provider", () => settings.getConfig());
  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle(
    "settings:save-asr-provider",
    async (_event, config, secret) => {
      await settings.save(
        AsrProviderConfigSchema.parse(config),
        typeof secret === "string" ? secret : undefined,
      );
      await settings.ensureDefaultBailianLlm();
      return settings.getConfig();
    },
  );
  ipcMain.handle(
    "settings:test-asr-provider",
    async (_event, config, secret) => {
      const parsed = AsrProviderConfigSchema.parse(config);
      const storedSecret = parsed.secretId
        ? await settings.getSecret(parsed.secretId)
        : undefined;
      return createAsrProvider(
        parsed,
        typeof secret === "string" && secret ? secret : storedSecret,
        aiUsageGateway,
        {
          featureKey: "connection_test",
          usageKind: "test",
          apiKind: "asr_realtime",
          requestedModel: parsed.model,
          region: "cn-beijing",
        },
      ).testConnection();
    },
  );
  ipcMain.handle("settings:get-insight-notifications", () =>
    settings.getInsightNotifications(),
  );
  ipcMain.handle(
    "settings:save-insight-notifications",
    async (_event, value) => {
      await settings.saveInsightNotifications(
        InsightNotificationSettingsSchema.parse(value),
      );
      return settings.getInsightNotifications();
    },
  );
  ipcMain.handle("settings:get-monitoring", () =>
    settings.getMonitoringSettings(),
  );
  ipcMain.handle("settings:save-monitoring", async (_event, value) => {
    monitoringSettings = MonitoringSettingsSchema.parse(value);
    await settings.saveMonitoringSettings(monitoringSettings);
    manager.updateMonitoringInterval(monitoringSettings.monitoredCheckSeconds);
    await reschedulePreparedRooms();
    diagnostic("monitoring_settings_changed", monitoringSettings);
    return monitoringSettings;
  });
  ipcMain.handle("access:get-state", () => coordinator.getState());
  ipcMain.handle("access:show-verification", async () => {
    const state = coordinator.getState();
    if (state.mode === "normal") throw new Error("VERIFICATION_NOT_REQUIRED");
    const target = (await database.rooms.list()).find(
      (item) => item.roomId === state.roomId,
    );
    if (!target) throw new Error("ROOM_NOT_FOUND");
    const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
    await verificationController.show(
      fixtureOrigin ? `${fixtureOrigin}/${target.roomId}` : target.canonicalUrl,
    );
    return { url: verificationController.currentUrl() };
  });
  ipcMain.handle("access:hide-verification", () => {
    verificationController.hide();
    return true;
  });
  ipcMain.handle("access:set-verification-bounds", (_event, bounds) => {
    const parsed = z
      .object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .parse(bounds);
    verificationController.setBounds(parsed);
    return true;
  });
  ipcMain.handle("access:check-verification", async () => {
    const clear = await coordinator.beginRecoveryCheck(
      async () =>
        (await verificationController.inspectBlockedState()) === "clear",
    );
    return { clear, state: coordinator.getState() };
  });
  ipcMain.handle("access:confirm-recovery", () => {
    coordinator.confirmRecovery();
    manager.resumeAccessRetries();
    verificationController.hide();
    return coordinator.getState();
  });
  ipcMain.handle("llm:get", () => settings.getLlmConfig());
  ipcMain.handle("llm:save", async (_event, config, secret) => {
    await settings.saveLlm(
      LlmProviderConfigSchema.parse(config),
      typeof secret === "string" ? secret : undefined,
    );
    return settings.getLlmConfig();
  });
  ipcMain.handle("llm:test", async (_event, config, secret) => {
    const parsed = LlmProviderConfigSchema.parse(config);
    const stored = parsed.secretId
      ? await settings.getSecret(parsed.secretId)
      : undefined;
    return createLlmProvider(
      parsed,
      parsed.analysisModel,
      typeof secret === "string" && secret ? secret : stored,
      aiUsageGateway,
      {
        featureKey: "connection_test",
        usageKind: "test",
        apiKind: "chat_completions",
        requestedModel: parsed.analysisModel,
        region: "cn-beijing",
        thinkingEnabled: false,
      },
    ).testConnection();
  });
  ipcMain.handle("rooms:list", snapshot);
  const groupSnapshot = () => ({
    groups: database.groups.list(),
    activeRun: database.groupRuns.active(),
    lastInterruptedRun: database.groupRuns.latestInterrupted(),
    ...(stopProgress ? { stopProgress } : {}),
    ...(currentRefreshGroupId &&
    probeScheduler.state().batch?.source === "manual_batch"
      ? {
          refreshProgress: {
            groupId: currentRefreshGroupId,
            total: probeScheduler.state().batch!.total,
            completed: probeScheduler.state().batch!.completed,
            currentRoomId: probeScheduler.state().currentRoomId,
            queuedRoomIds: probeScheduler.state().queuedRoomIds,
          },
        }
      : {}),
    ...(lastRefreshResult ? { lastRefreshResult } : {}),
  });
  broadcastGroupSnapshot = () => {
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.webContents.isDestroyed()
    )
      mainWindow.webContents.send("groups:changed", groupSnapshot());
  };
  ipcMain.handle("groups:list", groupSnapshot);
  ipcMain.handle("groups:create", (_event, name, parserId) => {
    database.groups.create(
      z.string().trim().min(1).max(30).parse(name),
      z.string().min(1).nullable().optional().parse(parserId) ?? null,
    );
    return groupSnapshot();
  });
  ipcMain.handle("groups:rename", (_event, groupId, name) => {
    database.groups.rename(
      z.string().min(1).parse(groupId),
      z.string().trim().min(1).max(30).parse(name),
    );
    return groupSnapshot();
  });
  ipcMain.handle("groups:remove", (_event, groupId) => {
    database.groups.remove(z.string().min(1).parse(groupId));
    return groupSnapshot();
  });
  ipcMain.handle(
    "groups:move-room",
    async (_event, roomId, groupId, position) => {
      database.groups.moveRoom(
        z.string().min(1).parse(roomId),
        z.string().min(1).parse(groupId),
        z.number().int().nonnegative().optional().parse(position),
      );
      await broadcastSnapshot();
      return groupSnapshot();
    },
  );
  ipcMain.handle("groups:set-parser", (_event, groupId, parserId) => {
    database.groups.setParser(
      z.string().min(1).parse(groupId),
      z.string().min(1).nullable().parse(parserId),
    );
    return groupSnapshot();
  });
  ipcMain.handle("groups:start", async (_event, groupId) => {
    stopProgress = undefined;
    await groupRunService.start(z.string().min(1).parse(groupId));
    broadcastGroupSnapshot();
    return groupSnapshot();
  });
  ipcMain.handle("groups:stop", async (_event, groupId) => {
    try {
      await groupRunService.stop(z.string().min(1).parse(groupId));
      return groupSnapshot();
    } finally {
      broadcastGroupSnapshot();
    }
  });
  ipcMain.handle("groups:retry-stop", async (_event, groupId) => {
    try {
      await groupRunService.retryStop(z.string().min(1).parse(groupId));
      return groupSnapshot();
    } finally {
      broadcastGroupSnapshot();
    }
  });
  ipcMain.handle("groups:refresh", async (_event, groupId) => {
    const id = z.string().min(1).parse(groupId);
    if (
      currentRefreshGroupId &&
      currentRefreshGroupId !== id &&
      probeScheduler.state().batch?.source === "manual_batch"
    )
      throw new Error("GROUP_REFRESH_IN_PROGRESS");
    const roomIds = (await rooms.list())
      .filter((room) => room.groupId === id && !room.monitoring)
      .map((room) => room.roomId);
    currentRefreshGroupId = id;
    lastRefreshResult = undefined;
    broadcastGroupSnapshot();
    void probeScheduler
      .runBatch(roomIds, "manual_batch")
      .then((result) => {
        lastRefreshResult = {
          groupId: id,
          total: result.total,
          failedRoomIds: result.failedRoomIds,
          completedAt: new Date().toISOString(),
        };
      })
      .finally(() => {
        if (currentRefreshGroupId === id) currentRefreshGroupId = undefined;
        broadcastGroupSnapshot();
      });
    return probeScheduler.state();
  });
  ipcMain.handle("rooms:list-intelligence", () =>
    closing ? [] : roomIntelligence.listSummaries(),
  );
  ipcMain.handle("rooms:get-intelligence", (_event, roomId) => {
    if (closing) throw new Error("APP_CLOSING");
    return roomIntelligence.getDetails(z.string().min(1).parse(roomId));
  });
  ipcMain.handle("rooms:add", async (_event, input) => {
    const result = await rooms.add(RoomInputSchema.parse(input));
    await broadcastSnapshot();
    return result;
  });
  ipcMain.handle("rooms:update", async (_event, roomId, input) => {
    const result = await rooms.update(
      String(roomId),
      RoomInputSchema.parse(input),
    );
    await broadcastSnapshot();
    return result;
  });
  ipcMain.handle("rooms:remove", async (_event, roomId) => {
    const id = String(roomId);
    coordinator.cancelRoom(id);
    await probeScheduler.cancel(id);
    preparedPageLeases.remove(id);
    await manager.stopMonitoring(id);
    await rooms.remove(id);
    await broadcastSnapshot();
  });
  ipcMain.handle("rooms:set-monitoring", async (_event, roomId, monitoring) => {
    const id = String(roomId);
    const enabled = Boolean(monitoring);
    if (enabled) await startRoomMonitoring(id);
    else {
      await rooms.setMonitoring(id, false);
      await manager.stopMonitoring(id);
      const room = (await rooms.list()).find((item) => item.roomId === id);
      const active = database.groupRuns.active();
      if (
        room &&
        active?.status === "running" &&
        active.groupId === room.groupId
      )
        schedulePreparedRoom(room);
      await broadcastSnapshot();
    }
    return snapshot();
  });
  ipcMain.handle(
    "rooms:set-auto-monitor-on-live",
    async (_event, roomId, enabled) => {
      const id = z.string().min(1).parse(roomId);
      const room = await rooms.setAutoMonitorOnLive(id, Boolean(enabled));
      const latestStatus = database.snapshots
        .list()
        .find((item) => item.roomId === id)?.status;
      const activeRun = database.groupRuns.active();
      if (
        room.autoMonitorOnLive &&
        latestStatus === "live" &&
        !room.monitoring &&
        activeRun?.status === "running" &&
        activeRun.groupId === room.groupId
      )
        await startRoomMonitoring(id);
      await broadcastSnapshot();
      return snapshot();
    },
  );
  ipcMain.handle("asr:list-before", (_event, roomId, options) => {
    const id = z.string().min(1).parse(roomId);
    const parsed = z
      .object({
        limit: z.number().int().min(1).max(100),
        beforeId: z.number().int().positive().optional(),
      })
      .parse(options);
    return database.asr.listBefore(id, parsed);
  });
  const parserSnapshot = async () => ({
    parsers: database.parsers.listImmutable(),
    llmConfigured: Boolean(await settings.getLlmConfig()),
  });
  const analyzerTestPasses = new AnalyzerTestPassStore();
  ipcMain.handle("parsers:list-immutable", parserSnapshot);
  ipcMain.handle("parsers:agent-discuss", async (_event, request) => {
    const parsed = AnalyzerAgentRequestSchema.parse(request);
    const config = await settings.getLlmConfig();
    if (!config) throw new Error("LLM_NOT_CONFIGURED");
    const secret = config.secretId
      ? await settings.getSecret(config.secretId)
      : undefined;
    const provider = createLlmProvider(
      config,
      config.agentModel,
      secret,
      aiUsageGateway,
      {
        featureKey: "analyzer_agent",
        usageKind: "production",
        apiKind: "chat_completions",
        requestedModel: config.agentModel,
        region: "cn-beijing",
        thinkingEnabled: false,
      },
    );
    const completion = await provider.complete({
      system: ANALYZER_AGENT_SYSTEM_PROMPT,
      user: JSON.stringify({ conversation: parsed.messages }),
      temperature: 0.1,
    });
    const response = AnalyzerAgentResponseSchema.safeParse(completion.output);
    if (!response.success) {
      completion.metering.markBusinessOutputInvalid?.();
      throw new Error("ANALYZER_AGENT_RESPONSE_INVALID");
    }
    return AnalyzerAgentResponseSchema.parse(sanitizeAnalyzerAgentResponse(response.data));
  });
  let analyzerSampleCapture: { roomId: string; owned: boolean } | undefined;
  const stopAnalyzerSampleCapture = async (requestedRoomId?: string) => {
    if (
      !analyzerSampleCapture ||
      (requestedRoomId && analyzerSampleCapture.roomId !== requestedRoomId)
    ) return;
    const capture = analyzerSampleCapture;
    analyzerSampleCapture = undefined;
    if (capture.owned) {
      const latestRoom = (await rooms.list()).find(
        (item) => item.roomId === capture.roomId,
      );
      if (!latestRoom?.monitoring) await manager.stopMonitoring(capture.roomId);
    }
  };
  const listAnalyzerSamples = async () => {
    const roomList = await database.rooms.list();
    const snapshotByRoom = new Map(
      database.snapshots.list().map((item) => [item.roomId, item]),
    );
    const runtimeByRoom = new Map(
      manager.snapshot().map((item) => [item.roomId, item]),
    );
    const samples = roomList.flatMap((room) => {
      const snapshot = snapshotByRoom.get(room.roomId);
      const runtime = runtimeByRoom.get(room.roomId);
      const page = database.asr.listBefore(room.roomId, { limit: 100 });
      const liveText = runtime?.asr.filter((event) => event.text.trim()) ?? [];
      const effectiveStatus = runtime && !["idle", "stopped"].includes(runtime.state)
        ? runtime.liveStatus
        : snapshot?.status;
      const status =
        effectiveStatus === "live"
          ? "live"
          : effectiveStatus === "offline"
            ? "offline"
            : effectiveStatus === "checking"
              ? "checking"
              : "unavailable";
      const captureState = page.items.length > 0 || liveText.length > 0
        ? "text_ready" as const
        : runtime?.audioReady
          ? "audio_ready" as const
          : runtime?.state === "starting" || runtime?.state === "monitoring"
            ? "connecting" as const
            : status === "checking"
              ? "checking" as const
              : "idle" as const;
      return [{
        roomId: room.roomId,
        label:
          snapshot?.anchorName ??
          snapshot?.title ??
          `直播间 ${room.roomId}`,
        status,
        source:
          page.items.length > 0
            ? "history" as const
            : status === "live" || captureState === "audio_ready" || captureState === "connecting"
              ? "live_waiting" as const
              : "no_asr" as const,
        captureState,
        asrCount: page.items.length || liveText.length,
        ...((page.items.at(-1)?.occurredAt ?? liveText.at(-1)?.occurredAt)
          ? { lastAsrAt: (page.items.at(-1)?.occurredAt ?? liveText.at(-1)!.occurredAt)! }
          : {}),
      }];
    }).sort((left, right) => {
      if (left.source !== right.source) {
        const rank = { history: 0, live_waiting: 1, no_asr: 2 } as const;
        return rank[left.source] - rank[right.source];
      }
      return (right.lastAsrAt ?? "").localeCompare(left.lastAsrAt ?? "");
    });
    return AnalyzerSampleListSchema.parse({ samples });
  };
  ipcMain.handle("parsers:list-samples", listAnalyzerSamples);
  ipcMain.handle("parsers:prepare-sample", async (_event, requestedRoomId) => {
    const roomId = z.string().min(1).parse(requestedRoomId);
    const room = (await rooms.list()).find((item) => item.roomId === roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    if (analyzerSampleCapture?.roomId !== roomId)
      await stopAnalyzerSampleCapture();

    try {
      await probeScheduler.runNow(roomId, "manual");
    } catch (error) {
      if (!(error instanceof Error && error.message === "PROBE_COOLDOWN"))
        throw error;
    }
    const latestStatus = database.snapshots
      .list()
      .find((item) => item.roomId === roomId)?.status;
    if (latestStatus === "live") {
      const latestRoom = (await rooms.list()).find((item) => item.roomId === roomId)!;
      const runtime = manager.snapshot().find((item) => item.roomId === roomId);
      const alreadyCapturing = runtime?.state === "starting" || runtime?.state === "monitoring";
      if (!alreadyCapturing) await manager.startMonitoring(roomId);
      analyzerSampleCapture = { roomId, owned: !latestRoom.monitoring };
    }
    return listAnalyzerSamples();
  });
  ipcMain.handle("parsers:stop-sample-capture", async (_event, requestedRoomId) => {
    const roomId = requestedRoomId === undefined
      ? undefined
      : z.string().min(1).parse(requestedRoomId);
    await stopAnalyzerSampleCapture(roomId);
    return listAnalyzerSamples();
  });
  ipcMain.handle("parsers:test-draft", async (_event, request) => {
    const parsed = AnalyzerDraftTestRequestSchema.parse(request);
    const room = (await database.rooms.list()).find(
      (item) => item.roomId === parsed.roomId,
    );
    if (!room) throw new Error("ROOM_NOT_FOUND");
    const stored = database.asr.listBefore(parsed.roomId, { limit: 100 }).items;
    const hot = manager.snapshot().find((item) => item.roomId === parsed.roomId)?.asr ?? [];
    const available = mergeAnalyzerSampleEvents(stored, hot);
    const events = selectAnalyzerSample(available, 6_000);
    if (!events.length) throw new Error("ANALYZER_SAMPLE_EMPTY");
    const config = await settings.getLlmConfig();
    if (!config) throw new Error("LLM_NOT_CONFIGURED");
    const secret = config.secretId
      ? await settings.getSecret(config.secretId)
      : undefined;
    const result = await new AnalyzerDraftEngine(
      createLlmProvider(
        config,
        config.analysisModel,
        secret,
        aiUsageGateway,
        {
          featureKey: "analyzer_sample_test",
          usageKind: "test",
          apiKind: "chat_completions",
          requestedModel: config.analysisModel,
          region: "cn-beijing",
          thinkingEnabled: false,
          roomId: parsed.roomId,
        },
      ),
    ).test(parsed.roomId, parsed.draft, events);
    if (result.status !== "passed") return result;
    const testToken = analyzerTestPasses.issue(parsed.draft, parsed.roomId);
    return { ...result, testToken };
  });
  ipcMain.handle("parsers:publish-tested", async (_event, request) => {
    const parsed = AnalyzerPublishRequestSchema.parse(request);
    analyzerTestPasses.consume(parsed.testToken, parsed.draft);
    database.parsers.replaceSystemAnalyzer(
      ParserSpecV4Schema.parse({
        schemaVersion: 4,
        name: parsed.draft.name,
        definition: parsed.draft,
      }),
    );
    return parserSnapshot();
  });
  ipcMain.handle("insights:list", (_event, options) =>
    database.insights.list(
      z
        .object({
          roomId: z.string().min(1).optional(),
          limit: z.number().int().min(1).max(100),
          beforeId: z.number().int().positive().optional(),
        })
        .parse(options),
    ),
  );
  ipcMain.handle("content-records:list", (_event, options) =>
    database.contentRecords.list(
      z.object({
        roomId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100),
        beforeId: z.number().int().positive().optional(),
      }).parse(options),
    ),
  );
  ipcMain.handle("rooms:probe", (_event, requestedRoomId) => {
    const roomId = z.string().min(1).parse(requestedRoomId);
    void probeScheduler.runNow(roomId, "manual").catch((error) => {
      diagnostic("manual_probe_failed", {
        roomId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return probeScheduler.state();
  });
  ipcMain.handle("rooms:get-probe-state", () => probeScheduler.state());
  ipcMain.handle("rooms:probe-all", async () => {
    if (coordinator.getState().mode !== "normal")
      throw new Error("ACCESS_VERIFICATION_PAUSED");
    const active = database.groupRuns.active();
    if (!active) throw new Error("GROUP_REQUIRED");
    const ids = (await rooms.list())
      .filter((room) => room.groupId === active.groupId && !room.monitoring)
      .map((room) => room.roomId);
    void probeScheduler.runBatch(ids, "manual_batch").catch((error) => {
      diagnostic("prepared_probe_batch_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return probeScheduler.state();
  });
  ipcMain.handle("rooms:cancel-probe-batch", () => {
    probeScheduler.cancelManualBatch();
    return probeScheduler.state();
  });
  ipcMain.handle("data:get-retention", () => settings.getDataRetention());
  ipcMain.handle("ai-usage:get-dashboard", (_event, query) =>
    database.aiUsage.getDashboard(AiUsageQuerySchema.parse(query)),
  );
  ipcMain.handle("data:save-retention", async (_event, value) => {
    await settings.saveDataRetention(DataRetentionSettingsSchema.parse(value));
    return settings.getDataRetention();
  });
  ipcMain.handle("data:get-usage", async () => ({
    databaseBytes: await fileSize(databasePath),
    walBytes: await fileSize(`${databasePath}-wal`),
    avatarBytes: await directorySize(join(userDataPath, "avatars")),
    coverBytes: await directorySize(join(userDataPath, "covers")),
    logBytes: await fileSize(join(userDataPath, "diagnostics.log")),
    categories: database.maintenance.getCategoryUsage(),
  }));
  ipcMain.handle("data:preview-cleanup", (_event, request) =>
    database.maintenance.previewCleanup(CleanupRequestSchema.parse(request)),
  );
  ipcMain.handle("data:execute-cleanup", (_event, request, token) =>
    database.maintenance.executeCleanup(
      CleanupRequestSchema.parse(request),
      z.string().min(1).parse(token),
    ),
  );
  ipcMain.handle("data:compact", () => {
    database.maintenance.checkpoint();
    database.maintenance.compact();
    return true;
  });
  ipcMain.handle("data:export-backup", async () => {
    const result = await dialog.showSaveDialog({
      title: "导出完整备份",
      defaultPath: `duoduo-${new Date().toISOString().slice(0, 10)}.duoduo-backup`,
      filters: [{ name: "多多直播备份", extensions: ["duoduo-backup"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    database.maintenance.checkpoint();
    await backupService.exportTo(result.filePath);
    return { canceled: false, path: result.filePath };
  });
  ipcMain.handle("data:import-backup", async (_event, requestedMode) => {
    const mode = z.enum(["replace", "merge"]).parse(requestedMode);
    const result = await dialog.showOpenDialog({
      title: "导入完整备份",
      properties: ["openFile"],
      filters: [{ name: "多多直播备份", extensions: ["duoduo-backup"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const staging = join(userDataPath, "restore-staging");
    await backupService.stageReplace(result.filePaths[0], staging);
    if (mode === "merge") {
      database.mergeFrom(join(staging, "duoduo.sqlite"));
      await mergeImages(staging, userDataPath);
      await rm(staging, { recursive: true, force: true });
      return { canceled: false, restartRequired: false };
    }
    await writeFile(join(staging, ".replace"), "1", { mode: 0o600 });
    setTimeout(() => {
      app.relaunch();
      app.quit();
    }, 100);
    return { canceled: false, restartRequired: true };
  });
  ipcMain.handle("rooms:refresh-avatar", async (_event, requestedRoomId) => {
    const roomId = z.string().min(1).parse(requestedRoomId);
    const room = (await rooms.list()).find((item) => item.roomId === roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    return coordinator.submit({
      roomId,
      type: "avatar_refresh",
      run: async () => {
        const coverWindow = new BrowserWindow({
          show: false,
          webPreferences: {
            session: platformSession,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: false,
          },
        });
        coverWindow.webContents.setAudioMuted(true);
        coverWindow.webContents.setWindowOpenHandler(() => ({
          action: "deny",
        }));
        try {
          const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
          const result = await probeRoom(
            coverWindow.webContents,
            fixtureOrigin ? `${fixtureOrigin}/${roomId}` : room.canonicalUrl,
          );
          if (result.status === "verification_required")
            return { value: await snapshot(), verificationRequired: true };
          if (!isTrustedAvatarStatus(result.status))
            throw new Error(`AVATAR_SOURCE_UNTRUSTED:${result.status}`);
          if (!result.avatar)
            throw new Error(`AVATAR_NOT_FOUND:${result.status}`);
          const avatarPath = await avatarCache.refresh(roomId, result.avatar);
          const existing = database.snapshots
            .list()
            .find((item) => item.roomId === roomId);
          database.snapshots.upsert({
            roomId,
            status: result.status,
            title: result.title ?? existing?.title,
            anchorName: result.anchorName ?? existing?.anchorName,
            coverPath: existing?.coverPath,
            liveDescription:
              result.liveDescription ?? existing?.liveDescription,
            viewerCount: result.viewerCount ?? existing?.viewerCount,
            followerCount: result.followerCount ?? existing?.followerCount,
            totalViewerCount:
              result.totalViewerCount ?? existing?.totalViewerCount,
            likeCount: result.likeCount ?? existing?.likeCount,
            metricRaw: result.metricRaw ?? existing?.metricRaw,
            metricEvidence: result.metricEvidence ?? existing?.metricEvidence,
            metricQuality: result.metricQuality ?? existing?.metricQuality,
            checkedAt: new Date().toISOString(),
          });
          database.snapshots.replaceAvatar(roomId, avatarPath);
          await broadcastSnapshot();
          return { value: await snapshot() };
        } finally {
          if (!coverWindow.isDestroyed()) coverWindow.destroy();
        }
      },
    });
  });
  ipcMain.handle("player:get-state", () => playback.state());
  ipcMain.handle("player:play", async (_event, roomId) => {
    const id = z.string().min(1).parse(roomId);
    const room = (await rooms.list()).find((item) => item.roomId === id);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
    return coordinator.submit({
      roomId: id,
      type: "user_play",
      traffic: "interactive",
      run: async () => {
        const value = await playback.play(
          id,
          fixtureOrigin ? `${fixtureOrigin}/${id}` : room.canonicalUrl,
        );
        return {
          value,
          verificationRequired: value.error === "PLAYER_VERIFICATION_REQUIRED",
        };
      },
    });
  });
  ipcMain.handle("player:stop", () => playback.stop());
  ipcMain.handle("player:set-bounds", (_event, bounds) => {
    const parsed = z
      .object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .parse(bounds);
    playback.setBounds(parsed);
  });

  database.groupRuns.interruptOnStartup();
  for (const room of await rooms.list())
    if (room.monitoring) await rooms.setMonitoring(room.roomId, false);
  diagnostic("before-window");
  await createWindow();
  diagnostic("window-loaded");
  if (process.env.DUODUO_REAL_INSIGHT_SMOKE === "1") {
    const parser = database.parsers.list()[0];
    if (parser?.publishedVersion)
      for (const room of await rooms.list())
        database.parsers.bindRoom(
          room.roomId,
          parser.id,
          parser.publishedVersion.id,
        );
  }
  if (process.env.DUODUO_E2E_ROOM_INTELLIGENCE_REPORT && mainWindow) {
    const reportPath = process.env.DUODUO_E2E_ROOM_INTELLIGENCE_REPORT;
    const screenshotPath = process.env.DUODUO_E2E_ROOM_INTELLIGENCE_SCREENSHOT;
    void (async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const ready = await mainWindow!.webContents.executeJavaScript(
          "Boolean(document.querySelector('.card .room-label'))",
        );
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const beforeLocalReads = roomIntelligenceRealRequestCount;
      const cardState = await mainWindow!.webContents
        .executeJavaScript(`(() => {
        const cards=Array.from(document.querySelectorAll('.card'));
        const top=cards.find((card)=>card.textContent.includes('https://live.douyin.com/100'));
        const empty=cards.find((card)=>card.textContent.includes('https://live.douyin.com/600'));
        const labels=top ? Array.from(top.querySelectorAll('.room-label')) : [];
        const state={topFound:Boolean(top),avatarVisible:Boolean(top?.querySelector('.avatar')),labelCount:labels.length,labelTexts:labels.map((label)=>label.textContent),tooltip:String(labels[0]?.getAttribute('title')??''),emptyAccumulating:Boolean(empty?.textContent.includes('数据积累中'))};
        labels[0]?.click();
        return state;
      })()`);
      while (Date.now() < deadline) {
        const ready = await mainWindow!.webContents.executeJavaScript(
          "Boolean(document.querySelector('.intelligence-drawer'))",
        );
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const detailsState = await mainWindow!.webContents
        .executeJavaScript(`(() => {
        const drawer=document.querySelector('.intelligence-drawer');
        const text=drawer?.textContent??'';
        return {opened:Boolean(drawer),allLabelCount:drawer?.querySelectorAll('.intelligence-evidence article').length??0,hasTrend:text.includes('在线人数趋势'),hasStartEvidence:text.includes('开播证据：'),hasStopEvidence:text.includes('停播证据：'),hasObservedDisclaimer:text.includes('不等同于平台完整直播时长'),containsSyntheticZero:/在线人数\s*0(?:\D|$)/.test(text)};
      })()`);
      if (screenshotPath)
        await writeFile(
          screenshotPath,
          (await mainWindow!.webContents.capturePage()).toPNG(),
        );
      const afterLocalReads = roomIntelligenceRealRequestCount;
      await writeFile(
        reportPath,
        `${JSON.stringify({ version: app.getVersion(), beforeLocalReads, afterLocalReads, realDouyinRequests: roomIntelligenceRealRequestCount, cardState, detailsState }, null, 2)}\n`,
      );
      app.quit();
    })().catch(async (error) => {
      await writeFile(
        reportPath,
        `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
      );
      app.exit(2);
    });
  }
  if (process.env.DUODUO_E2E_VERIFICATION_REPORT) {
    const reportPath = process.env.DUODUO_E2E_VERIFICATION_REPORT;
    void (async () => {
      const deadline = Date.now() + 10_000;
      while (coordinator.getState().mode === "normal" && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50));
      const initialPaused = coordinator.getState();
      if (initialPaused.mode !== "verification_paused")
        throw new Error("VERIFICATION_E2E_PAUSE_TIMEOUT");
      const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
      if (!fixtureOrigin) throw new Error("VERIFICATION_E2E_FIXTURE_MISSING");
      await verificationController.show(
        `${fixtureOrigin}/${initialPaused.roomId}`,
      );
      const blockedInspection =
        await verificationController.inspectBlockedState();
      await new Promise((resolve) => setTimeout(resolve, 900));
      const cleared = await coordinator.beginRecoveryCheck(
        async () =>
          (await verificationController.inspectBlockedState()) === "clear",
      );
      const beforeConfirmation = coordinator.getState();
      coordinator.confirmRecovery();
      manager.resumeAccessRetries();
      verificationController.hide();
      const afterConfirmation = coordinator.getState();
      const roomSnapshot = database.snapshots
        .list()
        .find((item) => item.roomId === initialPaused.roomId);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(
        reportPath,
        `${JSON.stringify({ initialPaused, blockedInspection, cleared, beforeConfirmation, afterConfirmation, snapshot: roomSnapshot }, null, 2)}\n`,
      );
      app.quit();
    })().catch(async (error) => {
      await writeFile(
        reportPath,
        `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
      );
      app.exit(2);
    });
  }
  if (process.env.DUODUO_REPLAY_INSIGHT_REPORT) {
    const replayReport = process.env.DUODUO_REPLAY_INSIGHT_REPORT;
    const replayScreenshot = process.env.DUODUO_REPLAY_INSIGHT_SCREENSHOT;
    const replayRooms = await rooms.list();
    for (const room of replayRooms)
      for (const event of database.asr.listBefore(room.roomId, { limit: 100 })
        .items)
        insightCoordinator.accept(event);
    setTimeout(() => {
      void (async () => {
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          const settled = replayRooms.every(
            (room) =>
              !["buffering", "analyzing"].includes(
                insightCoordinator.status(room.roomId).state,
              ),
          );
          if (settled && insightCoordinator.resourceCount() === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        const report = {
          source: "saved-real-asr-replay",
          rooms: replayRooms.map((room) => ({
            roomId: room.roomId,
            asrCount: database.asr.listBefore(room.roomId, { limit: 100 }).items
              .length,
          })),
          insights: database.insights.list({ limit: 100 }).items,
          statuses: Object.fromEntries(
            replayRooms.map((room) => [
              room.roomId,
              insightCoordinator.status(room.roomId),
            ]),
          ),
          resources: insightCoordinator.resourceCount(),
        };
        if (replayScreenshot && mainWindow) {
          await mainWindow.webContents.executeJavaScript(
            `Array.from(document.querySelectorAll('button')).find((button)=>button.textContent.includes('观点中心'))?.click()`,
          );
          await new Promise((resolve) => setTimeout(resolve, 400));
          await writeFile(
            replayScreenshot,
            (await mainWindow.webContents.capturePage()).toPNG(),
          );
        }
        await writeFile(replayReport, `${JSON.stringify(report, null, 2)}\n`);
        app.quit();
      })();
    }, 10_000);
  }
  if (process.env.DUODUO_E2E_PLAYER_REPORT) {
    diagnostic("player-e2e-scheduled");
    const reportPath = process.env.DUODUO_E2E_PLAYER_REPORT;
    const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
    const available = (await rooms.list()).slice(0, 2);
    setTimeout(() => {
      void (async () => {
        diagnostic("player-e2e-started");
        if (!fixtureOrigin || available.length < 2)
          throw new Error("PLAYER_E2E_FIXTURE_MISSING");
        const steps = [];
        steps.push({
          action: "initial",
          state: playback.state(),
          resources: playback.resourceCount(),
        });
        await playback.play(
          available[0].roomId,
          `${fixtureOrigin}/${available[0].roomId}`,
        );
        playback.setBounds({ x: 980, y: 122, width: 420, height: 700 });
        steps.push({
          action: "play-first",
          state: playback.state(),
          resources: playback.resourceCount(),
        });
        await playback.play(
          available[1].roomId,
          `${fixtureOrigin}/${available[1].roomId}`,
        );
        steps.push({
          action: "switch-second",
          state: playback.state(),
          resources: playback.resourceCount(),
        });
        playback.stop();
        steps.push({
          action: "stop",
          state: playback.state(),
          resources: playback.resourceCount(),
        });
        await writeFile(
          reportPath,
          `${JSON.stringify({ version: app.getVersion(), steps }, null, 2)}\n`,
        );
        diagnostic("player-e2e-complete");
        app.quit();
      })().catch(async (error) => {
        await writeFile(
          reportPath,
          `${JSON.stringify({ error: String(error) }, null, 2)}\n`,
        );
        app.exit(2);
      });
    }, 500);
  }
  if (process.env.DUODUO_E2E_INSIGHT_REPORT && mainWindow) {
    const reportPath = process.env.DUODUO_E2E_INSIGHT_REPORT;
    const screenshotPath = process.env.DUODUO_E2E_INSIGHT_SCREENSHOT;
    void (async () => {
      const room = (await rooms.list())[0];
      if (!room) throw new Error("INSIGHT_E2E_ROOM_MISSING");
      await probeScheduler.cancel(room.roomId);
      const parser = database.parsers.listImmutable()[0];
      if (!parser) throw new Error("INSIGHT_E2E_PARSER_MISSING");
      database.groups.setParser(room.groupId, parser.id);
      broadcastGroupSnapshot();
      const texts = [
        "今天指数虽然是红的，但是量没有明显放出来。",
        "现在市场情绪只能算修复，还不能说反转。",
        "大家点点赞，我们稍后继续看下午的量。",
      ];
      texts.forEach((text, index) => {
        const stored = database.asr.insert({
          roomId: room.roomId,
          sessionId: "insight-e2e",
          segmentId: `segment-${index}`,
          startMs: index * 5000,
          endMs: index * 5000 + 4000,
          text,
          isFinal: true,
          occurredAt: `2026-07-13T02:30:0${index}.000Z`,
        });
        if (stored) insightCoordinator.accept(stored);
      });
      const deadline = Date.now() + 20_000;
      while (
        database.insights.list({ roomId: room.roomId, limit: 10 }).items
          .length === 0 &&
        Date.now() < deadline
      )
        await new Promise((resolve) => setTimeout(resolve, 250));
      if (
        database.insights.list({ roomId: room.roomId, limit: 10 }).items
          .length === 0
      )
        throw new Error(
          `INSIGHT_E2E_TIMEOUT:${JSON.stringify({ status: insightCoordinator.status(room.roomId), group: database.groups.get(room.groupId), parser: database.parsers.getForRoom(room.roomId)?.id, asrCount: database.asr.listBefore(room.roomId, { limit: 50 }).items.length })}`,
        );
      await rooms.setMonitoring(room.roomId, true);
      await broadcastSnapshot();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const notificationVisible =
        await mainWindow!.webContents.executeJavaScript(
          `Boolean(document.querySelector('.insight-notification-open'))`,
        );
      await mainWindow!.webContents.executeJavaScript(
        `document.querySelector('.insight-notification-open')?.click()`,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      const navigation = await mainWindow!.webContents.executeJavaScript(
        `({roomCard:Boolean(document.querySelector(${JSON.stringify(`#room-card-${room.roomId}`)})),focusedInsight:Boolean(document.querySelector('.live-insight-item.focused')),insightTab:Array.from(document.querySelectorAll('.live-tabs button')).some((button)=>button.classList.contains('active')&&button.textContent.includes('内容分析'))})`,
      );
      const copiedParser = database.parsers.copyImmutable(parser.id, {
        ...parser.spec,
        name: `${parser.spec.name} E2E 副本`,
      });
      if (screenshotPath)
        await writeFile(
          screenshotPath,
          (await mainWindow!.webContents.capturePage()).toPNG(),
        );
      const insightPage = database.insights.list({
        roomId: room.roomId,
        limit: 10,
      });
      await writeFile(
        reportPath,
        `${JSON.stringify({ version: app.getVersion(), roomId: room.roomId, formalInsights: insightPage.items, groupParserId: database.groups.get(room.groupId)?.parserId, copiedParserId: copiedParser.id, notificationVisible, navigation, resourcesBeforeQuit: insightCoordinator.resourceCount() }, null, 2)}\n`,
      );
      app.quit();
    })().catch(async (error) => {
      await writeFile(
        reportPath,
        `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`,
      );
      app.exit(2);
    });
  }
  if (process.env.DUODUO_E2E_SCREENSHOT && mainWindow) {
    const screenshotPath = process.env.DUODUO_E2E_SCREENSHOT;
    const preparedScreenshotPath = process.env.DUODUO_E2E_PREPARED_SCREENSHOT;
    const preparedRoomId = process.env.DUODUO_E2E_PREPARED_ROOM;
    const e2eLogPath = process.env.DUODUO_E2E_LOG;
    const deadline =
      Date.now() + Number(process.env.DUODUO_E2E_TIMEOUT_MS ?? 20_000);
    void (async () => {
      const group = database.groups.list()[0];
      if (!group) throw new Error("E2E_GROUP_MISSING");
      await groupRunService.start(group.id);
      const targetRoomIds = (await rooms.list())
        .map((room) => room.roomId)
        .filter((roomId) => roomId !== preparedRoomId)
        .slice(0, 9);
      for (const roomId of targetRoomIds) await startRoomMonitoring(roomId);
      if (preparedRoomId)
        await probeScheduler.runNow(preparedRoomId, "initial");
    })().catch(async (error) => {
      if (e2eLogPath)
        await appendFile(
          e2eLogPath,
          `${JSON.stringify({ bootstrapError: error instanceof Error ? error.message : String(error) })}\n`,
        );
      app.exit(2);
    });
    const timer = setInterval(() => {
      const runtimes = manager.snapshot();
      if (e2eLogPath)
        void appendFile(
          e2eLogPath,
          `${JSON.stringify(runtimes.map((runtime) => ({ roomId: runtime.roomId, state: runtime.state, liveStatus: runtime.liveStatus, asr: runtime.asr.length, error: runtime.error })))}\n`,
        );
      const preparedReady =
        !preparedRoomId ||
        database.snapshots
          .list()
          .some(
            (item) =>
              item.roomId === preparedRoomId && item.status !== "checking",
          );
      if (
        runtimes.length >= 9 &&
        runtimes.every((runtime) => runtime.asr.length > 0) &&
        preparedReady
      ) {
        clearInterval(timer);
        setTimeout(() => {
          void mainWindow!.webContents
            .capturePage()
            .then((image) => writeFile(screenshotPath, image.toPNG()))
            .then(async () => {
              if (!preparedScreenshotPath) return;
              await mainWindow!.webContents.executeJavaScript(
                "document.querySelector('.grid')?.scrollIntoView({block:'start'})",
              );
              await new Promise((resolve) => setTimeout(resolve, 300));
              await writeFile(
                preparedScreenshotPath,
                (await mainWindow!.webContents.capturePage()).toPNG(),
              );
            })
            .then(() => manager.shutdown())
            .then(() => app.quit());
        }, 750);
        return;
      }
      if (Date.now() >= deadline) {
        clearInterval(timer);
        app.exit(2);
      }
    }, 250);
  }
  if (process.env.DUODUO_REAL_SMOKE_REPORT && mainWindow) {
    const reportPath = process.env.DUODUO_REAL_SMOKE_REPORT;
    const screenshotPath = process.env.DUODUO_REAL_SMOKE_SCREENSHOT;
    const durationMs = Math.min(
      Number(process.env.DUODUO_REAL_SMOKE_DURATION_MS ?? 600_000),
      1_200_000,
    );
    const startedAt = Date.now();
    setTimeout(() => {
      const runtimes = manager.snapshot();
      const report = {
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        durationMs,
        rooms: runtimes.map((runtime) => ({
          roomId: runtime.roomId,
          state: runtime.state,
          liveStatus: runtime.liveStatus,
          asrCount: runtime.asr.length,
          finalCount: runtime.asr.filter((event) => event.isFinal).length,
          texts: runtime.asr
            .filter((event) => event.isFinal)
            .slice(-5)
            .map((event) => event.text),
          error: runtime.error,
        })),
        insights: database.insights.list({ limit: 100 }).items,
        bindings: database.parsers.listBindings(),
        insightResources: insightCoordinator.resourceCount(),
      };
      const screenshot = screenshotPath
        ? (async () => {
            if (process.env.DUODUO_REAL_INSIGHT_SMOKE === "1") {
              await mainWindow!.webContents.executeJavaScript(
                `Array.from(document.querySelectorAll('button')).find((button)=>button.textContent.includes('观点中心'))?.click()`,
              );
              await new Promise((resolve) => setTimeout(resolve, 400));
            }
            await writeFile(
              screenshotPath,
              (await mainWindow!.webContents.capturePage()).toPNG(),
            );
          })()
        : Promise.resolve();
      void screenshot
        .then(() =>
          writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`),
        )
        .then(() => manager.shutdown())
        .then(() => app.quit());
    }, durationMs);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  if (!shutdown) return;
  event.preventDefault();
  const run = shutdown;
  shutdown = undefined;
  void run().finally(() => app.quit());
});

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}
async function directorySize(path: string): Promise<number> {
  try {
    let total = 0;
    for (const entry of await readdir(path, { withFileTypes: true }))
      total += entry.isDirectory()
        ? await directorySize(join(path, entry.name))
        : entry.isFile()
          ? await fileSize(join(path, entry.name))
          : 0;
    return total;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}
async function applyPendingRestore(userDataPath: string): Promise<void> {
  const staging = join(userDataPath, "restore-staging");
  try {
    await stat(join(staging, ".replace"));
  } catch {
    return;
  }
  const databasePath = join(userDataPath, "duoduo.sqlite");
  try {
    await stat(databasePath);
    const recoveryDirectory = join(userDataPath, "backups");
    await new BackupService(
      databasePath,
      join(userDataPath, "avatars"),
      join(userDataPath, "covers"),
    ).exportTo(
      join(
        recoveryDirectory,
        `pre-restore-${new Date().toISOString().replaceAll(":", "-")}.duoduo-backup`,
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const replacement = `${databasePath}.${process.pid}.restore`;
  await copyFile(join(staging, "duoduo.sqlite"), replacement);
  await rename(replacement, databasePath);
  for (const directory of ["avatars", "covers"]) {
    await rm(join(userDataPath, directory), { recursive: true, force: true });
    try {
      await rename(join(staging, directory), join(userDataPath, directory));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await rm(staging, { recursive: true, force: true });
}
async function mergeImages(
  staging: string,
  userDataPath: string,
): Promise<void> {
  for (const directory of ["avatars", "covers"]) {
    const source = join(staging, directory);
    const destination = join(userDataPath, directory);
    await mkdir(destination, { recursive: true });
    try {
      for (const entry of await readdir(source, { withFileTypes: true }))
        if (entry.isFile()) {
          const target = join(destination, entry.name);
          try {
            await stat(target);
          } catch {
            await copyFile(join(source, entry.name), target);
          }
        }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
async function pruneDiagnosticLog(path: string, days: number): Promise<void> {
  try {
    const cutoff = Date.now() - days * 86_400_000;
    const lines = (await readFile(path, "utf8")).split("\n").filter((line) => {
      const timestamp = Date.parse(line.slice(0, 24));
      return !Number.isFinite(timestamp) || timestamp >= cutoff;
    });
    await writeFile(
      path,
      lines.filter(Boolean).join("\n") + (lines.some(Boolean) ? "\n" : ""),
      { encoding: "utf8", mode: 0o600 },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
