import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, powerSaveBlocker, protocol, safeStorage, session, WebContentsView } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { appendFile, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { z } from "zod";
import { AsrProviderConfigSchema, CleanupRequestSchema, DataRetentionSettingsSchema, InsightNotificationSettingsSchema, LlmProviderConfigSchema, MonitoringSettingsSchema, ParserSpecSchema, RoomInputSchema } from "../shared/contracts";
import { DuoduoDatabase } from "./storage/database";
import { SettingsStore } from "./storage/settings-store";
import { createAsrProvider } from "./asr/provider-factory";
import { CaptureRouter } from "./audio/capture-router";
import { RoomManager } from "./rooms/room-manager";
import { RoomSession, type RoomNavigationGate } from "./rooms/room-session";
import { BailianProvider } from "./asr/bailian-provider";
import { ProbeScheduler, splitPreparedStartupRooms } from "./rooms/probe-scheduler";
import { CoverCache } from "./rooms/cover-cache";
import { AvatarCache } from "./rooms/avatar-cache";
import { BackupService } from "./storage/backup-service";
import { probeRoom } from "./rooms/live-probe";
import type { RoomProbeResult } from "./rooms/live-probe";
import { PlaybackController } from "./player/playback-controller";
import { createLlmProvider } from "./llm/provider-factory";
import { InsightEngine } from "./insights/insight-engine";
import { InsightCoordinator } from "./insights/insight-coordinator";
import { createDiagnosticLog, createNetworkErrorSampler, decideRendererRecovery, monitoringFingerprint } from "./diagnostics";
import { douyinPlatformPartitionName } from "./rooms/partitions";
import { DouyinAccessCoordinator } from "./rooms/douyin-access-coordinator";
import { acquireProcessLock, revealExistingWindow } from "./application-lifecycle";
import { EmbeddedVerificationController } from "./rooms/embedded-verification-controller";
import { inspectVerificationPage } from "./rooms/verification-page-inspector";
import type { Room } from "../shared/contracts";
import { isTrustedAvatarStatus, reconcileAvatarPaths } from "./rooms/avatar-reconciliation";
import { RoomIntelligenceService, type StoredLiveSession } from "./rooms/room-intelligence";
import { shouldAutoMonitor } from "./rooms/auto-monitor";

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("log-level", "3");

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | undefined;
let shutdown: (() => Promise<void>) | undefined;
let persistentDiagnostic: ReturnType<typeof createDiagnosticLog> | undefined;
let lastMainRendererCrashAt: number | undefined;
const processLock = acquireProcessLock(join(app.getPath("userData"), "duoduo.pid"));
const hasSingleInstanceLock = processLock.acquired && app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) { processLock.release(); app.quit(); }
else app.on("second-instance", () => revealExistingWindow(mainWindow));
app.on("will-quit", () => processLock.release());
const diagnosticLog = process.env.DUODUO_E2E_LOG;
function diagnostic(message: string, details: Record<string, unknown> = {}) {
  if (diagnosticLog) void appendFile(diagnosticLog, `${new Date().toISOString()} ${message} ${JSON.stringify(details)}\n`);
  void persistentDiagnostic?.(message, details);
}
diagnostic("main-loaded");

