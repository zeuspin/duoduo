import { useEffect, useState } from "react";
import type {
  AnalyzerAgentDraft,
  AnalyzerAgentMessage,
  AnalyzerAgentResponse,
  AnalyzerDraftTestResponse,
  AnalyzerSampleList,
  AnalyzerSampleOption,
  ContentRecord,
  ImmutableParser,
  Room,
  RoomGroup,
  RoomSnapshot,
} from "../../shared/contracts";
import { materializeParserPrompt } from "../../shared/parser-prompt";
import { AnalyzerChat } from "./AnalyzerChat";

interface ParserSnapshot {
  parsers: ImmutableParser[];
  llmConfigured: boolean;
}

export function ParserManagement({
  rooms: _rooms,
  snapshots: _snapshots,
}: {
  rooms: Room[];
  snapshots: RoomSnapshot[];
}) {
  const [data, setData] = useState<ParserSnapshot>({
    parsers: [],
    llmConfigured: false,
  });
  const [viewing, setViewing] = useState<ImmutableParser>();
  const [creating, setCreating] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AnalyzerAgentMessage[]>([]);
  const [agentInput, setAgentInput] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentDraft, setAgentDraft] = useState<AnalyzerAgentDraft>();
  const [agentReady, setAgentReady] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [creationStage, setCreationStage] = useState<"define" | "sample" | "result">("define");
  const [samples, setSamples] = useState<AnalyzerSampleOption[]>([]);
  const [selectedSampleRoomId, setSelectedSampleRoomId] = useState("");
  const [sampleBusy, setSampleBusy] = useState(false);
  const [sampleRoomUrl, setSampleRoomUrl] = useState("");
  const [sampleRoomBusy, setSampleRoomBusy] = useState(false);
  const [sampleRoomMessage, setSampleRoomMessage] = useState("");
  const [preparedSampleRoomId, setPreparedSampleRoomId] = useState("");
  const [testResult, setTestResult] = useState<AnalyzerDraftTestResponse>();
  const [publishBusy, setPublishBusy] = useState(false);
  const [recentRecords, setRecentRecords] = useState<ContentRecord[]>([]);
  const [message, setMessage] = useState("");
  const refresh = async () =>
    setData((await window.duoduo.parsers.list()) as ParserSnapshot);

  useEffect(() => {
    void refresh();
    void window.duoduo.contentRecords.list({ limit: 20 }).then((value) =>
      setRecentRecords((value as { items: ContentRecord[] }).items),
    );
    return window.duoduo.contentRecords.subscribe((value) =>
      setRecentRecords((value as { items: ContentRecord[] }).items),
    );
  }, []);

  useEffect(() => () => {
    void window.duoduo.parsers.stopSampleCapture();
  }, []);

  const discuss = async () => {
    const content = agentInput.trim();
    if (!content || agentBusy) return;
    const nextMessages: AnalyzerAgentMessage[] = [
      ...agentMessages,
      { role: "user", content },
    ];
    setAgentMessages(nextMessages);
    setAgentInput("");
    setAgentBusy(true);
    setAgentError("");
    try {
      const response = (await window.duoduo.parsers.discuss({
        messages: nextMessages,
      })) as AnalyzerAgentResponse;
      const assistantContent =
        response.status === "needs_clarification"
          ? response.questions.map((question, index) => `${index + 1}. ${question}`).join("\n")
          : `需求已经整理成“${response.draft.name}”草稿。确认后需要使用直播间 ASR 样本测试，通过后才会替换当前分析器。`;
      setAgentMessages([
        ...nextMessages,
        { role: "assistant", content: assistantContent },
      ]);
      setAgentDraft(response.draft);
      setAgentReady(response.status === "ready");
      setCreationStage("define");
      setTestResult(undefined);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setAgentError(
        detail.includes("LLM_NOT_CONFIGURED") || detail.includes("LLM_SECRET_MISSING")
          ? "请先在系统设置中完成百炼模型与 API Key 配置。"
          : "创建助手暂时无法完成这次整理，请稍后重试。",
      );
    } finally {
      setAgentBusy(false);
    }
  };

  const loadSamples = async (preferredRoomId?: string) => {
    setSampleBusy(true);
    setAgentError("");
    try {
      const response = (await window.duoduo.parsers.listSamples()) as AnalyzerSampleList;
      setSamples(response.samples);
      setSelectedSampleRoomId((current) =>
        response.samples.some((item) => item.roomId === (preferredRoomId ?? current))
          ? (preferredRoomId ?? current)
          : response.samples.find((item) => item.source === "history")?.roomId ?? "",
      );
      setCreationStage("sample");
    } catch {
      setAgentError("无法读取直播文字样本，请稍后重试。");
    } finally {
      setSampleBusy(false);
    }
  };

  const selectedSample = samples.find((item) => item.roomId === selectedSampleRoomId);
  const orderedSamples = selectedSampleRoomId
    ? [
        ...samples.filter((item) => item.roomId === selectedSampleRoomId),
        ...samples.filter((item) => item.roomId !== selectedSampleRoomId),
      ]
    : samples;

  useEffect(() => {
    if (!preparedSampleRoomId || selectedSample?.roomId !== preparedSampleRoomId) return;
    if (selectedSample.captureState === "text_ready")
      setSampleRoomMessage("已获得直播文字，可以运行样本测试。");
    else if (selectedSample.captureState === "audio_ready")
      setSampleRoomMessage("已捕获直播音频，正在生成首条直播文字。");
    else if (selectedSample.status === "live")
      setSampleRoomMessage("已确认正在直播，正在连接音频流。");
    else if (selectedSample.status === "offline")
      setSampleRoomMessage("已完成状态检查，但直播间当前未开播。");
  }, [preparedSampleRoomId, selectedSample?.captureState, selectedSample?.roomId, selectedSample?.source, selectedSample?.status]);

  useEffect(() => {
    if (
      creationStage !== "sample" ||
      !selectedSampleRoomId ||
      selectedSample?.captureState === "text_ready"
    ) return;
    let cancelled = false;
    const refreshPendingSample = async () => {
      try {
        const response = (await window.duoduo.parsers.listSamples()) as AnalyzerSampleList;
        if (cancelled) return;
        setSamples(response.samples);
        setSelectedSampleRoomId((current) =>
          response.samples.some((item) => item.roomId === current) ? current : "",
        );
      } catch { /* Keep the current state and retry while the sample is being prepared. */ }
    };
    const timer = window.setInterval(() => void refreshPendingSample(), 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [creationStage, selectedSampleRoomId, selectedSample?.captureState]);

  const runSampleTest = async () => {
    if (!agentDraft || !selectedSampleRoomId || selectedSample?.captureState !== "text_ready" || sampleBusy) return;
    setSampleBusy(true);
    setAgentError("");
    try {
      await window.duoduo.parsers.stopSampleCapture(selectedSampleRoomId);
      const response = (await window.duoduo.parsers.testDraft({
        draft: agentDraft,
        roomId: selectedSampleRoomId,
      })) as AnalyzerDraftTestResponse;
      setTestResult(response);
      setCreationStage("result");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setAgentError(
        detail.includes("ANALYZER_SAMPLE_EMPTY")
          ? "这个直播间还没有可用文字，请等待产生 ASR 后刷新样本。"
          : detail.includes("ANALYZER_TEST_EVIDENCE_INVALID")
            ? "模型返回的证据无法在原文中核对，测试未通过，请重试。"
            : "样本测试暂时失败，请稍后重试或更换直播间。",
      );
    } finally {
      setSampleBusy(false);
    }
  };

  const addSampleRoom = async () => {
    const url = sampleRoomUrl.trim();
    if (!url || sampleRoomBusy) return;
    setSampleRoomBusy(true);
    setAgentError("");
    setSampleRoomMessage("");
    try {
      let groupSnapshot = (await window.duoduo.groups.list()) as {
        groups: RoomGroup[];
        activeRun?: { groupId: string };
      };
      let targetGroup = groupSnapshot.groups.find(
        (group) => group.name.startsWith("洞察测试") && group.roomCount < 9 && group.id !== groupSnapshot.activeRun?.groupId,
      );
      if (!targetGroup) {
        const existingNames = new Set(groupSnapshot.groups.map((group) => group.name));
        let groupName = "洞察测试";
        let suffix = 2;
        while (existingNames.has(groupName)) groupName = `洞察测试 ${suffix++}`;
        groupSnapshot = (await window.duoduo.groups.create(groupName, null)) as {
          groups: RoomGroup[];
          activeRun?: { groupId: string };
        };
        targetGroup = groupSnapshot.groups.find((group) => group.name === groupName);
      }
      if (!targetGroup) throw new Error("ANALYZER_TEST_GROUP_CREATE_FAILED");

      const room = (await window.duoduo.rooms.add({
        url,
        schedule: null,
        groupId: targetGroup.id,
      })) as Room;
      setSelectedSampleRoomId(room.roomId);
      setPreparedSampleRoomId(room.roomId);
      setSamples((current) => [{
        roomId: room.roomId,
        label: `直播间 ${room.roomId}`,
        status: "checking",
        source: "no_asr",
        captureState: "checking",
        asrCount: 0,
      }, ...current.filter((item) => item.roomId !== room.roomId)]);
      await window.duoduo.rooms.setAutoMonitorOnLive(room.roomId, true);
      setSampleRoomUrl("");
      setSampleRoomMessage(`已选中直播间 ${room.roomId}，正在获取直播状态并连接音频。`);
      const response = (await window.duoduo.parsers.prepareSample(room.roomId)) as AnalyzerSampleList;
      setSamples(response.samples);
      setSelectedSampleRoomId(room.roomId);
      const prepared = response.samples.find((item) => item.roomId === room.roomId);
      setSampleRoomMessage(
        prepared?.captureState === "text_ready"
          ? "已获得直播文字，可以运行样本测试。"
          : prepared?.captureState === "audio_ready"
            ? "已捕获直播音频，正在生成首条直播文字。"
            : prepared?.status === "live"
              ? "已确认正在直播，正在连接音频流。"
              : "已完成状态检查，但直播间当前未开播。",
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setAgentError(
        detail.includes("ROOM_EXISTS")
          ? "这个直播间已经在列表中，可直接刷新后选择。"
          : detail.includes("INVALID_DOUYIN") || detail.includes("URL")
            ? "请输入有效的抖音直播间链接。"
            : detail.includes("ASR_NOT_CONFIGURED") || detail.includes("ASR_SECRET")
              ? "直播间已添加，但无法启动音频转写。请先在系统设置中配置百炼 ASR。"
            : "暂时无法添加这个直播间，请稍后重试。",
      );
    } finally {
      setSampleRoomBusy(false);
    }
  };

  const publishTestedAnalyzer = async () => {
    if (!agentDraft || !testResult?.testToken || publishBusy) return;
    if (!window.confirm(
      `发布“${agentDraft.name}”并替换当前唯一的内容分析器？旧版本会保留在历史记录中，现有内容记录不会删除。`,
    )) return;
    setPublishBusy(true);
    setAgentError("");
    try {
      setData((await window.duoduo.parsers.publishTested({
        draft: agentDraft,
        testToken: testResult.testToken,
      })) as ParserSnapshot);
      await window.duoduo.parsers.stopSampleCapture();
      setCreating(false);
      setMessage(`“${agentDraft.name}”已发布，当前分析器已安全替换`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setAgentError(
        detail.includes("ANALYZER_TEST_TOKEN_EXPIRED")
          ? "测试凭证已过期，请重新运行样本测试。"
          : detail.includes("ANALYZER_DRAFT_CHANGED_AFTER_TEST")
            ? "草稿在测试后发生了变化，请重新测试。"
            : "发布失败，当前分析器没有变化。",
      );
    } finally {
      setPublishBusy(false);
    }
  };

  const closeCreation = () => {
    void window.duoduo.parsers.stopSampleCapture();
    setCreating(false);
  };

  const returnToDefinition = () => {
    void window.duoduo.parsers.stopSampleCapture();
    setCreationStage("define");
  };

  return (
    <div className="parser-page">
      <div className="heading">
        <div>
          <h1>内容洞察</h1>
          <p>系统只保留一个内容分析器；提示词只读，自定义创建必须通过受控 Agent 和样本测试。</p>
        </div>
        <button className="primary" type="button" onClick={() => setCreating(true)}>
          新建内容洞察
        </button>
      </div>

      {creating && (
        <section className="parser-panel analyzer-agent-panel">
          <div className="parser-panel-head analyzer-agent-head">
            <div>
              <b>{data.parsers.length > 0 ? "创建新版内容洞察" : "创建内容洞察"}</b>
              <span>由系统规则约束，不直接编辑提示词</span>
            </div>
            <button type="button" onClick={closeCreation}>关闭</button>
          </div>
          <ol className="analyzer-agent-steps" aria-label="内容洞察创建步骤">
            <li className="active">1 描述需求</li>
            <li className={agentMessages.length > 0 ? "active" : ""}>2 补充信息</li>
            <li className={creationStage !== "define" ? "active" : ""}>3 样本测试</li>
            <li className={testResult?.status === "passed" ? "ready" : ""}>4 发布替换</li>
          </ol>
          {creationStage === "define" && <div className="analyzer-agent-body">
            <section className="analyzer-conversation-pane" aria-label="需求对话">
              <div className="analyzer-pane-head">
                <div><b>需求对话</b><small>创建助手只讨论需要记录和提醒的内容</small></div>
                <span>{agentMessages.filter((item) => item.role === "user").length} 次回复</span>
              </div>
              <AnalyzerChat messages={agentMessages} busy={agentBusy} />
              <form
                className="analyzer-agent-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void discuss();
                }}
              >
                <label htmlFor="analyzer-agent-input">描述需要记录或提醒的内容</label>
                <textarea
                  id="analyzer-agent-input"
                  value={agentInput}
                  onChange={(event) => setAgentInput(event.target.value)}
                  placeholder="直接说希望记录什么，或补充助手刚才询问的信息…"
                  disabled={agentBusy || !data.llmConfigured}
                />
                <div>
                  {!data.llmConfigured && <span>需要先配置百炼模型</span>}
                  {agentError && <span className="agent-error">{agentError}</span>}
                  <small>分析器发布后可应用到其他直播间</small>
                  <button className="primary" type="submit" disabled={!agentInput.trim() || agentBusy || !data.llmConfigured}>
                    {agentBusy ? "整理中…" : agentMessages.length > 0 ? "回复助手" : "发送需求"}
                  </button>
                </div>
              </form>
            </section>

            <aside className="analyzer-action-pane" aria-label="草稿与操作">
              <div className="analyzer-pane-head">
                <div><b>草稿与操作</b><small>这里不会直接编辑系统提示词</small></div>
              </div>
              {agentReady && agentDraft ? (
                <div className="analyzer-draft">
                  <small>待测试草稿</small>
                  <h3>{agentDraft.name}</h3>
                  <p>{agentDraft.purpose}</p>
                  <dl>
                    <div><dt>记录类型</dt><dd>{agentDraft.resultTypes.map((item) => item.label).join("、")}</dd></div>
                    <div><dt>提醒规则</dt><dd>{agentDraft.alertRules.length > 0 ? agentDraft.alertRules.join("；") : "不主动提醒"}</dd></div>
                  </dl>
                  <button type="button" onClick={() => void loadSamples()} disabled={sampleBusy}>
                    {sampleBusy ? "正在读取样本…" : "下一步：选择样本"}
                  </button>
                  <small>当前分析器保持生效，样本测试通过前不会被替换。</small>
                </div>
              ) : (
                <div className="analyzer-draft-empty">
                  <b>等待形成草稿</b>
                  <p>描述需要记录或提醒的内容。信息足够后，系统会在这里生成可测试的结构化草稿。</p>
                  <ul>
                    <li>不要求用户编写提示词</li>
                    <li>不绑定创建时的直播间</li>
                    <li>通过真实样本后才能发布</li>
                  </ul>
                </div>
              )}
            </aside>
          </div>}

          {creationStage === "sample" && (
            <div className="analyzer-sample-stage">
              <div className="analyzer-sample-layout">
                <section className="analyzer-sample-source-pane">
                  <div className="analyzer-stage-heading">
                    <div>
                      <b>选择一段真实直播文字</b>
                      <p>历史样本不合适时，可以在右侧添加新的直播间进行测试。</p>
                    </div>
                    <button type="button" onClick={() => void loadSamples()} disabled={sampleBusy}>刷新样本</button>
                  </div>
                  <div className="analyzer-sample-list" role="radiogroup" aria-label="选择测试直播间">
                    {orderedSamples.map((sample) => (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selectedSampleRoomId === sample.roomId}
                        className={selectedSampleRoomId === sample.roomId ? "selected" : ""}
                        onClick={() => setSelectedSampleRoomId(sample.roomId)}
                        key={sample.roomId}
                      >
                        <span><b>{sample.label}</b><small>直播间 {sample.roomId}</small></span>
                        <span className={`sample-status ${sample.source}`}>
                          {sample.source === "history"
                            ? `${sample.asrCount} 条历史文字`
                            : sample.captureState === "text_ready"
                              ? `${sample.asrCount} 条实时文字`
                            : sample.captureState === "audio_ready"
                              ? "已捕获音频 · 正在转写"
                              : sample.captureState === "connecting"
                                ? "直播中 · 正在连接音频"
                                : sample.source === "live_waiting"
                                  ? "直播中 · 正在采集"
                              : sample.status === "checking"
                                ? "正在检查"
                                : sample.status === "offline"
                                  ? "当前未直播"
                                  : "暂无直播文字"}
                        </span>
                        <small>{sample.lastAsrAt ? `最近文字 ${formatSampleTime(sample.lastAsrAt)}` : sample.captureState === "audio_ready" ? "首条直播文字生成后即可测试" : sample.source === "live_waiting" ? "捕获音频并生成文字后即可测试" : "直播后会自动采集测试文字"}</small>
                      </button>
                    ))}
                    {samples.length === 0 && (
                      <div className="analyzer-sample-empty">当前没有可用 ASR。可在右侧添加一个正在直播的直播间链接。</div>
                    )}
                  </div>
                </section>

                <aside className="analyzer-sample-add" aria-label="添加测试直播间">
                  <small>没有合适样本？</small>
                  <h3>添加新的直播间</h3>
                  <p>新链接会加入独立的“洞察测试”分组并立即选中。系统马上检查直播状态；确认直播后直接捕获音频并生成测试文字，不需要切换当前业务分组。</p>
                  <form onSubmit={(event) => { event.preventDefault(); void addSampleRoom(); }}>
                    <label htmlFor="analyzer-sample-room-url">抖音直播间链接</label>
                    <input
                      id="analyzer-sample-room-url"
                      type="url"
                      value={sampleRoomUrl}
                      onChange={(event) => setSampleRoomUrl(event.target.value)}
                      placeholder="https://live.douyin.com/123456"
                      disabled={sampleRoomBusy}
                    />
                    <button className="primary" type="submit" disabled={!sampleRoomUrl.trim() || sampleRoomBusy}>
                      {sampleRoomBusy ? "正在添加并检查…" : "添加并检查直播状态"}
                    </button>
                  </form>
                  {sampleRoomMessage && <div className="analyzer-sample-add-message">{sampleRoomMessage}</div>}
                  <ul>
                    <li>已有历史样本仍可直接选择</li>
                    <li>不会自动替换当前分析器</li>
                    <li>其他分组运行时也可独立采集测试样本</li>
                  </ul>
                </aside>
              </div>
              {agentError && <p className="analyzer-stage-error">{agentError}</p>}
              <div className="analyzer-stage-actions">
                <button type="button" onClick={returnToDefinition}>返回修改需求</button>
                <button className="primary" type="button" disabled={!selectedSampleRoomId || selectedSample?.captureState !== "text_ready" || sampleBusy} onClick={() => void runSampleTest()}>
                  {sampleBusy ? "正在运行测试…" : selectedSample && selectedSample.captureState !== "text_ready" ? "等待首条直播文字…" : "运行样本测试"}
                </button>
              </div>
            </div>
          )}

          {creationStage === "result" && testResult && (
            <div className="analyzer-result-stage">
              <div className={`analyzer-test-summary ${testResult.status}`}>
                <div>
                  <small>{testResult.status === "passed" ? "测试通过" : "样本不足"}</small>
                  <h3>{testResult.message}</h3>
                  <p>已检查 {testResult.sampleCount} 条 ASR、{testResult.sampleCharacters} 个字符；结构、结果类型和逐字证据均已校验。</p>
                </div>
                <b>{testResult.records.length}</b>
              </div>
              <div className="analyzer-test-records">
                {testResult.records.map((record, index) => (
                  <article key={`${record.resultTypeId}-${index}`}>
                    <div className="analyzer-test-record-head"><span>{record.resultTypeLabel}</span><small>可信度 {Math.round(record.confidence * 100)}%</small></div>
                    <h4>{record.title}</h4>
                    {record.summary && <p>{record.summary}</p>}
                    {Object.keys(record.fields).some((field) => field !== "original_quote") && (
                      <dl>{Object.entries(record.fields).filter(([field]) => field !== "original_quote").map(([field, value]) => <div key={field}><dt>{agentDraft?.fields.find((item) => item.id === field)?.label ?? field}</dt><dd>{Array.isArray(value) ? value.join("、") : String(value)}</dd></div>)}</dl>
                    )}
                    <details className="analyzer-test-evidence">
                      <summary>查看逐字原文（{record.evidence.length} 段）</summary>
                      <blockquote>“{record.evidence.join("；")}”</blockquote>
                    </details>
                  </article>
                ))}
                {testResult.records.length === 0 && <div className="analyzer-sample-empty">这段样本没有出现目标内容，不能据此判断分析器是否能正确召回。</div>}
              </div>
              {agentError && <p className="analyzer-stage-error">{agentError}</p>}
              <div className="analyzer-stage-actions">
                <button type="button" onClick={returnToDefinition}>返回修改需求</button>
                <button type="button" onClick={() => setCreationStage("sample")}>更换样本</button>
                <button type="button" onClick={() => void runSampleTest()} disabled={sampleBusy}>{sampleBusy ? "正在复测…" : "重新测试"}</button>
                <button
                  className="primary"
                  type="button"
                  disabled={testResult.status !== "passed" || !testResult.testToken || publishBusy}
                  onClick={() => void publishTestedAnalyzer()}
                >
                  {publishBusy ? "正在发布…" : testResult.status === "passed" ? "确认发布并替换" : "测试通过后才能发布"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="parser-panel">
        <div className="parser-panel-head">
          <b>解析器列表</b>
          <span>{data.parsers.length} 个可用解析器</span>
        </div>
        <div className="parser-table">
          {data.parsers.map((parser) => (
            <div className="parser-tr" key={parser.id}>
              <div>
                <b>{parser.spec.name}</b>
                <small>完整提示词 · 保存后不可编辑</small>
              </div>
              <span>使用系统内容分析模型</span>
              <span>{new Date(parser.createdAt).toLocaleDateString()}</span>
              <div className="parser-actions">
                <button onClick={() => setViewing(parser)}>查看</button>
              </div>
            </div>
          ))}
        </div>
        {data.parsers.length === 0 && <p>系统分析器尚未初始化，请重新启动应用。</p>}
      </section>

      {recentRecords.length > 0 && (
        <section className="parser-panel content-record-panel">
          <div className="parser-panel-head">
            <b>最近内容记录</b>
            <span>由当前通用内容分析器生成</span>
          </div>
          <div className="content-record-list">
            {recentRecords.map((record) => (
              <article key={record.id}>
                <time>{formatSampleTime(record.startedAt)}</time>
                <div>
                  <small>{record.resultTypeLabel}</small>
                  <h3>{record.title}</h3>
                  {record.summary && <p>{record.summary}</p>}
                  <blockquote>原文：“{record.evidence.join("；")}”</blockquote>
                </div>
                <span className={record.alertLevel}>{record.alertLevel === "important" ? "重点提醒" : record.alertLevel === "normal" ? "提醒" : "仅记录"}</span>
              </article>
            ))}
          </div>
        </section>
      )}

      {viewing && (
        <section className="parser-panel editor-panel parser-view">
          <div className="parser-panel-head">
            <b>{viewing.spec.name}</b>
            <button onClick={() => setViewing(undefined)}>关闭</button>
          </div>
          <label className="parser-view-prompt">
            完整提示词
            <textarea
              aria-label="解析器提示词"
              readOnly
              value={materializeParserPrompt(viewing.spec)}
            />
          </label>
          <div className="editor-actions">
            <button
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(materializeParserPrompt(viewing.spec))
                  .then(() => setMessage("提示词已复制"))
              }
            >
              复制提示词
            </button>
          </div>
        </section>
      )}

      {message && (
        <div className="toast">
          {message}
          <button onClick={() => setMessage("")}>×</button>
        </div>
      )}
    </div>
  );
}

function formatSampleTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
