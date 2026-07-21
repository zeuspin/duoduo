import { useEffect, useState } from "react";
import type { AsrEvent } from "../../shared/contracts";
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

export function LiveRoomWorkspace({
  roomId,
  liveEvents,
  runtimeState,
  analysisEnabled,
  llmConfigured,
  focusInsightId,
}: {
  roomId: string;
  liveEvents: AsrEvent[];
  runtimeState: string;
  analysisEnabled: boolean;
  llmConfigured: boolean;
  focusInsightId?: number;
}) {
  const [tab, setTab] = useState<"asr" | "insights">("asr");
  useEffect(() => {
    if (focusInsightId) setTab("insights");
  }, [focusInsightId]);

  return (
    <div className="live-workspace">
      <div className="live-workspace-toolbar">
        <div className="live-tabs">
          <button
            className={tab === "asr" ? "active" : ""}
            onClick={() => setTab("asr")}
          >
            直播文字
          </button>
          <button
            className={tab === "insights" ? "active" : ""}
            onClick={() => setTab("insights")}
          >
            内容分析
          </button>
        </div>
      </div>
      {tab === "asr" ? (
        <div className="asr">
          <div className="asr-title">
            <b>
              <em />
              直播文字
            </b>
            <span>{runtimeLabels[runtimeState] ?? "状态更新中"}</span>
          </div>
          <AsrFeed
            roomId={roomId}
            liveEvents={liveEvents}
            listBefore={window.duoduo.asr.listBefore}
          />
        </div>
      ) : (
        <LiveInsightPanel
          roomId={roomId}
          enabled={analysisEnabled}
          llmConfigured={llmConfigured}
          focusInsightId={focusInsightId}
        />
      )}
    </div>
  );
}
