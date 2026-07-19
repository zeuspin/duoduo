import { Check, Flask, PencilSimple, Trash, Warning } from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { LlmProviderConfig, ParserDefinition, ParserSpec, ParserTestRun, Room, RoomParserBinding, RoomSnapshot } from "../../shared/contracts";

interface ParserSnapshot { definitions: ParserDefinition[]; bindings: RoomParserBinding[]; tests: ParserTestRun[]; llmConfigured: boolean }
const objectives: Array<[ParserSpec["objectives"][number], string]> = [["sector_direction", "板块方向"], ["market_indicator", "大盘指标解读"], ["volume_and_funds", "量价与资金"], ["market_sentiment", "市场情绪"], ["conditional_view", "条件性判断"], ["risk_signal", "风险信号"]];
const filters: Array<[ParserSpec["filters"][number], string]> = [["greeting", "寒暄互动"], ["audience_question", "观众提问"], ["unendorsed_quote", "未认可的转述"], ["advertising", "广告引导"], ["unsupported_sentiment", "无依据情绪词"], ["duplicate_view", "重复观点"]];
const testStatusLabels: Record<string, string> = { running: "测试中", completed: "测试完成", failed: "测试失败" };

export function ParserManagement({ rooms, snapshots }: { rooms: Room[]; snapshots: RoomSnapshot[] }) {
  const [data, setData] = useState<ParserSnapshot>({ definitions: [], bindings: [], tests: [], llmConfigured: false });
  const [editing, setEditing] = useState<ParserDefinition>();
  const [message, setMessage] = useState("");
  const [llm, setLlm] = useState<LlmProviderConfig>({ type: "bailian", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus", secretId: "llm-main" });
  const [secret, setSecret] = useState("");
  const [testRoom, setTestRoom] = useState(rooms[0]?.roomId ?? "");
  const refresh = async () => setData(await window.duoduo.parsers.list() as ParserSnapshot);
  useEffect(() => { void refresh(); void window.duoduo.llm.get().then((value) => { if (value) setLlm(value as LlmProviderConfig); }); }, []);

  async function beginEdit(parser: ParserDefinition) {
    const next = parser.draftVersion ? data : await window.duoduo.parsers.createDraft(parser.id) as ParserSnapshot;
    setData(next); setEditing(next.definitions.find((item) => item.id === parser.id));
  }
  async function bind(roomId: string, value: string) {
    const [parserId, version] = value.split(":");
    setData(await window.duoduo.parsers.bindRoom(roomId, value === "none" ? null : parserId, value === "none" ? null : Number(version)) as ParserSnapshot);
    setMessage(value === "none" ? "该直播间将仅保存直播文字" : "直播间分析规则已更新");
  }
  async function saveLlm(event: FormEvent) { event.preventDefault(); await window.duoduo.llm.save(llm, secret); setSecret(""); setMessage("内容分析服务设置已保存"); await refresh(); }
  async function testLlm() { const result = await window.duoduo.llm.test(llm, secret) as { message: string }; setMessage(result.message); }
  const latestTest = data.tests[0];

  return <div className="parser-page">
    <div className="heading"><div><h1>内容分析规则</h1><p>设置需要关注的内容，并选择应用这些规则的直播间。</p></div></div>
    <section className="parser-panel"><div className="parser-panel-head"><b>内容分析服务</b><span>{data.llmConfigured ? "已设置" : "设置后才能产生观点"}</span></div><form className="llm-row" onSubmit={saveLlm}><select value={llm.type} onChange={(event) => setLlm(event.target.value === "bailian" ? { type: "bailian", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus", secretId: "llm-main" } : { type: "openai-compatible", endpoint: "https://", model: "", auth: "bearer", secretId: "llm-main" })}><option value="bailian">阿里云百炼</option><option value="openai-compatible">OpenAI-compatible</option></select>{llm.type === "openai-compatible" && <input className="endpoint-input" aria-label="模型接口地址" value={llm.endpoint} onChange={(event) => setLlm({ ...llm, endpoint: event.target.value })} placeholder="https://gateway.example/v1/chat/completions" />}<input aria-label="模型" value={llm.model} onChange={(event) => setLlm({ ...llm, model: event.target.value })} placeholder="模型名" /><input aria-label="模型 API Key" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="API Key（留空则使用已保存值）" /><button type="button" onClick={() => void testLlm()}>测试连接</button><button className="primary" type="submit">保存</button></form></section>
    <section className="parser-panel"><div className="parser-panel-head"><b>分析规则</b><span>已启用版本与测试草稿相互独立</span></div><div className="parser-table"><div className="parser-tr parser-th"><span>分析规则</span><span>版本</span><span>使用直播间</span><span>操作</span></div>{data.definitions.map((parser) => <div className="parser-tr" key={parser.id}><div><b>{parser.name}</b><small>{parser.description}</small></div><span>{parser.publishedVersion ? `已启用 v${parser.publishedVersion.version}` : "未启用"}{parser.draftVersion && <i>草稿 v{parser.draftVersion.version}</i>}</span><b>{data.bindings.filter((binding) => binding.parserId === parser.id).length} 路</b><div className="parser-actions"><button onClick={() => void beginEdit(parser)}><PencilSimple />编辑</button>{parser.draftVersion && <button onClick={() => void window.duoduo.parsers.removeDraft(parser.id).then(refresh)}><Trash />删除草稿</button>}</div></div>)}</div></section>
    {editing?.draftVersion && <ParserEditor parser={editing} rooms={rooms} testRoom={testRoom} setTestRoom={setTestRoom} onUpdated={(next) => { setData(next); setEditing(next.definitions.find((item) => item.id === editing.id)); }} onMessage={setMessage} />}
    <section className="parser-panel"><div className="parser-panel-head"><b>应用到直播间</b><span>每个直播间最多使用一条分析规则</span></div><div className="binding-list">{rooms.map((room) => { const snapshot = snapshots.find((item) => item.roomId === room.roomId); const binding = data.bindings.find((item) => item.roomId === room.roomId); return <div className="binding-row" key={room.roomId}><div><b>{snapshot?.anchorName || snapshot?.title || `直播间 ${room.roomId}`}</b><small>{room.monitoring ? "正在监看 · 正在记录直播文字" : "未监看"}</small></div><select aria-label={`直播间 ${room.roomId} 的分析规则`} value={binding ? `${binding.parserId}:${binding.parserVersionId}` : "none"} onChange={(event) => void bind(room.roomId, event.target.value)}><option value="none">不分析（仅保存直播文字）</option>{data.definitions.flatMap((parser) => parser.publishedVersion ? [<option value={`${parser.id}:${parser.publishedVersion.id}`} key={parser.id}>{parser.name} v{parser.publishedVersion.version}</option>] : [])}</select><span className={binding ? "binding-on" : "binding-off"}>{binding ? "正在分析" : "仅保存直播文字"}</span></div>; })}</div></section>
    {latestTest && <section className="parser-panel"><div className="parser-panel-head"><b>最近对照测试</b><span>{testStatusLabels[latestTest.status] ?? "状态更新中"}</span></div><div className="compare-grid"><div><h3>当前启用版本</h3>{latestTest.publishedResults.map((item, index) => <p key={index}>{item.summary}</p>)}</div><div><h3>测试草稿</h3>{latestTest.draftResults.map((item, index) => <p key={index}>{item.summary}</p>)}</div></div></section>}
    {message && <div className="toast">{message}<button onClick={() => setMessage("")}>×</button></div>}
  </div>;
}

function ParserEditor({ parser, rooms, testRoom, setTestRoom, onUpdated, onMessage }: { parser: ParserDefinition; rooms: Room[]; testRoom: string; setTestRoom(value: string): void; onUpdated(value: ParserSnapshot): void; onMessage(value: string): void }) {
  const draft = parser.draftVersion!; const [spec, setSpec] = useState(draft.spec);
  const toggle = <T extends string>(values: T[], value: T) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  async function save() { onUpdated(await window.duoduo.parsers.updateDraft(draft.id, spec) as ParserSnapshot); onMessage(`测试草稿 v${draft.version} 已保存，当前启用版本未受影响`); }
  async function run() { if (!testRoom) return; onUpdated(await window.duoduo.parsers.runTest(parser.id, testRoom, 50) as ParserSnapshot); onMessage("相同直播文字样本的对照已完成"); }
  async function publish() { if (!confirm(`启用 v${draft.version}？使用这条规则的直播间将从下一段文字起使用新版本。`)) return; onUpdated(await window.duoduo.parsers.publish(parser.id, draft.id) as ParserSnapshot); onMessage(`v${draft.version} 已启用`); }
  return <section className="parser-panel editor-panel"><div className="parser-panel-head"><b>编辑测试草稿 v{draft.version}</b><span>不会影响当前启用版本</span></div><div className="parser-editor"><label>分析规则名称<input value={spec.name} onChange={(event) => setSpec({ ...spec, name: event.target.value })} /></label><label>说明<input value={spec.description} onChange={(event) => setSpec({ ...spec, description: event.target.value })} /></label><fieldset><legend>关注内容</legend>{objectives.map(([value, label]) => <label key={value}><input type="checkbox" checked={spec.objectives.includes(value)} onChange={() => setSpec({ ...spec, objectives: toggle(spec.objectives, value) })} />{label}</label>)}</fieldset><fieldset><legend>忽略内容</legend>{filters.map(([value, label]) => <label key={value}><input type="checkbox" checked={spec.filters.includes(value)} onChange={() => setSpec({ ...spec, filters: toggle(spec.filters, value) })} />{label}</label>)}</fieldset><label>模型<input value={spec.model} onChange={(event) => setSpec({ ...spec, model: event.target.value })} /></label><label>板块名称<select value={spec.normalization} onChange={(event) => setSpec({ ...spec, normalization: event.target.value as ParserSpec["normalization"] })}><option value="preserve">保留主播原话</option><option value="suggest">保留原话并建议标准名称</option><option value="strict">仅明确时规范化</option></select></label><details><summary>高级提示规则</summary><textarea value={spec.advancedPrompt} onChange={(event) => setSpec({ ...spec, advancedPrompt: event.target.value })} /></details><div className="editor-actions"><button onClick={() => void save()}><Check />保存草稿</button><select aria-label="测试直播间" value={testRoom} onChange={(event) => setTestRoom(event.target.value)}><option value="">选择历史直播文字</option>{rooms.map((room) => <option value={room.roomId} key={room.roomId}>直播间 {room.roomId}</option>)}</select><button onClick={() => void run()} disabled={!testRoom}><Flask />运行对照</button><button className="primary" onClick={() => void publish()}><Warning />启用 v{draft.version}</button></div></div></section>;
}
