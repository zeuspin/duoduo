import { Broadcast, ChartLineUp, Database, Gear, ImageSquare, Lightbulb, List, MagnifyingGlass, PencilSimple, Play, Plus, RadioButton, SlidersHorizontal, Stop, Trash, TreeStructure, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AsrProviderConfig, DouyinAccessState, InsightNotificationSettings, MarketInsight, MonitoringSettings, PreparedProbeState, ProbeRequestState, Room, RoomIntelligence, RoomIntelligenceSummary, RoomRuntime, RoomSnapshot } from "../shared/contracts";
import { ParserManagement } from "./components/ParserManagement";
import { InsightCenter } from "./components/InsightCenter";
import { InsightNotificationRail } from "./components/InsightNotificationRail";
import { LiveRoomWorkspace, type ParserSnapshot } from "./components/LiveRoomWorkspace";
import { DataManagement } from "./components/DataManagement";
import { AiUsageDashboard } from "./components/AiUsageDashboard";
import { PreparedRoomHeader } from "./components/PreparedRoomHeader";
import { RoomCardActions } from "./components/RoomCardActions";
import { RoomMetricsActions } from "./components/RoomMetricsActions";
import { RoomIntelligenceBadges, RoomIntelligenceDrawer } from "./components/RoomIntelligence";
import { compactCheckedAt, compactCount, probeDetail, roomDisplayName } from "./room-card-presenter";

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
const statusLabels: Record<RoomSnapshot["status"], string> = { checking: "检测中", live: "直播中", offline: "未开播", login_required: "需要登录", verification_required: "需要验证", timeout: "检测超时", page_error: "检测失败" };
type TimeRange = { start: string; end: string };
type PlayerState = { activeRoomId: string | null; status: "stopped" | "loading" | "playing" | "error"; error?: string };