function broadcastRooms(rooms: unknown) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send("rooms:changed", rooms);
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
    if (details.reason === "clean-exit" || !mainWindow || mainWindow.isDestroyed()) return;
    const recovery = decideRendererRecovery(lastMainRendererCrashAt, Date.now(), 60_000);
    lastMainRendererCrashAt = recovery.crashAt;
    diagnostic("main_renderer_gone", { reason: details.reason, exitCode: details.exitCode, action: recovery.action });
    if (recovery.action === "reload") setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload(); }, 500);
    else void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent("<!doctype html><meta charset='utf-8'><style>body{font:16px system-ui;background:#f4f6fa;color:#172033;display:grid;place-items:center;height:100vh;margin:0}main{max-width:560px;padding:32px;background:white;border-radius:16px;box-shadow:0 8px 30px #0001}h1{font-size:22px}</style><main><h1>界面渲染进程连续异常</h1><p>系统已停止自动重载，避免反复白屏和资源消耗。请重新启动应用；故障记录已保存到 diagnostics.log。</p></main>")}`);
  });
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else await mainWindow.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  diagnostic("app-ready");
  const powerBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  const userDataPath = app.getPath("userData");
  await applyPendingRestore(userDataPath);
  persistentDiagnostic = createDiagnosticLog(join(userDataPath, "diagnostics.log"));
  diagnostic("diagnostics_ready");
  const databasePath = join(userDataPath, "duoduo.sqlite");
  const database = new DuoduoDatabase(databasePath);
  await database.migrateLegacyRooms(join(userDataPath, "rooms.json"));
  const rooms = database.rooms;
  const coverCache = new CoverCache(join(userDataPath, "covers"), (url) => net.fetch(url), (bytes) => nativeImage.createFromBuffer(bytes).toPNG());
  const avatarCache = new AvatarCache(join(userDataPath, "avatars"), (url) => net.fetch(url), (bytes) => nativeImage.createFromBuffer(bytes).toPNG());
  const repairedAvatarRoomIds = await reconcileAvatarPaths((await rooms.list()).map((room) => room.roomId), avatarCache, database.snapshots);
  if (repairedAvatarRoomIds.length) diagnostic("avatar_paths_reconciled", { roomIds: repairedAvatarRoomIds });
  const backupService = new BackupService(databasePath, join(userDataPath, "avatars"), join(userDataPath, "covers"));
  const settings = new SettingsStore(join(app.getPath("userData"), "settings.json"), {
    encryptString(value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("SECURE_STORAGE_UNAVAILABLE");
      return safeStorage.encryptString(value).toString("base64");
    },
    decryptString(value) { return safeStorage.decryptString(Buffer.from(value, "base64")); },
  });
  await settings.ensureDefaultBailianLlm();
  const platformSession = session.fromPartition(douyinPlatformPartitionName, { cache: false });
  platformSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  let roomIntelligenceRealRequestCount = 0;
  if (process.env.DUODUO_E2E_ROOM_INTELLIGENCE_REPORT) {
    platformSession.webRequest.onBeforeRequest({ urls: ["https://live.douyin.com/*"] }, (_details, callback) => {
      roomIntelligenceRealRequestCount += 1;
      callback({ cancel: true });
    });
  }
  const storedAccessState = await settings.getDouyinAccessState();
  const recentSnapshots = database.snapshots.list();
  const existingVerification = recentSnapshots.find((item) => item.status === "verification_required");
  const repeatedPageError = recentSnapshots.filter((item) => item.status === "page_error" && Date.now() - Date.parse(item.checkedAt) < 30 * 60_000).length >= 3 ? recentSnapshots.find((item) => item.status === "page_error") : undefined;
  const blockedSnapshot = existingVerification ?? repeatedPageError;
  const initialAccessState = storedAccessState.mode === "normal" && blockedSnapshot
    ? { mode: "verification_paused" as const, roomId: blockedSnapshot.roomId, taskType: "startup_probe" as const, triggeredAt: blockedSnapshot.checkedAt, reason: existingVerification ? "verification_required" as const : "suspected_verification" as const }
    : storedAccessState;
  const coordinator = new DouyinAccessCoordinator({
    initialState: initialAccessState,
    minimumGapMs: process.env.DUODUO_FIXTURE_ORIGIN ? 0 : 60_000,
    automaticBudgetPerHour: process.env.DUODUO_FIXTURE_ORIGIN ? Number.POSITIVE_INFINITY : 10,
    persistState: (state) => settings.saveDouyinAccessState(state),
  });
  const restoredAccessState = coordinator.getState();
  if (JSON.stringify(restoredAccessState) !== JSON.stringify(storedAccessState)) await settings.saveDouyinAccessState(restoredAccessState);
  const broadcastAccessState = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("access:changed", coordinator.getState()); };
  const unsubscribeAccess = coordinator.subscribe(() => broadcastAccessState());
  const verificationController = new EmbeddedVerificationController(() => {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error("MAIN_WINDOW_UNAVAILABLE");
    const view = new WebContentsView({ webPreferences: { session: platformSession, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    view.setBackgroundColor("#ffffff");
    view.setVisible(false);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.contentView.addChildView(view);
    return {
      async loadURL(url: string) {
        try { await view.webContents.loadURL(url); }
        catch (error) { if (view.webContents.isDestroyed()) throw error; }
      },
      setBounds(bounds: { x: number; y: number; width: number; height: number }) { view.setBounds(bounds); },
      setVisible(visible: boolean) { view.setVisible(visible); },
      currentUrl() { return view.webContents.getURL(); },
      async inspectBlockedState() {
        const startedAt = Date.now();
        const host = (() => {
          try { return new URL(view.webContents.getURL()).hostname; }
          catch { return "unknown"; }
        })();
        const isLoading = view.webContents.isLoading();
        diagnostic("verification_check_started", { host, isLoading });
        try {
          const result = await inspectVerificationPage(view.webContents.mainFrame);
          diagnostic("verification_check_completed", { host, isLoading, durationMs: Date.now() - startedAt, result });
          return result;
        } catch (error) {
          diagnostic("verification_check_failed", { host, isLoading, durationMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      },
      destroy() {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) view.webContents.close();
      },
      isDestroyed() { return view.webContents.isDestroyed(); },
    };
  });
  let monitoringSettings = await settings.getMonitoringSettings();
  const runRetention = async () => { const retention = await settings.getDataRetention(); const removed = database.maintenance.runAutomaticRetention(retention); await pruneDiagnosticLog(join(userDataPath, "diagnostics.log"), retention.logDays); return removed; };
  await runRetention();
  const retentionTimer = setInterval(() => { void runRetention(); }, 86_400_000);
  const captureRouter = new CaptureRouter();
  const networkErrorSampler = createNetworkErrorSampler(60_000);
  const broadcastInsights = () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("insights:changed", database.insights.list({ limit: 50 }));
  };
  const insightCoordinator = new InsightCoordinator({
    analyze: async (roomId, events) => {
      const binding = database.parsers.getBinding(roomId);
      if (!binding) return [];
      const version = database.parsers.getVersion(binding.parserVersionId);
      if (!version || version.state !== "published") throw new Error("PARSER_VERSION_NOT_PUBLISHED");
      const config = await settings.getLlmConfig();
      if (!config) throw new Error("LLM_NOT_CONFIGURED");
      const smokeSecret = process.env.DUODUO_REAL_SMOKE === "1" ? process.env.DUODUO_SMOKE_API_KEY : undefined;
      const secret = smokeSecret ?? (config.secretId ? await settings.getSecret(config.secretId) : undefined);
      return new InsightEngine(createLlmProvider({ ...config, model: version.spec.model }, secret)).analyze(roomId, version, events);
    },
    persist: (insight) => { if (!database.insights.hasDuplicate(insight)) { database.insights.insert(insight); broadcastInsights(); } },
  });
  const persistProbeResult = async (roomId: string, result: RoomProbeResult, screenshot: Buffer) => {
    const existing = database.snapshots.list().find((item) => item.roomId === roomId);
    const coverPath = await coverCache.updateForStatus(roomId, result.status, result.cover, screenshot).catch(() => undefined);
    let avatarPath = existing?.avatarPath;
    if (!avatarPath && result.avatar && isTrustedAvatarStatus(result.status)) {
      const cachedPath = await avatarCache.ensure(roomId, result.avatar).catch(() => undefined);
      if (cachedPath) {
        database.snapshots.setAvatarIfMissing(roomId, cachedPath);
        avatarPath = cachedPath;
      }
    }
    const metadata = result.status === "live" ? { title: result.title, anchorName: result.anchorName, coverPath, avatarPath, viewerCount: result.viewerCount, followerCount: result.followerCount, totalViewerCount: result.totalViewerCount, likeCount: result.likeCount, metricRaw: result.metricRaw, metricEvidence: result.metricEvidence, metricQuality: result.metricQuality } : {};
    const failed = result.status === "page_error" || result.status === "timeout" || result.status === "verification_required";
    database.snapshots.record({ roomId, status: result.status, ...metadata, checkedAt: new Date().toISOString(), ...(failed ? { error: `PROBE_${result.status.toUpperCase()}` } : {}) });
    if (avatarPath && isTrustedAvatarStatus(result.status)) database.snapshots.setAvatarIfMissing(roomId, avatarPath);
  };
  const manager = new RoomManager(async (roomId, signal, reason) => {
    const room = (await rooms.list()).find((item) => item.roomId === roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    const smokeKey = process.env.DUODUO_REAL_SMOKE === "1" ? process.env.DUODUO_SMOKE_API_KEY : undefined;
    const config = smokeKey ? undefined : await settings.getConfig();
    if (!smokeKey && !config) throw new Error("ASR_NOT_CONFIGURED");
    const secret = config?.secretId ? await settings.getSecret(config.secretId) : undefined;
    const provider = smokeKey ? new BailianProvider({ apiKey: smokeKey }) : createAsrProvider(config!, secret);
    const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
    const roomUrl = fixtureOrigin ? `${fixtureOrigin}/${roomId}` : room.canonicalUrl;
    const taskType = reason === "user_start" ? "monitor_start" : "monitor_reconnect";
    const traffic = reason === "user_start" ? "interactive" : "automatic";
    const navigationGate: RoomNavigationGate = (run) => coordinator.submit({ roomId, type: taskType, traffic, run });
    return new RoomSession(
      roomId,
      roomUrl,
      provider,
      captureRouter,
      (event) => manager.appendAsr(event),
      signal,
      platformSession,
      navigationGate,
      async (result, screenshot) => { await persistProbeResult(roomId, result, screenshot); await broadcastSnapshot(); },
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
          checkedAt: new Date().toISOString(),
        });
        await broadcastSnapshot();
      },
      (event) => {
        if (networkErrorSampler.shouldLog(event)) diagnostic("room_network_error", { roomId, ...event });
      },
      monitoringSettings.monitoredCheckSeconds,
    );
  }, { persistFinalAsr: (event) => { const stored = database.asr.insert(event); if (stored) insightCoordinator.accept(stored); } });

  const roomIntelligence = new RoomIntelligenceService({
    listRoomIds: async () => (await rooms.list()).map((room) => room.roomId),
    listSnapshots: () => database.snapshots.list(),
    listHistorySince: (roomId, since, limit) => database.snapshots.listHistorySince(roomId, since, limit),
    listSessions: (roomId) => database.snapshots.listSessions(roomId) as unknown as StoredLiveSession[],
  });

  const snapshot = async () => ({ rooms: await rooms.list(), runtimes: manager.snapshot(), snapshots: database.snapshots.list() });
  const broadcastSnapshot = async () => broadcastRooms(await snapshot());
  let closing = false;
  const pendingBroadcasts = new Set<Promise<void>>();
  const queueBroadcast = () => {
    if (closing) return;
    const task = broadcastSnapshot().finally(() => pendingBroadcasts.delete(task));
    pendingBroadcasts.add(task);
  };
  let lastMonitoringFingerprint: string | undefined;
  const unsubscribeManager = manager.subscribe((runtime) => {
    const fingerprint = monitoringFingerprint(runtime);
    if (fingerprint !== lastMonitoringFingerprint) {
      lastMonitoringFingerprint = fingerprint;
      diagnostic("monitoring_snapshot", { rooms: runtime.map(({ roomId, state, liveStatus, error }) => ({ roomId, state, liveStatus, error })) });
    }
    queueBroadcast();
  });
  const playback = new PlaybackController(async (roomId) => {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error("MAIN_WINDOW_UNAVAILABLE");
    const view = new WebContentsView({ webPreferences: { session: platformSession, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    view.setBackgroundColor("#111111");
    view.setBounds({ x: 0, y: 0, width: 1, height: 1 });
    view.webContents.setAudioMuted(true);
    view.webContents.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36");
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.contentView.addChildView(view);
    return {
      roomId,
      async load(url: string) {
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([
            view.webContents.loadURL(url),
            new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("PLAYER_LOAD_TIMEOUT")), 15_000); }),
          ]);
        } finally { if (timer) clearTimeout(timer); }
        const accessState = await inspectVerificationPage(view.webContents.mainFrame);
        if (accessState === "verification_required") throw new Error("PLAYER_VERIFICATION_REQUIRED");
        if (accessState === "login_required") throw new Error("PLAYER_LOGIN_REQUIRED");
        await view.webContents.executeJavaScript("(() => { const video=document.querySelector('video'); if(video){video.muted=false;video.volume=1;void video.play().catch(()=>undefined)} return true })()").catch(() => undefined);
      },
      setMuted(value: boolean) { if (!view.webContents.isDestroyed()) view.webContents.setAudioMuted(value); },
      setBounds(bounds: { x: number; y: number; width: number; height: number }) { view.setBounds(bounds); },
      destroy() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.contentView.removeChildView(view); if (!view.webContents.isDestroyed()) view.webContents.close(); },
    };
  });
  playback.subscribe((state) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("player:changed", state); });
  const executePreparedProbe = async (roomId: string) => {
    const room = (await rooms.list()).find((item) => item.roomId === roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    const previousStatus = database.snapshots.list().find((item) => item.roomId === roomId)?.status;
    database.snapshots.upsert({ roomId, status: "checking", checkedAt: new Date().toISOString() });
    await broadcastSnapshot();
    const probeWindow = new BrowserWindow({ show: false, webPreferences: { session: platformSession, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    probeWindow.webContents.setAudioMuted(true);
    probeWindow.webContents.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36");
    try {
      const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
      const result = await probeRoom(probeWindow.webContents, fixtureOrigin ? `${fixtureOrigin}/${roomId}` : room.canonicalUrl);
      const verificationRequired = result.status === "verification_required";
      await persistProbeResult(roomId, result, verificationRequired ? Buffer.alloc(0) : (await probeWindow.capturePage()).toPNG());
      return { value: { probeResult: result, autoMonitor: shouldAutoMonitor(room, previousStatus, result.status) }, verificationRequired };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      database.snapshots.record({ roomId, status: "page_error", checkedAt: new Date().toISOString(), error: `PROBE_EXECUTION_FAILED:${message}` });
      diagnostic("prepared_probe_failed", { roomId, error: message });
      throw error;
    } finally {
      if (!probeWindow.isDestroyed()) probeWindow.destroy();
      await broadcastSnapshot();
    }
  };
  const probeScheduler = new ProbeScheduler(async (roomId, source) => {
    const requested = source === "manual" || source === "initial";
    const result = await coordinator.submit({
      roomId,
      type: requested ? "manual_probe" : "startup_probe",
      traffic: requested ? "interactive" : "automatic",
      run: () => executePreparedProbe(roomId),
    });
    if (result.autoMonitor) await startRoomMonitoring(roomId, false);
    return result.probeResult;
  }, {
    defaultIntervalMinutes: monitoringSettings.preparedCheckMinutes ?? 5,
    maxConcurrency: 1,
    jitterRatio: 0.2,
    manualCooldownMs: 60_000,
  });
  const schedulePreparedRoom = (room: Room) => {
    if (room.monitoring) { void probeScheduler.cancel(room.roomId); return; }
    probeScheduler.schedule(room.roomId, room);
  };
  async function startRoomMonitoring(roomId: string, waitForProbeCancellation = true) {
    if (coordinator.getState().mode !== "normal") throw new Error("ACCESS_VERIFICATION_PAUSED");
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
    probeScheduler.setDefaultIntervalMinutes(monitoringSettings.preparedCheckMinutes ?? 5);
    for (const room of await rooms.list()) schedulePreparedRoom(room);
  };
  const broadcastProbeState = (state = probeScheduler.state()) => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send("rooms:probe-state", state);
  };
  const unsubscribeProbeState = probeScheduler.subscribe(broadcastProbeState);
  protocol.handle("duoduo-cover", (request) => {
    if (closing) return new Response(null, { status: 410 });
    const roomId = new URL(request.url).hostname;
    const coverPath = database.snapshots.list().find((item) => item.roomId === roomId)?.coverPath;
    return coverPath ? net.fetch(pathToFileURL(coverPath).toString()) : new Response(null, { status: 404 });
  });
  protocol.handle("duoduo-avatar", (request) => {
    if (closing) return new Response(null, { status: 410 });
    const roomId = new URL(request.url).hostname;
    const avatarPath = database.snapshots.list().find((item) => item.roomId === roomId)?.avatarPath;
    return avatarPath ? net.fetch(pathToFileURL(avatarPath).toString()) : new Response(null, { status: 404 });
  });
  shutdown = async () => {
    closing = true;
    clearInterval(retentionTimer);
    unsubscribeManager();
    unsubscribeAccess();
    unsubscribeProbeState();
    playback.stop();
    await probeScheduler.stop();
    await coordinator.stop();
    verificationController.dispose();
    await insightCoordinator.shutdown();
    await manager.shutdown();
    await Promise.allSettled(pendingBroadcasts);
    protocol.unhandle("duoduo-cover");
    protocol.unhandle("duoduo-avatar");
    database.close();
    if (powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
  };

  ipcMain.handle("settings:get-asr-provider", () => settings.getConfig());
  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle("settings:save-asr-provider", async (_event, config, secret) => {
    await settings.save(AsrProviderConfigSchema.parse(config), typeof secret === "string" ? secret : undefined);
    return settings.getConfig();
  });
  ipcMain.handle("settings:test-asr-provider", async (_event, config, secret) => {
    const parsed = AsrProviderConfigSchema.parse(config);
    const storedSecret = parsed.secretId ? await settings.getSecret(parsed.secretId) : undefined;
    return createAsrProvider(parsed, typeof secret === "string" && secret ? secret : storedSecret).testConnection();
  });
  ipcMain.handle("settings:get-insight-notifications", () => settings.getInsightNotifications());
  ipcMain.handle("settings:save-insight-notifications", async (_event, value) => {
    await settings.saveInsightNotifications(InsightNotificationSettingsSchema.parse(value));
    return settings.getInsightNotifications();
  });
  ipcMain.handle("settings:get-monitoring", () => settings.getMonitoringSettings());
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
    const target = (await database.rooms.list()).find((item) => item.roomId === state.roomId);
    if (!target) throw new Error("ROOM_NOT_FOUND");
    const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
    await verificationController.show(fixtureOrigin ? `${fixtureOrigin}/${target.roomId}` : target.canonicalUrl);
    return { url: verificationController.currentUrl() };
  });
  ipcMain.handle("access:hide-verification", () => { verificationController.hide(); return true; });
  ipcMain.handle("access:set-verification-bounds", (_event, bounds) => {
    const parsed = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).parse(bounds);
    verificationController.setBounds(parsed);
    return true;
  });
  ipcMain.handle("access:check-verification", async () => {
    const clear = await coordinator.beginRecoveryCheck(async () => await verificationController.inspectBlockedState() === "clear");
    return { clear, state: coordinator.getState() };
  });
  ipcMain.handle("access:confirm-recovery", () => { coordinator.confirmRecovery(); manager.resumeAccessRetries(); verificationController.hide(); return coordinator.getState(); });
  ipcMain.handle("llm:get", () => settings.getLlmConfig());
  ipcMain.handle("llm:save", async (_event, config, secret) => {
    await settings.saveLlm(LlmProviderConfigSchema.parse(config), typeof secret === "string" ? secret : undefined);
    return settings.getLlmConfig();
  });
  ipcMain.handle("llm:test", async (_event, config, secret) => {
    const parsed = LlmProviderConfigSchema.parse(config);
    const stored = parsed.secretId ? await settings.getSecret(parsed.secretId) : undefined;
    return createLlmProvider(parsed, typeof secret === "string" && secret ? secret : stored).testConnection();
  });
  ipcMain.handle("rooms:list", snapshot);
  ipcMain.handle("rooms:list-intelligence", () => closing ? [] : roomIntelligence.listSummaries());
  ipcMain.handle("rooms:get-intelligence", (_event, roomId) => {
    if (closing) throw new Error("APP_CLOSING");
    return roomIntelligence.getDetails(z.string().min(1).parse(roomId));
  });
  ipcMain.handle("rooms:add", async (_event, input) => { const result = await rooms.add(RoomInputSchema.parse(input)); schedulePreparedRoom(result); void probeScheduler.runNow(result.roomId, "initial").catch(() => undefined); await broadcastSnapshot(); return result; });
  ipcMain.handle("rooms:update", async (_event, roomId, input) => { const result = await rooms.update(String(roomId), RoomInputSchema.parse(input)); schedulePreparedRoom(result); if (!result.monitoring) void probeScheduler.runNow(result.roomId).catch(() => undefined); await broadcastSnapshot(); return result; });
  ipcMain.handle("rooms:remove", async (_event, roomId) => { const id = String(roomId); await probeScheduler.cancel(id); await manager.stopMonitoring(id); await rooms.remove(id); await broadcastSnapshot(); });
  ipcMain.handle("rooms:set-monitoring", async (_event, roomId, monitoring) => {
    const id = String(roomId); const enabled = Boolean(monitoring);
    if (enabled) await startRoomMonitoring(id);
    else {
      await rooms.setMonitoring(id, false);
      await manager.stopMonitoring(id);
      const room = (await rooms.list()).find((item) => item.roomId === id);
      if (room) schedulePreparedRoom(room);
      await broadcastSnapshot();
    }
    return snapshot();
  });
  ipcMain.handle("rooms:set-auto-monitor-on-live", async (_event, roomId, enabled) => {
    const id = z.string().min(1).parse(roomId);
    const room = await rooms.setAutoMonitorOnLive(id, Boolean(enabled));
    const latestStatus = database.snapshots.list().find((item) => item.roomId === id)?.status;
    if (room.autoMonitorOnLive && latestStatus === "live" && !room.monitoring) await startRoomMonitoring(id);
    await broadcastSnapshot();
    return snapshot();
  });
  ipcMain.handle("asr:list-before", (_event, roomId, options) => {
    const id = z.string().min(1).parse(roomId);
    const parsed = z.object({ limit: z.number().int().min(1).max(100), beforeId: z.number().int().positive().optional() }).parse(options);
    return database.asr.listBefore(id, parsed);
  });
  const parserSnapshot = async () => ({ definitions: database.parsers.list(), bindings: database.parsers.listBindings(), tests: database.parserTests.list(), llmConfigured: Boolean(await settings.getLlmConfig()) });
  ipcMain.handle("parsers:list", parserSnapshot);
  ipcMain.handle("parsers:create-draft", async (_event, parserId) => { database.parsers.createDraft(z.string().min(1).parse(parserId)); return parserSnapshot(); });
  ipcMain.handle("parsers:update-draft", async (_event, versionId, spec) => { database.parsers.updateDraft(z.number().int().positive().parse(versionId), ParserSpecSchema.parse(spec)); return parserSnapshot(); });
  ipcMain.handle("parsers:remove-draft", async (_event, parserId) => { database.parsers.removeDraft(z.string().min(1).parse(parserId)); return parserSnapshot(); });
  ipcMain.handle("parsers:publish", async (_event, parserId, versionId) => { database.parsers.publish(z.string().min(1).parse(parserId), z.number().int().positive().parse(versionId)); return parserSnapshot(); });
  ipcMain.handle("parsers:bind-room", async (_event, roomId, parserId, parserVersionId) => {
    const id = z.string().min(1).parse(roomId);
    if (!(await rooms.list()).some((room) => room.roomId === id)) throw new Error("ROOM_NOT_FOUND");
    database.parsers.bindRoom(id, z.string().min(1).nullable().parse(parserId), z.number().int().positive().nullable().parse(parserVersionId));
    return parserSnapshot();
  });
  ipcMain.handle("parsers:run-test", async (_event, parserId, roomId, requestedLimit) => {
    const id = z.string().min(1).parse(parserId); const room = z.string().min(1).parse(roomId); const limit = z.number().int().min(1).max(100).parse(requestedLimit);
    const parser = database.parsers.list().find((item) => item.id === id);
    if (!parser?.publishedVersion || !parser.draftVersion) throw new Error("PARSER_DRAFT_REQUIRED");
    const samples = database.asr.listBefore(room, { limit }).items;
    if (!samples.length) throw new Error("PARSER_TEST_NO_ASR");
    const config = await settings.getLlmConfig(); if (!config) throw new Error("LLM_NOT_CONFIGURED");
    const secret = config.secretId ? await settings.getSecret(config.secretId) : undefined;
    const runId = randomUUID();
    const base = { id: runId, parserId: id, publishedVersionId: parser.publishedVersion.id, draftVersionId: parser.draftVersion.id, roomId: room, sampleAsrIds: samples.map((item) => item.id), status: "running" as const, publishedResults: [], draftResults: [], createdAt: new Date().toISOString() };
    database.parserTests.insert(base);
    try {
      const publishedEngine = new InsightEngine(createLlmProvider({ ...config, model: parser.publishedVersion.spec.model }, secret));
      const draftEngine = new InsightEngine(createLlmProvider({ ...config, model: parser.draftVersion.spec.model }, secret));
      const [published, draft] = await Promise.all([publishedEngine.analyze(room, parser.publishedVersion, samples), draftEngine.analyze(room, parser.draftVersion, samples)]);
      const toCandidate = ({ roomId: _roomId, parserId: _parserId, parserVersionId: _version, sourceAsrIds: _sourceIds, startedAt: _start, endedAt: _end, createdAt: _created, ...candidate }: typeof published[number]) => candidate;
      database.parserTests.update({ ...base, status: "completed", publishedResults: published.map(toCandidate), draftResults: draft.map(toCandidate), completedAt: new Date().toISOString() });
    } catch (error) { database.parserTests.update({ ...base, status: "failed", error: error instanceof Error ? error.message : String(error), completedAt: new Date().toISOString() }); }
    return parserSnapshot();
  });
  ipcMain.handle("insights:list", (_event, options) => database.insights.list(z.object({ roomId: z.string().min(1).optional(), limit: z.number().int().min(1).max(100), beforeId: z.number().int().positive().optional() }).parse(options)));
  ipcMain.handle("rooms:probe", async (_event, roomId) => { await probeScheduler.runNow(z.string().min(1).parse(roomId)); return snapshot(); });
  ipcMain.handle("rooms:get-probe-state", () => probeScheduler.state());
  ipcMain.handle("rooms:probe-all", async () => {
    if (coordinator.getState().mode !== "normal") throw new Error("ACCESS_VERIFICATION_PAUSED");
    const ids = (await rooms.list()).filter((room) => !room.monitoring).map((room) => room.roomId);
    void probeScheduler.runBatch(ids, "manual_batch").catch((error) => {
      diagnostic("prepared_probe_batch_failed", { error: error instanceof Error ? error.message : String(error) });
    });
    return probeScheduler.state();
  });
  ipcMain.handle("rooms:cancel-probe-batch", () => {
    probeScheduler.cancelManualBatch();
    return probeScheduler.state();
  });
  ipcMain.handle("data:get-retention", () => settings.getDataRetention());
  ipcMain.handle("data:save-retention", async (_event, value) => { await settings.saveDataRetention(DataRetentionSettingsSchema.parse(value)); return settings.getDataRetention(); });
  ipcMain.handle("data:get-usage", async () => ({
    databaseBytes: await fileSize(databasePath), walBytes: await fileSize(`${databasePath}-wal`), avatarBytes: await directorySize(join(userDataPath, "avatars")), coverBytes: await directorySize(join(userDataPath, "covers")), logBytes: await fileSize(join(userDataPath, "diagnostics.log")), categories: database.maintenance.getCategoryUsage(),
  }));
  ipcMain.handle("data:preview-cleanup", (_event, request) => database.maintenance.previewCleanup(CleanupRequestSchema.parse(request)));
  ipcMain.handle("data:execute-cleanup", (_event, request, token) => database.maintenance.executeCleanup(CleanupRequestSchema.parse(request), z.string().min(1).parse(token)));
  ipcMain.handle("data:compact", () => { database.maintenance.checkpoint(); database.maintenance.compact(); return true; });
  ipcMain.handle("data:export-backup", async () => {
    const result = await dialog.showSaveDialog({ title: "导出完整备份", defaultPath: `duoduo-${new Date().toISOString().slice(0, 10)}.duoduo-backup`, filters: [{ name: "多多直播备份", extensions: ["duoduo-backup"] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    database.maintenance.checkpoint(); await backupService.exportTo(result.filePath); return { canceled: false, path: result.filePath };
  });
  ipcMain.handle("data:import-backup", async (_event, requestedMode) => {
    const mode = z.enum(["replace", "merge"]).parse(requestedMode);
    const result = await dialog.showOpenDialog({ title: "导入完整备份", properties: ["openFile"], filters: [{ name: "多多直播备份", extensions: ["duoduo-backup"] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const staging = join(userDataPath, "restore-staging"); await backupService.stageReplace(result.filePaths[0], staging);
    if (mode === "merge") { database.mergeFrom(join(staging, "duoduo.sqlite")); await mergeImages(staging, userDataPath); await rm(staging, { recursive: true, force: true }); return { canceled: false, restartRequired: false }; }
    await writeFile(join(staging, ".replace"), "1", { mode: 0o600 });
    setTimeout(() => { app.relaunch(); app.quit(); }, 100);
    return { canceled: false, restartRequired: true };
  });
  ipcMain.handle("rooms:refresh-avatar", async (_event, requestedRoomId) => {
    const roomId = z.string().min(1).parse(requestedRoomId);
    const room = (await rooms.list()).find((item) => item.roomId === roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    return coordinator.submit({ roomId, type: "avatar_refresh", run: async () => {
    const coverWindow = new BrowserWindow({ show: false, webPreferences: { session: platformSession, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    coverWindow.webContents.setAudioMuted(true);
    coverWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    try {
      const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
      const result = await probeRoom(coverWindow.webContents, fixtureOrigin ? `${fixtureOrigin}/${roomId}` : room.canonicalUrl);
      if (result.status === "verification_required") return { value: await snapshot(), verificationRequired: true };
      if (!isTrustedAvatarStatus(result.status)) throw new Error(`AVATAR_SOURCE_UNTRUSTED:${result.status}`);
      if (!result.avatar) throw new Error(`AVATAR_NOT_FOUND:${result.status}`);
      const avatarPath = await avatarCache.refresh(roomId, result.avatar);
      const existing = database.snapshots.list().find((item) => item.roomId === roomId);
      database.snapshots.upsert({ roomId, status: result.status, title: result.title ?? existing?.title, anchorName: result.anchorName ?? existing?.anchorName, coverPath: existing?.coverPath, viewerCount: result.viewerCount ?? existing?.viewerCount, followerCount: result.followerCount ?? existing?.followerCount, totalViewerCount: result.totalViewerCount ?? existing?.totalViewerCount, likeCount: result.likeCount ?? existing?.likeCount, metricRaw: result.metricRaw ?? existing?.metricRaw, metricEvidence: result.metricEvidence ?? existing?.metricEvidence, metricQuality: result.metricQuality ?? existing?.metricQuality, checkedAt: new Date().toISOString() });
      database.snapshots.replaceAvatar(roomId, avatarPath);
      await broadcastSnapshot();
      return { value: await snapshot() };
    } finally {
      if (!coverWindow.isDestroyed()) coverWindow.destroy();
    }
    } });
  });
  ipcMain.handle("player:get-state", () => playback.state());
  ipcMain.handle("player:play", async (_event, roomId) => {
    const id = z.string().min(1).parse(roomId);
    const room = (await rooms.list()).find((item) => item.roomId === id);
    if (!room) throw new Error("ROOM_NOT_FOUND");
    const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
    return coordinator.submit({ roomId: id, type: "user_play", traffic: "interactive", run: async () => {
      const value = await playback.play(id, fixtureOrigin ? `${fixtureOrigin}/${id}` : room.canonicalUrl);
      return { value, verificationRequired: value.error === "PLAYER_VERIFICATION_REQUIRED" };
    } });
  });
  ipcMain.handle("player:stop", () => playback.stop());
  ipcMain.handle("player:set-bounds", (_event, bounds) => {
    const parsed = z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() }).parse(bounds);
    playback.setBounds(parsed);
  });

  diagnostic("before-window");
  await createWindow();
  diagnostic("window-loaded");
  if (process.env.DUODUO_REAL_INSIGHT_SMOKE === "1") {
    const parser = database.parsers.list()[0];
    if (parser?.publishedVersion) for (const room of await rooms.list()) database.parsers.bindRoom(room.roomId, parser.id, parser.publishedVersion.id);
  }
  const restored = process.env.DUODUO_REPLAY_INSIGHT_REPORT || coordinator.getState().mode !== "normal" ? [] : (await rooms.list()).filter((room) => room.monitoring);
  await Promise.allSettled(restored.map((room) => manager.startMonitoring(room.roomId)));
  const preparedRooms = (await rooms.list()).filter((item) => !item.monitoring);
  for (const room of preparedRooms) schedulePreparedRoom(room);
  const preparedRoomIds = preparedRooms.map((room) => room.roomId);
  const startupQueues = splitPreparedStartupRooms(preparedRoomIds, database.snapshots.list());
  for (const roomId of startupQueues.initialRoomIds) void probeScheduler.runNow(roomId, "initial").catch((error) => diagnostic("initial_probe_failed", { roomId, error: error instanceof Error ? error.message : String(error) }));
  void probeScheduler.runStartup(startupQueues.refreshRoomIds).catch((error) => diagnostic("startup_probe_failed", { error: error instanceof Error ? error.message : String(error) }));
  if (process.env.DUODUO_E2E_ROOM_INTELLIGENCE_REPORT && mainWindow) {
    const reportPath = process.env.DUODUO_E2E_ROOM_INTELLIGENCE_REPORT;
    const screenshotPath = process.env.DUODUO_E2E_ROOM_INTELLIGENCE_SCREENSHOT;
    void (async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const ready = await mainWindow!.webContents.executeJavaScript("Boolean(document.querySelector('.card .room-label'))");
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const beforeLocalReads = roomIntelligenceRealRequestCount;
      const cardState = await mainWindow!.webContents.executeJavaScript(`(() => {
        const cards=Array.from(document.querySelectorAll('.card'));
        const top=cards.find((card)=>card.textContent.includes('https://live.douyin.com/100'));
        const empty=cards.find((card)=>card.textContent.includes('https://live.douyin.com/600'));
        const labels=top ? Array.from(top.querySelectorAll('.room-label')) : [];
        const state={topFound:Boolean(top),avatarVisible:Boolean(top?.querySelector('.avatar')),labelCount:labels.length,labelTexts:labels.map((label)=>label.textContent),tooltip:String(labels[0]?.getAttribute('title')??''),emptyAccumulating:Boolean(empty?.textContent.includes('数据积累中'))};
        labels[0]?.click();
        return state;
      })()`);
      while (Date.now() < deadline) {
        const ready = await mainWindow!.webContents.executeJavaScript("Boolean(document.querySelector('.intelligence-drawer'))");
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const detailsState = await mainWindow!.webContents.executeJavaScript(`(() => {
        const drawer=document.querySelector('.intelligence-drawer');
        const text=drawer?.textContent??'';
        return {opened:Boolean(drawer),allLabelCount:drawer?.querySelectorAll('.intelligence-evidence article').length??0,hasTrend:text.includes('在线人数趋势'),hasStartEvidence:text.includes('开播证据：'),hasStopEvidence:text.includes('停播证据：'),hasObservedDisclaimer:text.includes('不等同于平台完整直播时长'),containsSyntheticZero:/在线人数\s*0(?:\D|$)/.test(text)};
      })()`);
      if (screenshotPath) await writeFile(screenshotPath, (await mainWindow!.webContents.capturePage()).toPNG());
      const afterLocalReads = roomIntelligenceRealRequestCount;
      await writeFile(reportPath, `${JSON.stringify({ version: app.getVersion(), beforeLocalReads, afterLocalReads, realDouyinRequests: roomIntelligenceRealRequestCount, cardState, detailsState }, null, 2)}\n`);
      app.quit();
    })().catch(async (error) => {
      await writeFile(reportPath, `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
      app.exit(2);
    });
  }
  if (process.env.DUODUO_E2E_VERIFICATION_REPORT) {
    const reportPath = process.env.DUODUO_E2E_VERIFICATION_REPORT;
    void (async () => {
      const deadline = Date.now() + 10_000;
      while (coordinator.getState().mode === "normal" && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      const initialPaused = coordinator.getState();
      if (initialPaused.mode !== "verification_paused") throw new Error("VERIFICATION_E2E_PAUSE_TIMEOUT");
      const fixtureOrigin = process.env.DUODUO_FIXTURE_ORIGIN;
      if (!fixtureOrigin) throw new Error("VERIFICATION_E2E_FIXTURE_MISSING");
      await verificationController.show(`${fixtureOrigin}/${initialPaused.roomId}`);
      const blockedInspection = await verificationController.inspectBlockedState();
      await new Promise((resolve) => setTimeout(resolve, 900));
      const cleared = await coordinator.beginRecoveryCheck(async () => await verificationController.inspectBlockedState() === "clear");
      const beforeConfirmation = coordinator.getState();
      coordinator.confirmRecovery();
      manager.resumeAccessRetries();
      verificationController.hide();
      const afterConfirmation = coordinator.getState();
      const roomSnapshot = database.snapshots.list().find((item) => item.roomId === initialPaused.roomId);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(reportPath, `${JSON.stringify({ initialPaused, blockedInspection, cleared, beforeConfirmation, afterConfirmation, snapshot: roomSnapshot }, null, 2)}\n`);
      app.quit();
    })().catch(async (error) => {
      await writeFile(reportPath, `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`);
      app.exit(2);
    });
  }
  if (process.env.DUODUO_REPLAY_INSIGHT_REPORT) {
    const replayReport = process.env.DUODUO_REPLAY_INSIGHT_REPORT;
    const replayScreenshot = process.env.DUODUO_REPLAY_INSIGHT_SCREENSHOT;
    const replayRooms = await rooms.list();
    for (const room of replayRooms) for (const event of database.asr.listBefore(room.roomId, { limit: 100 }).items) insightCoordinator.accept(event);
    setTimeout(() => {
      void (async () => {
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          const settled = replayRooms.every((room) => !["buffering", "analyzing"].includes(insightCoordinator.status(room.roomId).state));
          if (settled && insightCoordinator.resourceCount() === 0) break;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        const report = { source: "saved-real-asr-replay", rooms: replayRooms.map((room) => ({ roomId: room.roomId, asrCount: database.asr.listBefore(room.roomId, { limit: 100 }).items.length })), insights: database.insights.list({ limit: 100 }).items, statuses: Object.fromEntries(replayRooms.map((room) => [room.roomId, insightCoordinator.status(room.roomId)])), resources: insightCoordinator.resourceCount() };
        if (replayScreenshot && mainWindow) { await mainWindow.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button)=>button.textContent.includes('观点中心'))?.click()`); await new Promise((resolve) => setTimeout(resolve, 400)); await writeFile(replayScreenshot, (await mainWindow.webContents.capturePage()).toPNG()); }
        await writeFile(replayReport, `${JSON.stringify(report, null, 2)}\n`); app.quit();
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
        if (!fixtureOrigin || available.length < 2) throw new Error("PLAYER_E2E_FIXTURE_MISSING");
        const steps = [];
        steps.push({ action: "initial", state: playback.state(), resources: playback.resourceCount() });
        await playback.play(available[0].roomId, `${fixtureOrigin}/${available[0].roomId}`);
        playback.setBounds({ x: 980, y: 122, width: 420, height: 700 });
        steps.push({ action: "play-first", state: playback.state(), resources: playback.resourceCount() });
        await playback.play(available[1].roomId, `${fixtureOrigin}/${available[1].roomId}`);
        steps.push({ action: "switch-second", state: playback.state(), resources: playback.resourceCount() });
        playback.stop();
        steps.push({ action: "stop", state: playback.state(), resources: playback.resourceCount() });
        await writeFile(reportPath, `${JSON.stringify({ version: app.getVersion(), steps }, null, 2)}\n`);
        diagnostic("player-e2e-complete");
        app.quit();
      })().catch(async (error) => { await writeFile(reportPath, `${JSON.stringify({ error: String(error) }, null, 2)}\n`); app.exit(2); });
    }, 500);
  }
  if (process.env.DUODUO_E2E_INSIGHT_REPORT && mainWindow) {
    const reportPath = process.env.DUODUO_E2E_INSIGHT_REPORT;
    const screenshotPath = process.env.DUODUO_E2E_INSIGHT_SCREENSHOT;
    void (async () => {
      const room = (await rooms.list())[0]; if (!room) throw new Error("INSIGHT_E2E_ROOM_MISSING");
      await probeScheduler.cancel(room.roomId);
      const parser = database.parsers.list()[0]; if (!parser.publishedVersion) throw new Error("INSIGHT_E2E_PARSER_MISSING");
      database.parsers.bindRoom(room.roomId, parser.id, parser.publishedVersion.id);
      const texts = ["今天指数虽然是红的，但是量没有明显放出来。", "现在市场情绪只能算修复，还不能说反转。", "大家点点赞，我们稍后继续看下午的量。"];
      texts.forEach((text, index) => { const stored = database.asr.insert({ roomId: room.roomId, sessionId: "insight-e2e", segmentId: `segment-${index}`, startMs: index * 5000, endMs: index * 5000 + 4000, text, isFinal: true, occurredAt: `2026-07-13T02:30:0${index}.000Z` }); if (stored) insightCoordinator.accept(stored); });
      const deadline = Date.now() + 20_000;
      while (database.insights.list({ roomId: room.roomId, limit: 10 }).items.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 250));
      if (database.insights.list({ roomId: room.roomId, limit: 10 }).items.length === 0) throw new Error("INSIGHT_E2E_TIMEOUT");
      await rooms.setMonitoring(room.roomId, true); await broadcastSnapshot();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const notificationVisible = await mainWindow!.webContents.executeJavaScript(`Boolean(document.querySelector('.insight-notification-open'))`);
      await mainWindow!.webContents.executeJavaScript(`document.querySelector('.insight-notification-open')?.click()`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const navigation = await mainWindow!.webContents.executeJavaScript(`({roomCard:Boolean(document.querySelector(${JSON.stringify(`#room-card-${room.roomId}`)})),focusedInsight:Boolean(document.querySelector('.live-insight-item.focused')),insightTab:Array.from(document.querySelectorAll('.live-tabs button')).some((button)=>button.classList.contains('active')&&button.textContent.includes('解析观点'))})`);
      await mainWindow!.webContents.executeJavaScript(`window.duoduo.parsers.createDraft(${JSON.stringify(parser.id)})`);
      await mainWindow!.webContents.executeJavaScript(`window.duoduo.parsers.runTest(${JSON.stringify(parser.id)},${JSON.stringify(room.roomId)},50)`);
      if (screenshotPath) await writeFile(screenshotPath, (await mainWindow!.webContents.capturePage()).toPNG());
      const insightPage = database.insights.list({ roomId: room.roomId, limit: 10 }); const tests = database.parserTests.list(parser.id);
      await writeFile(reportPath, `${JSON.stringify({ version: app.getVersion(), roomId: room.roomId, formalInsights: insightPage.items, testRuns: tests, binding: database.parsers.getBinding(room.roomId), notificationVisible, navigation, resourcesBeforeQuit: insightCoordinator.resourceCount() }, null, 2)}\n`);
      app.quit();
    })().catch(async (error) => { await writeFile(reportPath, `${JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2)}\n`); app.exit(2); });
  }
  if (process.env.DUODUO_E2E_SCREENSHOT && mainWindow) {
    const screenshotPath = process.env.DUODUO_E2E_SCREENSHOT;
    const preparedScreenshotPath = process.env.DUODUO_E2E_PREPARED_SCREENSHOT;
    const preparedRoomId = process.env.DUODUO_E2E_PREPARED_ROOM;
    const e2eLogPath = process.env.DUODUO_E2E_LOG;
    const deadline = Date.now() + Number(process.env.DUODUO_E2E_TIMEOUT_MS ?? 20_000);
    const timer = setInterval(() => {
      const runtimes = manager.snapshot();
      if (e2eLogPath) void appendFile(e2eLogPath, `${JSON.stringify(runtimes.map((runtime) => ({ roomId: runtime.roomId, state: runtime.state, liveStatus: runtime.liveStatus, asr: runtime.asr.length, error: runtime.error })))}\n`);
      const preparedReady = !preparedRoomId || database.snapshots.list().some((item) => item.roomId === preparedRoomId && item.status !== "checking");
      if (runtimes.length >= 3 && runtimes.every((runtime) => runtime.asr.length > 0) && preparedReady) {
        clearInterval(timer);
        setTimeout(() => {
          void mainWindow!.webContents.capturePage().then((image) => writeFile(screenshotPath, image.toPNG())).then(async () => {
            if (!preparedScreenshotPath) return;
            await mainWindow!.webContents.executeJavaScript("document.querySelector('.grid')?.scrollIntoView({block:'start'})");
            await new Promise((resolve) => setTimeout(resolve, 300));
            await writeFile(preparedScreenshotPath, (await mainWindow!.webContents.capturePage()).toPNG());
          }).then(() => manager.shutdown()).then(() => app.quit());
        }, 750);
        return;
      }
      if (Date.now() >= deadline) { clearInterval(timer); app.exit(2); }
    }, 250);
  }
  if (process.env.DUODUO_REAL_SMOKE_REPORT && mainWindow) {
    const reportPath = process.env.DUODUO_REAL_SMOKE_REPORT;
    const screenshotPath = process.env.DUODUO_REAL_SMOKE_SCREENSHOT;
    const durationMs = Math.min(Number(process.env.DUODUO_REAL_SMOKE_DURATION_MS ?? 600_000), 1_200_000);
    const startedAt = Date.now();
    setTimeout(() => {
      const runtimes = manager.snapshot();
      const report = { startedAt: new Date(startedAt).toISOString(), endedAt: new Date().toISOString(), durationMs, rooms: runtimes.map((runtime) => ({ roomId: runtime.roomId, state: runtime.state, liveStatus: runtime.liveStatus, asrCount: runtime.asr.length, finalCount: runtime.asr.filter((event) => event.isFinal).length, texts: runtime.asr.filter((event) => event.isFinal).slice(-5).map((event) => event.text), error: runtime.error })), insights: database.insights.list({ limit: 100 }).items, bindings: database.parsers.listBindings(), insightResources: insightCoordinator.resourceCount() };
      const screenshot = screenshotPath ? (async () => { if (process.env.DUODUO_REAL_INSIGHT_SMOKE === "1") { await mainWindow!.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find((button)=>button.textContent.includes('观点中心'))?.click()`); await new Promise((resolve) => setTimeout(resolve, 400)); } await writeFile(screenshotPath, (await mainWindow!.webContents.capturePage()).toPNG()); })() : Promise.resolve();
      void screenshot.then(() => writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)).then(() => manager.shutdown()).then(() => app.quit());
    }, durationMs);
  }
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", (event) => {
  if (!shutdown) return;
  event.preventDefault();
  const run = shutdown; shutdown = undefined;
  void run().finally(() => app.quit());
});

