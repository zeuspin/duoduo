#!/usr/bin/env python3

import argparse
import json
from pathlib import Path


def load_manifest(path: Path):
    by_asr_file = {}
    if not path.exists():
        return by_asr_file
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        asr_file = item.get("asr_file")
        if asr_file:
            by_asr_file[Path(asr_file).name] = item
    return by_asr_file


def iter_segments(asr_dir: Path, manifest_path: Path):
    manifest = load_manifest(manifest_path)
    for asr_path in sorted(asr_dir.glob("*.json")):
        data = json.loads(asr_path.read_text())
        meta = manifest.get(asr_path.name, {})
        sentences = data.get("final_result", {}).get("output", {}).get("sentence", [])
        for sentence in sentences:
            sample_id = meta.get("sample_id") or asr_path.stem
            room_id = meta.get("room_id") or ""
            sentence_id = sentence.get("sentence_id")
            yield {
                "segment_id": f"{sample_id}-ASR-{sentence_id:06d}" if isinstance(sentence_id, int) else f"{sample_id}-ASR",
                "sample_id": sample_id,
                "room_id": room_id,
                "room_url": meta.get("room_url", ""),
                "asr_file": str(asr_path),
                "audio_file": meta.get("audio_file", ""),
                "start_ms": sentence.get("begin_time"),
                "end_ms": sentence.get("end_time"),
                "text": sentence.get("text", ""),
                "sentence_end": sentence.get("sentence_end"),
                "source": "bailian_asr",
                "review_status": "needs_manual_review",
            }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--asr-dir", default="demo/samples/transcripts/asr")
    parser.add_argument("--manifest", default="demo/samples/manifests/sample-manifest.jsonl")
    parser.add_argument("--output", default="demo/samples/transcripts/asr/asr-segments.jsonl")
    args = parser.parse_args()

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with output.open("w") as handle:
        for segment in iter_segments(Path(args.asr_dir), Path(args.manifest)):
            handle.write(json.dumps(segment, ensure_ascii=False) + "\n")
            count += 1
    print(json.dumps({"output": str(output), "segments": count}, ensure_ascii=False))


if __name__ == "__main__":
    main()
