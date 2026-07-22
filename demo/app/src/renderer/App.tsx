import {
  ArrowClockwise,
  Broadcast,
  CaretDown,
  ChartLineUp,
  Database,
  Gear,
  ImageSquare,
  Lightbulb,
  List,
  MagnifyingGlass,
  PencilSimple,
  Play,
  Plus,
  RadioButton,
  SquaresFour,
  Stop,
  Trash,
  TreeStructure,
  X,
} from "@phosphor-icons/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  AsrProviderConfig,
  ContentRecord,
  DouyinAccessState,
  InsightNotificationSettings,
  MarketInsight,
  MonitoringSettings,
  PreparedProbeState,
  ProbeRequestState,
  Room,
  RoomGroup,
  RoomIntelligence,
  RoomIntelligenceSummary,
  RoomRuntime,
  RoomSnapshot,
} from "../shared/contracts";
import { ParserManagement } from "./components/ParserManagement";
import { InsightCenter } from "./components/InsightCenter";
import { InsightNotificationRail, type InsightNotificationItem } from "./components/InsightNotificationRail";
import { LiveRoomWorkspace } from "./components/LiveRoomWorkspace";
import { DataManagement } from "./components/DataManagement";
import { AiUsageDashboard } from "./components/AiUsageDashboard";
import { RoomGroupWorkspace } from "./components/RoomGroupWorkspace";
import { PreparedRoomHeader } from "./components/PreparedRoomHeader";
import { RoomCardActions } from "./components/RoomCardActions";
import { RoomMetricsActions } from "./components/RoomMetricsActions";
import {
  SettingsCenter,
  settingsSectionMeta,
  type SettingsSection,
} from "./components/SettingsCenter";
import { applyTheme, getStoredTheme, themes, type ThemeId } from "./theme";

type ParserSnapshot = { llmConfigured: boolean };
import {
  RoomIntelligenceBadges,
  RoomIntelligenceDrawer,
} from "./components/RoomIntelligence";
import {
  compactCheckedAt,
  compactCount,
  probeDetail,
  roomDisplayName,
} from "./room-card-presenter";

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
const statusLabels: Record<RoomSnapshot["status"], string> = {
  checking: "检测中",
  live: "直播中",
  offline: "未开播",
  login_required: "需要登录",
  verification_required: "需要验证",
  timeout: "检测超时",
  page_error: "检测失败",
};
type TimeRange = { start: string; end: string };
type PlayerState = {
  activeRoomId: string | null;
  status: "stopped" | "loading" | "playing" | "error";
  error?: string;
};