async function fileSize(path: string): Promise<number> { try { return (await stat(path)).size; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; } }
async function directorySize(path: string): Promise<number> {
  try { let total = 0; for (const entry of await readdir(path, { withFileTypes: true })) total += entry.isDirectory() ? await directorySize(join(path, entry.name)) : entry.isFile() ? await fileSize(join(path, entry.name)) : 0; return total; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
}
async function applyPendingRestore(userDataPath: string): Promise<void> {
  const staging = join(userDataPath, "restore-staging");
  try { await stat(join(staging, ".replace")); } catch { return; }
  const databasePath = join(userDataPath, "duoduo.sqlite");
  try {
    await stat(databasePath);
    const recoveryDirectory = join(userDataPath, "backups");
    await new BackupService(databasePath, join(userDataPath, "avatars"), join(userDataPath, "covers")).exportTo(join(recoveryDirectory, `pre-restore-${new Date().toISOString().replaceAll(":", "-")}.duoduo-backup`));
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const replacement = `${databasePath}.${process.pid}.restore`;
  await copyFile(join(staging, "duoduo.sqlite"), replacement);
  await rename(replacement, databasePath);
  for (const directory of ["avatars", "covers"]) {
    await rm(join(userDataPath, directory), { recursive: true, force: true });
    try { await rename(join(staging, directory), join(userDataPath, directory)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  await rm(staging, { recursive: true, force: true });
}
async function mergeImages(staging: string, userDataPath: string): Promise<void> {
  for (const directory of ["avatars", "covers"]) {
    const source = join(staging, directory); const destination = join(userDataPath, directory); await mkdir(destination, { recursive: true });
    try { for (const entry of await readdir(source, { withFileTypes: true })) if (entry.isFile()) { const target = join(destination, entry.name); try { await stat(target); } catch { await copyFile(join(source, entry.name), target); } } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
async function pruneDiagnosticLog(path: string, days: number): Promise<void> {
  try {
    const cutoff = Date.now() - days * 86_400_000;
    const lines = (await readFile(path, "utf8")).split("\n").filter((line) => { const timestamp = Date.parse(line.slice(0, 24)); return !Number.isFinite(timestamp) || timestamp >= cutoff; });
    await writeFile(path, lines.filter(Boolean).join("\n") + (lines.some(Boolean) ? "\n" : ""), { encoding: "utf8", mode: 0o600 });
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
