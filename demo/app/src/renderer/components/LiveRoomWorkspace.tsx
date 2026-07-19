import { useEffect, useState } from "react";
import type { AsrEvent, ParserDefinition, ParserTestRun, RoomParserBinding } from "../../shared/contracts";
import { AsrFeed } from "./AsrFeed";
import { LiveInsightPanel } from "./LiveInsightPanel";

const runtimeLabels: Record<string, string> = {
  idle: "尚未开始",
  starting: "正在准备文字记录",
  monitoring: "正在记录直播内容",
  waiting_for_live: "等待主播开播",
  recovering: "正在重新连接",
  stopped: "已停止记录",
  error: "文字记录遇到问题",
};

export interface ParserSnapshot { definitions: ParserDefinition[]; bindings: RoomParserBinding[]; tests: ParserTestRun[]; llmConfigured: boolean }

export function LiveRoomWorkspace({ roomId, liveEvents, runtimeState, parsers, onParsersChange, focusInsightId }: { roomId: string; liveEvents: AsrEvent[]; runtimeState: string; parsers: ParserSnapshot; onParsersChange(value: ParserSnapshot): void; focusInsightId?: number }) {
  const [tab, setTab] = useState<"asr" | "insights">("asr");
  const binding = parsers.bindings.find((item) => item.roomId === roomId);
  useEffect(() => { if (focusInsightId) setTab("insights"); }, [focusInsightId]);

  async function bind(value: string) {
    const [parserId, versionId] = value.split(":");
    onParsersChange(await window.duoduo.parsers.bindRoom(roomId, value === "none" ? null : parserId, value === "none" ? null : Number(versionId)) as ParserSnapshot);
  }

  return <div className="live-workspace">
    <div className="live-workspace-toolbar"><div className="live-tabs"><button className={tab === "asr" ? "active" : ""} onClick={() => setTab("asr")}>直播文字</button><button className={tab === "insights" ? "active" : ""} onClick={() => setTab("insights")}>内容分析</button></div><label>分析规则<select aria-label={`直播间 ${roomId} 分析规则`} value={binding ? `${binding.parserId}:${binding.parserVersionId}` : "none"} onChange={(event) => void bind(event.target.value)}><option value="none">不分析，仅保存直播文字</option>{parsers.definitions.flatMap((parser) => parser.publishedVersion ? [<option value={`${parser.id}:${parser.publishedVersion.id}`} key={parser.id}>{parser.name} v{parser.publishedVersion.version}</option>] : [])}</select></label></div>
    {tab === "asr" ? <div className="asr"><div className="asr-title"><b><em />直播文字</b><span>{runtimeLabels[runtimeState] ?? "状态更新中"}</span></div><AsrFeed roomId={roomId} liveEvents={liveEvents} listBefore={window.duoduo.asr.listBefore} /></div> : <LiveInsightPanel roomId={roomId} enabled={Boolean(binding)} llmConfigured={parsers.llmConfigured} focusInsightId={focusInsightId} />}
  </div>;
}
