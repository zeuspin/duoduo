import { useMemo, useState } from "react";
import {
  formatModelPrice,
  getAvailableModels,
  type BailianModelScene,
  type BailianModelSort,
} from "../../shared/bailian-model-catalog";

const sortLabels: Record<BailianModelSort, string> = {
  recommended: "默认推荐",
  cost: "成本优先",
  effect: "效果优先",
};
const sceneLabels: Record<BailianModelScene, string> = {
  asr_extraction: "ASR 提取",
  asr_analysis: "内容分析",
  analyzer_agent: "分析器创建 Agent",
};

export function ModelSelector({
  scene,
  value,
  onChange,
}: {
  scene: BailianModelScene;
  value: string;
  onChange(value: string): void;
}) {
  const [sort, setSort] = useState<BailianModelSort>("recommended");
  const models = useMemo(() => getAvailableModels(scene, sort), [scene, sort]);
  const recommendedId = getAvailableModels(scene, "recommended")[0]?.id;
  const supportsSorting = getAvailableModels(scene).length > 1;

  return (
    <div className="model-selector">
      {supportsSorting && <div className="model-sort" aria-label={`${sceneLabels[scene]}模型排序方式`}>
        {(Object.keys(sortLabels) as BailianModelSort[]).map((item) => (
          <button
            className={sort === item ? "active" : ""}
            type="button"
            aria-pressed={sort === item}
            onClick={() => setSort(item)}
            key={item}
          >
            {sortLabels[item]}
          </button>
        ))}
      </div>}
      <div className="model-options" role="radiogroup" aria-label={`${sceneLabels[scene]}可用模型`}>
        {models.map((model) => {
          const evaluation = model.evaluations[scene]!;
          return (
            <button
              className={value === model.id ? "selected" : ""}
              type="button"
              role="radio"
              aria-checked={value === model.id}
              onClick={() => onChange(model.id)}
              key={model.id}
            >
              <span className="model-option-heading">
                <span>
                  <b>{model.label}</b>
                  <small>{model.id}</small>
                </span>
                {model.id === recommendedId && (
                  <span className="model-recommended-badge">推荐</span>
                )}
              </span>
              <span className="model-option-meta">
                <strong>{formatModelPrice(model)}</strong>
                <small>场景测试 {evaluation.score.toFixed(1)} 分</small>
              </span>
              <span className="model-option-note">{evaluation.note}</span>
            </button>
          );
        })}
      </div>
      <p className="model-selector-footnote">
        仅显示已通过股票金融与电商直播场景生死线的模型；价格为华北 2（北京）目录价估算。
      </p>
    </div>
  );
}
