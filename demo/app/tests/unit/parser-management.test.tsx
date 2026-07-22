// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ParserManagement } from "../../src/renderer/components/ParserManagement";

const legacyParser = {
  id: "market-insight",
  spec: {
    name: "市场观点",
    description: "旧说明",
    objectives: ["sector_direction" as const],
    filters: ["audience_question" as const, "advertising" as const],
    normalization: "suggest" as const,
    model: "qwen-plus",
    advancedPrompt: "只提取有证据的观点",
  },
  createdAt: "2026-07-13T00:00:00.000Z",
};
const snapshot = { parsers: [legacyParser], llmConfigured: true };

beforeEach(() =>
  Object.assign(window, {
    duoduo: {
      parsers: {
        list: vi.fn().mockResolvedValue(snapshot),
        discuss: vi.fn().mockResolvedValue({
          status: "ready",
          draft: {
            name: "价格变化提醒",
            purpose: "记录主播提到的价格变化并提醒",
            resultTypes: [{ id: "price_change", label: "价格变化", definition: "商品价格发生变化" }],
            fields: [{ id: "product", label: "商品", type: "string" }],
            inclusionRules: ["主播明确提到价格变化"],
            exclusionRules: ["忽略寒暄"],
            alertRules: ["价格下降时提醒"],
          },
          questions: [],
        }),
        listSamples: vi.fn().mockResolvedValue({
          samples: [{
            roomId: "shop-room",
            label: "美妆直播间",
            status: "offline",
            source: "history",
            captureState: "text_ready",
            asrCount: 28,
            lastAsrAt: "2026-07-21T08:00:00.000Z",
          }],
        }),
        prepareSample: vi.fn().mockResolvedValue({
          samples: [{
            roomId: "987654",
            label: "新电商直播间",
            status: "live",
            source: "live_waiting",
            captureState: "audio_ready",
            asrCount: 0,
          }],
        }),
        stopSampleCapture: vi.fn().mockResolvedValue({ samples: [] }),
        testDraft: vi.fn().mockResolvedValue({
          status: "passed",
          roomId: "shop-room",
          sampleCount: 28,
          sampleCharacters: 1200,
          records: [{
            resultTypeId: "price_change",
            resultTypeLabel: "价格变化",
            title: "防晒霜降价",
            summary: "价格降至七十九元",
            fields: { product: "防晒霜" },
            evidence: ["这款防晒霜今天七十九元"],
            sourceAsrIds: [1],
            confidence: 0.96,
            alertLevel: "important",
          }],
          checks: { schemaValid: true, evidenceGrounded: true, resultTypesValid: true },
          message: "样本产生 1 条记录，结构和逐字证据校验通过。",
          testToken: "pass-token",
        }),
        publishTested: vi.fn().mockResolvedValue({
          parsers: [{ ...legacyParser, spec: { schemaVersion: 4, name: "价格变化提醒", definition: {} } }],
          llmConfigured: true,
        }),
        create: vi.fn().mockResolvedValue(snapshot),
        copy: vi.fn().mockResolvedValue(snapshot),
        remove: vi.fn().mockResolvedValue({ parsers: [], llmConfigured: true }),
      },
      contentRecords: {
        list: vi.fn().mockResolvedValue({ items: [] }),
        subscribe: vi.fn().mockReturnValue(() => undefined),
      },
      groups: {
        list: vi.fn().mockResolvedValue({
          groups: [{ id: "default", name: "默认分组", parserId: null, position: 0, roomCount: 1, createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z" }],
        }),
        create: vi.fn().mockResolvedValue({
          groups: [
            { id: "default", name: "默认分组", parserId: null, position: 0, roomCount: 1, createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z" },
            { id: "test-group", name: "洞察测试", parserId: null, position: 1, roomCount: 0, createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z" },
          ],
        }),
        start: vi.fn().mockResolvedValue({}),
      },
      rooms: {
        add: vi.fn().mockResolvedValue({
          roomId: "987654",
          canonicalUrl: "https://live.douyin.com/987654",
          schedule: null,
          monitoring: false,
          autoMonitorOnLive: false,
          groupId: "test-group",
          positionInGroup: 0,
          createdAt: "2026-07-21T00:00:00.000Z",
          updatedAt: "2026-07-21T00:00:00.000Z",
        }),
        setAutoMonitorOnLive: vi.fn().mockResolvedValue({}),
        probe: vi.fn().mockResolvedValue({}),
      },
    },
  }),
);
afterEach(cleanup);

describe("ParserManagement", () => {
  it("does not expose a duplicate content-analysis service or API Key setting", async () => {
    render(<ParserManagement rooms={[]} snapshots={[]} />);
    await screen.findByText("解析器列表");

    expect(screen.queryByText("内容分析服务")).toBeNull();
    expect(screen.queryByLabelText("模型 API Key")).toBeNull();
    expect(screen.queryByLabelText("服务类型")).toBeNull();
  });

  it("exposes controlled creation without direct prompt editing", async () => {
    render(<ParserManagement rooms={[]} snapshots={[]} />);
    await screen.findByText("解析器列表");
    fireEvent.click(screen.getByRole("button", { name: "新建内容洞察" }));
    expect(screen.getByText("创建新版内容洞察")).toBeTruthy();
    expect(screen.getByLabelText("描述需要记录或提醒的内容")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "新建解析器" })).toBeNull();
    expect(screen.queryByRole("button", { name: "复制新建" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
    expect(screen.queryByLabelText("解析器名称")).toBeNull();
    expect(screen.queryByLabelText("模型")).toBeNull();
    expect(screen.queryByLabelText("用户提示词")).toBeNull();
    expect(screen.queryByLabelText("解析器说明")).toBeNull();
    expect(screen.queryByText("关注内容")).toBeNull();
    expect(screen.queryByText("忽略内容")).toBeNull();
    expect(screen.queryByLabelText("名称规范化")).toBeNull();
    expect(screen.queryByLabelText("高级提示词")).toBeNull();
    expect(screen.queryByRole("button", { name: "运行样本测试" })).toBeNull();
  });

  it("turns a plain-language request into a constrained draft", async () => {
    render(<ParserManagement rooms={[]} snapshots={[]} />);
    await screen.findByText("解析器列表");
    fireEvent.click(screen.getByRole("button", { name: "新建内容洞察" }));
    fireEvent.change(screen.getByLabelText("描述需要记录或提醒的内容"), {
      target: { value: "提到商品降价时提醒我" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送需求" }));
    expect(await screen.findByText("价格变化提醒")).toBeTruthy();
    expect(screen.getByText("当前分析器保持生效，样本测试通过前不会被替换。")).toBeTruthy();
    expect(window.duoduo.parsers.discuss).toHaveBeenCalledWith({
      messages: [{ role: "user", content: "提到商品降价时提醒我" }],
    });
  });

  it("selects historical ASR and renders evidence-grounded test results", async () => {
    render(<ParserManagement rooms={[]} snapshots={[]} />);
    await screen.findByText("解析器列表");
    fireEvent.click(screen.getByRole("button", { name: "新建内容洞察" }));
    fireEvent.change(screen.getByLabelText("描述需要记录或提醒的内容"), {
      target: { value: "提到商品降价时提醒我" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送需求" }));
    fireEvent.click(await screen.findByRole("button", { name: "下一步：选择样本" }));
    expect((await screen.findByRole("radio", { name: /美妆直播间/ })).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "运行样本测试" }));
    expect(await screen.findByText("防晒霜降价")).toBeTruthy();
    expect(screen.getByText(/结构、结果类型和逐字证据均已校验/)).toBeTruthy();
    expect(window.duoduo.parsers.testDraft).toHaveBeenCalledWith(expect.objectContaining({ roomId: "shop-room" }));
    fireEvent.click(screen.getByRole("button", { name: "返回修改需求" }));
    expect(screen.getByLabelText("描述需要记录或提醒的内容")).toBeTruthy();
  });

  it("allows adding a new live room even when historical samples already exist", async () => {
    vi.mocked(window.duoduo.parsers.listSamples)
      .mockResolvedValueOnce({
        samples: [{ roomId: "shop-room", label: "美妆直播间", status: "offline", source: "history", captureState: "text_ready", asrCount: 28, lastAsrAt: "2026-07-21T08:00:00.000Z" }],
      })
      .mockResolvedValueOnce({
        samples: [
          { roomId: "shop-room", label: "美妆直播间", status: "offline", source: "history", captureState: "text_ready", asrCount: 28, lastAsrAt: "2026-07-21T08:00:00.000Z" },
          { roomId: "987654", label: "新电商直播间", status: "live", source: "live_waiting", captureState: "text_ready", asrCount: 1, lastAsrAt: "2026-07-21T08:01:00.000Z" },
        ],
      });
    render(<ParserManagement rooms={[]} snapshots={[]} />);
    await screen.findByText("解析器列表");
    fireEvent.click(screen.getByRole("button", { name: "新建内容洞察" }));
    fireEvent.change(screen.getByLabelText("描述需要记录或提醒的内容"), { target: { value: "提到商品降价时提醒我" } });
    fireEvent.click(screen.getByRole("button", { name: "发送需求" }));
    fireEvent.click(await screen.findByRole("button", { name: "下一步：选择样本" }));

    expect(await screen.findByRole("radio", { name: /美妆直播间/ })).toBeTruthy();
    fireEvent.change(await screen.findByLabelText("抖音直播间链接"), { target: { value: "https://live.douyin.com/987654" } });
    fireEvent.click(screen.getByRole("button", { name: "添加并检查直播状态" }));

    const addedRoom = await screen.findByRole("radio", { name: /新电商直播间/ });
    expect(addedRoom.getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("radio")[0]).toBe(addedRoom);
    expect(await screen.findByText("已捕获音频 · 正在转写")).toBeTruthy();
    expect((screen.getByRole("button", { name: "等待首条直播文字…" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(
      () => expect((screen.getByRole("button", { name: "运行样本测试" }) as HTMLButtonElement).disabled).toBe(false),
      { timeout: 2_500 },
    );
    expect(screen.getByText("1 条实时文字")).toBeTruthy();
    expect(window.duoduo.groups.create).toHaveBeenCalledWith("洞察测试", null);
    expect(window.duoduo.rooms.add).toHaveBeenCalledWith(expect.objectContaining({ groupId: "test-group" }));
    expect(window.duoduo.parsers.prepareSample).toHaveBeenCalledWith("987654");
    expect(window.duoduo.groups.start).not.toHaveBeenCalled();
    expect(window.duoduo.rooms.probe).not.toHaveBeenCalled();
  });

  it("does not interrupt another running group when adding a test room", async () => {
    vi.mocked(window.duoduo.groups.list).mockResolvedValue({
      activeRun: { groupId: "default" },
      groups: [{ id: "default", name: "默认分组", parserId: null, position: 0, roomCount: 1, createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z" }],
    });
    vi.mocked(window.duoduo.groups.create).mockResolvedValue({
      activeRun: { groupId: "default" },
      groups: [
        { id: "default", name: "默认分组", parserId: null, position: 0, roomCount: 1, createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z" },
        { id: "test-group", name: "洞察测试", parserId: null, position: 1, roomCount: 0, createdAt: "2026-07-21T00:00:00.000Z", updatedAt: "2026-07-21T00:00:00.000Z" },
      ],
    });
    render(<ParserManagement rooms={[]} snapshots={[]} />);
    await screen.findByText("解析器列表");
    fireEvent.click(screen.getByRole("button", { name: "新建内容洞察" }));
    fireEvent.change(screen.getByLabelText("描述需要记录或提醒的内容"), { target: { value: "提到商品降价时提醒我" } });
    fireEvent.click(screen.getByRole("button", { name: "发送需求" }));
    fireEvent.click(await screen.findByRole("button", { name: "下一步：选择样本" }));
    fireEvent.change(await screen.findByLabelText("抖音直播间链接"), { target: { value: "https://live.douyin.com/987654" } });
    fireEvent.click(screen.getByRole("button", { name: "添加并检查直播状态" }));

    expect(await screen.findByText(/已捕获直播音频/)).toBeTruthy();
    expect(window.duoduo.parsers.prepareSample).toHaveBeenCalledWith("987654");
    expect(window.duoduo.groups.start).not.toHaveBeenCalled();
  });

  it("publishes only after a passed test and explicit replacement confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ParserManagement rooms={[]} snapshots={[]} />);
    await screen.findByText("解析器列表");
    fireEvent.click(screen.getByRole("button", { name: "新建内容洞察" }));
    fireEvent.change(screen.getByLabelText("描述需要记录或提醒的内容"), {
      target: { value: "提到商品降价时提醒我" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送需求" }));
    fireEvent.click(await screen.findByRole("button", { name: "下一步：选择样本" }));
    fireEvent.click(await screen.findByRole("button", { name: "运行样本测试" }));
    fireEvent.click(await screen.findByRole("button", { name: "确认发布并替换" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(window.duoduo.parsers.publishTested).toHaveBeenCalledWith(expect.objectContaining({
      testToken: "pass-token",
    }));
    expect(await screen.findByText(/已发布，当前分析器已安全替换/)).toBeTruthy();
  });

  it("shows a legacy parser as its complete materialized prompt", async () => {
    render(<ParserManagement rooms={[]} snapshots={[]} />);
    fireEvent.click(await screen.findByRole("button", { name: "查看" }));
    const prompt = screen.getByLabelText("解析器提示词") as HTMLTextAreaElement;
    const view = prompt.closest("section");
    expect(view?.classList.contains("parser-view")).toBe(true);
    expect(prompt.parentElement?.classList.contains("parser-view-prompt")).toBe(
      true,
    );
    expect(prompt.readOnly).toBe(true);
    expect(prompt.value).toContain("观众提问，除非主播随后明确回答并认可");
    expect(prompt.value).toContain("附加规则：只提取有证据的观点");
  });

});
