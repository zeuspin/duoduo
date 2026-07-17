import type { PreparedProbeState } from "../../shared/contracts";

interface PreparedRoomHeaderProps {
  count: number;
  state: PreparedProbeState;
  roomName(roomId: string): string;
  accessBlocked: boolean;
  onProbeAll(): void;
  onCancelBatch(): void;
}

function nextRunLabel(nextRunAt: string | undefined): string | undefined {
  if (!nextRunAt) return undefined;
  const time = new Date(nextRunAt);
  if (!Number.isFinite(time.getTime())) return undefined;
  return `下次检测 ${time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function estimatedCompletionLabel(estimatedCompletionAt: string | undefined): string | undefined {
  if (!estimatedCompletionAt) return undefined;
  const time = new Date(estimatedCompletionAt);
  if (!Number.isFinite(time.getTime())) return undefined;
  return `按照安全节流，预计最早 ${time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })} 完成`;
}

export function PreparedRoomHeader({ count, state, roomName, accessBlocked, onProbeAll, onCancelBatch }: PreparedRoomHeaderProps) {
  const manualBatch = state.batch?.source === "manual_batch";
  const progress = state.batch ? Math.min(state.batch.completed + (state.currentRoomId ? 1 : 0), state.batch.total) : 0;
  const status = accessBlocked
    ? "自动更新已暂停"
    : manualBatch
      ? `批量更新 ${progress}/${state.batch!.total}`
      : state.mode === "running"
        ? `自动更新中 · 队列 ${state.queuedRoomIds.length}`
        : "自动更新已开启";
  const nextRun = state.mode === "idle" && !accessBlocked ? nextRunLabel(state.nextRunAt) : undefined;
  const estimatedCompletion = manualBatch ? estimatedCompletionLabel(state.estimatedCompletionAt) : undefined;

  return <div className="section-head prepared-room-head">
    <b>预备直播间 <small>{count}</small></b>
    <div className="prepared-probe-summary" role="status">
      <span>{status}</span>
      {state.currentRoomId && <span>当前：{roomName(state.currentRoomId)}</span>}
      {estimatedCompletion && <span>{estimatedCompletion}</span>}
      {nextRun && <span>{nextRun}</span>}
      {manualBatch
        ? <button type="button" onClick={onCancelBatch}>停止后续更新</button>
        : <button type="button" disabled={accessBlocked || count === 0 || state.mode === "running"} onClick={onProbeAll}>更新全部状态</button>}
    </div>
  </div>;
}
