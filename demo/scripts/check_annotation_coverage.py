#!/usr/bin/env python3

import argparse
import json
from collections import Counter
from pathlib import Path


REQUIRED_FIELDS = [
    "source_segment_id",
    "sample_id",
    "room_id",
    "start_ms",
    "end_ms",
    "asr_text",
    "topic",
    "direction",
    "conditions",
    "risk_flags",
    "content_type",
    "source_type",
    "is_news_relay",
    "is_independent_view",
    "is_same_source_relay",
    "is_reversal",
    "evidence_text",
    "review_status",
]

COVERAGE_TARGETS = {
    "topic_or_market_entity": 150,
    "number_expression": 80,
    "negative_expression": 50,
    "condition_expression": 50,
    "risk_expression": 50,
    "news_relay": 40,
    "independent_view": 80,
    "same_source_relay": 30,
    "reversal_or_correction": 20,
    "low_value_or_ad": 60,
}

TARGET_TOTAL = 500
TARGET_RISK_CONDITION_RATIO = 0.20

NEGATIVE_TERMS = ["不", "别", "没", "不是", "不要", "假的", "不能", "无"]
NUMBER_TERMS = list("0123456789一二三四五六七八九十百千万亿")
LOW_VALUE_TYPES = {"advertising", "greeting", "thanks", "follow_request", "unrelated_chat", "chitchat"}


