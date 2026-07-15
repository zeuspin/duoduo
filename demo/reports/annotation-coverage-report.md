# 人工标注覆盖率检查报告

输入文件：`demo/samples/annotations/human-annotation-workpack.jsonl`

## 总览

| 项目 | 值 |
| --- | ---: |
| 总行数 | 1467 |
| 目标行数 | 500 |
| 距离 500 条缺口 | 0 |
| 已填写 manual_text | 0 |
| 已审核行数 | 0 |
| 否定/条件/风险/反转覆盖比例 | 44.10% |

## 覆盖缺口

| 类型 | 当前数量 | 目标数量 | 缺口 |
| --- | ---: | ---: | ---: |
| topic_or_market_entity | 21 | 150 | 129 |
| number_expression | 649 | 80 | 0 |
| negative_expression | 640 | 50 | 0 |
| condition_expression | 13 | 50 | 37 |
| risk_expression | 5 | 50 | 45 |
| news_relay | 0 | 40 | 40 |
| independent_view | 0 | 80 | 80 |
| same_source_relay | 0 | 30 | 30 |
| reversal_or_correction | 0 | 20 | 20 |
| low_value_or_ad | 0 | 60 | 60 |

## 字段完整性

- 缺失必填字段：`{}`
- 空值必填字段：`{"conditions": 1454, "risk_flags": 1462, "is_news_relay": 1467, "is_independent_view": 1467, "is_same_source_relay": 1467, "is_reversal": 1467, "topic": 1382, "direction": 1382, "content_type": 1382, "source_type": 1382, "asr_text": 1, "evidence_text": 1}`
- review_status 分布：`{"todo": 1467}`

## 判断

- Task 0.2 标注数据检查未通过；当前文件只能作为待人工复核材料或部分样本。
- 该检查只能验证字段、数量和覆盖类型，不能替代人工听写质量审核。