export function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [runtimes, setRuntimes] = useState<RoomRuntime[]>([]);
  const [snapshots, setSnapshots] = useState<RoomSnapshot[]>([]);
  const [roomIntelligence, setRoomIntelligence] = useState<RoomIntelligenceSummary[]>([]);
  const [intelligenceDetails, setIntelligenceDetails] = useState<RoomIntelligence>();
  const [intelligenceLoadingRoomId, setIntelligenceLoadingRoomId] = useState<string>();
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<"room" | "settings" | "monitoring" | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<string>();
  const [url, setUrl] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"uncertain" | "fixed">("uncertain");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [ranges, setRanges] = useState<TimeRange[]>([{ start: "09:00", end: "12:00" }]);
  const [probeInterval, setProbeInterval] = useState("default");
  const [provider, setProvider] = useState<AsrProviderConfig | undefined>();
  const [secret, setSecret] = useState("");
  const [providerType, setProviderType] = useState<"bailian" | "duoduo-streaming-asr-v1">("bailian");
  const [endpoint, setEndpoint] = useState("wss://");
  const [auth, setAuth] = useState<"none" | "bearer" | "x-api-key">("bearer");
  const [message, setMessage] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [player, setPlayer] = useState<PlayerState>({ activeRoomId: null, status: "stopped" });
  const [view, setView] = useState<"rooms" | "parsers" | "insights" | "usage" | "data">("rooms");
  const [parsers, setParsers] = useState<ParserSnapshot>({ definitions: [], bindings: [], tests: [], llmConfigured: false });
  const [notifications, setNotifications] = useState<MarketInsight[]>([]);
  const [notificationTimeout, setNotificationTimeout] = useState<InsightNotificationSettings["timeoutSeconds"]>(30);
  const [monitoringSettings, setMonitoringSettings] = useState<MonitoringSettings>({ monitoredCheckSeconds: 30, preparedCheckMinutes: 5 });
  const [focusInsight, setFocusInsight] = useState<{ roomId: string; insightId: number }>();
  const [, setProbeClock] = useState(0);
  const [preparedProbeState, setPreparedProbeState] = useState<PreparedProbeState>({ mode: "idle", queuedRoomIds: [], manualProbes: [] });
  const [accessState, setAccessState] = useState<DouyinAccessState>({ mode: "normal" });
  const [verificationVisible, setVerificationVisible] = useState(false);
  const [verificationUrl, setVerificationUrl] = useState("");
  const [verificationFeedback, setVerificationFeedback] = useState("");
  const verificationSurface = useRef<HTMLDivElement>(null);
  const latestInsightId = useRef<number | undefined>(undefined);

  function applySnapshot(value: unknown) {
    const snapshot = value as { rooms: Room[]; runtimes: RoomRuntime[]; snapshots?: RoomSnapshot[] };
    setRooms(snapshot.rooms ?? []);
    setRuntimes(snapshot.runtimes ?? []);
    setSnapshots(snapshot.snapshots ?? []);
  }
  async function refresh() { applySnapshot(await window.duoduo.rooms.list()); }
  async function refreshIntelligence() { setRoomIntelligence(await window.duoduo.rooms.listIntelligence() as RoomIntelligenceSummary[]); }
  useEffect(() => {
    void refresh();
    void refreshIntelligence();
    void window.duoduo.app.getVersion().then((value) => setAppVersion(String(value)));
    void window.duoduo.settings.getAsrProvider().then((value) => {
      const config = value as AsrProviderConfig | undefined; setProvider(config);
      if (!config) return;
      setProviderType(config.type);
      if (config.type === "duoduo-streaming-asr-v1") { setEndpoint(config.endpoint); setAuth(config.auth); }
    });
    void window.duoduo.settings.getInsightNotifications().then((value) => setNotificationTimeout((value as InsightNotificationSettings).timeoutSeconds));
    void window.duoduo.settings.getMonitoring().then((value) => setMonitoringSettings(value as MonitoringSettings));
    void window.duoduo.access.getState().then((value) => setAccessState(value as DouyinAccessState));
    void window.duoduo.parsers.list().then((value) => setParsers(value as ParserSnapshot));
    return window.duoduo.rooms.subscribe((value) => { applySnapshot(value); void refreshIntelligence(); });
  }, []);
  useEffect(() => window.duoduo.access.subscribe((value) => setAccessState(value as DouyinAccessState)), []);
  useEffect(() => {
    let active = true;
    void window.duoduo.rooms.getProbeState().then((value) => { if (active) setPreparedProbeState(value as PreparedProbeState); });
    const unsubscribe = window.duoduo.rooms.subscribeProbeState((value) => setPreparedProbeState(value as PreparedProbeState));
    return () => { active = false; unsubscribe(); };
  }, []);
  useEffect(() => { if (view === "rooms") void window.duoduo.parsers.list().then((value) => setParsers(value as ParserSnapshot)); }, [view]);
  useEffect(() => {
    if (!(preparedProbeState.manualProbes ?? []).some((item) => item.phase === "cooldown")) return;
    const timer = window.setInterval(() => setProbeClock((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [(preparedProbeState.manualProbes ?? []).some((item) => item.phase === "cooldown")]);
  useEffect(() => {
    void window.duoduo.player.getState().then((value) => setPlayer(value as PlayerState));
    return window.duoduo.player.subscribe((value) => setPlayer(value as PlayerState));
  }, []);
  useEffect(() => {
    let active = true;
    void window.duoduo.insights.list({ limit: 50 }).then((value) => {
      if (!active) return;
      const page = value as { items: MarketInsight[] };
      latestInsightId.current = Math.max(0, ...page.items.map((item) => item.id));
    });
    const unsubscribe = window.duoduo.insights.subscribe((value) => {
      const page = value as { items: MarketInsight[] };
      const maxId = Math.max(0, ...page.items.map((item) => item.id));
      if (latestInsightId.current === undefined) { latestInsightId.current = maxId; return; }
      const incoming = page.items.filter((item) => item.id > latestInsightId.current!).sort((a, b) => b.id - a.id);
      latestInsightId.current = Math.max(latestInsightId.current, maxId);
      if (incoming.length) setNotifications((current) => [...incoming, ...current.filter((item) => !incoming.some((next) => next.id === item.id))].slice(0, 20));
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const monitored = rooms.filter((room) => room.monitoring);
  const pool = useMemo(() => rooms.filter((room) => !room.monitoring && `${room.roomId} ${snapshots.find((item) => item.roomId === room.roomId)?.title ?? ""}`.includes(query)), [rooms, snapshots, query]);

  function openAddRoom() {
    setEditingRoomId(undefined); setUrl(""); setScheduleMode("uncertain"); setDays([1, 2, 3, 4, 5]); setRanges([{ start: "09:00", end: "12:00" }]); setProbeInterval("default"); setDialog("room");
  }
  function openEditRoom(room: Room) {
    setEditingRoomId(room.roomId); setUrl(room.canonicalUrl); setScheduleMode(room.schedule ? "fixed" : "uncertain"); setDays(room.schedule?.days ?? [1, 2, 3, 4, 5]); setRanges(room.schedule?.ranges ?? [{ start: "09:00", end: "12:00" }]); setProbeInterval(room.probeIntervalMinutes?.toString() ?? "default"); setDialog("room");
  }
  async function saveRoom(event: FormEvent) {
    event.preventDefault();
    try {
      const input = { url, schedule: scheduleMode === "fixed" ? { days, ranges } : null, probeIntervalMinutes: probeInterval === "default" ? null : Number(probeInterval) };
      if (editingRoomId) await window.duoduo.rooms.update(editingRoomId, input);
      else await window.duoduo.rooms.add(input);
      setDialog(null); setMessage(editingRoomId ? "直播间信息已更新" : "直播间已添加"); await refresh();
    } catch (error) { setMessage(String(error).replace(/^Error invoking remote method '[^']+': /, "")); }
  }

  function draftProvider(): AsrProviderConfig {
    return providerType === "bailian" ? { type: "bailian", model: "paraformer-realtime-v2", secretId: "bailian-main" } : { type: "duoduo-streaming-asr-v1", endpoint, auth, ...(auth === "none" ? {} : { secretId: "gateway-main" }) };
  }
  async function saveProvider(event: FormEvent) {
    event.preventDefault(); const config = draftProvider(); await window.duoduo.settings.saveAsrProvider(config, secret || undefined); setProvider(config); setSecret(""); setDialog(null); setMessage("语音转文字设置已保存");
  }
  async function saveNotificationSettings() { await window.duoduo.settings.saveInsightNotifications({ timeoutSeconds: notificationTimeout }); setMessage("新观点提醒设置已保存"); }
  async function saveMonitoringSettings(event: FormEvent) { event.preventDefault(); setMonitoringSettings(await window.duoduo.settings.saveMonitoring(monitoringSettings) as MonitoringSettings); setDialog(null); setMessage("监看频率已更新并立即生效"); }
  async function testProvider() {
    try { const result = await window.duoduo.settings.testAsrProvider(draftProvider(), secret) as { ok: boolean; message: string }; setMessage(result.message); }
    catch (error) { setMessage(`连接失败：${String(error)}`); }
  }

  const scheduleText = (room: Room) => room.schedule ? `周${room.schedule.days.map((day) => weekdays[day]).join("、")} ${room.schedule.ranges.map((range) => `${range.start}-${range.end}`).join(" / ")}` : "直播时间不确定";
  const roomSnapshot = (roomId: string) => snapshots.find((item) => item.roomId === roomId);
  async function togglePlayback(roomId: string) {
    setPlayer(await (player.activeRoomId === roomId ? window.duoduo.player.stop() : window.duoduo.player.play(roomId)) as PlayerState);
  }
  async function stopPlayback() { setPlayer(await window.duoduo.player.stop() as PlayerState); }
  async function refreshAvatar(roomId: string) {
    try { applySnapshot(await window.duoduo.rooms.refreshAvatar(roomId)); setMessage("主播头像已更新"); }
    catch (error) { setMessage(String(error).includes("AVATAR_NOT_FOUND") ? "当前页面没有识别到主播头像，已保留原头像" : `头像更新失败：${String(error)}`); }
  }
  async function probeRoomNow(roomId: string) {
    try { setPreparedProbeState(await window.duoduo.rooms.probe(roomId) as PreparedProbeState); }
    catch (error) {
      const text = String(error);
      setMessage(text.includes("PROBE_COOLDOWN") ? "检测过于频繁，请等待 60 秒" : `检测失败：${text}`);
    }
  }
  async function probeAllRooms() {
    try { setPreparedProbeState(await window.duoduo.rooms.probeAll() as PreparedProbeState); }
    catch (error) { setMessage(`无法更新全部状态：${String(error)}`); }
  }
  async function cancelProbeBatch() {
    try {
      setPreparedProbeState(await window.duoduo.rooms.cancelProbeBatch() as PreparedProbeState);
      setMessage("已停止尚未开始的更新，当前直播间会安全完成");
    } catch (error) { setMessage(`停止后续更新失败：${String(error)}`); }
  }
  function dismissNotification(id: number) { setNotifications((current) => current.filter((item) => item.id !== id)); }
  function openNotification(item: MarketInsight) {
    setView("rooms"); setFocusInsight({ roomId: item.roomId, insightId: item.id }); dismissNotification(item.id);
    setTimeout(() => document.getElementById(`room-card-${item.roomId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }
  const roomName = (roomId: string) => roomDisplayName(roomSnapshot(roomId), roomId);
  const roomIntelligenceSummary = (roomId: string) => roomIntelligence.find((item) => item.roomId === roomId);
  async function openIntelligence(roomId: string) {
    setIntelligenceLoadingRoomId(roomId);
    try { setIntelligenceDetails(await window.duoduo.rooms.getIntelligence(roomId) as RoomIntelligence); }
    catch (error) { setMessage(`读取本地数据详情失败：${String(error)}`); }
    finally { setIntelligenceLoadingRoomId((current) => current === roomId ? undefined : current); }
  }
  const accessBlocked = accessState.mode !== "normal";
  async function openVerification() {
    try {
      const result = await window.duoduo.access.showVerification() as { url?: string };
      setVerificationUrl(result?.url ?? "https://live.douyin.com");
      setVerificationVisible(true);
    } catch (error) { setMessage(`无法打开验证页：${String(error)}`); }
  }
  async function closeVerification() {
    try { await window.duoduo.access.hideVerification(); setVerificationVisible(false); }
    catch (error) { setMessage(`无法关闭验证页：${String(error)}`); }
  }
  async function checkVerification() {
    const checkingMessage = "正在检查验证状态…";
    setMessage(checkingMessage);
    setVerificationFeedback(checkingMessage);
    try {
      const result = await window.duoduo.access.checkVerification() as { clear: boolean; state: DouyinAccessState };
      setAccessState(result.state);
      const resultMessage = result.clear ? "验证检查已通过，请点击“恢复访问”继续" : "仍检测到平台验证，请在验证页完成后再次检查";
      setMessage(resultMessage);
      setVerificationFeedback(resultMessage);
    } catch (error) {
      const errorText = String(error);
      const errorMessage = errorText.includes("VERIFICATION_CHECK_TIMEOUT")
        ? "验证检查超时，请等待页面稳定后重试"
        : `验证检查失败：${errorText}`;
      setMessage(errorMessage);
      setVerificationFeedback(errorMessage);
    }
  }
  async function confirmRecovery() {
    try {
      setAccessState(await window.duoduo.access.confirmRecovery() as DouyinAccessState);
      setVerificationVisible(false);
      setVerificationFeedback("");
      const recoveryMessage = "访问已恢复，自动更新已继续";
      setMessage(recoveryMessage);
      window.setTimeout(() => setMessage((current) => current === recoveryMessage ? "" : current), 4_000);
    } catch (error) { setMessage(`恢复失败：${String(error)}`); }
  }

  useEffect(() => {
    if (!verificationVisible) return;
    const updateBounds = () => {
      const bounds = verificationSurface.current?.getBoundingClientRect();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
      void window.duoduo.access.setVerificationBounds({ x: Math.max(0, Math.round(bounds.x)), y: Math.max(0, Math.round(bounds.y)), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) });
    };
    updateBounds();
    window.addEventListener("resize", updateBounds);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateBounds);
    if (verificationSurface.current) observer?.observe(verificationSurface.current);
    return () => { observer?.disconnect(); window.removeEventListener("resize", updateBounds); };
  }, [verificationVisible]);

  return <div className={`shell ${notifications.length ? "has-insight-notifications" : ""}`}>
    <aside className="sidebar"><div className="brand"><span><Broadcast weight="fill" /></span><strong>多多直播</strong></div><small>工作台</small><button className={view === "rooms" ? "active" : ""} onClick={() => setView("rooms")}><RadioButton weight="fill" />直播监看<i>{rooms.length}</i></button><button className={view === "parsers" ? "active" : ""} onClick={() => setView("parsers")}><TreeStructure />内容分析规则</button><button className={view === "insights" ? "active" : ""} onClick={() => setView("insights")}><Lightbulb />观点中心</button><button className={view === "usage" ? "active" : ""} onClick={() => setView("usage")}><ChartLineUp />AI 用量</button><small>系统</small><button className={view === "data" ? "active" : ""} onClick={() => setView("data")}><Database />数据管理</button><button onClick={() => setDialog("monitoring")}><SlidersHorizontal />监看设置</button><button onClick={() => setDialog("settings")}><Gear />系统设置</button><div className="app-version">{appVersion ? `v${appVersion}` : ""}</div></aside>
    <header><List />{view === "rooms" && <label><MagnifyingGlass /><input placeholder="搜索直播间" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}<span>{provider ? "语音转文字已开启" : "语音转文字未设置"}</span></header>
    {accessBlocked && <div className="verification-banner" role="alert" aria-label="抖音访问已暂停"><div><strong>抖音要求安全验证，新的页面访问已暂停</strong><span>现有可信数据不会被覆盖{"roomId" in accessState ? ` · 直播间 ${accessState.roomId}` : ""}</span></div><div><button onClick={() => void openVerification()}>打开验证页</button><button onClick={() => void checkVerification()} disabled={accessState.mode === "recovery_checking"}>我已完成，检查状态</button>{accessState.mode === "recovery_ready" && <button className="primary" onClick={() => void confirmRecovery()}>恢复访问</button>}</div></div>}
    <InsightNotificationRail items={notifications} timeoutSeconds={notificationTimeout} roomName={roomName} onOpen={openNotification} onDismiss={dismissNotification} />
    {view === "rooms" ? <main><div className="heading"><div><h1>直播监看</h1><p>维护直播间，选择静默监看，并查看每个直播间的实时文字。</p></div><button className="primary" onClick={openAddRoom}><Plus />添加直播间</button></div>
      <section><div className="section-head"><b><em />实时监看中</b><span>{monitored.length} 路，声音默认不外放</span></div><div className="monitor-list">{monitored.map((room) => {
        const runtime = runtimes.find((item) => item.roomId === room.roomId); const snapshot = roomSnapshot(room.roomId); const displaySnapshot = snapshot && runtime && runtime.state !== "starting" ? { ...snapshot, status: runtime.liveStatus } : snapshot;
        return <article className="monitor" id={`room-card-${room.roomId}`} key={room.roomId}><RoomInfo room={room} snapshot={displaySnapshot} intelligence={roomIntelligenceSummary(room.roomId)} intelligenceLoading={intelligenceLoadingRoomId === room.roomId} scheduleText={scheduleText(room)} onEdit={() => openEditRoom(room)} onPlay={() => void togglePlayback(room.roomId)} onRefreshAvatar={() => void refreshAvatar(room.roomId)} onOpenIntelligence={() => void openIntelligence(room.roomId)} active={player.activeRoomId === room.roomId} /><LiveRoomWorkspace roomId={room.roomId} liveEvents={runtime?.asr ?? []} runtimeState={runtime?.state ?? "starting"} parsers={parsers} onParsersChange={setParsers} focusInsightId={focusInsight?.roomId === room.roomId ? focusInsight.insightId : undefined} /></article>;
      })}</div></section>
      <section><PreparedRoomHeader count={pool.length} state={preparedProbeState} roomName={roomName} accessBlocked={accessBlocked} onProbeAll={() => void probeAllRooms()} onCancelBatch={() => void cancelProbeBatch()} /><div className="grid">{pool.map((room) => {
        const snapshot = roomSnapshot(room.roomId);
        const probeState = (preparedProbeState.manualProbes ?? []).find((item) => item.roomId === room.roomId);
        const detail = probeDetail(snapshot);
        const intelligence = roomIntelligenceSummary(room.roomId);
        const followerCount = intelligence?.currentMetrics.followerCount ?? snapshot?.followerCount;
        return <article className="card" key={room.roomId}><Cover roomId={room.roomId} snapshot={snapshot} probeState={probeState} scheduleText={scheduleText(room)} loading={intelligenceLoadingRoomId === room.roomId} onOpenIntelligence={() => void openIntelligence(room.roomId)} /><div className="body"><h2 className="room-name">{roomDisplayName(snapshot, room.roomId)}</h2><div className="room-metrics-actions"><p className="room-follower"><span>主播粉丝</span><b>{compactCount(followerCount)}</b></p><RoomCardActions active={player.activeRoomId === room.roomId} blocked={accessBlocked} probeState={probeState} onPlay={() => void togglePlayback(room.roomId)} onProbe={() => void probeRoomNow(room.roomId)} onRefreshAvatar={() => void refreshAvatar(room.roomId)} onEdit={() => openEditRoom(room)} onDelete={() => void window.duoduo.rooms.remove(room.roomId)} /></div><LiveDescription value={snapshot?.liveDescription} /><RoomIntelligenceBadges summary={intelligence} status={snapshot?.status} onOpen={() => void openIntelligence(room.roomId)} />{snapshot && detail && <p className="probe-detail">{detail}</p>}<div className="monitor-controls"><button className={`join-monitoring ${(snapshot?.status === "live" || (snapshot?.status === "checking" && snapshot.lastReliableStatus === "live")) ? "live" : ""}`} disabled={accessBlocked} onClick={() => void window.duoduo.rooms.setMonitoring(room.roomId, true)}>加入实时监看</button><label className="auto-monitor"><input type="checkbox" checked={room.autoMonitorOnLive} disabled={accessBlocked} onChange={(event) => void window.duoduo.rooms.setAutoMonitorOnLive(room.roomId, event.currentTarget.checked)} />开播后自动监看</label></div></div></article>;
      })}</div></section>
    </main> : view === "parsers" ? <main><ParserManagement rooms={rooms} snapshots={snapshots} /></main> : view === "insights" ? <main><InsightCenter rooms={rooms} /></main> : view === "usage" ? <AiUsageDashboard /> : <DataManagement />}
    {player.activeRoomId && <PlayerDrawer room={rooms.find((room) => room.roomId === player.activeRoomId)} snapshot={roomSnapshot(player.activeRoomId)} state={player} onStop={() => void stopPlayback()} />}
    {intelligenceDetails && <RoomIntelligenceDrawer roomName={roomName(intelligenceDetails.roomId)} details={intelligenceDetails} onClose={() => setIntelligenceDetails(undefined)} />}
    {verificationVisible && <div className="verification-overlay" role="dialog" aria-label="抖音人工验证"><div className="verification-toolbar"><div><strong>抖音人工验证</strong><span>{verificationHost(verificationUrl)} · 请在下方页面亲自完成平台要求的操作</span>{verificationFeedback && <span className="verification-feedback" role="status">{verificationFeedback}</span>}</div><div><button onClick={() => void checkVerification()} disabled={accessState.mode === "recovery_checking"}>我已完成，检查状态</button>{accessState.mode === "recovery_ready" && <button className="primary" onClick={() => void confirmRecovery()}>恢复访问</button>}<button onClick={() => void closeVerification()}>关闭验证页</button></div></div><div className="verification-surface" ref={verificationSurface} aria-label="抖音验证页面" /></div>}
    {dialog && <div className="backdrop" onMouseDown={() => setDialog(null)}><form className="modal" onSubmit={dialog === "room" ? saveRoom : dialog === "monitoring" ? saveMonitoringSettings : saveProvider} onMouseDown={(event) => event.stopPropagation()}><div><h2>{dialog === "room" ? (editingRoomId ? "编辑直播间" : "添加直播间") : dialog === "monitoring" ? "监看设置" : "系统设置"}</h2><button type="button" onClick={() => setDialog(null)}><X /></button></div>{dialog === "room" ? <RoomFields url={url} setUrl={setUrl} scheduleMode={scheduleMode} setScheduleMode={setScheduleMode} days={days} setDays={setDays} ranges={ranges} setRanges={setRanges} probeInterval={probeInterval} setProbeInterval={setProbeInterval} /> : dialog === "monitoring" ? <><label>直播状态更新速度<select value={monitoringSettings.monitoredCheckSeconds} onChange={(event) => setMonitoringSettings({ ...monitoringSettings, monitoredCheckSeconds: Number(event.target.value) as MonitoringSettings["monitoredCheckSeconds"] })}>{[15, 30, 60, 120].map((seconds) => <option value={seconds} key={seconds}>约 {seconds} 秒内</option>)}</select></label><label>未监看直播间检查频率<select value={monitoringSettings.preparedCheckMinutes} onChange={(event) => setMonitoringSettings({ ...monitoringSettings, preparedCheckMinutes: Number(event.target.value) as MonitoringSettings["preparedCheckMinutes"] })}>{[1, 3, 5, 10, 15, 30].map((minutes) => <option value={minutes} key={minutes}>每 {minutes} 分钟</option>)}</select></label><p>修改后立即生效。实时监看优先读取现有页面，不额外刷新抖音页面。</p></> : <><ProviderFields providerType={providerType} setProviderType={setProviderType} endpoint={endpoint} setEndpoint={setEndpoint} auth={auth} setAuth={setAuth} secret={secret} setSecret={setSecret} secretRequired={!provider} /><div className="notification-setting"><label>新观点提醒自动关闭<select aria-label="新观点提醒自动关闭" value={notificationTimeout ?? "never"} onChange={(event) => setNotificationTimeout(event.target.value === "never" ? null : Number(event.target.value) as 10 | 30 | 60)}><option value="never">永不自动关闭</option><option value="10">10 秒</option><option value="30">30 秒</option><option value="60">60 秒</option></select></label><button type="button" onClick={() => void saveNotificationSettings()}>保存提醒设置</button></div></>}<footer>{dialog === "settings" && <button type="button" onClick={() => void testProvider()}>测试连接</button>}<button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary" type="submit">{dialog === "room" ? "保存直播间" : dialog === "monitoring" ? "保存监看设置" : "保存语音转文字设置"}</button></footer></form></div>}
    {message && <div className="toast">{message}<button onClick={() => setMessage("")}><X /></button></div>}
  </div>;
}

function Cover({ roomId, snapshot, probeState, scheduleText, loading = false, onOpenIntelligence }: { roomId: string; snapshot?: RoomSnapshot; probeState?: ProbeRequestState; scheduleText?: string; loading?: boolean; onOpenIntelligence?: () => void }) {
  const status = probeState?.phase === "queued" ? "queued" : probeState?.phase === "running" ? "checking" : snapshot?.status === "checking" || !snapshot ? "unprobed" : snapshot.status;
  const offline = status === "offline";
  const statusLabel = status === "queued" ? (probeState?.requestType === "initial" ? "等待首次检测" : "等待检测") : status === "unprobed" ? "待检测" : statusLabels[status];
  const emptyLabel = status === "unprobed" ? "等待首次检测" : status === "queued" ? "等待安全检测通道" : offline ? "当前未开播" : "尚未获取直播画面";
  const checkingText = snapshot?.lastReliableStatus === "live" ? "上次状态：直播中" : snapshot?.lastReliableStatus === "offline" ? "上次状态：未开播" : "正在确认直播状态";
  return <div className={`cover cover-${status}`}>{!offline && snapshot?.coverPath ? <img className="live-cover" src={`duoduo-cover://${roomId}?v=${encodeURIComponent(snapshot.checkedAt)}`} alt={snapshot.title || `直播间 ${roomId}`} /> : <div className="cover-empty"><Broadcast /><small>{emptyLabel}</small></div>}{snapshot?.avatarPath && <img className={offline ? "avatar avatar-offline" : "avatar avatar-live"} src={`duoduo-avatar://${roomId}?v=${encodeURIComponent(snapshot.avatarPath)}`} alt={`${snapshot.anchorName ?? "主播"}头像`} />}{status === "live" && snapshot?.viewerCount !== undefined && <span className="viewer-count">{snapshot.viewerCount.toLocaleString("zh-CN")} 人在线</span>}<span className={`status ${status}`}>{statusLabel}</span>{status === "checking" && <div className="cover-meta"><span>{checkingText}</span></div>}{offline && <div className="cover-meta"><span>{scheduleText ?? "直播时间不确定"}</span><span>{snapshot ? compactCheckedAt(snapshot.checkedAt) : "等待首次检测"}</span></div>}{onOpenIntelligence && <button className="cover-intelligence" type="button" disabled={loading} onClick={onOpenIntelligence}>{loading ? "读取中" : "数据详情"}</button>}</div>;
}

function RoomInfo({ room, snapshot, intelligence, intelligenceLoading, scheduleText, onEdit, onPlay, onRefreshAvatar, onOpenIntelligence, active }: { room: Room; snapshot?: RoomSnapshot; intelligence?: RoomIntelligenceSummary; intelligenceLoading?: boolean; scheduleText: string; onEdit: () => void; onPlay: () => void; onRefreshAvatar: () => void; onOpenIntelligence: () => void; active: boolean }) {
  const followerCount = intelligence?.currentMetrics.followerCount ?? snapshot?.followerCount;
  const viewerText = snapshot?.status === "live" && snapshot.viewerCount !== undefined ? snapshot.viewerCount.toLocaleString("zh-CN") : "—";
  return <div className="room-info"><Cover roomId={room.roomId} snapshot={snapshot} scheduleText={scheduleText} loading={intelligenceLoading} onOpenIntelligence={onOpenIntelligence} /><div className="monitored-room-body"><h2 className="room-name">{roomDisplayName(snapshot, room.roomId)}</h2><RoomMetricsActions followerText={followerCount === undefined ? "—" : compactCount(followerCount)} viewerText={viewerText}><div className="monitor-actions"><button aria-label={active ? "停止播放" : "播放直播"} onClick={onPlay}>{active ? <Stop weight="fill" /> : <Play weight="fill" />}</button><button aria-label="更新主播头像" onClick={onRefreshAvatar}><ImageSquare /></button><button aria-label="编辑直播间" onClick={onEdit}><PencilSimple /></button></div></RoomMetricsActions><LiveDescription value={snapshot?.liveDescription} /><RoomIntelligenceBadges summary={intelligence} status={snapshot?.status} onOpen={onOpenIntelligence} /><button className="leave-monitoring" onClick={() => void window.duoduo.rooms.setMonitoring(room.roomId, false)}>退出实时监看</button></div></div>;
}

function LiveDescription({ value }: { value?: string }) {
  if (!value?.trim()) return null;
  return <p className="live-description" title={value}>直播介绍：{value}</p>;
}

function PlayerDrawer({ room, snapshot, state, onStop }: { room?: Room; snapshot?: RoomSnapshot; state: PlayerState; onStop: () => void }) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const updateBounds = () => {
      const bounds = surface.current?.getBoundingClientRect();
      if (!bounds) return;
      void window.duoduo.player.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) });
    };
    updateBounds();
    window.addEventListener("resize", updateBounds);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateBounds);
    if (surface.current) observer?.observe(surface.current);
    return () => { observer?.disconnect(); window.removeEventListener("resize", updateBounds); };
  }, [state.activeRoomId]);
  return <aside className="player-drawer" aria-label="直播播放器"><div className="player-head"><div><b>{snapshot?.anchorName || snapshot?.title || `直播间 ${room?.roomId ?? state.activeRoomId}`}</b><span>{state.status === "loading" ? "正在加载直播" : state.status === "error" ? state.error || "播放失败" : "正在播放"}</span></div><button title="停止播放" onClick={onStop}><Stop weight="fill" /></button></div><div className="player-surface" ref={surface}><span>{state.status === "loading" ? "正在连接直播画面…" : state.status === "error" ? state.error : ""}</span></div></aside>;
}

interface RoomFieldsProps { url: string; setUrl(value: string): void; scheduleMode: "uncertain" | "fixed"; setScheduleMode(value: "uncertain" | "fixed"): void; days: number[]; setDays(value: number[]): void; ranges: TimeRange[]; setRanges(value: TimeRange[]): void; probeInterval: string; setProbeInterval(value: string): void }
function RoomFields({ url, setUrl, scheduleMode, setScheduleMode, days, setDays, ranges, setRanges, probeInterval, setProbeInterval }: RoomFieldsProps) {
  return <><label>抖音直播间链接<input autoFocus required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://live.douyin.com/123456" /></label><label>直播时间<select value={scheduleMode} onChange={(event) => setScheduleMode(event.target.value as "uncertain" | "fixed")}><option value="uncertain">不确定</option><option value="fixed">固定周期</option></select></label>{scheduleMode === "fixed" && <div className="schedule-fields"><span>直播星期</span><div className="weekday-options">{weekdays.map((day, index) => <label key={day}><input type="checkbox" checked={days.includes(index)} onChange={() => setDays(days.includes(index) ? days.filter((value) => value !== index) : [...days, index].sort())} />周{day}</label>)}</div><span>直播时段</span>{ranges.map((range, index) => <div className="time-range" key={index}><input type="time" value={range.start} onChange={(event) => setRanges(ranges.map((item, itemIndex) => itemIndex === index ? { ...item, start: event.target.value } : item))} /><span>至</span><input type="time" value={range.end} onChange={(event) => setRanges(ranges.map((item, itemIndex) => itemIndex === index ? { ...item, end: event.target.value } : item))} />{ranges.length > 1 && <button type="button" title="删除时段" onClick={() => setRanges(ranges.filter((_, itemIndex) => itemIndex !== index))}><Trash /></button>}</div>)}<button className="add-range" type="button" onClick={() => setRanges([...ranges, { start: "19:00", end: "22:00" }])}><Plus />增加时段</button></div>}<label>检查开播状态频率<select value={probeInterval} onChange={(event) => setProbeInterval(event.target.value)}><option value="default">跟随全局监看设置</option>{[1, 3, 5, 10, 15, 30].map((minutes) => <option value={minutes} key={minutes}>每 {minutes} 分钟</option>)}</select></label></>;
}

interface ProviderFieldsProps { providerType: "bailian" | "duoduo-streaming-asr-v1"; setProviderType(value: "bailian" | "duoduo-streaming-asr-v1"): void; endpoint: string; setEndpoint(value: string): void; auth: "none" | "bearer" | "x-api-key"; setAuth(value: "none" | "bearer" | "x-api-key"): void; secret: string; setSecret(value: string): void; secretRequired: boolean }
function ProviderFields({ providerType, setProviderType, endpoint, setEndpoint, auth, setAuth, secret, setSecret, secretRequired }: ProviderFieldsProps) {
  return <><label>语音转文字服务<select value={providerType} onChange={(event) => setProviderType(event.target.value as typeof providerType)}><option value="bailian">阿里云百炼</option><option value="duoduo-streaming-asr-v1">通用语音转文字网关（ASR）</option></select></label>{providerType === "duoduo-streaming-asr-v1" && <><label>WebSocket URL<input required value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label><label>鉴权<select value={auth} onChange={(event) => setAuth(event.target.value as typeof auth)}><option value="none">无鉴权</option><option value="bearer">Bearer Token</option><option value="x-api-key">X-API-Key</option></select></label></>}{(providerType === "bailian" || auth !== "none") && <label>{providerType === "bailian" ? "API Key" : "访问凭据"}<input autoFocus required={secretRequired} type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="off" placeholder={secretRequired ? "请输入 API Key" : "留空则继续使用已保存凭据"} /></label>}</>;
}

function verificationHost(value: string): string {
  try { return new URL(value).hostname || "live.douyin.com"; } catch { return "live.douyin.com"; }
}
