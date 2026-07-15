#!/usr/bin/env python3

import argparse
import json
from pathlib import Path


MERGE_FIELDS = [
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

APPROVED_STATUSES = {"reviewed", "accepted", "done"}


def load_jsonl(path):
    rows = []
    if not path.exists():
        return rows
    for line in path.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def write_jsonl(rows, path):
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def meaningful_review(row):
    status = row.get("review_status")
    return status in APPROVED_STATUSES or bool(row.get("manual_text")) or bool(row.get("reviewer"))


def merge(master_rows, review_rows):
    review_by_id = {row.get("work_item_id"): row for row in review_rows if row.get("work_item_id")}
    merged_rows = []
    matched = 0
    changed = 0
    approved = 0
    skipped_unreviewed = 0
    missing_master_ids = []
    master_ids = {row.get("work_item_id") for row in master_rows}

    for review_id in review_by_id:
        if review_id not in master_ids:
            missing_master_ids.append(review_id)

    for row in master_rows:
        work_item_id = row.get("work_item_id")
        review = review_by_id.get(work_item_id)
        if not review:
            merged_rows.append(row)
            continue
        matched += 1
        if not meaningful_review(review):
            skipped_unreviewed += 1
            merged_rows.append(row)
            continue
        new_row = dict(row)
        row_changed = False
        for field in MERGE_FIELDS:
            if field in review and review.get(field) != row.get(field):
                new_row[field] = review.get(field)
                row_changed = True
        if new_row.get("review_status") in APPROVED_STATUSES:
            approved += 1
        if row_changed:
            changed += 1
        merged_rows.append(new_row)

    return merged_rows, {
        "master_rows": len(master_rows),
        "review_rows": len(review_rows),
        "matched_rows": matched,
        "changed_rows": changed,
        "approved_rows_after_merge": approved,
        "skipped_unreviewed_rows": skipped_unreviewed,
        "missing_master_ids": missing_master_ids,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--master", default="demo/samples/annotations/human-annotation-workpack.jsonl")
    parser.add_argument("--review-pack", default="demo/samples/annotations/stock-finance-review-pack.jsonl")
    parser.add_argument("--output", default="demo/samples/annotations/human-annotation-workpack.jsonl")
    parser.add_argument("--report", default="demo/reports/merge-stock-review-pack-report.json")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    master_rows = load_jsonl(Path(args.master))
    review_rows = load_jsonl(Path(args.review_pack))
    merged_rows, report = merge(master_rows, review_rows)
    report["dry_run"] = args.dry_run
    report["input_master"] = args.master
    report["input_review_pack"] = args.review_pack
    report["output"] = args.output

    if not args.dry_run:
        write_jsonl(merged_rows, args.output)
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
