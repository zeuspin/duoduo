#!/usr/bin/env python3

import argparse
import json
import re
from pathlib import Path


ENTITY_PATTERNS = [
    "PCB", "pcb", "MCC", "mcc", "算力", "半导体", "费城半导体", "商业银行", "银行",
    "主力", "散户", "成交额", "中东冲突", "通胀", "央行", "加息", "欧洲央行",
    "能源", "生产者价格", "权重", "京东", "中报", "电力", "创新药", "封装",
]

RISK_PATTERNS = ["风险", "别追", "不要追", "冲突", "通胀", "加息", "下跌", "假的", "出货"]
CONDITION_PATTERNS = ["如果", "假如", "除以", "再看", "才", "可能", "需要", "只要"]
POSITIVE_PATTERNS = ["涨", "反弹", "承接", "热点", "主线", "突破"]
NEGATIVE_PATTERNS = ["跌", "下跌", "卖出", "出货", "假的", "冲突", "通胀", "加息"]


def find_terms(text, patterns):
    found = []
    for pattern in patterns:
        if re.search(re.escape(pattern), text, flags=re.IGNORECASE):
            found.append(pattern.upper() if pattern.islower() else pattern)
    return sorted(set(found))


def infer_direction(text):
    positives = find_terms(text, POSITIVE_PATTERNS)
    negatives = find_terms(text, NEGATIVE_PATTERNS)
    if positives and negatives:
        return "mixed"
    if positives:
        return "positive"
    if negatives:
        return "negative"
    return "neutral"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--segments", default="demo/samples/transcripts/asr/asr-segments.jsonl")
    parser.add_argument("--output", default="demo/samples/annotations/semantic-events-seed.jsonl")
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with Path(args.segments).open() as source, output.open("w") as target:
        for index, line in enumerate(source, start=1):
            if not line.strip():
                continue
            segment = json.loads(line)
            text = segment.get("text", "")
            entities = find_terms(text, ENTITY_PATTERNS)
            risks = find_terms(text, RISK_PATTERNS)
            conditions = find_terms(text, CONDITION_PATTERNS)
            event = {
                "annotation_id": f"MSEED-{index:06d}",
                "source_segment_ids": [segment.get("segment_id")],
                "sample_id": segment.get("sample_id"),
                "room_id": segment.get("room_id"),
                "start_ms": segment.get("start_ms"),
                "end_ms": segment.get("end_ms"),
                "raw_text": text,
                "clean_text": text,
                "topic": entities[0] if entities else "待人工确认",
                "topic_entities": entities,
                "market_entities": [],
                "direction": infer_direction(text),
                "stance": "conditional" if conditions else "unknown",
                "conditions": conditions,
                "risk_flags": risks,
                "content_type": "unknown",
                "source_type": "unknown",
                "is_news_relay": None,
                "is_independent_view": None,
                "is_same_source_relay": None,
                "is_reversal": None,
                "evidence_text": text[:120],
                "confidence_label": "machine_seed",
                "review_status": "needs_manual_review",
                "notes": "机器规则预标注，仅用于人工标注前筛选，不计入 Task 0.2 人工标注验收。",
            }
            target.write(json.dumps(event, ensure_ascii=False) + "\n")
            count += 1
    print(json.dumps({"output": str(output), "events": count}, ensure_ascii=False))


if __name__ == "__main__":
    main()
