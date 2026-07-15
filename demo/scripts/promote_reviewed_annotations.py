#!/usr/bin/env python3

import argparse
import json
from pathlib import Path


APPROVED_STATUSES = {"reviewed", "accepted", "done"}
LIST_FIELDS = {"topic_entities", "market_entities", "conditions", "risk_flags"}
BOOL_FIELDS = {"is_news_relay", "is_independent_view", "is_same_source_relay", "is_reversal"}


def split_terms(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    if isinstance(value, str):
        return [item for item in value.split("|") if item]
    return [str(value)]


def parse_bool(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "y"}
    return bool(value)


def clean_enum(value, fallback):
    if value in ("", None, "unknown", "needs_human_review"):
        return fallback
    return value


def iter_rows(path):
    with path.open() as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            item = json.loads(line)
            item["_line_number"] = line_number
            yield item


def promote(row, index):
    raw_text = row.get("manual_text") or row.get("asr_text") or ""
    event = {
        "annotation_id": f"ANN-{index:06d}",
        "source_segment_ids": [row.get("source_segment_id", "")],
        "sample_id": row.get("sample_id", ""),
        "room_id": row.get("room_id", ""),
        "start_ms": row.get("start_ms"),
        "end_ms": row.get("end_ms"),
        "raw_text": raw_text,
        "clean_text": row.get("manual_text") or row.get("asr_text") or "",
        "topic": row.get("topic") or "待人工确认",
        "topic_entities": split_terms(row.get("topic_entities")),
        "market_entities": split_terms(row.get("market_entities")),
        "direction": clean_enum(row.get("direction"), "uncertain"),
        "stance": clean_enum(row.get("stance"), "not_applicable"),
        "conditions": split_terms(row.get("conditions")),
        "risk_flags": split_terms(row.get("risk_flags")),
        "time_horizon": row.get("time_horizon") or "unknown",
        "content_type": clean_enum(row.get("content_type"), "uncertain"),
        "source_type": clean_enum(row.get("source_type"), "unknown"),
        "is_news_relay": parse_bool(row.get("is_news_relay")),
        "is_independent_view": parse_bool(row.get("is_independent_view")),
        "is_same_source_relay": parse_bool(row.get("is_same_source_relay")),
        "is_reversal": parse_bool(row.get("is_reversal")),
        "evidence_text": row.get("evidence_text") or raw_text[:120],
        "confidence_label": clean_enum(row.get("confidence_label"), "medium"),
        "reviewer": row.get("reviewer", ""),
        "notes": row.get("review_notes", ""),
    }
    return event


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="demo/samples/annotations/human-annotation-workpack.jsonl")
    parser.add_argument("--output", default="demo/samples/annotations/semantic-events.jsonl")
    parser.add_argument("--report", default="demo/reports/promote-reviewed-annotations-report.json")
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    total = 0
    skipped = 0
    promoted = 0
    status_counts = {}

    with output.open("w") as handle:
        for row in iter_rows(Path(args.input)):
            total += 1
            status = row.get("review_status", "")
            status_counts[status] = status_counts.get(status, 0) + 1
            if status not in APPROVED_STATUSES:
                skipped += 1
                continue
            promoted += 1
            handle.write(json.dumps(promote(row, promoted), ensure_ascii=False) + "\n")

    report = {
        "input": args.input,
        "output": str(output),
        "total_rows": total,
        "promoted_rows": promoted,
        "skipped_rows": skipped,
        "approved_statuses": sorted(APPROVED_STATUSES),
        "status_counts": status_counts,
        "ready_for_task_0_2_count_gate": promoted >= 500,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
