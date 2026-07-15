#!/usr/bin/env python3

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path


ROOM_CLASSIFICATION = {
    "782837937233": {
        "label": "财经小板总",
        "suitability": "stock_finance",
        "reason": "财经 / 板块 / 个股讨论",
    },
    "31544105137": {
        "label": "先机财经",
        "suitability": "stock_finance",
        "reason": "板块热点分析和主线挖掘",
    },
    "100263212175": {
        "label": "江哥财经",
        "suitability": "stock_finance",
        "reason": "A 股行情分析和热点聚焦",
    },
    "414092641626": {
        "label": "谷市一代枭雄",
        "suitability": "stock_finance",
        "reason": "政策 / 市场影响 / 解盘",
    },
    "893703096387": {
        "label": "谢说财经",
        "suitability": "stock_finance_candidate",
        "reason": "财经候选；未完成稳定捕获",
    },
    "816173758414": {
        "label": "老李财观",
        "suitability": "stock_finance",
        "reason": "K 线主题 / 财经口播",
    },
    "16743488023": {
        "label": "大A付老大-九点",
        "suitability": "stock_finance",
        "reason": "利好信号 / 市场主线 / A 股主题",
    },
    "873902239044": {
        "label": "股市林教头",
        "suitability": "stock_finance",
        "reason": "用户指定候选；股市直播间",
    },
    "334489081726": {
        "label": "文鼎（文说股市）",
        "suitability": "stock_finance",
        "reason": "用户指定候选；股市直播间",
    },
    "812755146455": {
        "label": "海派-和众汇富",
        "suitability": "stock_finance",
        "reason": "用户指定候选；股票 / 投顾直播间",
    },
    "400595809668": {
        "label": "汇正首席杨Sir",
        "suitability": "stock_finance",
        "reason": "用户指定候选；股票 / 投顾直播间",
    },
    "773107011629": {
        "label": "用户指定 U6",
        "suitability": "stock_finance",
        "reason": "用户新增指定候选；待标题确认",
    },
    "305503141482": {
        "label": "财经红姐",
        "suitability": "stock_finance",
        "reason": "Safari 直播首页财经候选；run38 有效捕获",
    },
    "583183556429": {
        "label": "海能-叨哥财经",
        "suitability": "stock_finance",
        "reason": "Safari 直播首页财经候选；run38 前 8 轮有效，后续中途失流",
    },
    "848398958216": {
        "label": "小溪财经",
        "suitability": "stock_finance",
        "reason": "Safari 直播首页财经候选；run38/run40 有效捕获，曾中途失流",
    },
    "857559947435": {
        "label": "老李财经",
        "suitability": "stock_finance",
        "reason": "Safari 直播首页财经候选；run38 换源后有效",
    },
    "56106509963": {
        "label": "国海小飞鱼",
        "suitability": "stock_finance",
        "reason": "Safari 直播首页财经候选；run40 有效捕获",
    },
    "88057849963": {
        "label": "广发证券修多多",
        "suitability": "stock_finance",
        "reason": "Safari 直播首页证券候选；run40 有效捕获",
    },
    "142040264912": {
        "label": "来来财经",
        "suitability": "stock_finance",
        "reason": "Safari 直播首页财经候选；run40 换源后有效",
    },
    "5583822346": {
        "label": "九方钱老虎",
        "suitability": "stock_finance",
        "reason": "Safari refresh2 行情候选；run43 16/16 有效捕获",
    },
    "632263122130": {
        "label": "A股小王子",
        "suitability": "stock_finance",
        "reason": "Safari refresh2 行业板块候选；run43 16/16 有效捕获",
    },
    "746541295999": {
        "label": "峰哥说财经",
        "suitability": "stock_finance",
        "reason": "Safari refresh2 行情修复候选；run43 16/16 有效捕获",
    },
    "59041165350": {
        "label": "老林故事会",
        "suitability": "pipeline_only",
        "reason": "口播故事会；可用于音频和 ASR 链路验证，但不能计入股票看盘样本验收",
    },
}

STOCK_SUITABILITY = {"stock_finance"}


def load_jsonl(path):
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def classify(row):
    room_id = str(row.get("room_id", ""))
    info = ROOM_CLASSIFICATION.get(room_id)
    if info:
        return info
    return {
        "label": "unknown",
        "suitability": "unknown",
        "reason": "未在样本适用性白名单中，需要人工确认直播内容类型",
    }


