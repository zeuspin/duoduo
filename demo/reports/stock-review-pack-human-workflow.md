# 股票 / 财经人工复核回填流程

## 目的

本流程把 `stock-finance-review-pack` 作为第一批人工听写和语义复核入口。人工填写完成后，再合并回总 workpack，并由既有脚本迁入正式语义标注集。

## 文件

| 文件 | 用途 |
| --- | --- |
| `demo/samples/annotations/stock-finance-review-pack.csv` | 给人工编辑的表格版复核包 |
| `demo/samples/annotations/stock-finance-review-pack.jsonl` | 给脚本读取的 JSONL 复核包 |
| `demo/scripts/merge_stock_review_pack.py` | 将已人工填写的复核包按 `work_item_id` 合并回总 workpack |
| `demo/scripts/promote_reviewed_annotations.py` | 将 `reviewed` / `accepted` / `done` 行迁入正式语义标注集 |

## 人工填写要求

- `manual_text`：按音频真实内容校正 ASR，不为了通顺改写原意。
- `audibility`：建议填写 `clear`、`noisy`、`partial` 或 `inaudible`。
- `topic` / `topic_entities` / `market_entities`：标出主要讨论对象。
- `direction` / `stance` / `conditions` / `risk_flags`：按真实语义填写。
- `review_status`：未完成保持 `todo`；完成后填 `reviewed`、`accepted` 或 `done`。
- `reviewer`：填写复核人。

## 回填命令

先 dry-run：

```text
python3 demo/scripts/merge_stock_review_pack.py --dry-run
```

确认 `changed_rows` 符合预期后执行写入：

```text
python3 demo/scripts/merge_stock_review_pack.py
python3 demo/scripts/promote_reviewed_annotations.py
python3 demo/scripts/check_annotation_coverage.py --input demo/samples/annotations/semantic-events.jsonl --output-json demo/reports/semantic-events-coverage-report.json --output-md demo/reports/semantic-events-coverage-report.md
```

## 当前状态

当前复核包尚未人工填写。dry-run 预期应显示 `matched_rows=120`、`changed_rows=0`、`approved_rows_after_merge=0`。
