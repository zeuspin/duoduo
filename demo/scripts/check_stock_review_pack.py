#!/usr/bin/env python3

import argparse
import json
from collections import Counter
from pathlib import Path


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


def analyze(rows, stock_room_ids, target):
    room_counts = Counter(str(row.get("room_id")) for row in rows)
    non_stock = [row for row in rows if str(row.get("room_id")) not in stock_room_ids]
    reasons = Counter()
    for row in rows:
        for reason in str(row.get("selection_reasons", "")).split("|"):
            if reason:
                reasons[reason] += 1
    scores = [int(row.get("selection_score") or 0) for row in rows]
    return {
        "total_rows": len(rows),
        "target_rows": target,
        "target_gap": max(target - len(rows), 0),
        "room_counts": dict(room_counts),
        "non_stock_rows": len(non_stock),
        "non_stock_work_item_ids": [row.get("work_item_id") for row in non_stock],
        "selection_reason_counts": dict(reasons),
        "score_min": min(scores) if scores else None,
        "score_max": max(scores) if scores else None,
        "review_pack_ready": len(rows) >= target and not non_stock,
        "important_note": "This readiness only covers review-pack composition. It is not manual transcription or formal annotation completion.",
    }


def write_markdown(report, output_path):
    lines = [
        "# 股票 / 财经优先复核包检查报告",
        "",
        "## 总览",
        "",
        "| 项目 | 值 |",
        "| --- | ---: |",
        f"| 总行数 | {report['total_rows']} |",
        f"| 目标行数 | {report['target_rows']} |",
        f"| 目标缺口 | {report['target_gap']} |",
        f"| 非股票样本行数 | {report['non_stock_rows']} |",
        f"| 最低分 | {report['score_min']} |",
        f"| 最高分 | {report['score_max']} |",
        f"| 复核包组成是否通过 | {report['review_pack_ready']} |",
        "",
        "## 房间分布",
        "",
        "| room_id | 数量 |",
        "| --- | ---: |",
    ]
    for room_id, count in sorted(report["room_counts"].items()):
        lines.append(f"| `{room_id}` | {count} |")
    lines.extend([
        "",
        "## 选择原因覆盖",
        "",
        "| reason | 数量 |",
        "| --- | ---: |",
    ])
    for reason, count in sorted(report["selection_reason_counts"].items()):
        lines.append(f"| {reason} | {count} |")
    lines.extend([
        "",
        "## 判断",
        "",
        "- 该检查只证明复核包组成符合筛选规则。",
        "- 该检查不证明人工听写完成，也不证明 Task 0.2 通过。",
    ])
    output_path.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="demo/samples/annotations/stock-finance-review-pack.jsonl")
    parser.add_argument("--suitability-report", default="demo/reports/sample-suitability-report.json")
    parser.add_argument("--target", type=int, default=120)
    parser.add_argument("--output-json", default="demo/reports/stock-finance-review-pack-check.json")
    parser.add_argument("--output-md", default="demo/reports/stock-finance-review-pack-check.md")
    args = parser.parse_args()

    report = analyze(load_jsonl(Path(args.input)), stock_rooms(args.suitability_report), args.target)
    output_json = Path(args.output_json)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(report, Path(args.output_md))
    print(json.dumps({
        "output_json": args.output_json,
        "output_md": args.output_md,
        "total_rows": report["total_rows"],
        "review_pack_ready": report["review_pack_ready"],
    }, ensure_ascii=False))
    return 0 if report["review_pack_ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