export function App() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [runtimes, setRuntimes] = useState<RoomRuntime[]>([]);
  const [snapshots, setSnapshots] = useState<RoomSnapshot[]>([]);
  const [roomIntelligence, setRoomIntelligence] = useState<
    RoomIntelligenceSummary[]
  >([]);
  const [intelligenceDetails, setIntelligenceDetails] =
    useState<RoomIntelligence>();
  const [intelligenceLoadingRoomId, setIntelligenceLoadingRoomId] =
    useState<string>();
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<"room" | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<string>();
  const [activeGroupId, setActiveGroupId] = useState<string>();
  const [selectedGroupId, setSelectedGroupId] = useState<string>();
  const [url, setUrl] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"uncertain" | "fixed">(
    "uncertain",
  );
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [ranges, setRanges] = useState<TimeRange[]>([
    { start: "09:00", end: "12:00" },
  ]);
  const [roomGroups, setRoomGroups] = useState<RoomGroup[]>([]);
  const [roomGroupId, setRoomGroupId] = useState("");
  const [provider, setProvider] = useState<AsrProviderConfig | undefined>();
  const [message, setMessage] = useState("");
  const [deletingRoomIds, setDeletingRoomIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [joiningRoomIds, setJoiningRoomIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [refreshingAvatarIds, setRefreshingAvatarIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [appVersion, setAppVersion] = useState("");
  const [player, setPlayer] = useState<PlayerState>({
    activeRoomId: null,
    status: "stopped",
  });
  const [view, setView] = useState<
    "rooms" | "parsers" | "insights" | "usage" | "data" | "settings"
  >("rooms");
  const [parsers, setParsers] = useState<ParserSnapshot>({
    llmConfigured: false,
  });
  const [notifications, setNotifications] = useState<InsightNotificationItem[]>([]);
  const [notificationTimeout, setNotificationTimeout] =
    useState<InsightNotificationSettings["timeoutSeconds"]>(30);
  const [monitoringSettings, setMonitoringSettings] =
    useState<MonitoringSettings>({
      monitoredCheckSeconds: 30,
      preparedCheckMinutes: 5,
    });
  const [theme, setTheme] = useState<ThemeId>(() => getStoredTheme());
  const activeTheme = themes.find((item) => item.id === theme) ?? themes[0];
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("appearance");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [focusInsight, setFocusInsight] = useState<{
    roomId: string;
    insightId: number;
  }>();
  const [, setProbeClock] = useState(0);
  const [preparedProbeState, setPreparedProbeState] =
    useState<PreparedProbeState>({
      mode: "idle",
      queuedRoomIds: [],
      manualProbes: [],
    });
  const [accessState, setAccessState] = useState<DouyinAccessState>({
    mode: "normal",
  });
  const [verificationVisible, setVerificationVisible] = useState(false);
  const [verificationUrl, setVerificationUrl] = useState("");
  const [verificationFeedback, setVerificationFeedback] = useState("");
  const verificationSurface = useRef<HTMLDivElement>(null);
  const latestInsightId = useRef<number | undefined>(undefined);
  const latestContentRecordId = useRef<number | undefined>(undefined);

  useEffect(() => applyTheme(theme), [theme]);

  const pageContext =
    view === "settings"
      ? settingsSectionMeta[settingsSection]
      : {
          rooms: { label: "直播监看", description: "直播间状态与实时内容", icon: <RadioButton weight="fill" /> },
          parsers: { label: "内容洞察", description: "分析器与洞察规则", icon: <TreeStructure /> },
          insights: { label: "观点中心", description: "聚合主播观点与证据", icon: <Lightbulb /> },
          usage: { label: "AI 用量", description: "模型调用与费用统计", icon: <ChartLineUp /> },
          data: { label: "数据管理", description: "本地数据、备份与保留", icon: <Database /> },
        }[view];

  function applySnapshot(value: unknown) {
    const snapshot = value as {
      rooms: Room[];
      runtimes: RoomRuntime[];
      snapshots?: RoomSnapshot[];
    };
    setRooms(snapshot.rooms ?? []);
    setRuntimes(snapshot.runtimes ?? []);
    setSnapshots(snapshot.snapshots ?? []);
  }
  async function refresh() {
    applySnapshot(await window.duoduo.rooms.list());
  }
  async function refreshIntelligence() {
    setRoomIntelligence(
      (await window.duoduo.rooms.listIntelligence()) as RoomIntelligenceSummary[],
    );
  }
  useEffect(() => {
    void refresh();
    void refreshIntelligence();
    void window.duoduo.app
      .getVersion()
      .then((value) => setAppVersion(String(value)));
    void window.duoduo.settings.getAsrProvider().then((value) => {
      const config = value as AsrProviderConfig | undefined;
      setProvider(config);
    });
    void window.duoduo.settings
      .getInsightNotifications()
      .then((value) =>
        setNotificationTimeout(
          (value as InsightNotificationSettings).timeoutSeconds,
        ),
      );
    void window.duoduo.settings
      .getMonitoring()
      .then((value) => setMonitoringSettings(value as MonitoringSettings));
    void window.duoduo.access
      .getState()
      .then((value) => setAccessState(value as DouyinAccessState));
    void window.duoduo.parsers
      .list()
      .then((value) => setParsers(value as ParserSnapshot));
    return window.duoduo.rooms.subscribe((value) => {
      applySnapshot(value);
      void refreshIntelligence();
    });
  }, []);
  useEffect(
    () =>
      window.duoduo.access.subscribe((value) =>
        setAccessState(value as DouyinAccessState),
      ),
    [],
  );
  useEffect(() => {
    let active = true;
    void window.duoduo.rooms.getProbeState().then((value) => {
      if (active) setPreparedProbeState(value as PreparedProbeState);
    });
    const unsubscribe = window.duoduo.rooms.subscribeProbeState((value) =>
      setPreparedProbeState(value as PreparedProbeState),
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (view === "rooms")
      void window.duoduo.parsers
        .list()
        .then((value) => setParsers(value as ParserSnapshot));
  }, [view]);
  useEffect(() => {
    if (
      !(preparedProbeState.manualProbes ?? []).some(
        (item) => item.phase === "cooldown",
      )
    )
      return;
    const timer = window.setInterval(
      () => setProbeClock((value) => value + 1),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [
    (preparedProbeState.manualProbes ?? []).some(
      (item) => item.phase === "cooldown",
    ),
  ]);
  useEffect(() => {
    void window.duoduo.player
      .getState()
      .then((value) => setPlayer(value as PlayerState));
    return window.duoduo.player.subscribe((value) =>
      setPlayer(value as PlayerState),
    );
  }, []);
  useEffect(() => {
    let active = true;
    void window.duoduo.insights.list({ limit: 50 }).then((value) => {
      if (!active) return;
      const page = value as { items: MarketInsight[] };
      latestInsightId.current = Math.max(
        0,
        ...page.items.map((item) => item.id),
      );
    });
    const unsubscribe = window.duoduo.insights.subscribe((value) => {
      const page = value as { items: MarketInsight[] };
      const maxId = Math.max(0, ...page.items.map((item) => item.id));
      if (latestInsightId.current === undefined) {
        latestInsightId.current = maxId;
        return;
      }
      const incoming = page.items
        .filter((item) => item.id > latestInsightId.current!)
        .sort((a, b) => b.id - a.id);
      latestInsightId.current = Math.max(latestInsightId.current, maxId);
      if (incoming.length)
        setNotifications((current) =>
          [
            ...incoming.map((item) => ({
              key: `market-${item.id}`,
              kind: "market" as const,
              id: item.id,
              roomId: item.roomId,
              startedAt: item.startedAt,
              summary: item.summary,
              alertLevel: item.alertLevel,
            })),
            ...current.filter(
              (item) => !incoming.some((next) => item.key === `market-${next.id}`),
            ),
          ].slice(0, 20),
        );
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    const contentRecords = window.duoduo.contentRecords;
    if (!contentRecords) return;
    let active = true;
    void contentRecords.list({ limit: 50 }).then((value) => {
      if (!active) return;
      const page = value as { items: ContentRecord[] };
      latestContentRecordId.current = Math.max(0, ...page.items.map((item) => item.id));
    });
    const unsubscribe = contentRecords.subscribe((value) => {
      const page = value as { items: ContentRecord[] };
      const maxId = Math.max(0, ...page.items.map((item) => item.id));
      if (latestContentRecordId.current === undefined) {
        latestContentRecordId.current = maxId;
        return;
      }
      const incoming = page.items
        .filter((item) => item.id > latestContentRecordId.current! && item.alertLevel !== "none")
        .sort((a, b) => b.id - a.id);
      latestContentRecordId.current = Math.max(latestContentRecordId.current, maxId);
      if (incoming.length)
        setNotifications((current) => [
          ...incoming.map((item) => ({
            key: `content-${item.id}`,
            kind: "content" as const,
            id: item.id,
            roomId: item.roomId,
            startedAt: item.startedAt,
            summary: item.title,
            alertLevel: item.alertLevel,
          })),
          ...current.filter((item) => !incoming.some((next) => item.key === `content-${next.id}`)),
        ].slice(0, 20));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const monitored = rooms.filter((room) => room.monitoring);
  const pool = useMemo(
    () =>
      rooms.filter(
        (room) =>
          !room.monitoring &&
          `${room.roomId} ${snapshots.find((item) => item.roomId === room.roomId)?.title ?? ""}`.includes(
            query,
          ),
      ),
    [rooms, snapshots, query],
  );
  const belongsToGroup = (room: Room, groupId: string) =>
    room.groupId === groupId;

  async function openAddRoom(targetGroupId?: string) {
    const groupSnapshot = (await window.duoduo.groups.list()) as {
      groups: RoomGroup[];
      activeRun?: { groupId: string };
    };
    setActiveGroupId(groupSnapshot.activeRun?.groupId);
    setRoomGroups(groupSnapshot.groups);
    const target = groupSnapshot.groups.find(
      (group) => group.id === targetGroupId,
    );
    if (!target) {
      setMessage("当前分组不存在，请重新选择分组");
      return;
    }
    if (groupSnapshot.activeRun?.groupId === target.id) {
      setMessage(`“${target.name}”正在运行，请先停止该分组再添加直播间`);
      return;
    }
    if (target.roomCount >= 9) {
      setMessage(`“${target.name}”已达到 9 个直播间上限，请切换或新建分组`);
      return;
    }
    setRoomGroupId(target.id);
    setEditingRoomId(undefined);
    setUrl("");
    setScheduleMode("uncertain");
    setDays([1, 2, 3, 4, 5]);
    setRanges([{ start: "09:00", end: "12:00" }]);
    setDialog("room");
  }
  async function openEditRoom(room: Room) {
    const groupSnapshot = (await window.duoduo.groups.list()) as {
      groups: RoomGroup[];
      activeRun?: { groupId: string };
    };
    setActiveGroupId(groupSnapshot.activeRun?.groupId);
    setRoomGroups(groupSnapshot.groups);
    setRoomGroupId(room.groupId);
    setEditingRoomId(room.roomId);
    setUrl(room.canonicalUrl);
    setScheduleMode(room.schedule ? "fixed" : "uncertain");
    setDays(room.schedule?.days ?? [1, 2, 3, 4, 5]);
    setRanges(room.schedule?.ranges ?? [{ start: "09:00", end: "12:00" }]);
    setDialog("room");
  }
  async function saveRoom(event: FormEvent) {
    event.preventDefault();
    try {
      const input = {
        url,
        schedule: scheduleMode === "fixed" ? { days, ranges } : null,
        groupId: roomGroupId,
      };
      if (editingRoomId) {
        await window.duoduo.rooms.update(editingRoomId, input);
        const current = rooms.find((room) => room.roomId === editingRoomId);
        if (current?.groupId !== roomGroupId)
          await window.duoduo.groups.moveRoom(editingRoomId, roomGroupId);
      } else await window.duoduo.rooms.add(input);
      setDialog(null);
      setMessage(editingRoomId ? "直播间信息已更新" : "直播间已添加");
      await refresh();
    } catch (error) {
      setMessage(
        String(error).replace(/^Error invoking remote method '[^']+': /, ""),
      );
    }
  }

  const scheduleText = (room: Room) =>
    room.schedule
      ? `周${room.schedule.days.map((day) => weekdays[day]).join("、")} ${room.schedule.ranges.map((range) => `${range.start}-${range.end}`).join(" / ")}`
      : "直播时间不确定";
  const roomSnapshot = (roomId: string) =>
    snapshots.find((item) => item.roomId === roomId);
  async function togglePlayback(roomId: string) {
    const stopping = player.activeRoomId === roomId;
    setPlayer({ activeRoomId: roomId, status: "loading" });
    try {
      setPlayer((await (stopping ? window.duoduo.player.stop() : window.duoduo.player.play(roomId))) as PlayerState);
    } catch (error) {
      setPlayer({ activeRoomId: stopping ? roomId : null, status: "error", error: String(error) });
      setMessage(`播放操作失败：${String(error)}`);
    }
  }
  async function stopPlayback() {
    setPlayer((await window.duoduo.player.stop()) as PlayerState);
  }
  async function refreshAvatar(roomId: string) {
    setRefreshingAvatarIds((current) => new Set(current).add(roomId));
    try {
      applySnapshot(await window.duoduo.rooms.refreshAvatar(roomId));
      setMessage("主播头像已更新");
    } catch (error) {
      setMessage(
        String(error).includes("AVATAR_NOT_FOUND")
          ? "当前页面没有识别到主播头像，已保留原头像"
          : `头像更新失败：${String(error)}`,
      );
    } finally {
      setRefreshingAvatarIds((current) => {
        const next = new Set(current);
        next.delete(roomId);
        return next;
      });
    }
  }
  async function removeRoom(roomId: string) {
    setDeletingRoomIds((current) => new Set(current).add(roomId));
    try {
      await window.duoduo.rooms.remove(roomId);
      await refresh();
      setMessage("直播间已删除");
    } catch (error) {
      setMessage(`删除直播间失败：${String(error)}`);
    } finally {
      setDeletingRoomIds((current) => {
        const next = new Set(current);
        next.delete(roomId);
        return next;
      });
    }
  }
  async function joinMonitoring(roomId: string) {
    setJoiningRoomIds((current) => new Set(current).add(roomId));
    try {
      await window.duoduo.rooms.setMonitoring(roomId, true);
    } catch (error) {
      setMessage(`无法加入实时监看：${String(error)}`);
      void refresh();
    } finally {
      setJoiningRoomIds((current) => {
        const next = new Set(current);
        next.delete(roomId);
        return next;
      });
    }
  }
  async function probeRoomNow(roomId: string) {
    try {
      setPreparedProbeState(
        (await window.duoduo.rooms.probe(roomId)) as PreparedProbeState,
      );
    } catch (error) {
      const text = String(error);
      setMessage(
        text.includes("PROBE_COOLDOWN")
          ? "检测过于频繁，请等待 60 秒"
          : `检测失败：${text}`,
      );
    }
  }
  async function probeAllRooms() {
    try {
      setPreparedProbeState(
        (await window.duoduo.rooms.probeAll()) as PreparedProbeState,
      );
    } catch (error) {
      setMessage(`无法更新全部状态：${String(error)}`);
    }
  }
  async function cancelProbeBatch() {
    try {
      setPreparedProbeState(
        (await window.duoduo.rooms.cancelProbeBatch()) as PreparedProbeState,
      );
      setMessage("已停止尚未开始的更新，当前直播间会安全完成");
    } catch (error) {
      setMessage(`停止后续更新失败：${String(error)}`);
    }
  }
  function dismissNotification(key: string) {
    setNotifications((current) => current.filter((item) => item.key !== key));
  }
  function openNotification(item: InsightNotificationItem) {
    if (item.kind === "content") {
      setView("parsers");
      dismissNotification(item.key);
      return;
    }
    setView("rooms");
    setFocusInsight({ roomId: item.roomId, insightId: item.id });
    dismissNotification(item.key);
    setTimeout(
      () =>
        document
          .getElementById(`room-card-${item.roomId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      0,
    );
  }
  const roomName = (roomId: string) =>
    roomDisplayName(roomSnapshot(roomId), roomId);
  const roomIntelligenceSummary = (roomId: string) =>
    roomIntelligence.find((item) => item.roomId === roomId);
  async function openIntelligence(roomId: string) {
    setIntelligenceLoadingRoomId(roomId);
    try {
      setIntelligenceDetails(
        (await window.duoduo.rooms.getIntelligence(roomId)) as RoomIntelligence,
      );
    } catch (error) {
      setMessage(`读取本地数据详情失败：${String(error)}`);
    } finally {
      setIntelligenceLoadingRoomId((current) =>
        current === roomId ? undefined : current,
      );
    }
  }
  const accessBlocked = accessState.mode !== "normal";
  async function openVerification() {
    try {
      const result = (await window.duoduo.access.showVerification()) as {
        url?: string;
      };
      setVerificationUrl(result?.url ?? "https://live.douyin.com");
      setVerificationVisible(true);
    } catch (error) {
      setMessage(`无法打开验证页：${String(error)}`);
    }
  }
  async function closeVerification() {
    try {
      await window.duoduo.access.hideVerification();
      setVerificationVisible(false);
    } catch (error) {
      setMessage(`无法关闭验证页：${String(error)}`);
    }
  }
  async function checkVerification() {
    const checkingMessage = "正在检查验证状态…";
    setMessage(checkingMessage);
    setVerificationFeedback(checkingMessage);
    try {
      const result = (await window.duoduo.access.checkVerification()) as {
        clear: boolean;
        state: DouyinAccessState;
      };
      setAccessState(result.state);
      const resultMessage = result.clear
        ? "验证检查已通过，请点击“恢复访问”继续"
        : "仍检测到平台验证，请在验证页完成后再次检查";
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
      setAccessState(
        (await window.duoduo.access.confirmRecovery()) as DouyinAccessState,
      );
      setVerificationVisible(false);
      setVerificationFeedback("");
      const recoveryMessage = "访问已恢复，自动更新已继续";
      setMessage(recoveryMessage);
      window.setTimeout(
        () =>
          setMessage((current) => (current === recoveryMessage ? "" : current)),
        4_000,
      );
    } catch (error) {
      setMessage(`恢复失败：${String(error)}`);
    }
  }

  useEffect(() => {
    if (!verificationVisible) return;
    const updateBounds = () => {
      const bounds = verificationSurface.current?.getBoundingClientRect();
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
      void window.duoduo.access.setVerificationBounds({
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      });
    };
    updateBounds();
    window.addEventListener("resize", updateBounds);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateBounds);
    if (verificationSurface.current)
      observer?.observe(verificationSurface.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, [verificationVisible]);

  return (
    <div
      className={`shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${notifications.length ? "has-insight-notifications" : ""}`}
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <img src={activeTheme.icon} alt="" />
          </span>
          <strong>观风-直播观察 Agent</strong>
        </div>
        <nav className="sidebar-nav" aria-label="主导航">
          <SidebarSection label="工作台">
            <SidebarItem icon={<RadioButton weight="fill" />} label="直播监看" badge={rooms.length} active={view === "rooms"} onClick={() => setView("rooms")} />
            <SidebarItem icon={<Lightbulb />} label="观点中心" active={view === "insights"} onClick={() => setView("insights")} />
            <SidebarItem icon={<TreeStructure />} label="内容洞察" active={view === "parsers"} onClick={() => setView("parsers")} />
          </SidebarSection>
          <SidebarSection label="系统">
            <SidebarItem icon={<ChartLineUp />} label="AI 用量" active={view === "usage"} onClick={() => setView("usage")} />
            <SidebarItem icon={<Database />} label="数据管理" active={view === "data"} onClick={() => setView("data")} />
            <SidebarItem icon={<Gear />} label="系统设置" active={view === "settings"} onClick={() => setView("settings")} />
          </SidebarSection>
        </nav>
        <div className="app-version">{appVersion ? `v${appVersion}` : ""}</div>
      </aside>
      <header>
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={sidebarCollapsed ? "展开左侧菜单" : "收起左侧菜单"}
          aria-expanded={!sidebarCollapsed}
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
        >
          <List />
        </button>
        {view === "rooms" && (
          <label>
            <MagnifyingGlass />
            <input
              placeholder="搜索直播间"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        )}
        {!provider && <span className="header-status">语音转文字未设置</span>}
        <div className="header-context" aria-label={`当前菜单：${pageContext.label}`}>
          <span className="header-context-icon">{pageContext.icon}</span>
          <span className="header-context-copy">
            <strong>{pageContext.label}</strong>
            <small>{pageContext.description}</small>
          </span>
        </div>
      </header>
      {accessBlocked && (
        <div
          className="verification-banner"
          role="alert"
          aria-label="抖音访问已暂停"
        >
          <div>
            <strong>抖音要求安全验证，新的页面访问已暂停</strong>
            <span>
              现有可信数据不会被覆盖
              {"roomId" in accessState ? ` · 直播间 ${accessState.roomId}` : ""}
            </span>
          </div>
          <div>
            <button onClick={() => void openVerification()}>打开验证页</button>
            <button
              onClick={() => void checkVerification()}
              disabled={accessState.mode === "recovery_checking"}
            >
              我已完成，检查状态
            </button>
            {accessState.mode === "recovery_ready" && (
              <button
                className="primary"
                onClick={() => void confirmRecovery()}
              >
                恢复访问
              </button>
            )}
          </div>
        </div>
      )}
      <InsightNotificationRail
        items={notifications}
        timeoutSeconds={notificationTimeout}
        roomName={roomName}
        roomAvatar={(roomId) => {
          const avatarPath = roomSnapshot(roomId)?.avatarPath;
          return avatarPath
            ? `duoduo-avatar://${roomId}?v=${encodeURIComponent(avatarPath)}`
            : undefined;
        }}
        onOpen={openNotification}
        onDismiss={dismissNotification}
      />
      {view === "rooms" ? (
        <main>
          <div className="heading">
            <div>
              <h1>直播监看</h1>
            </div>
            <button
              className="primary"
              disabled={!selectedGroupId}
              onClick={() => void openAddRoom(selectedGroupId)}
            >
              <Plus />
              添加直播间
            </button>
          </div>
          <RoomGroupWorkspace
            accessBlocked={accessBlocked}
            onMessage={setMessage}
            onSelectedGroupChange={setSelectedGroupId}
            renderContent={(
              groupId,
              groupParserId,
              availableGroups,
              refreshGroups,
              groupRunning,
            ) => (
              <>
                {monitored.some((room) => belongsToGroup(room, groupId)) && (
                <section className="monitoring-section">
                  <div className="section-head live-section-head">
                    <b>
                      <em />
                      实时监看中
                    </b>
                  </div>
                  <div className="monitor-list">
                    {monitored
                      .filter((room) => belongsToGroup(room, groupId))
                      .map((room) => {
                        const runtime = runtimes.find(
                          (item) => item.roomId === room.roomId,
                        );
                        const snapshot = roomSnapshot(room.roomId);
                        const displaySnapshot =
                          snapshot && runtime && runtime.state !== "starting"
                            ? { ...snapshot, status: runtime.liveStatus }
                            : snapshot;
                        return (
                          <article
                            className="monitor"
                            id={`room-card-${room.roomId}`}
                            key={room.roomId}
                          >
                            <RoomInfo
                              room={room}
                              snapshot={displaySnapshot}
                              intelligence={roomIntelligenceSummary(
                                room.roomId,
                              )}
                              intelligenceLoading={
                                intelligenceLoadingRoomId === room.roomId
                              }
                              scheduleText={scheduleText(room)}
                              onEdit={() => openEditRoom(room)}
                              onPlay={() => void togglePlayback(room.roomId)}
                              onRefreshAvatar={() =>
                                void refreshAvatar(room.roomId)
                              }
                              onOpenIntelligence={() =>
                                void openIntelligence(room.roomId)
                              }
                              active={player.activeRoomId === room.roomId}
                              playbackLoading={player.activeRoomId === room.roomId && player.status === "loading"}
                              avatarRefreshing={refreshingAvatarIds.has(room.roomId)}
                            />
                            <LiveRoomWorkspace
                              roomId={room.roomId}
                              liveEvents={runtime?.asr ?? []}
                              runtimeState={runtime?.state ?? "starting"}
                              analysisEnabled={Boolean(groupParserId)}
                              llmConfigured={parsers.llmConfigured}
                              focusInsightId={
                                focusInsight?.roomId === room.roomId
                                  ? focusInsight.insightId
                                  : undefined
                              }
                            />
                          </article>
                        );
                      })}
                  </div>
                </section>
                )}
                <section className="room-pool-section">
                  <div className="section-head pool-section-head">
                    <b><SquaresFour aria-hidden="true" />组内直播间</b>
                  </div>
                  <div className="grid">
                    {pool
                      .filter((room) => belongsToGroup(room, groupId))
                      .map((room) => {
                        const snapshot = roomSnapshot(room.roomId);
                        const probeState = (
                          preparedProbeState.manualProbes ?? []
                        ).find((item) => item.roomId === room.roomId) ?? (preparedProbeState.currentRoomId === room.roomId ? { roomId: room.roomId, requestType: "manual" as const, phase: "running" as const } : preparedProbeState.queuedRoomIds.includes(room.roomId) ? { roomId: room.roomId, requestType: "manual" as const, phase: "queued" as const } : undefined);
                        const detail = probeDetail(snapshot);
                        const intelligence = roomIntelligenceSummary(
                          room.roomId,
                        );
                        const followerCount =
                          intelligence?.currentMetrics.followerCount ??
                          snapshot?.followerCount;
                        return (
                          <article className="card" key={room.roomId}>
                            <Cover
                              roomId={room.roomId}
                              snapshot={snapshot}
                              probeState={probeState}
                              scheduleText={scheduleText(room)}
                              loading={
                                intelligenceLoadingRoomId === room.roomId
                              }
                              onOpenIntelligence={() =>
                                void openIntelligence(room.roomId)
                              }
                              footer={
                                <RoomIntelligenceBadges
                                  summary={intelligence}
                                  status={snapshot?.status}
                                  showCurrentMetric={false}
                                  onOpen={() =>
                                    void openIntelligence(room.roomId)
                                  }
                                />
                              }
                            />
                            <div className="body">
                              <h2 className="room-name">
                                {roomDisplayName(snapshot, room.roomId)}
                              </h2>
                              <p className="room-follower">
                                <span>主播粉丝</span>
                                <b>{compactCount(followerCount)}</b>
                              </p>
                              <RoomCardActions
                                active={player.activeRoomId === room.roomId}
                                playbackLoading={player.activeRoomId === room.roomId && player.status === "loading"}
                                avatarRefreshing={refreshingAvatarIds.has(room.roomId)}
                                blocked={accessBlocked}
                                deleting={deletingRoomIds.has(room.roomId)}
                                probeState={probeState}
                                onPlay={() => void togglePlayback(room.roomId)}
                                onProbe={() => void probeRoomNow(room.roomId)}
                                onRefreshAvatar={() =>
                                  void refreshAvatar(room.roomId)
                                }
                                onEdit={() => openEditRoom(room)}
                                deleteDisabled={groupRunning}
                                moveDisabled={groupRunning}
                                moveTargets={availableGroups.filter(
                                  (group) =>
                                    group.id !== groupId && group.roomCount < 9,
                                )}
                                onMove={(targetGroupId) =>
                                  void window.duoduo.groups
                                    .moveRoom(room.roomId, targetGroupId)
                                    .then(async () => {
                                      await refresh();
                                      await refreshGroups();
                                      setMessage("直播间已移动到新分组");
                                    })
                                    .catch((error) => setMessage(String(error)))
                                }
                                onDelete={() => void removeRoom(room.roomId)}
                              />
                              <div className="card-description-slot">
                                <LiveDescription
                                  value={snapshot?.liveDescription}
                                />
                              </div>
                              <div className="card-probe-slot">
                                {snapshot && detail && (
                                  <p className="probe-detail">{detail}</p>
                                )}
                              </div>
                              <div className="monitor-controls">
                                <button
                                  className={`join-monitoring ${snapshot?.status === "live" || (snapshot?.status === "checking" && snapshot.lastReliableStatus === "live") ? "live" : ""}`}
                                  disabled={
                                    accessBlocked ||
                                    !groupRunning ||
                                    joiningRoomIds.has(room.roomId)
                                  }
                                  title={
                                    !groupRunning
                                      ? "请先启动当前分组"
                                      : undefined
                                  }
                                  onClick={() => void joinMonitoring(room.roomId)}
                                >
                                  {joiningRoomIds.has(room.roomId)
                                    ? "正在加入…"
                                    : "加入实时监看"}
                                </button>
                                <label className="auto-monitor">
                                  <input
                                    type="checkbox"
                                    checked={room.autoMonitorOnLive}
                                    disabled={accessBlocked}
                                    onChange={(event) =>
                                      void window.duoduo.rooms.setAutoMonitorOnLive(
                                        room.roomId,
                                        event.currentTarget.checked,
                                      )
                                    }
                                  />
                                  开播后自动监看
                                </label>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                  </div>
                </section>
              </>
            )}
          />
        </main>
      ) : view === "parsers" ? (
        <main>
          <ParserManagement rooms={rooms} snapshots={snapshots} />
        </main>
      ) : view === "insights" ? (
        <main>
          <InsightCenter rooms={rooms} />
        </main>
      ) : view === "usage" ? (
        <AiUsageDashboard
          rooms={rooms.map((room) => {
            const snapshot = roomSnapshot(room.roomId);
            return {
              roomId: room.roomId,
              name: roomDisplayName(snapshot, room.roomId),
              avatarVersion: snapshot?.avatarPath,
            };
          })}
        />
      ) : view === "data" ? (
        <DataManagement />
      ) : (
        <SettingsCenter
          section={settingsSection}
          onSectionChange={setSettingsSection}
          theme={theme}
          onThemeChange={setTheme}
          provider={provider}
          onProviderChange={setProvider}
          monitoring={monitoringSettings}
          onMonitoringChange={setMonitoringSettings}
          notificationTimeout={notificationTimeout}
          onNotificationTimeoutChange={setNotificationTimeout}
          onMessage={setMessage}
        />
      )}
      {player.activeRoomId && (
        <PlayerDrawer
          room={rooms.find((room) => room.roomId === player.activeRoomId)}
          snapshot={roomSnapshot(player.activeRoomId)}
          state={player}
          onStop={() => void stopPlayback()}
        />
      )}
      {intelligenceDetails && (
        <RoomIntelligenceDrawer
          roomName={roomName(intelligenceDetails.roomId)}
          details={intelligenceDetails}
          onClose={() => setIntelligenceDetails(undefined)}
        />
      )}
      {verificationVisible && (
        <div
          className="verification-overlay"
          role="dialog"
          aria-label="抖音人工验证"
        >
          <div className="verification-toolbar">
            <div>
              <strong>抖音人工验证</strong>
              <span>
                {verificationHost(verificationUrl)} ·
                请在下方页面亲自完成平台要求的操作
              </span>
              {verificationFeedback && (
                <span className="verification-feedback" role="status">
                  {verificationFeedback}
                </span>
              )}
            </div>
            <div>
              <button
                onClick={() => void checkVerification()}
                disabled={accessState.mode === "recovery_checking"}
              >
                我已完成，检查状态
              </button>
              {accessState.mode === "recovery_ready" && (
                <button
                  className="primary"
                  onClick={() => void confirmRecovery()}
                >
                  恢复访问
                </button>
              )}
              <button onClick={() => void closeVerification()}>
                关闭验证页
              </button>
            </div>
          </div>
          <div
            className="verification-surface"
            ref={verificationSurface}
            aria-label="抖音验证页面"
          />
        </div>
      )}
      {dialog && (
        <div className="backdrop" onMouseDown={() => setDialog(null)}>
          <form
            className="modal"
            onSubmit={saveRoom}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div>
              <h2>{editingRoomId ? "编辑直播间" : "添加直播间"}</h2>
              <button type="button" onClick={() => setDialog(null)}>
                <X />
              </button>
            </div>
            <RoomFields
              url={url}
              setUrl={setUrl}
              scheduleMode={scheduleMode}
              setScheduleMode={setScheduleMode}
              days={days}
              setDays={setDays}
              ranges={ranges}
              setRanges={setRanges}
              groups={roomGroups}
              groupId={roomGroupId}
              setGroupId={setRoomGroupId}
              editingGroupId={
                editingRoomId
                  ? rooms.find((room) => room.roomId === editingRoomId)?.groupId
                  : undefined
              }
              lockedGroupId={activeGroupId}
            />
            <footer>
              <button type="button" onClick={() => setDialog(null)}>
                取消
              </button>
              <button className="primary" type="submit">
                保存直播间
              </button>
            </footer>
          </form>
        </div>
      )}
      {message && (
        <div className="toast">
          {message}
          <button onClick={() => setMessage("")}>
            <X />
          </button>
        </div>
      )}
    </div>
  );
}

function SidebarSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="sidebar-section">
      <h2>{label}</h2>
      <div className="sidebar-section-items">{children}</div>
    </section>
  );
}

function SidebarItem({
  icon,
  label,
  badge,
  active = false,
  onClick,
  children,
}: {
  icon: ReactNode;
  label: string;
  badge?: number;
  active?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const expandable = Boolean(children);
  return (
    <div className={`sidebar-item ${active ? "active" : ""} ${expanded ? "expanded" : ""}`}>
      <button
        type="button"
        className="sidebar-item-trigger"
        title={label}
        aria-current={active ? "page" : undefined}
        aria-expanded={expandable ? expanded : undefined}
        onClick={() => {
          onClick?.();
          if (expandable) setExpanded((value) => !value);
        }}
      >
        <span className="sidebar-item-icon">{icon}</span>
        <span className="sidebar-item-label">{label}</span>
        {badge !== undefined && <span className="sidebar-item-badge">{badge}</span>}
        {expandable && <CaretDown className="sidebar-item-caret" />}
      </button>
      {expandable && expanded && <div className="sidebar-submenu">{children}</div>}
    </div>
  );
}

function Cover({
  roomId,
  snapshot,
  probeState,
  scheduleText,
  loading = false,
  onOpenIntelligence,
  footer,
}: {
  roomId: string;
  snapshot?: RoomSnapshot;
  probeState?: ProbeRequestState;
  scheduleText?: string;
  loading?: boolean;
  onOpenIntelligence?: () => void;
  footer?: ReactNode;
}) {
  const status =
    probeState?.phase === "queued"
      ? "queued"
      : probeState?.phase === "running"
        ? "checking"
        : snapshot?.status === "checking" || !snapshot
          ? "unprobed"
          : snapshot.status;
  const offline = status === "offline";
  const statusLabel =
    status === "queued"
      ? probeState?.requestType === "initial"
        ? "等待首次检测"
        : "等待检测"
      : status === "unprobed"
        ? "待检测"
        : statusLabels[status];
  const emptyLabel =
    status === "unprobed"
      ? "等待首次检测"
      : status === "queued"
        ? "等待安全检测通道"
        : offline
          ? "当前未开播"
          : "尚未获取直播画面";
  const checkingText =
    snapshot?.lastReliableStatus === "live"
      ? "上次状态：直播中"
      : snapshot?.lastReliableStatus === "offline"
        ? "上次状态：未开播"
        : "正在确认直播状态";
  return (
    <div className={`cover cover-${status}`}>
      {!offline && snapshot?.coverPath ? (
        <img
          className="live-cover"
          src={`duoduo-cover://${roomId}?v=${encodeURIComponent(snapshot.checkedAt)}`}
          alt={snapshot.title || `直播间 ${roomId}`}
        />
      ) : (
        <div className="cover-empty">
          <Broadcast />
          <small>{emptyLabel}</small>
        </div>
      )}
      {snapshot?.avatarPath && (
        <img
          className={offline ? "avatar avatar-offline" : "avatar avatar-live"}
          src={`duoduo-avatar://${roomId}?v=${encodeURIComponent(snapshot.avatarPath)}`}
          alt={`${snapshot.anchorName ?? "主播"}头像`}
        />
      )}
      {status === "live" && snapshot?.viewerCount !== undefined && (
        <span className="viewer-count">
          {snapshot.viewerCount.toLocaleString("zh-CN")} 人在线
        </span>
      )}
      <span className={`status ${status}`}>{statusLabel}</span>
      {status === "checking" && (
        <div className="cover-meta">
          <span>{checkingText}</span>
        </div>
      )}
      {offline && (
        <div className="cover-meta">
          <span>{scheduleText ?? "直播时间不确定"}</span>
          <span>
            {snapshot ? compactCheckedAt(snapshot.checkedAt) : "等待首次检测"}
          </span>
        </div>
      )}
      {onOpenIntelligence && (
        <button
          className="cover-intelligence"
          type="button"
          disabled={loading}
          onClick={onOpenIntelligence}
        >
          {loading ? "读取中" : "数据详情"}
        </button>
      )}
      {footer && <div className="cover-labels">{footer}</div>}
    </div>
  );
}

function RoomInfo({
  room,
  snapshot,
  intelligence,
  intelligenceLoading,
  scheduleText,
  onEdit,
  onPlay,
  onRefreshAvatar,
  onOpenIntelligence,
  active,
  playbackLoading,
  avatarRefreshing,
}: {
  room: Room;
  snapshot?: RoomSnapshot;
  intelligence?: RoomIntelligenceSummary;
  intelligenceLoading?: boolean;
  scheduleText: string;
  onEdit: () => void;
  onPlay: () => void;
  onRefreshAvatar: () => void;
  onOpenIntelligence: () => void;
  active: boolean;
  playbackLoading: boolean;
  avatarRefreshing: boolean;
}) {
  const followerCount =
    intelligence?.currentMetrics.followerCount ?? snapshot?.followerCount;
  const viewerText =
    snapshot?.status === "live" && snapshot.viewerCount !== undefined
      ? snapshot.viewerCount.toLocaleString("zh-CN")
      : "—";
  return (
    <div className="room-info">
      <Cover
        roomId={room.roomId}
        snapshot={snapshot}
        scheduleText={scheduleText}
        loading={intelligenceLoading}
        onOpenIntelligence={onOpenIntelligence}
      />
      <div className="monitored-room-body">
        <div className="room-title-actions">
          <h2 className="room-name">{roomDisplayName(snapshot, room.roomId)}</h2>
          <div className="monitor-actions">
            <button
              aria-label={playbackLoading ? "正在加载直播" : active ? "停止播放" : "播放直播"}
              disabled={playbackLoading}
              onClick={onPlay}
            >
              {playbackLoading ? <ArrowClockwise className="feedback-spinner" /> : active ? <Stop weight="fill" /> : <Play weight="fill" />}
            </button>
            <button aria-label={avatarRefreshing ? "正在更新主播头像" : "更新主播头像"} disabled={avatarRefreshing} onClick={onRefreshAvatar}>
              {avatarRefreshing ? <ArrowClockwise className="feedback-spinner" /> : <ImageSquare />}
            </button>
            <button aria-label="编辑直播间" onClick={onEdit}>
              <PencilSimple />
            </button>
          </div>
        </div>
        <RoomMetricsActions
          followerText={
            followerCount === undefined ? "—" : compactCount(followerCount)
          }
          viewerLabel={snapshot?.status === "live" ? "当前在线" : "上次在线"}
          viewerText={viewerText}
        />
        <LiveDescription value={snapshot?.liveDescription} />
        <RoomIntelligenceBadges
          summary={intelligence}
          status={snapshot?.status}
          showCurrentMetric={false}
          onOpen={onOpenIntelligence}
        />
        <button
          className="leave-monitoring"
          onClick={() =>
            void window.duoduo.rooms.setMonitoring(room.roomId, false)
          }
        >
          退出实时监看
        </button>
      </div>
    </div>
  );
}

function LiveDescription({ value }: { value?: string }) {
  if (!value?.trim()) return null;
  return (
    <p className="live-description" title={value}>
      直播介绍：{value}
    </p>
  );
}

function PlayerDrawer({
  room,
  snapshot,
  state,
  onStop,
}: {
  room?: Room;
  snapshot?: RoomSnapshot;
  state: PlayerState;
  onStop: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const updateBounds = () => {
      const bounds = surface.current?.getBoundingClientRect();
      if (!bounds) return;
      void window.duoduo.player.setBounds({
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(1, Math.round(bounds.width)),
        height: Math.max(1, Math.round(bounds.height)),
      });
    };
    updateBounds();
    window.addEventListener("resize", updateBounds);
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateBounds);
    if (surface.current) observer?.observe(surface.current);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, [state.activeRoomId]);
  return (
    <aside className="player-drawer" aria-label="直播播放器">
      <div className="player-head">
        <div>
          <b>
            {snapshot?.anchorName ||
              snapshot?.title ||
              `直播间 ${room?.roomId ?? state.activeRoomId}`}
          </b>
          <span>
            {state.status === "loading"
              ? "正在加载直播"
              : state.status === "error"
                ? state.error || "播放失败"
                : "正在播放"}
          </span>
        </div>
        <button title="停止播放" onClick={onStop}>
          <Stop weight="fill" />
        </button>
      </div>
      <div className="player-surface" ref={surface}>
        <span>
          {state.status === "loading"
            ? "正在连接直播画面…"
            : state.status === "error"
              ? state.error
              : ""}
        </span>
      </div>
    </aside>
  );
}

interface RoomFieldsProps {
  url: string;
  setUrl(value: string): void;
  scheduleMode: "uncertain" | "fixed";
  setScheduleMode(value: "uncertain" | "fixed"): void;
  days: number[];
  setDays(value: number[]): void;
  ranges: TimeRange[];
  setRanges(value: TimeRange[]): void;
  groups: RoomGroup[];
  groupId: string;
  setGroupId(value: string): void;
  editingGroupId?: string;
  lockedGroupId?: string;
}
function RoomFields({
  url,
  setUrl,
  scheduleMode,
  setScheduleMode,
  days,
  setDays,
  ranges,
  setRanges,
  groups,
  groupId,
  setGroupId,
  editingGroupId,
  lockedGroupId,
}: RoomFieldsProps) {
  return (
    <>
      <label>
        所属分组
        <select
          required
          disabled={Boolean(editingGroupId && editingGroupId === lockedGroupId)}
          value={groupId}
          onChange={(event) => setGroupId(event.target.value)}
        >
          {groups.map((group) => (
            <option
              value={group.id}
              disabled={
                (group.roomCount >= 9 && group.id !== editingGroupId) ||
                (group.id === lockedGroupId && group.id !== editingGroupId)
              }
              key={group.id}
            >
              {group.name}（{group.roomCount}/9）
            </option>
          ))}
        </select>
      </label>
      <label>
        抖音直播间链接
        <input
          autoFocus
          required
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://live.douyin.com/123456"
        />
      </label>
      <label>
        直播时间
        <select
          value={scheduleMode}
          onChange={(event) =>
            setScheduleMode(event.target.value as "uncertain" | "fixed")
          }
        >
          <option value="uncertain">不确定</option>
          <option value="fixed">固定周期</option>
        </select>
      </label>
      {scheduleMode === "fixed" && (
        <div className="schedule-fields">
          <span>直播星期</span>
          <div className="weekday-options">
            {weekdays.map((day, index) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={days.includes(index)}
                  onChange={() =>
                    setDays(
                      days.includes(index)
                        ? days.filter((value) => value !== index)
                        : [...days, index].sort(),
                    )
                  }
                />
                周{day}
              </label>
            ))}
          </div>
          <span>直播时段</span>
          {ranges.map((range, index) => (
            <div className="time-range" key={index}>
              <input
                type="time"
                value={range.start}
                onChange={(event) =>
                  setRanges(
                    ranges.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, start: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <span>至</span>
              <input
                type="time"
                value={range.end}
                onChange={(event) =>
                  setRanges(
                    ranges.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, end: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              {ranges.length > 1 && (
                <button
                  type="button"
                  title="删除时段"
                  onClick={() =>
                    setRanges(
                      ranges.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  <Trash />
                </button>
              )}
            </div>
          ))}
          <button
            className="add-range"
            type="button"
            onClick={() =>
              setRanges([...ranges, { start: "19:00", end: "22:00" }])
            }
          >
            <Plus />
            增加时段
          </button>
        </div>
      )}
    </>
  );
}

function verificationHost(value: string): string {
  try {
    return new URL(value).hostname || "live.douyin.com";
  } catch {
    return "live.douyin.com";
  }
}
