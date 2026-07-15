import { ArrowClockwise, Broadcast, CalendarDots, Database, Gear, ImageSquare, Lightbulb, List, MagnifyingGlass, PencilSimple, Play, Plus, RadioButton, SlidersHorizontal, Stop, Trash, TreeStructure, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AsrProviderConfig, InsightNotificationSettings, MarketInsight, MonitoringSettings, Room, RoomRuntime, RoomSnapshot } from "../shared/contracts";
import { ParserManagement } from "./components/ParserManagement";
import { InsightCenter } from "./components/InsightCenter";
import { InsightNotificationRail } from "./components/InsightNotificationRail";
import { LiveRoomWorkspace, type ParserSnapshot } from "./components/LiveRoomWorkspace";
import { DataManagement } from "./components/DataManagement";

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
const statusLabels: Record<RoomSnapshot["status"], string> = { checking: "检测中", live: "直播中", offline: "未开播", login_required: "需要登录", timeout: "检测超时", page_error: "检测失败" };
type TimeRange = { start: string; end: string };
type PlayerState = { activeRoomId: string | null; status: "stopped" | "loading" | "playing" | "error"; error?: string };

export function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [runtimes, setRuntimes] = useState<RoomRuntime[]>([]);
  const [snapshots, setSnapshots] = useState<RoomSnapshot[]>([]);
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
  const [view, setView] = useState<"rooms" | "parsers" | "insights" | "data">("rooms");
  const [parsers, setParsers] = useState<ParserSnapshot>({ definitions: [], bindings: [], tests: [], llmConfigured: false });
  const [notifications, setNotifications] = useState<MarketInsight[]>([]);
  const [notificationTimeout, setNotificationTimeout] = useState<InsightNotificationSettings["timeoutSeconds"]>(30);
  const [monitoringSettings, setMonitoringSettings] = useState<MonitoringSettings>({ monitoredCheckSeconds: 30, preparedCheckMinutes: 5 });
  const [focusInsight, setFocusInsight] = useState<{ roomId: string; insightId: number }>();
  const latestInsightId = useRef<number | undefined>(undefined);

  function applySnapshot(value: unknown) {
    const snapshot = value as { rooms: Room[]; runtimes: RoomRuntime[]; snapshots?: RoomSnapshot[] };
    setRooms(snapshot.rooms ?? []);
    setRuntimes(snapshot.runtimes ?? []);
    setSnapshots(snapshot.snapshots ?? []);
  }
  async function refresh() { applySnapshot(await window.duoduo.rooms.list()); }
  useEffect(() => {
    void refresh();
    void window.duoduo.app.getVersion().then((value) => setAppVersion(String(value)));
    void window.duoduo.settings.getAsrProvider().then((value) => {
      const config = value as AsrProviderConfig | undefined; setProvider(config);
      if (!config) return;
      setProviderType(config.type);
      if (config.type === "duoduo-streaming-asr-v1") { setEndpoint(config.endpoint); setAuth(config.auth); }
    });
    void window.duoduo.settings.getInsightNotifications().then((value) => setNotificationTimeout((value as InsightNotificationSettings).timeoutSeconds));
    void window.duoduo.settings.getMonitoring().then((value) => setMonitoringSettings(value as MonitoringSettings));
    void window.duoduo.parsers.list().then((value) => setParsers(value as ParserSnapshot));
    return window.duoduo.rooms.subscribe(applySnapshot);
  }, []);
  useEffect(() => { if (view === "rooms") void window.duoduo.parsers.list().then((value) => setParsers(value as ParserSnapshot)); }, [view]);
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
    event.preventDefault(); const config = draftProvider(); await window.duoduo.settings.saveAsrProvider(config, secret || undefined); setProvider(config); setSecret(""); setDialog(null); setMessage("ASR 设置已保存");
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
  function dismissNotification(id: number) { setNotifications((current) => current.filter((item) => item.id !== id)); }
  function openNotification(item: MarketInsight) {
    setView("rooms"); setFocusInsight({ roomId: item.roomId, insightId: item.id }); dismissNotification(item.id);
    setTimeout(() => document.getElementById(`room-card-${item.roomId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }
  const roomName = (roomId: string) => { const snapshot = roomSnapshot(roomId); return snapshot?.anchorName || snapshot?.title || `直播间 ${roomId}`; };

  return <div className={`shell ${notifications.length ? "has-insight-notifications" : ""}`}>
    <aside className="sidebar"><div className="brand"><span><Broadcast weight="fill" /></span><strong>多多直播</strong></div><small>工作台</small><button className={view === "rooms" ? "active" : ""} onClick={() => setView("rooms")}><RadioButton weight="fill" />直播监看<i>{rooms.length}</i></button><button className={view === "parsers" ? "active" : ""} onClick={() => setView("parsers")}><TreeStructure />解析器管理</button><button className={view === "insights" ? "active" : ""} onClick={() => setView("insights")}><Lightbulb />观点中心</button><small>系统</small><button className={view === "data" ? "active" : ""} onClick={() => setView("data")}><Database />数据管理</button><button onClick={() => setDialog("monitoring")}><SlidersHorizontal />监看设置</button><button onClick={() => setDialog("settings")}><Gear />系统设置</button><div className="app-version">{appVersion ? `v${appVersion}` : ""}</div></aside>
    <header><List />{view === "rooms" && <label><MagnifyingGlass /><input placeholder="搜索直播间" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}<span>{provider ? "ASR 已配置" : "ASR 未配置"}</span></header>
    <InsightNotificationRail items={notifications} timeoutSeconds={notificationTimeout} roomName={roomName} onOpen={openNotification} onDismiss={dismissNotification} />
    {view === "rooms" ? <main><div className="heading"><div><h1>直播监看</h1><p>维护直播间，选择静默监看，并查看每路独立 ASR。</p></div><button className="primary" onClick={openAddRoom}><Plus />添加直播间</button></div>
      <section><div className="section-head"><b><em />实时监看中</b><span>{monitored.length} 路，声音默认不外放</span></div><div className="monitor-list">{monitored.map((room) => {
        const runtime = runtimes.find((item) => item.roomId === room.roomId); const snapshot = roomSnapshot(room.roomId); const displaySnapshot = snapshot && runtime ? { ...snapshot, status: runtime.liveStatus } : snapshot;
        return <article className="monitor" id={`room-card-${room.roomId}`} key={room.roomId}><RoomInfo room={room} snapshot={displaySnapshot} scheduleText={scheduleText(room)} onEdit={() => openEditRoom(room)} onPlay={() => void togglePlayback(room.roomId)} onRefreshAvatar={() => void refreshAvatar(room.roomId)} active={player.activeRoomId === room.roomId} /><LiveRoomWorkspace roomId={room.roomId} liveEvents={runtime?.asr ?? []} runtimeState={runtime?.state ?? "starting"} parsers={parsers} onParsersChange={setParsers} focusInsightId={focusInsight?.roomId === room.roomId ? focusInsight.insightId : undefined} /></article>;
      })}</div></section>
      <section><div className="section-head"><b>预备直播间</b><span>{pool.length} 个未监看</span></div><div className="grid">{pool.map((room) => {
        const snapshot = roomSnapshot(room.roomId);
        return <article className="card" key={room.roomId}><Cover roomId={room.roomId} snapshot={snapshot} /><div className="body"><div><h2>{snapshot?.anchorName || snapshot?.title || `直播间 ${room.roomId}`}</h2><span className="card-actions"><button title={player.activeRoomId === room.roomId ? "停止播放" : "播放直播"} onClick={() => void togglePlayback(room.roomId)}>{player.activeRoomId === room.roomId ? <Stop weight="fill" /> : <Play weight="fill" />}</button><button title="检测直播状态" onClick={() => void window.duoduo.rooms.probe(room.roomId)}><ArrowClockwise /></button><button title="更新头像" onClick={() => void refreshAvatar(room.roomId)}><ImageSquare /></button><button title="编辑直播间" onClick={() => openEditRoom(room)}><PencilSimple /></button><button title="删除直播间" onClick={() => void window.duoduo.rooms.remove(room.roomId)}><Trash /></button></span></div><p>{room.canonicalUrl}</p><p><CalendarDots />{scheduleText(room)}</p><p className="checked-at">{snapshot ? `最后检测 ${formatCheckedAt(snapshot.checkedAt)}` : "等待首次检测"}</p><label><input type="checkbox" onChange={() => void window.duoduo.rooms.setMonitoring(room.roomId, true)} />加入实时监看</label></div></article>;
      })}</div></section>
    </main> : view === "parsers" ? <main><ParserManagement rooms={rooms} snapshots={snapshots} /></main> : view === "insights" ? <main><InsightCenter rooms={rooms} /></main> : <DataManagement />}
    {player.activeRoomId && <PlayerDrawer room={rooms.find((room) => room.roomId === player.activeRoomId)} snapshot={roomSnapshot(player.activeRoomId)} state={player} onStop={() => void stopPlayback()} />}
    {dialog && <div className="backdrop" onMouseDown={() => setDialog(null)}><form className="modal" onSubmit={dialog === "room" ? saveRoom : dialog === "monitoring" ? saveMonitoringSettings : saveProvider} onMouseDown={(event) => event.stopPropagation()}><div><h2>{dialog === "room" ? (editingRoomId ? "编辑直播间" : "添加直播间") : dialog === "monitoring" ? "监看设置" : "系统设置"}</h2><button type="button" onClick={() => setDialog(null)}><X /></button></div>{dialog === "room" ? <RoomFields url={url} setUrl={setUrl} scheduleMode={scheduleMode} setScheduleMode={setScheduleMode} days={days} setDays={setDays} ranges={ranges} setRanges={setRanges} probeInterval={probeInterval} setProbeInterval={setProbeInterval} /> : dialog === "monitoring" ? <><label>实时监看状态延迟<select value={monitoringSettings.monitoredCheckSeconds} onChange={(event) => setMonitoringSettings({ ...monitoringSettings, monitoredCheckSeconds: Number(event.target.value) as MonitoringSettings["monitoredCheckSeconds"] })}>{[15, 30, 60, 120].map((seconds) => <option value={seconds} key={seconds}>约 {seconds} 秒内</option>)}</select></label><label>预备直播间检测频率<select value={monitoringSettings.preparedCheckMinutes} onChange={(event) => setMonitoringSettings({ ...monitoringSettings, preparedCheckMinutes: Number(event.target.value) as MonitoringSettings["preparedCheckMinutes"] })}>{[1, 3, 5, 10, 15, 30].map((minutes) => <option value={minutes} key={minutes}>每 {minutes} 分钟</option>)}</select></label><p>修改后立即生效。实时监看优先读取现有页面，不额外刷新抖音页面。</p></> : <><ProviderFields providerType={providerType} setProviderType={setProviderType} endpoint={endpoint} setEndpoint={setEndpoint} auth={auth} setAuth={setAuth} secret={secret} setSecret={setSecret} secretRequired={!provider} /><div className="notification-setting"><label>新观点提醒自动关闭<select aria-label="新观点提醒自动关闭" value={notificationTimeout ?? "never"} onChange={(event) => setNotificationTimeout(event.target.value === "never" ? null : Number(event.target.value) as 10 | 30 | 60)}><option value="never">永不自动关闭</option><option value="10">10 秒</option><option value="30">30 秒</option><option value="60">60 秒</option></select></label><button type="button" onClick={() => void saveNotificationSettings()}>保存提醒设置</button></div></>}<footer>{dialog === "settings" && <button type="button" onClick={() => void testProvider()}>测试连接</button>}<button type="button" onClick={() => setDialog(null)}>取消</button><button className="primary" type="submit">{dialog === "room" ? "保存直播间" : dialog === "monitoring" ? "保存监看设置" : "保存 ASR 设置"}</button></footer></form></div>}
    {message && <div className="toast">{message}<button onClick={() => setMessage("")}><X /></button></div>}
  </div>;
}

function Cover({ roomId, snapshot }: { roomId: string; snapshot?: RoomSnapshot }) {
  const status = snapshot?.status ?? "checking";
  const offline = status === "offline";
  return <div className={`cover cover-${status}`}>{!offline && snapshot?.coverPath ? <img className="live-cover" src={`duoduo-cover://${roomId}?v=${encodeURIComponent(snapshot.checkedAt)}`} alt={snapshot.title || `直播间 ${roomId}`} /> : <div className="cover-empty"><Broadcast /><small>{offline ? "当前未开播" : "尚未获取直播画面"}</small></div>}{snapshot?.avatarPath && <img className={offline ? "avatar avatar-offline" : "avatar avatar-live"} src={`duoduo-avatar://${roomId}?v=${encodeURIComponent(snapshot.avatarPath)}`} alt={`${snapshot.anchorName ?? "主播"}头像`} />}{status === "live" && snapshot?.viewerCount !== undefined && <span className="viewer-count">{snapshot.viewerCount.toLocaleString("zh-CN")} 人在线</span>}<span className={`status ${status}`}>{statusLabels[status]}</span></div>;
}

function RoomInfo({ room, snapshot, scheduleText, onEdit, onPlay, onRefreshAvatar, active }: { room: Room; snapshot?: RoomSnapshot; scheduleText: string; onEdit: () => void; onPlay: () => void; onRefreshAvatar: () => void; active: boolean }) {
  return <div className="room-info"><Cover roomId={room.roomId} snapshot={snapshot} /><div><div className="room-title"><h2>{snapshot?.anchorName || snapshot?.title || `直播间 ${room.roomId}`}</h2><button title={active ? "停止播放" : "播放直播"} onClick={onPlay}>{active ? <Stop weight="fill" /> : <Play weight="fill" />}</button><button title="更新头像" onClick={onRefreshAvatar}><ImageSquare /></button><button title="编辑直播间" onClick={onEdit}><PencilSimple /></button></div><p>{room.canonicalUrl}</p><p><CalendarDots />{scheduleText}</p><label><input type="checkbox" checked onChange={() => void window.duoduo.rooms.setMonitoring(room.roomId, false)} />实时监看中</label></div></div>;
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
  return <><label>抖音直播间链接<input autoFocus required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://live.douyin.com/123456" /></label><label>直播时间<select value={scheduleMode} onChange={(event) => setScheduleMode(event.target.value as "uncertain" | "fixed")}><option value="uncertain">不确定</option><option value="fixed">固定周期</option></select></label>{scheduleMode === "fixed" && <div className="schedule-fields"><span>直播星期</span><div className="weekday-options">{weekdays.map((day, index) => <label key={day}><input type="checkbox" checked={days.includes(index)} onChange={() => setDays(days.includes(index) ? days.filter((value) => value !== index) : [...days, index].sort())} />周{day}</label>)}</div><span>直播时段</span>{ranges.map((range, index) => <div className="time-range" key={index}><input type="time" value={range.start} onChange={(event) => setRanges(ranges.map((item, itemIndex) => itemIndex === index ? { ...item, start: event.target.value } : item))} /><span>至</span><input type="time" value={range.end} onChange={(event) => setRanges(ranges.map((item, itemIndex) => itemIndex === index ? { ...item, end: event.target.value } : item))} />{ranges.length > 1 && <button type="button" title="删除时段" onClick={() => setRanges(ranges.filter((_, itemIndex) => itemIndex !== index))}><Trash /></button>}</div>)}<button className="add-range" type="button" onClick={() => setRanges([...ranges, { start: "19:00", end: "22:00" }])}><Plus />增加时段</button></div>}<label>状态检测频次<select value={probeInterval} onChange={(event) => setProbeInterval(event.target.value)}><option value="default">跟随全局监看设置</option>{[1, 3, 5, 10, 15, 30].map((minutes) => <option value={minutes} key={minutes}>每 {minutes} 分钟</option>)}</select></label></>;
}

interface ProviderFieldsProps { providerType: "bailian" | "duoduo-streaming-asr-v1"; setProviderType(value: "bailian" | "duoduo-streaming-asr-v1"): void; endpoint: string; setEndpoint(value: string): void; auth: "none" | "bearer" | "x-api-key"; setAuth(value: "none" | "bearer" | "x-api-key"): void; secret: string; setSecret(value: string): void; secretRequired: boolean }
function ProviderFields({ providerType, setProviderType, endpoint, setEndpoint, auth, setAuth, secret, setSecret, secretRequired }: ProviderFieldsProps) {
  return <><label>服务类型<select value={providerType} onChange={(event) => setProviderType(event.target.value as typeof providerType)}><option value="bailian">阿里云百炼</option><option value="duoduo-streaming-asr-v1">通用 ASR 网关</option></select></label>{providerType === "duoduo-streaming-asr-v1" && <><label>WebSocket URL<input required value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label><label>鉴权<select value={auth} onChange={(event) => setAuth(event.target.value as typeof auth)}><option value="none">无鉴权</option><option value="bearer">Bearer Token</option><option value="x-api-key">X-API-Key</option></select></label></>}{(providerType === "bailian" || auth !== "none") && <label>{providerType === "bailian" ? "API Key" : "访问凭据"}<input autoFocus required={secretRequired} type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="off" placeholder={secretRequired ? "请输入 API Key" : "留空则继续使用已保存凭据"} /></label>}</>;
}

function formatCheckedAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
