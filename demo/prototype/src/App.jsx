import { useState } from "react";
import {
  Broadcast, CalendarDots, CaretRight, ChartLineUp, CheckCircle,
  Clock, Gear, House, List, MagnifyingGlass, MicrophoneStage, Pause,
  Play, Plus, RadioButton, SlidersHorizontal, Trash, User, Users, X,
} from "@phosphor-icons/react";
import { Line, LineChart, ResponsiveContainer } from "recharts";

const roomsSeed = [
  {
    id: "478068897604", name: "大声直播间", title: "台风路径与沿海现场实时播报",
    cover: "/assets/live-cover-1.png", live: true, monitoring: true, viewers: "8,642",
    peak: "12,380", likes: "36.8万", velocity: "+4,280/分", heat: "快速上升",
    schedule: "周一至周日 08:00–12:00", duration: "01:42:18",
    trend: [22, 26, 30, 38, 44, 61, 78, 91], color: "#f05b66",
  },
  {
    id: "744549703134", name: "小白龙", title: "台州临海路况与现场信息",
    cover: "/assets/live-cover-2.png", live: true, monitoring: true, viewers: "2,106",
    peak: "3,742", likes: "9.2万", velocity: "+860/分", heat: "平稳",
    schedule: "周二至周日 09:30–13:00", duration: "00:56:43",
    trend: [40, 42, 39, 44, 48, 47, 53, 55], color: "#4f83f1",
  },
  {
    id: "575973340980", name: "王者猪八", title: "国服阿骨朵巅峰赛实时对局",
    cover: "/assets/live-cover-3.png", live: true, monitoring: false, viewers: "1,428",
    peak: "2,104", likes: "6.7万", velocity: "+320/分", heat: "平稳",
    schedule: "周一至周六 19:00–23:30", duration: "02:18:09",
    trend: [32, 36, 41, 38, 43, 46, 44, 49], color: "#49a782",
  },
  {
    id: "881309244117", name: "财经观察", title: "每日收盘复盘与市场观察",
    cover: "/assets/live-cover-1.png", live: false, monitoring: false, viewers: "—",
    peak: "—", likes: "—", velocity: "—", heat: "未开播",
    schedule: "周一至周五 15:10–17:00", duration: "—",
    trend: [20, 20, 20, 20, 20, 20, 20, 20], color: "#a2a9b1",
  },
];

const feed = [
  { room: "大声直播间", id: "478068897604", time: "09:42:41", text: "现在能看到现场的雨势明显比刚才更大。", partial: true },
  { room: "小白龙", id: "744549703134", time: "09:42:38", text: "前面这个路口已经开始限制通行，我们换个位置继续看。" },
  { room: "大声直播间", id: "478068897604", time: "09:42:32", text: "预计今天下午沿海风力会继续增强，请大家关注最新通知。" },
  { room: "大声直播间", id: "478068897604", time: "09:42:26", text: "当地已经开放部分场馆，作为临时避险点。" },
  { room: "小白龙", id: "744549703134", time: "09:42:19", text: "现在从临海往市区方向走，路上的车辆已经少了很多。" },
];