def build_report(manifest_rows, segment_rows):
    segment_count_by_sample = Counter(row.get("sample_id") for row in segment_rows)
    rows = []
    by_suitability = defaultdict(lambda: {
        "sample_count": 0,
        "duration_sec": 0,
        "effective_duration_sec": 0,
        "asr_segment_count": 0,
    })
    by_room = defaultdict(lambda: {
        "label": "",
        "suitability": "",
        "reason": "",
        "sample_count": 0,
        "duration_sec": 0,
        "effective_duration_sec": 0,
        "asr_segment_count": 0,
    })

    for row in manifest_rows:
        info = classify(row)
        duration = row.get("duration_sec") or 0
        effective = row.get("effective_duration_sec") or 0
        sample_id = row.get("sample_id")
        asr_count = segment_count_by_sample.get(sample_id, 0)
        item = {
            "sample_id": sample_id,
            "room_id": row.get("room_id"),
            "room_url": row.get("room_url"),
            "duration_sec": duration,
            "effective_duration_sec": effective,
            "asr_segment_count": asr_count,
            **info,
        }
        rows.append(item)
        bucket = by_suitability[info["suitability"]]
        bucket["sample_count"] += 1
        bucket["duration_sec"] += duration
        bucket["effective_duration_sec"] += effective
        bucket["asr_segment_count"] += asr_count

        room = by_room[str(row.get("room_id", ""))]
        room["label"] = info["label"]
        room["suitability"] = info["suitability"]
        room["reason"] = info["reason"]
        room["sample_count"] += 1
        room["duration_sec"] += duration
        room["effective_duration_sec"] += effective
        room["asr_segment_count"] += asr_count

    stock_rows = [row for row in rows if row["suitability"] in STOCK_SUITABILITY]
    return {
        "total_samples": len(rows),
        "total_effective_duration_sec": sum(row["effective_duration_sec"] for row in rows),
        "stock_finance_samples": len(stock_rows),
        "stock_finance_effective_duration_sec": sum(row["effective_duration_sec"] for row in stock_rows),
        "stock_finance_effective_duration_hours": round(sum(row["effective_duration_sec"] for row in stock_rows) / 3600, 4),
        "target_stock_finance_duration_hours": 3,
        "stock_finance_duration_gap_sec": max(10800 - sum(row["effective_duration_sec"] for row in stock_rows), 0),
        "stock_finance_asr_segments": sum(row["asr_segment_count"] for row in stock_rows),
        "pipeline_only_samples": sum(1 for row in rows if row["suitability"] == "pipeline_only"),
        "pipeline_only_effective_duration_sec": sum(row["effective_duration_sec"] for row in rows if row["suitability"] == "pipeline_only"),
        "by_suitability": dict(by_suitability),
        "by_room": dict(by_room),
        "samples": rows,
        "task_0_2_stock_duration_pass": sum(row["effective_duration_sec"] for row in stock_rows) >= 10800,
    }


def write_markdown(report, output_path):
    lines = [
        "# 样本适用性审计报告",
        "",
        "## 总览",
        "",
        "| 项目 | 值 |",
        "| --- | ---: |",
        f"| manifest 样本数 | {report['total_samples']} |",
        f"| 全部有效时长（秒） | {report['total_effective_duration_sec']} |",
        f"| 股票 / 财经样本数 | {report['stock_finance_samples']} |",
        f"| 股票 / 财经有效时长（小时） | {report['stock_finance_effective_duration_hours']} |",
        f"| 距 3 小时股票样本缺口（秒） | {report['stock_finance_duration_gap_sec']} |",
        f"| 股票 / 财经 ASR 片段数 | {report['stock_finance_asr_segments']} |",
        f"| pipeline-only 样本数 | {report['pipeline_only_samples']} |",
        f"| 股票样本时长是否达标 | {report['task_0_2_stock_duration_pass']} |",
        "",
        "## 按直播间统计",
        "",
        "| room_id | 直播间 | 适用性 | 样本数 | 有效时长秒 | ASR 片段 | 说明 |",
        "| --- | --- | --- | ---: | ---: | ---: | --- |",
    ]
    for room_id, item in sorted(report["by_room"].items()):
        lines.append(
            f"| `{room_id}` | {item['label']} | {item['suitability']} | "
            f"{item['sample_count']} | {item['effective_duration_sec']} | "
            f"{item['asr_segment_count']} | {item['reason']} |"
        )
    lines.extend([
        "",
        "## 判断",
        "",
        "- `stock_finance` 样本可计入 Task 0.2 的股票直播样本时长和 ASR 待复核材料。",
        "- `pipeline_only` 样本只能证明音频捕获、分段和 ASR 链路可用，不能计入股票看盘语义验收。",
        "- 本报告不替代人工听写和人工语义标注。",
    ])
    output_path.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default="demo/samples/manifests/sample-manifest.jsonl")
    parser.add_argument("--segments", default="demo/samples/transcripts/asr/asr-segments.jsonl")
    parser.add_argument("--output-json", default="demo/reports/sample-suitability-report.json")
    parser.add_argument("--output-md", default="demo/reports/sample-suitability-report.md")
    args = parser.parse_args()

    report = build_report(load_jsonl(Path(args.manifest)), load_jsonl(Path(args.segments)))
    output_json = Path(args.output_json)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(report, Path(args.output_md))
    print(json.dumps({
        "output_json": str(output_json),
        "output_md": args.output_md,
        "stock_finance_effective_duration_hours": report["stock_finance_effective_duration_hours"],
        "stock_finance_duration_gap_sec": report["stock_finance_duration_gap_sec"],
        "task_0_2_stock_duration_pass": report["task_0_2_stock_duration_pass"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
