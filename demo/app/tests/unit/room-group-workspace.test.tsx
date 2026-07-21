// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoomGroupWorkspace } from "../../src/renderer/components/RoomGroupWorkspace";

const groups = [
  {
    id: "a",
    name: "盘中观察",
    parserId: null,
    position: 0,
    roomCount: 2,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  },
  {
    id: "b",
    name: "行业研究",
    parserId: null,
    position: 1,
    roomCount: 1,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  },
];
const api = {
  list: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  moveRoom: vi.fn(),
  setParser: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  retryStop: vi.fn(),
  refresh: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue({
    groups,
    activeRun: {
      id: "r",
      groupId: "a",
      status: "running",
      startedAt: "2026-07-20T00:00:00.000Z",
    },
  });
  Object.assign(window, {
    duoduo: {
      groups: api,
      parsers: { list: vi.fn().mockResolvedValue({ parsers: [] }) },
    },
  });
});
afterEach(cleanup);

describe("RoomGroupWorkspace", () => {
  it("switches viewed groups freely while keeping the running group visible", async () => {
    const onSelectedGroupChange = vi.fn();
    const onMessage = vi.fn();
    render(
      <RoomGroupWorkspace
        onSelectedGroupChange={onSelectedGroupChange}
        onMessage={onMessage}
        renderContent={(groupId) => <div>内容 {groupId}</div>}
      />,
    );
    expect(await screen.findByRole("tab", { name: /盘中观察.*运行中/ })).toBeTruthy();
    expect(screen.queryByText("正在运行：盘中观察")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /行业研究/ }));
    expect(screen.getByText("内容 b")).toBeTruthy();
    expect(screen.queryByText("正在运行：盘中观察")).toBeNull();
    expect(screen.getByRole("tab", { name: /盘中观察.*运行中/ })).toBeTruthy();
    expect(onSelectedGroupChange).toHaveBeenLastCalledWith("b");
    expect(
      screen.getByRole("button", { name: "启动" }).hasAttribute("disabled"),
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "启动" }));
    expect(api.start).not.toHaveBeenCalled();
    expect(onMessage).toHaveBeenCalledWith(
      "“盘中观察”正在运行，请先停止该分组再启动“行业研究”",
    );
    expect(
      screen.getByRole("button", { name: "刷新状态" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("starts a stopped group when no other group is running", async () => {
    api.list.mockResolvedValueOnce({ groups, activeRun: undefined });
    api.start.mockResolvedValue({
      groups,
      activeRun: {
        id: "r",
        groupId: "a",
        status: "running",
        startedAt: "2026-07-20T00:00:00.000Z",
      },
    });
    render(<RoomGroupWorkspace renderContent={() => <div />} />);
    fireEvent.click(await screen.findByRole("button", { name: "启动" }));
    expect(api.start).toHaveBeenCalledWith("a");
  });

  it("renames a running group from the inline title editor", async () => {
    const renamed = { ...groups[0], name: "早盘观察" };
    api.rename.mockResolvedValue({
      groups: [renamed, groups[1]],
      activeRun: {
        id: "r",
        groupId: "a",
        status: "running",
        startedAt: "2026-07-20T00:00:00.000Z",
      },
    });
    render(<RoomGroupWorkspace renderContent={() => <div />} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑“盘中观察”分组名称" }));
    fireEvent.change(screen.getByRole("textbox", { name: "分组名称" }), {
      target: { value: "早盘观察" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存分组名称" }));
    expect(api.rename).toHaveBeenCalledWith("a", "早盘观察");
    expect(await screen.findByRole("tab", { name: /早盘观察/ })).toBeTruthy();
  });

  it("creates a group with an optional parser from an explicit form", async () => {
    const created = {
      id: "c",
      name: "新能源",
      parserId: "p",
      position: 2,
      roomCount: 0,
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    };
    api.create.mockResolvedValue({ groups: [...groups, created], activeRun: undefined });
    const onSelectedGroupChange = vi.fn();
    Object.assign(window, {
      duoduo: {
        groups: api,
        parsers: {
          list: vi.fn().mockResolvedValue({
            parsers: [
              {
                id: "p",
                spec: {
                  name: "行业解析",
                  description: "",
                  objectives: ["sector_direction"],
                  filters: [],
                  normalization: "suggest",
                  model: "qwen-plus",
                  advancedPrompt: "",
                },
                createdAt: "2026-07-20T00:00:00.000Z",
              },
            ],
          }),
        },
      },
    });
    render(
      <RoomGroupWorkspace
        onSelectedGroupChange={onSelectedGroupChange}
        renderContent={() => <div />}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /新建分组/ }));
    fireEvent.change(screen.getByLabelText("分组名称"), {
      target: { value: "新能源" },
    });
    fireEvent.change(screen.getByLabelText("新分组解析器"), {
      target: { value: "p" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建分组" }));
    expect(api.create).toHaveBeenCalledWith("新能源", "p");
    expect(
      (await screen.findByRole("tab", { name: /新能源/ })).getAttribute(
        "aria-selected",
      ),
    ).toBe("true");
  });
});
