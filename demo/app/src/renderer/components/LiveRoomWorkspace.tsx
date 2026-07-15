import { useEffect, useState } from "react";
import type { AsrEvent, ParserDefinition, ParserTestRun, RoomParserBinding } from "../../shared/contracts";
import { AsrFeed } from "./AsrFeed";
import { LiveInsightPanel } from "./LiveInsightPanel";

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
    <div className="live-workspace-toolbar"><div className="live-tabs"><button className={tab === "asr" ? "active" : ""} onClick={() => setTab("asr")}>实时 ASR</button><button className={tab === "insights" ? "active" : ""} onClick={() => setTab("insights")}>解析观点</button></div><label>解析器<select aria-label={`直播间 ${roomId} 解析器`} value={binding ? `${binding.parserId}:${binding.parserVersionId}` : "none"} onChange={(event) => void bind(event.target.value)}><option value="none">不使用解析器，仅保留 ASR</option>{parsers.definitions.flatMap((parser) => parser.publishedVersion ? [<option value={`${parser.id}:${parser.publishedVersion.id}`} key={parser.id}>{parser.name} v{parser.publishedVersion.version}</option>] : [])}</select></label></div>
    {tab === "asr" ? <div className="asr"><div className="asr-title"><b><em />实时 ASR</b><span>{runtimeState}</span></div><AsrFeed roomId={roomId} liveEvents={liveEvents} listBefore={window.duoduo.asr.listBefore} /></div> : <LiveInsightPanel roomId={roomId} enabled={Boolean(binding)} llmConfigured={parsers.llmConfigured} focusInsightId={focusInsightId} />}
  </div>;
}
