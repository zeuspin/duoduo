#!/usr/bin/env python3

import argparse
import csv
import json
from pathlib import Path


NUMERIC_TERMS = set("0123456789一二三四五六七八九十百千万亿.%")
NEGATIVE_TERMS = ["不", "别", "没", "不是", "不要", "不能", "无", "假的"]
CONDITION_TERMS = ["如果", "假如", "才", "可能", "需要", "只要", "再看", "等"]
RISK_TERMS = ["风险", "别追", "不要追", "下跌", "出货", "冲突", "通胀", "加息"]


def load_jsonl(path):
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def stock_rooms(suitability_report):
    data = json.loads(Path(suitability_report).read_text())
    return {
        room_id
        for room_id, item in data.get("by_room", {}).items()
        if item.get("suitability") == "stock_finance"
    }


def has_any(text, terms):
    return any(term in text for term in terms)


def split_terms(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    if isinstance(value, str):
        return [item for item in value.split("|") if item]
    return [str(value)]


def score(row):
    text = row.get("asr_text", "")
    topic_entities = split_terms(row.get("topic_entities"))
    market_entities = split_terms(row.get("market_entities"))
    score_value = 0
    reasons = []
    if any(term in text for term in NUMERIC_TERMS):
        score_value += 3
        reasons.append("number")
    if has_any(text, NEGATIVE_TERMS):
        score_value += 3
        reasons.append("negative")
    if has_any(text, CONDITION_TERMS) or split_terms(row.get("conditions")):
        score_value += 3
        reasons.append("condition")
    if has_any(text, RISK_TERMS) or split_terms(row.get("risk_flags")):
        score_value += 3
        reasons.append("risk")
    if topic_entities or market_entities or row.get("topic") not in {"", "待人工确认", None}:
        score_value += 2
        reasons.append("entity")
    duration_ms = (int(row.get("end_ms") or 0) - int(row.get("start_ms") or 0))
    if 3000 <= duration_ms <= 15000:
        score_value += 1
        reasons.append("good_duration")
    return score_value, reasons


def build_pack(workpack_path, suitability_report, limit):
    rooms = stock_rooms(suitability_report)
    candidates = []
    for row in load_jsonl(Path(workpack_path)):
        if str(row.get("room_id")) not in rooms:
            continue
        score_value, reasons = score(row)
        candidates.append({
            **row,
            "selection_score": score_value,
            "selection_reasons": "|".join(reasons),
            "review_status": "todo",
        })
    candidates.sort(key=lambda row: (-row["selection_score"], row.get("sample_id", ""), int(row.get("start_ms") or 0)))
    return candidates[:limit]


def write_jsonl(rows, path):
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_csv(rows, path):
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        output.write_text("")
        return
    fields = list(rows[0].keys())
    with output.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_markdown(rows, path):
    lines = [
        "# 股票 / 财经优先人工复核包",
        "",
        "## 用途",
        "",
        "本文件从 `human-annotation-workpack` 中筛出股票 / 财经直播片段，优先给人工听写、ASR 校对和语义标注使用。",
        "",
        "注意：本包不是人工标准稿，也不是正式人工语义标注。只有人工填写 `manual_text` 并将 `review_status` 改为 `reviewed` / `accepted` / `done` 后，才能迁入正式标注集。",
        "",
        "## 总览",
        "",
        "| 项目 | 值 |",
        "| --- | ---: |",
        f"| 待复核条数 | {len(rows)} |",
        "",
        "## 前 30 条",
        "",
        "| work_item_id | room_id | score | reasons | asr_text |",
        "| --- | --- | ---: | --- | --- |",
    ]
    for row in rows[:30]:
        text = str(row.get("asr_text", "")).replace("|", " ").replace("\n", " ")[:120]
        lines.append(
            f"| `{row.get('work_item_id')}` | `{row.get('room_id')}` | "
            f"{row.get('selection_score')} | {row.get('selection_reasons')} | {text} |"
        )
    Path(path).write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workpack", default="demo/samples/annotations/human-annotation-workpack.jsonl")
    parser.add_argument("--suitability-report", default="demo/reports/sample-suitability-report.json")
    parser.add_argument("--limit", type=int, default=120)
    parser.add_argument("--output-jsonl", default="demo/samples/annotations/stock-finance-review-pack.jsonl")
    parser.add_argument("--output-csv", default="demo/samples/annotations/stock-finance-review-pack.csv")
    parser.add_argument("--output-md", default="demo/reports/stock-finance-review-pack.md")
    args = parser.parse_args()

    rows = build_pack(args.workpack, args.suitability_report, args.limit)
    write_jsonl(rows, args.output_jsonl)
    write_csv(rows, args.output_csv)
    write_markdown(rows, args.output_md)
    print(json.dumps({
        "output_jsonl": args.output_jsonl,
        "output_csv": args.output_csv,
        "output_md": args.output_md,
        "items": len(rows),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
