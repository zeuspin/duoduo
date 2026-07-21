import {
  ArrowClockwise,
  DotsThree,
  ImageSquare,
  PencilSimple,
  Play,
  Stop,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { ProbeRequestState } from "../../shared/contracts";
import { Tooltip } from "./Tooltip";

interface RoomCardActionsProps {
  active: boolean;
  playbackLoading?: boolean;
  avatarRefreshing?: boolean;
  blocked: boolean;
  deleting?: boolean;
  deleteDisabled?: boolean;
  probeState?: ProbeRequestState;
  onPlay(): void;
  onProbe(): void;
  onRefreshAvatar(): void;
  onEdit(): void;
  onDelete(): void;
  moveTargets?: Array<{ id: string; name: string }>;
  moveDisabled?: boolean;
  onMove?(groupId: string): void;
}

export function RoomCardActions({
  active,
  playbackLoading = false,
  avatarRefreshing = false,
  blocked,
  deleting = false,
  deleteDisabled = false,
  probeState,
  onPlay,
  onProbe,
  onRefreshAvatar,
  onEdit,
  onDelete,
  moveTargets = [],
  moveDisabled = false,
  onMove,
}: RoomCardActionsProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  const cooldown =
    probeState?.phase === "cooldown"
      ? Math.max(
          0,
          Math.ceil(
            (Date.parse(probeState.cooldownUntil) - Date.now()) / 1_000,
          ),
        )
      : 0;
  const probeText =
    probeState?.phase === "queued"
      ? probeState.requestType === "initial"
        ? "等待首次检测"
        : "等待检测"
      : probeState?.phase === "running"
        ? probeState.requestType === "initial"
          ? "正在首次检测"
          : "正在检测"
        : cooldown > 0
          ? `${cooldown} 秒`
          : "立即检测";
  const probeLabel =
    cooldown > 0
      ? `${cooldown} 秒后可再次检测`
      : probeState && probeState.phase !== "cooldown"
        ? probeText
        : "立即检测直播状态";
  const probeDisabled =
    blocked ||
    Boolean(probeState && (probeState.phase !== "cooldown" || cooldown > 0));

  return (
    <div
      className="card-actions"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        type="button"
        className="card-action card-play-action"
        aria-label={playbackLoading ? "正在加载直播" : active ? "停止播放" : "播放直播"}
        disabled={playbackLoading || (blocked && !active)}
        onClick={onPlay}
      >
        {playbackLoading ? <ArrowClockwise className="feedback-spinner" /> : active ? <Stop weight="fill" /> : <Play weight="fill" />}
        <span>{playbackLoading ? "加载中" : active ? "停止" : "播放"}</span>
      </button>
      <button
        type="button"
        className={`card-action card-probe-action ${probeState?.phase === "running" ? "probing" : ""}`}
        aria-label={probeLabel}
        disabled={probeDisabled}
        onClick={onProbe}
      >
        <ArrowClockwise />
        <span>{probeText}</span>
      </button>
      <div className="card-more">
        <Tooltip label="更多操作">
          <button
            type="button"
            className="card-more-trigger"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <DotsThree weight="bold" />
          </button>
        </Tooltip>
        {open && (
          <div className="card-action-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              disabled={blocked || avatarRefreshing}
              onClick={() => run(onRefreshAvatar)}
            >
              {avatarRefreshing ? <ArrowClockwise className="feedback-spinner" /> : <ImageSquare />}
              {avatarRefreshing ? "正在更新头像" : "更新主播头像"}
            </button>
            <button type="button" role="menuitem" onClick={() => run(onEdit)}>
              <PencilSimple />
              编辑直播间
            </button>
            {onMove && (
              <label className="room-move-menu">
                移动到分组
                <select
                  aria-label="移动到分组"
                  disabled={moveDisabled}
                  defaultValue=""
                  onChange={(event) => {
                    const groupId = event.target.value;
                    if (groupId) run(() => onMove(groupId));
                  }}
                >
                  <option value="" disabled>
                    选择分组
                  </option>
                  {moveTargets.map((group) => (
                    <option value={group.id} key={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              role="menuitem"
              className="danger"
              disabled={deleting || deleteDisabled}
              onClick={() => run(onDelete)}
            >
              <Trash />
              {deleting ? "正在删除" : "删除直播间"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
