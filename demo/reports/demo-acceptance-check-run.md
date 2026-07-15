# Demo 统一验收检查运行报告

生成时间：`2026-07-11T09:51:44+08:00`

## 总览

| 项目 | 值 |
| --- | --- |
| 必需检查是否通过 | True |
| key 扫描是否通过 | True |
| 总体验收是否通过 | False |
| 目标逐条审计是否完成 | False |
| 股票 / 财经有效样本小时 | 3.061 |
| 距 3 小时股票样本缺口秒 | 0 |
| workpack 行数 | 1467 |
| workpack 距 500 条缺口 | 0 |
| 正式语义标注行数 | 0 |
| 股票复核包 ready | True |

## 检查项

| id | required | returncode | ok |
| --- | --- | ---: | --- |
| scope_signoff | False | 0 | True |
| sample_suitability | True | 0 | True |
| annotation_coverage | True | 0 | True |
| semantic_events_coverage | True | 0 | True |
| stock_review_pack | True | 0 | True |
| merge_stock_review_pack_dry_run | True | 0 | True |
| process_guard | True | 0 | True |
| demo_acceptance_state | True | 0 | True |
| objective_requirements_audit | True | 0 | True |

## key 扫描

- 未发现 key 形态字符串。

## 判断

- 本报告证明检查链路可复跑，不代表总体验收通过。
- 当前 `overall_acceptance_pass=false` 时，仍需继续补样本、人工标注和长稳验证。
