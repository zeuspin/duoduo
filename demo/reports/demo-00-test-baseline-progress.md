# Demo 00：测试样本与人工标注基线进展报告

## 1. 目标

对应计划中的 `Task 0.2`：建立真实测试样本和人工标注基线，用于后续 ASR、语义切分、摘要和聚合评测。

## 2. 当前已完成

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| 样本与标注规范 | 已完成 | `demo/test-baseline.md` |
| 样本目录约定 | 已完成 | `demo/test-baseline.md`、`demo/samples/` |
| 真实财经直播候选 | 部分完成 | C1/C2/C3/C4/C5 已记录，其中 C1/C2/C3/C4 已做无登录 Chrome 验证或采样 |
| 页面级音频样本 | 已有 smoke 样本 | `demo/samples/audio/raw/` |
| 百炼 ASR 输出 | 已有 smoke 输出 | `demo/samples/transcripts/asr/*.json` |
| ASR 片段清单 | 已生成 | `demo/samples/transcripts/asr/asr-segments.jsonl`，130 条 |
| 机器预标注 seed | 已生成 | `demo/samples/annotations/semantic-events-seed.jsonl`，130 条 |
| 人工标注工作包 | 已生成 | `demo/samples/annotations/human-annotation-workpack.jsonl` 与 `.csv`，130 条待人工复核 |
| 标注覆盖率检查 | 已生成 | `demo/reports/annotation-coverage-report.md` 与 `.json` |
| 正式语义标注集 | 已初始化 | `demo/samples/annotations/semantic-events.jsonl`，当前 0 条 |
| 已审核标注迁移报告 | 已生成 | `demo/reports/promote-reviewed-annotations-report.json` |
| 正式标注覆盖率检查 | 已生成 | `demo/reports/semantic-events-coverage-report.md` 与 `.json` |

## 3. 当前样本规模

| 类型 | 数量 / 时长 | 说明 |
| --- | ---: | --- |
| 10 秒 smoke 样本 | 4 条 | C1/C2/C3/C4 |
| 60 秒 smoke 样本 | 3 条 | C2/C1/C4 |
| 180 秒 smoke 样本 | 3 条 | C2/C1/C4 |
| 600 秒 smoke 样本 | 1 条 | C1，10 分钟页面级捕获和百炼 ASR 成功 |
| ASR 句子片段 | 130 条 | 由百炼 ASR 输出抽取 |
| 机器预标注片段 | 130 条 | 规则生成，待人工复核 |
| 人工标注工作包 | 130 条 | 供人工填写 `manual_text`、主题、方向、条件、风险和证据等字段 |
| 覆盖率检查 | 未通过 | 当前总量 130，距离 500 条缺 370；manual_text 0；reviewed 0 |
| 人工标准稿 | 0 条 | 尚未开始 |
| 正式人工语义标注 | 0 条 | `semantic-events.jsonl` 当前为空 |

## 4. 验收标准对照

| Task 0.2 验收标准 | 当前判断 | 说明 |
| --- | --- | --- |
| 测试样本总时长不少于 3 小时。 | 未通过 | 当前只有 smoke 样本，远低于 3 小时。 |
| 标注片段不少于 500 条。 | 未通过 | 当前只有 130 条机器预标注，且不是人工标注。 |
| 每条标注片段包含原文、时间范围、主题、方向、条件、风险、证据字段。 | 部分具备 | 机器 seed 和人工 workpack 已具备字段结构，但需人工填写、复核与修正。 |
| 至少 20% 片段包含否定、条件、风险或反转表达。 | 未验证 | 需要人工标注后统计。 |
| 任一指标都能由标注数据复算。 | 未通过 | 尚未有人工标准稿和指标计算样本。 |

## 4.1 当前覆盖率检查结果

检查脚本：

```text
demo/scripts/check_annotation_coverage.py
```

输出：

```text
demo/reports/annotation-coverage-report.md
demo/reports/annotation-coverage-report.json
```

| 检查项 | 当前结果 | 判断 |
| --- | ---: | --- |
| 总行数 | 130 | 未达 500 条 |
| 距离 500 条缺口 | 370 | 未通过 |
| 已填写 `manual_text` | 0 | 未通过 |
| 已审核行数 | 0 | 未通过 |
| 否定 / 条件 / 风险 / 反转覆盖比例 | 47.69% | 比例达 20%，但基于机器预填，仍需人工复核 |

主要类型缺口：

- 主题 / 市场实体缺 113 条。
- 条件表达缺 28 条。
- 风险表达缺 35 条。
- 新闻转述缺 40 条。
- 主播独立观点缺 80 条。
- 同源 / 重复转述缺 30 条。
- 观点反转 / 修正缺 20 条。
- 广告、寒暄、感谢、求关注缺 60 条。

## 5. 重要边界

- `semantic-events-seed.jsonl` 是机器规则预标注，不计入人工标注验收。
- `human-annotation-workpack.jsonl` / `.csv` 是待人工填写的工作包，不计入人工标注验收。
- `semantic-events.jsonl` 才是正式人工语义标注集；当前 0 条。
- `promote_reviewed_annotations.py` 只会提升 `review_status` 为 `reviewed`、`accepted` 或 `done` 的记录，避免把 `todo` 机器预填内容混入正式集。
- 当前 ASR 文本可以用于评测准备，但不能替代人工标准稿。
- C1/C2/C3/C4 是短时 smoke 样本；C1 已补 10 分钟样本，但仍不能代表 3 小时真实样本集。
- Safari 只用于登录态搜索候选链接；正式播放、捕获和 ASR 均使用无登录 Chrome profile。

## 6. 下一步

1. 每个候选直播至少采集 3 到 5 分钟，先形成最小人工听写样本。
2. 从 `human-annotation-workpack.csv` 中先抽取 50 到 100 条片段进行人工标准稿校对。
3. 人工复核 `human-annotation-workpack.jsonl` / `.csv`，将可用片段标为 `reviewed`、`accepted` 或 `done`。
4. 运行 `demo/scripts/promote_reviewed_annotations.py` 迁移正式 `semantic-events.jsonl`，再运行 `check_annotation_coverage.py` 复算正式覆盖率。
5. 按 `annotation-coverage-report.md` 和 `semantic-events-coverage-report.md` 的缺口补采新闻转述、独立观点、同源重复、反转和低价值内容样本。
6. 补足至少 3 小时真实股票直播样本和 500 条人工标注后，才能判定 Task 0.2 通过。
