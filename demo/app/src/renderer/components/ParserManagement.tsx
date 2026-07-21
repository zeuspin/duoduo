import { useEffect, useState, type FormEvent } from "react";
import type {
  ImmutableParser,
  ParserSpecV2,
  Room,
  RoomSnapshot,
} from "../../shared/contracts";
import {
  BAILIAN_PARSER_MODELS,
  DEFAULT_PARSER_MODEL_ID,
  getBailianParserModel,
  type BailianParserModel,
} from "../../shared/bailian-model-catalog";
import {
  DEFAULT_PARSER_PROMPT,
  materializeParserPrompt,
} from "../../shared/parser-prompt";

interface ParserSnapshot {
  parsers: ImmutableParser[];
  llmConfigured: boolean;
}

const emptyDraft = (): ParserSpecV2 => ({
  schemaVersion: 2,
  name: "",
  model: DEFAULT_PARSER_MODEL_ID,
  prompt: DEFAULT_PARSER_PROMPT,
});

const groupLabels: Record<BailianParserModel["vendor"], string> = {
  recommended: "推荐",
  qwen: "千问",
  deepseek: "DeepSeek",
  other: "其他",
};
const positionLabels: Record<BailianParserModel["position"], string> = {
  balanced: "均衡",
  quality: "高质量",
  economy: "低成本",
};

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
  const [sourceId, setSourceId] = useState<string>();
  const [draft, setDraft] = useState<ParserSpecV2>();
  const [message, setMessage] = useState("");
  const refresh = async () =>
    setData((await window.duoduo.parsers.list()) as ParserSnapshot);

  useEffect(() => {
    void refresh();
  }, []);

  async function saveParser(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setData(
      (await (sourceId
        ? window.duoduo.parsers.copy(sourceId, draft)
        : window.duoduo.parsers.create(draft))) as ParserSnapshot,
    );
    setDraft(undefined);
    setSourceId(undefined);
    setMessage("新解析器已创建；原解析器没有被修改");
  }

  async function remove(parser: ImmutableParser) {
    if (!confirm(`删除解析器“${parser.spec.name}”？历史分析结果不会删除。`))
      return;
    try {
      setData(
        (await window.duoduo.parsers.remove(parser.id)) as ParserSnapshot,
      );
    } catch (error) {
      setMessage(
        String(error).includes("PARSER_IN_USE")
          ? "该解析器正在被分组使用，请先切换分组解析器"
          : String(error),
      );
    }
  }

  function copyParser(parser: ImmutableParser) {
    setSourceId(parser.id);
    setDraft({
      schemaVersion: 2,
      name: `${parser.spec.name} 副本`,
      model: getBailianParserModel(parser.spec.model)
        ? parser.spec.model
        : DEFAULT_PARSER_MODEL_ID,
      prompt: materializeParserPrompt(parser.spec),
    });
    setViewing(undefined);
  }

  return (
    <div className="parser-page">
      <div className="heading">
        <div>
          <h1>内容解析器</h1>
          <p>提示词完整可见；创建后不可修改，需要调整时请复制新建。</p>
        </div>
        <button
          className="primary"
          onClick={() => {
            setSourceId(undefined);
            setDraft(emptyDraft());
          }}
        >
          新建解析器
        </button>
      </div>

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
              <span>模型：{parser.spec.model}</span>
              <span>{new Date(parser.createdAt).toLocaleDateString()}</span>
              <div className="parser-actions">
                <button onClick={() => setViewing(parser)}>查看</button>
                <button onClick={() => copyParser(parser)}>复制新建</button>
                <button onClick={() => void remove(parser)}>删除</button>
              </div>
            </div>
          ))}
        </div>
        {data.parsers.length === 0 && <p>暂无解析器，请新建一个后再为分组选择。</p>}
      </section>

      {viewing && (
        <section className="parser-panel editor-panel parser-view">
          <div className="parser-panel-head">
            <b>{viewing.spec.name}</b>
            <button onClick={() => setViewing(undefined)}>关闭</button>
          </div>
          <ModelPriceCard modelId={viewing.spec.model} />
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
            <button className="primary" onClick={() => copyParser(viewing)}>
              复制到新建
            </button>
          </div>
        </section>
      )}

      {draft && (
        <form className="parser-panel editor-panel" onSubmit={saveParser}>
          <div className="parser-panel-head">
            <b>{sourceId ? "从现有解析器新建" : "新建解析器"}</b>
            <span>保存后不可编辑</span>
          </div>
          <div className="parser-editor parser-editor-simple">
            <label>
              解析器名称
              <input
                aria-label="解析器名称"
                required
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
              />
            </label>
            <label>
              模型
              <select
                aria-label="模型"
                value={draft.model}
                onChange={(event) =>
                  setDraft({ ...draft, model: event.target.value })
                }
              >
                {Object.entries(groupLabels).map(([group, label]) => (
                  <optgroup label={label} key={group}>
                    {BAILIAN_PARSER_MODELS.filter(
                      (model) => model.vendor === group,
                    ).map((model) => (
                      <option value={model.id} key={model.id}>
                        {model.label} · {positionLabels[model.position]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <ModelPriceCard modelId={draft.model} />
            <label className="parser-prompt-field">
              用户提示词
              <textarea
                aria-label="用户提示词"
                required
                value={draft.prompt}
                onChange={(event) =>
                  setDraft({ ...draft, prompt: event.target.value })
                }
              />
            </label>
            <div className="editor-actions">
              <button
                type="button"
                onClick={() => {
                  setDraft(undefined);
                  setSourceId(undefined);
                }}
              >
                取消
              </button>
              <button className="primary" type="submit">
                创建并保存
              </button>
            </div>
          </div>
        </form>
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

function ModelPriceCard({ modelId }: { modelId: string }) {
  const model = getBailianParserModel(modelId);
  if (!model)
    return <div className="model-price-card muted">当前目录无价格</div>;
  return (
    <div className="model-price-card">
      <div className="model-price-head">
        <div>
          <b>{model.label}</b>
          <span>{positionLabels[model.position]} · 华北 2（北京）</span>
        </div>
        <strong>
          {model.versionKind === "rolling"
            ? "滚动版本"
            : model.versionKind === "fixed"
              ? "固定版本"
              : "代际版本"}
        </strong>
      </div>
      {model.currentEquivalent && <p>当前等效版本：{model.currentEquivalent}</p>}
      <div className="model-price-tiers">
        {model.nonThinkingPriceTiers.map((tier, index) => (
          <p key={`${tier.maxInputTokens ?? "flat"}-${index}`}>
            {formatTier(model.nonThinkingPriceTiers[index - 1]?.maxInputTokens, tier.maxInputTokens)}：输入 ¥{tier.inputCnyPerMillion} / 输出 ¥{tier.outputCnyPerMillion}（每百万 Token）
          </p>
        ))}
      </div>
      <small>非思考模式 · 价格核对于 {model.checkedAt} · 目录价估算，以百炼账单为准</small>
    </div>
  );
}

function formatTier(previous: number | null | undefined, maximum: number | null) {
  if (maximum === null) return "不区分输入阶梯";
  const upper = formatTokenCount(maximum);
  return previous ? `${formatTokenCount(previous)}–${upper}` : `≤ ${upper}`;
}

function formatTokenCount(value: number) {
  if (value % 1_048_576 === 0) return `${value / 1_048_576}M`;
  return `${Math.round(value / 1024)}K`;
}
