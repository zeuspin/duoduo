#!/usr/bin/env python3

import argparse
import csv
import json
from pathlib import Path


FIELDS = [
    "work_item_id",
    "source_segment_id",
    "sample_id",
    "room_id",
    "room_url",
    "audio_file",
    "asr_file",
    "start_ms",
    "end_ms",
    "asr_text",
    "manual_text",
    "audibility",
    "speaker_label",
    "topic",
    "topic_entities",
    "market_entities",
    "direction",
    "stance",
    "conditions",
    "risk_flags",
    "content_type",
    "source_type",
    "is_news_relay",
    "is_independent_view",
    "is_same_source_relay",
    "is_reversal",
    "evidence_text",
    "confidence_label",
    "review_status",
    "reviewer",
    "review_notes",
]


def load_seed(path: Path):
    by_segment_id = {}
    if not path.exists():
        return by_segment_id
    with path.open() as handle:
        for line in handle:
            if not line.strip():
                continue
            item = json.loads(line)
            for segment_id in item.get("source_segment_ids", []):
                by_segment_id[segment_id] = item
    return by_segment_id


def as_list_text(value):
    if value is None:
        return ""
    if isinstance(value, list):
        return "|".join(str(item) for item in value)
    return str(value)


def iter_work_items(segments_path: Path, seed_path: Path, limit: int):
    seeds = load_seed(seed_path)
    count = 0
    with segments_path.open() as handle:
        for line in handle:
            if not line.strip():
                continue
            segment = json.loads(line)
            seed = seeds.get(segment.get("segment_id"), {})
            count += 1
            if limit and count > limit:
                break
            yield {
                "work_item_id": f"HWORK-{count:06d}",
                "source_segment_id": segment.get("segment_id", ""),
                "sample_id": segment.get("sample_id", ""),
                "room_id": segment.get("room_id", ""),
                "room_url": segment.get("room_url", ""),
                "audio_file": segment.get("audio_file", ""),
                "asr_file": segment.get("asr_file", ""),
                "start_ms": segment.get("start_ms", ""),
                "end_ms": segment.get("end_ms", ""),
                "asr_text": segment.get("text", ""),
                "manual_text": "",
                "audibility": "",
                "speaker_label": "anchor",
                "topic": seed.get("topic", ""),
                "topic_entities": as_list_text(seed.get("topic_entities")),
                "market_entities": as_list_text(seed.get("market_entities")),
                "direction": seed.get("direction", ""),
                "stance": seed.get("stance", ""),
                "conditions": as_list_text(seed.get("conditions")),
                "risk_flags": as_list_text(seed.get("risk_flags")),
                "content_type": seed.get("content_type", ""),
                "source_type": seed.get("source_type", ""),
                "is_news_relay": seed.get("is_news_relay"),
                "is_independent_view": seed.get("is_independent_view"),
                "is_same_source_relay": seed.get("is_same_source_relay"),
                "is_reversal": seed.get("is_reversal"),
                "evidence_text": seed.get("evidence_text", segment.get("text", "")),
                "confidence_label": "needs_human_review",
                "review_status": "todo",
                "reviewer": "",
                "review_notes": "",
            }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--segments", default="demo/samples/transcripts/asr/asr-segments.jsonl")
    parser.add_argument("--seed", default="demo/samples/annotations/semantic-events-seed.jsonl")
    parser.add_argument("--output-jsonl", default="demo/samples/annotations/human-annotation-workpack.jsonl")
    parser.add_argument("--output-csv", default="demo/samples/annotations/human-annotation-workpack.csv")
    parser.add_argument("--limit", type=int, default=0, help="0 means include all segments")
    args = parser.parse_args()

    items = list(iter_work_items(Path(args.segments), Path(args.seed), args.limit))

    output_jsonl = Path(args.output_jsonl)
    output_jsonl.parent.mkdir(parents=True, exist_ok=True)
    with output_jsonl.open("w") as handle:
        for item in items:
            handle.write(json.dumps(item, ensure_ascii=False) + "\n")

    output_csv = Path(args.output_csv)
    output_csv.parent.mkdir(parents=True, exist_ok=True)
    with output_csv.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(items)

    print(json.dumps({
        "jsonl": str(output_jsonl),
        "csv": str(output_csv),
        "items": len(items),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