function Trend({ room }) {
  const data = room.trend.map((value, index) => ({ index, value }));
  return (
    <div className="spark" aria-label={`${room.name} 热度趋势`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
          <Line type="monotone" dataKey="value" stroke={room.color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function RoomCard({ room, onMonitor, onPlay, onDelete }) {
  return (
    <article className={`live-card ${room.monitoring ? "is-monitoring" : ""}`}>
      <div className="cover-wrap">
        <img src={room.cover} alt={`${room.name} 直播间主图`} />
        <span className={`live-state ${room.live ? "on" : "off"}`}>{room.live ? "直播中" : "未开播"}</span>
        {room.live && <span className="duration"><Clock size={13} /> {room.duration}</span>}
      </div>

      <div className="card-body">
        <div className="identity-row">
          <div>
            <h2>{room.name}</h2>
            <p>{room.title}</p>
          </div>
          <button className="icon-button" aria-label={`删除 ${room.name}`} title="删除直播间" onClick={() => onDelete(room.id)}><Trash size={17} /></button>
        </div>

        <div className="metrics">
          <div><span>在线人数</span><strong>{room.viewers}</strong><small>峰值 {room.peak}</small></div>
          <div><span>点赞</span><strong>{room.likes}</strong><small>{room.velocity}</small></div>
          <div className="trend-cell"><span>近 30 分钟热度</span><Trend room={room} /><small>{room.heat}</small></div>
        </div>

        <div className="schedule"><CalendarDots size={16} /><span>{room.schedule}</span><button>编辑周期</button></div>

        <div className="card-actions">
          <label className={`monitor-choice ${room.monitoring ? "checked" : ""}`}>
            <input type="checkbox" checked={room.monitoring} disabled={!room.live} onChange={(event) => onMonitor(room.id, event.target.checked)} />
            <span>{room.monitoring ? "实时监看中" : room.live ? "加入实时监看" : "等待开播"}</span>
          </label>
          <button className="play-button" disabled={!room.live} onClick={() => onPlay(room.id)}><Play weight="fill" size={15} />播放</button>
        </div>
      </div>
    </article>
  );
}

function MonitoringCard({ room, onMonitor, onPlay }) {
  const roomFeed = feed.filter((item) => item.id === room.id);
  return (
    <article className="monitor-card">
      <div className="monitor-identity">
        <div className="monitor-cover">
          <img src={room.cover} alt={`${room.name} 直播间主图`} />
          <span className="live-state on">直播中</span>
          <span className="duration"><Clock size={13} /> {room.duration}</span>
        </div>
        <div className="monitor-summary">
          <div><h2>{room.name}</h2><p>{room.title}</p></div>
          <div className="monitor-stats">
            <span><small>在线人数</small><strong>{room.viewers}</strong></span>
            <span><small>点赞增速</small><strong>{room.velocity}</strong></span>
            <span className="wide"><small>近 30 分钟热度</small><Trend room={room} /></span>
          </div>
          <div className="monitor-meta"><CalendarDots size={15} /><span>{room.schedule}</span></div>
          <div className="monitor-controls">
            <label><input type="checkbox" checked onChange={(event) => onMonitor(room.id, event.target.checked)} />实时监看中</label>
            <button onClick={() => onPlay(room.id)}><Play size={15} weight="fill" />播放音视频</button>
          </div>
        </div>
      </div>
      <div className="card-asr">
        <div className="card-asr-head">
          <div><span className="asr-live-dot" /><strong>实时 ASR</strong><small>最新内容自动滚动</small></div>
          <span>延迟 1.2 秒</span>
        </div>
        <div className="card-asr-feed">
          {roomFeed.length ? roomFeed.map((item) => (
            <button key={item.time} className={item.partial ? "partial" : ""} onClick={() => onPlay(room.id)}>
              <time>{item.time}</time>
              <p>{item.text}</p>
              <span>{item.partial ? "识别中" : "已确认"}</span>
            </button>
          )) : <div className="asr-waiting"><MicrophoneStage size={20} /><span>等待主播说话</span></div>}
        </div>
      </div>
    </article>
  );
}

export function App() {
  const [rooms, setRooms] = useState(roomsSeed);
  const [drawerId, setDrawerId] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [selectedDays, setSelectedDays] = useState([1, 2, 3, 4, 5]);
  const [toast, setToast] = useState("");
  const playing = rooms.find((room) => room.id === drawerId);
  const monitored = rooms.filter((room) => room.monitoring);
  const visibleRooms = rooms.filter((room) => {
    const matchesFilter = filter === "all" || (filter === "live" && room.live) || (filter === "monitoring" && room.monitoring);
    return matchesFilter && `${room.name}${room.title}`.toLowerCase().includes(query.toLowerCase());
  });

  function changeMonitoring(id, next) {
    setRooms((current) => current.map((room) => room.id === id ? { ...room, monitoring: next } : room));
    setToast(next ? "已开始静默内录和 ASR，不会播放声音" : "已停止实时监看");
  }

  function openPlayer(id) {
    setDrawerId(id);
    setToast("当前只播放此直播间；其他直播继续静默监看");
  }

  function deleteRoom(id) {
    setRooms((current) => current.filter((room) => room.id !== id));
    if (drawerId === id) setDrawerId(null);
    setToast("直播间已从预备监看列表删除");
  }

  function addRoom(event) {
    event.preventDefault();
    const match = url.match(/live\.douyin\.com\/(\d+)/);
    if (!match) return setToast("请输入标准抖音直播间链接");
    const id = match[1];
    setRooms((current) => [...current, {
      id, name: `初始化中 · ${id.slice(-4)}`, title: "正在获取直播间身份与主图",
      cover: "/assets/live-cover-2.png", live: false, monitoring: false, viewers: "—",
      peak: "—", likes: "—", velocity: "—", heat: "初始化中", duration: "—",
      schedule: "周一至周五 09:00–12:00", trend: [20,20,20,20,20,20,20,20], color: "#a2a9b1",
    }]);
    setShowAdd(false); setUrl(""); setToast("直播间已添加，正在初始化");
  }

  return (
    <div className={`admin-shell ${playing ? "drawer-open" : ""}`}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Broadcast size={22} weight="fill" /></span><strong>多多直播</strong></div>
        <div className="nav-caption">工作台</div>
        <nav>
          <button className="nav-item active"><RadioButton size={19} weight="fill" /><span>直播间管理</span><small>{rooms.length}</small></button>
          <button className="nav-item"><ChartLineUp size={19} /><span>重点信息</span></button>
          <button className="nav-item"><Clock size={19} /><span>历史记录</span></button>
        </nav>
        <div className="nav-caption">系统</div>
        <nav><button className="nav-item"><SlidersHorizontal size={19} /><span>监看设置</span></button><button className="nav-item"><Gear size={19} /><span>系统设置</span></button></nav>
      </aside>

      <header className="topbar">
        <button className="top-icon" aria-label="折叠菜单"><List size={22} /></button>
        <div className="global-search"><MagnifyingGlass size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索直播间" /></div>
        <div className="top-actions"><button className="profile" onClick={() => setShowProfile(!showProfile)}><span><User size={17} /></span><b>本机用户</b></button></div>
      </header>

      <main className="main-content">
        <div className="page-heading">
          <div><h1>直播间管理</h1><p>维护预备直播间，选择实时监看，并查看多路 ASR。</p></div>
          <button className="primary-button" onClick={() => setShowAdd(true)}><Plus size={17} weight="bold" />添加直播间</button>
        </div>

        <section className="monitoring-section">
          <div className="section-heading">
            <div><span className="asr-live-dot" /><h2>实时监看中</h2><small>{monitored.length} 路独立转写</small></div>
            <span>声音默认不外放</span>
          </div>
          <div className="monitoring-list">
            {monitored.map((room) => <MonitoringCard key={room.id} room={room} onMonitor={changeMonitoring} onPlay={openPlayer} />)}
          </div>
        </section>

        <section className="pool-section">
          <div className="section-heading pool-heading">
            <div><h2>预备直播间</h2><small>{rooms.filter((room) => !room.monitoring).length} 个未监看</small></div>
            <div className="filter-tabs">
              <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button>
              <button className={filter === "live" ? "active" : ""} onClick={() => setFilter("live")}>直播中</button>
            </div>
          </div>
          <div className="card-grid" aria-label="预备直播间列表">
            {visibleRooms.filter((room) => !room.monitoring).map((room) => <RoomCard key={room.id} room={room} onMonitor={changeMonitoring} onPlay={openPlayer} onDelete={deleteRoom} />)}
          </div>
        </section>
      </main>

      {playing && (
        <aside className="player-drawer" aria-label="直播播放与历史 ASR">
          <div className="drawer-head"><div><span>正在播放</span><strong>{playing.name}</strong></div><button aria-label="关闭播放浮层" onClick={() => setDrawerId(null)}><X size={21} /></button></div>
          <div className="vertical-video">
            <img src={playing.cover} alt={`${playing.name} 直播画面`} />
            <span className="video-live">直播</span>
            <div className="video-controls"><button><Pause size={18} weight="fill" /></button><span>实时播放 · 00:00</span><button>静音</button></div>
          </div>
          <div className="drawer-status"><span><Users size={16} />{playing.viewers} 人在线</span><span>{playing.likes} 点赞</span><button>回到直播</button></div>
          <div className="history-head"><div><strong>历史 ASR</strong><small>点击时间回放对应片段</small></div><button><MagnifyingGlass size={16} /></button></div>
          <div className="history-list">
            {feed.filter((item) => item.id === playing.id).map((item) => (
              <button key={item.time} onClick={() => setToast(`正在回放 ${item.time} 对应片段`)}><time>{item.time}</time><p>{item.text}</p><Play size={14} weight="fill" /></button>
            ))}
          </div>
        </aside>
      )}

      {showAdd && (
        <div className="modal-backdrop" onMouseDown={() => setShowAdd(false)}>
          <form className="add-modal" onSubmit={addRoom} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-title"><div><h2>添加直播间</h2><p>系统将获取直播间身份、主图并按预计周期检测状态。</p></div><button type="button" onClick={() => setShowAdd(false)}><X size={20} /></button></div>
            <label>直播间链接<input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://live.douyin.com/123456789" /></label>
            <fieldset><legend>每周重复</legend><div className="days">{["一","二","三","四","五","六","日"].map((day,index) => <button type="button" className={selectedDays.includes(index + 1) ? "selected" : ""} key={day} onClick={() => setSelectedDays((days) => days.includes(index+1) ? days.filter((item)=>item!==index+1) : [...days,index+1])}>周{day}</button>)}</div></fieldset>
            <fieldset><legend>预计直播时段</legend><div className="time-range"><input type="time" defaultValue="09:00" /><span>至</span><input type="time" defaultValue="12:00" /><button type="button"><Plus size={15} />增加时段</button></div></fieldset>
            <div className="init-note"><CheckCircle size={19} /><p><b>添加后进入初始化</b><span>不会自动加入实时监看，也不会播放声音。</span></p></div>
            <div className="modal-actions"><button type="button" onClick={() => setShowAdd(false)}>取消</button><button className="primary-button" type="submit">添加并初始化</button></div>
          </form>
        </div>
      )}
      {showProfile && <div className="profile-menu"><button>本机数据与隐私</button><button>退出客户端</button></div>}
      {toast && <div className="toast" role="status">{toast}<button onClick={() => setToast("")}><X size={14} /></button></div>}
    </div>
  );
}
