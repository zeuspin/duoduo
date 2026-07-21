import { CaretDown, Check, PencilSimple, X } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import type {
  GroupRun,
  GroupRefreshProgress,
  GroupRefreshResult,
  GroupStopProgress,
  ImmutableParser,
  RoomGroup,
} from "../../shared/contracts";

type Snapshot = {
  groups: RoomGroup[];
  activeRun?: GroupRun;
  lastInterruptedRun?: GroupRun;
  stopProgress?: GroupStopProgress;
  refreshProgress?: GroupRefreshProgress;
  lastRefreshResult?: GroupRefreshResult;
};

export function RoomGroupWorkspace({
  renderContent,
  onMessage,
  onSelectedGroupChange,
  accessBlocked = false,
}: {
  renderContent(
    groupId: string,
    parserId: string | null,
    groups: RoomGroup[],
    refreshGroups: () => Promise<void>,
    groupRunning: boolean,
  ): ReactNode;
  onMessage?(message: string): void;
  onSelectedGroupChange?(groupId: string): void;
  accessBlocked?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ groups: [] });
  const [selectedId, setSelectedId] = useState<string>();
  const [parsers, setParsers] = useState<ImmutableParser[]>([]);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupParserId, setNewGroupParserId] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const refresh = async () => {
    const next = (await window.duoduo.groups.list()) as Snapshot;
    setSnapshot(next);
    setSelectedId((current) =>
      current && next.groups.some((group) => group.id === current)
        ? current
        : next.groups[0]?.id,
    );
  };
  useEffect(() => {
    void refresh();
    void window.duoduo.parsers
      .list()
      .then((value) =>
        setParsers((value as { parsers?: ImmutableParser[] }).parsers ?? []),
      );
    return window.duoduo.groups.subscribe?.((value) =>
      setSnapshot(value as Snapshot),
    );
  }, []);
  useEffect(() => {
    if (selectedId) onSelectedGroupChange?.(selectedId);
  }, [onSelectedGroupChange, selectedId]);
  const selected = snapshot.groups.find((group) => group.id === selectedId);
  const running = snapshot.groups.find(
    (group) => group.id === snapshot.activeRun?.groupId,
  );

  async function action(work: () => Promise<unknown>) {
    setBusy(true);
    try {
      const next = (await work()) as Snapshot;
      setSnapshot(next);
      return next;
    } catch (error) {
      onMessage?.(String(error));
      await refresh();
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  async function createGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    const next = await action(() =>
      window.duoduo.groups.create(name, newGroupParserId || null),
    );
    if (next) {
      const created = next.groups.find((group) => group.name === name);
      if (created) setSelectedId(created.id);
      setCreating(false);
      setNewGroupName("");
      setNewGroupParserId("");
    }
  }
  async function renameGroup() {
    if (!selected || renaming) return;
    const name = groupNameDraft.trim();
    if (!name || name === selected.name) {
      setEditingName(false);
      return;
    }
    setRenaming(true);
    try {
      const next = (await window.duoduo.groups.rename(selected.id, name)) as Snapshot;
      setSnapshot(next);
      setEditingName(false);
    } catch (error) {
      onMessage?.(String(error));
      await refresh();
    } finally {
      setRenaming(false);
    }
  }
  async function removeGroup() {
    if (
      !selected ||
      !window.confirm(`删除分组“${selected.name}”？仅空分组可以删除。`)
    )
      return;
    await action(() => window.duoduo.groups.remove(selected.id));
  }

  const groupControls = selected ? (
    <div className="group-panel-head">
      {editingName && (
        <div className="group-identity">
          <form
            className="group-name-editor"
            onSubmit={(event) => {
              event.preventDefault();
              void renameGroup();
            }}
          >
            <input
              aria-label="分组名称"
              autoFocus
              maxLength={30}
              value={groupNameDraft}
              onChange={(event) => setGroupNameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditingName(false);
              }}
            />
            <button type="submit" aria-label="保存分组名称" disabled={renaming || !groupNameDraft.trim()}><Check /></button>
            <button type="button" aria-label="取消编辑分组名称" onClick={() => setEditingName(false)}><X /></button>
          </form>
        </div>
      )}
      <div className="group-actions">
        <label className="group-parser-control">
          <span>解析器</span>
          <select
            aria-label="分组解析器"
            disabled={busy || snapshot.activeRun?.groupId === selected.id}
            value={selected.parserId ?? ""}
            onChange={(event) =>
              void action(() =>
                window.duoduo.groups.setParser(selected.id, event.target.value || null),
              )
            }
          >
            <option value="">不分析，仅保存文字</option>
            {parsers.map((parser) => (
              <option key={parser.id} value={parser.id}>{parser.spec.name}</option>
            ))}
          </select>
          <CaretDown aria-hidden="true" />
        </label>
        <button
          aria-label="删除分组"
          disabled={busy || snapshot.activeRun?.groupId === selected.id || selected.roomCount > 0}
          onClick={() => void removeGroup()}
        >删除</button>
        <button
          className="start"
          aria-label="启动"
          disabled={busy || accessBlocked || snapshot.activeRun?.groupId === selected.id}
          onClick={() => {
            if (running && running.id !== selected.id) {
              onMessage?.(`“${running.name}”正在运行，请先停止该分组再启动“${selected.name}”`);
              return;
            }
            void action(() => window.duoduo.groups.start(selected.id));
          }}
        >▷ 启动</button>
        <button
          aria-label="停止"
          disabled={busy || snapshot.activeRun?.groupId !== selected.id}
          onClick={() => void action(() => window.duoduo.groups.stop(selected.id))}
        >■ 停止</button>
        {snapshot.activeRun?.groupId === selected.id && snapshot.activeRun.status === "stop_failed" && (
          <button aria-label="重试停止" disabled={busy} onClick={() => void action(() => window.duoduo.groups.retryStop(selected.id))}>
            重试停止
          </button>
        )}
        <button
          aria-label="刷新状态"
          disabled={busy || accessBlocked || snapshot.refreshProgress?.groupId === selected.id}
          onClick={() =>
            void action(async () => {
              await window.duoduo.groups.refresh(selected.id);
              return window.duoduo.groups.list();
            })
          }
        >
          ↻ {snapshot.refreshProgress?.groupId === selected.id
            ? `刷新中 ${snapshot.refreshProgress.completed}/${snapshot.refreshProgress.total}`
            : "刷新状态"}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="group-workspace">
      {!running && snapshot.lastInterruptedRun && (
        <div className="other-group-running" role="status">
          <b>上一次运行因应用退出而中断</b>
          <span>
            系统没有自动恢复轮询或实时记录；请确认后手动启动需要运行的分组。
          </span>
        </div>
      )}
      <div className="group-commandbar">
        <div className="group-tabs" role="tablist">
          {snapshot.groups.map((group) => (
            <div
              className={`group-tab-shell ${group.id === selectedId ? "selected" : ""} ${group.id === running?.id ? "running" : ""}`}
              key={group.id}
            >
              <button
                role="tab"
                aria-selected={group.id === selectedId}
                onClick={() => setSelectedId(group.id)}
              >
                <b>{group.name}</b>
                <small><i />{group.id === running?.id ? "运行中" : "已停止"}</small>
              </button>
              {group.id === selectedId && !editingName && (
                <button
                  type="button"
                  className="group-tab-rename"
                  aria-label={`编辑“${group.name}”分组名称`}
                  title={`重命名“${group.name}”`}
                  onClick={() => {
                    setGroupNameDraft(group.name);
                    setEditingName(true);
                  }}
                >
                  <PencilSimple />
                </button>
              )}
            </div>
          ))}
          <button className="new-group" onClick={() => setCreating(true)}>
            ＋ 新建分组
          </button>
        </div>
        {groupControls}
      </div>
      {creating && (
        <form
          className="new-group-form"
          onSubmit={(event) => {
            event.preventDefault();
            void createGroup();
          }}
        >
          <label>
            分组名称
            <input
              aria-label="分组名称"
              autoFocus
              maxLength={30}
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
            />
          </label>
          <label>
            解析器
            <select
              aria-label="新分组解析器"
              value={newGroupParserId}
              onChange={(event) => setNewGroupParserId(event.target.value)}
            >
              <option value="">暂不设置</option>
              {parsers.map((parser) => (
                <option key={parser.id} value={parser.id}>
                  {parser.spec.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setCreating(false)}>
            取消
          </button>
          <button
            className="primary"
            type="submit"
            disabled={!newGroupName.trim() || busy}
          >
            创建分组
          </button>
        </form>
      )}
      {selected && (
        <section className="group-panel">
          {busy && (
            <div className="group-operation-progress" role="status">
              {snapshot.stopProgress?.groupId === selected.id
                ? `正在停止：${snapshot.stopProgress.completed}/${snapshot.stopProgress.total}`
                : "正在处理分组操作，请稍候…"}
            </div>
          )}
          {snapshot.lastRefreshResult?.groupId === selected.id &&
            !snapshot.refreshProgress && snapshot.lastRefreshResult.failedRoomIds.length > 0 && (
              <div className="group-operation-progress" role="status">
                {snapshot.lastRefreshResult.failedRoomIds.length} 个直播间刷新失败：
                {snapshot.lastRefreshResult.failedRoomIds.join("、")}
              </div>
            )}
          {snapshot.activeRun?.groupId === selected.id &&
            snapshot.activeRun.status === "stop_failed" && (
              <div className="other-group-running" role="alert">
                <b>分组未能完全停止</b>
                <span>
                  未停止直播间：
                  {snapshot.stopProgress?.failedRoomIds.join("、") ||
                    snapshot.activeRun.error ||
                    "未知"}
                  。请使用“重试停止”，确认全部停止后再启动其他组。
                </span>
              </div>
            )}
          <div>
            {renderContent(
              selected.id,
              selected.parserId,
              snapshot.groups,
              refresh,
              snapshot.activeRun?.groupId === selected.id,
            )}
          </div>
        </section>
      )}
    </div>
  );
}