def split_terms(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    if isinstance(value, str):
        return [item for item in value.split("|") if item]
    return [str(value)]


def truthy(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "y"}
    return bool(value)


def load_jsonl(path):
    rows = []
    with path.open() as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            item = json.loads(line)
            item["_line_number"] = line_number
            rows.append(item)
    return rows


def classify(row):
    text = row.get("manual_text") or row.get("clean_text") or row.get("asr_text") or row.get("raw_text") or ""
    topic_entities = split_terms(row.get("topic_entities"))
    market_entities = split_terms(row.get("market_entities"))
    conditions = split_terms(row.get("conditions"))
    risk_flags = split_terms(row.get("risk_flags"))
    content_type = row.get("content_type")
    stance = row.get("stance")
    source_type = row.get("source_type")

    categories = set()
    if topic_entities or market_entities or row.get("topic") not in {"", "待人工确认", None}:
        categories.add("topic_or_market_entity")
    if any(term in text for term in NUMBER_TERMS):
        categories.add("number_expression")
    if any(term in text for term in NEGATIVE_TERMS):
        categories.add("negative_expression")
    if conditions or content_type == "condition" or stance == "conditional":
        categories.add("condition_expression")
    if risk_flags or content_type == "risk_warning" or stance == "risk_warning":
        categories.add("risk_expression")
    if truthy(row.get("is_news_relay")) or source_type == "news_relay" or content_type == "news_relay":
        categories.add("news_relay")
    if truthy(row.get("is_independent_view")) or source_type == "anchor_judgement":
        categories.add("independent_view")
    if truthy(row.get("is_same_source_relay")):
        categories.add("same_source_relay")
    if truthy(row.get("is_reversal")) or content_type == "correction" or stance == "correction":
        categories.add("reversal_or_correction")
    if content_type in LOW_VALUE_TYPES or stance in LOW_VALUE_TYPES:
        categories.add("low_value_or_ad")
    return categories


def analyze(rows):
    missing = Counter()
    empty = Counter()
    review_status = Counter()
    category_counts = Counter()
    risk_condition_rows = 0
    manual_text_rows = 0
    reviewed_rows = 0

    for row in rows:
        for field in REQUIRED_FIELDS:
            if field not in row:
                missing[field] += 1
            elif row.get(field) in ("", None):
                empty[field] += 1
        review_status[row.get("review_status", "")] += 1
        if row.get("manual_text"):
            manual_text_rows += 1
        if row.get("review_status") in {"reviewed", "accepted", "done"}:
            reviewed_rows += 1
        categories = classify(row)
        category_counts.update(categories)
        if categories & {"negative_expression", "condition_expression", "risk_expression", "reversal_or_correction"}:
            risk_condition_rows += 1

    total = len(rows)
    ratio = risk_condition_rows / total if total else 0
    return {
        "total_rows": total,
        "target_total": TARGET_TOTAL,
        "total_gap": max(TARGET_TOTAL - total, 0),
        "manual_text_rows": manual_text_rows,
        "reviewed_rows": reviewed_rows,
        "review_status": dict(review_status),
        "missing_required_fields": dict(missing),
        "empty_required_fields": dict(empty),
        "category_counts": dict(category_counts),
        "coverage_targets": COVERAGE_TARGETS,
        "coverage_gaps": {
            key: max(target - category_counts.get(key, 0), 0)
            for key, target in COVERAGE_TARGETS.items()
        },
        "risk_condition_reversal_rows": risk_condition_rows,
        "risk_condition_reversal_ratio": ratio,
        "target_risk_condition_reversal_ratio": TARGET_RISK_CONDITION_RATIO,
        "risk_condition_reversal_ratio_pass": ratio >= TARGET_RISK_CONDITION_RATIO,
        "task_0_2_pass": (
            total >= TARGET_TOTAL
            and reviewed_rows >= TARGET_TOTAL
            and ratio >= TARGET_RISK_CONDITION_RATIO
            and not missing
        ),
    }


def write_markdown(report, output_path, source_path):
    lines = [
        "# 人工标注覆盖率检查报告",
        "",
        f"输入文件：`{source_path}`",
        "",
        "## 总览",
        "",
        "| 项目 | 值 |",
        "| --- | ---: |",
        f"| 总行数 | {report['total_rows']} |",
        f"| 目标行数 | {report['target_total']} |",
        f"| 距离 500 条缺口 | {report['total_gap']} |",
        f"| 已填写 manual_text | {report['manual_text_rows']} |",
        f"| 已审核行数 | {report['reviewed_rows']} |",
        f"| 否定/条件/风险/反转覆盖比例 | {report['risk_condition_reversal_ratio']:.2%} |",
        "",
        "## 覆盖缺口",
        "",
        "| 类型 | 当前数量 | 目标数量 | 缺口 |",
        "| --- | ---: | ---: | ---: |",
    ]
    for key, target in report["coverage_targets"].items():
        current = report["category_counts"].get(key, 0)
        gap = report["coverage_gaps"].get(key, 0)
        lines.append(f"| {key} | {current} | {target} | {gap} |")

    lines.extend([
        "",
        "## 字段完整性",
        "",
        f"- 缺失必填字段：`{json.dumps(report['missing_required_fields'], ensure_ascii=False)}`",
        f"- 空值必填字段：`{json.dumps(report['empty_required_fields'], ensure_ascii=False)}`",
        f"- review_status 分布：`{json.dumps(report['review_status'], ensure_ascii=False)}`",
        "",
        "## 判断",
        "",
    ])
    if report["task_0_2_pass"]:
        lines.append("- Task 0.2 标注数据检查通过。")
    else:
        lines.append("- Task 0.2 标注数据检查未通过；当前文件只能作为待人工复核材料或部分样本。")
    lines.append("- 该检查只能验证字段、数量和覆盖类型，不能替代人工听写质量审核。")
    output_path.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="demo/samples/annotations/human-annotation-workpack.jsonl")
    parser.add_argument("--output-json", default="demo/reports/annotation-coverage-report.json")
    parser.add_argument("--output-md", default="demo/reports/annotation-coverage-report.md")
    args = parser.parse_args()

    rows = load_jsonl(Path(args.input))
    report = analyze(rows)
    output_json = Path(args.output_json)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(report, Path(args.output_md), args.input)
    print(json.dumps({
        "input": args.input,
        "output_json": str(output_json),
        "output_md": args.output_md,
        "total_rows": report["total_rows"],
        "task_0_2_pass": report["task_0_2_pass"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
