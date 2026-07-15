#!/usr/bin/env python3

import argparse
import json
import re
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path


RAW_DIR = Path("demo/samples/audio/raw")
ASR_DIR = Path("demo/samples/transcripts/asr")
MANIFEST_PATH = Path("demo/samples/manifests/sample-manifest.jsonl")
CAPTURE_RE = re.compile(
    r"run11_(C[23])_(\d+)_20260709T0408_seg(\d{2})_60s_page_capture\.webm$"
)

ROUTE_META = {
    "C2": {
        "room_name": "老李财观",
        "room_url": "https://live.douyin.com/816173758414",
        "room_type": "财经 / K 线",
    },
    "C3": {
        "room_name": "老林故事会",
        "room_url": "https://live.douyin.com/59041165350",
        "room_type": "口播",
    },
}


def load_existing_sample_ids(path: Path):
    sample_ids = set()
    if not path.exists():
        return sample_ids
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        sample_ids.add(json.loads(line).get("sample_id"))
    return sample_ids


def iter_inputs(limit):
    items = []
    for path in sorted(RAW_DIR.glob("run11_C[23]_*_20260709T0408_seg*_60s_page_capture.webm")):
        match = CAPTURE_RE.match(path.name)
        if not match:
            continue
        route, room_id, segment = match.groups()
        sample_id = f"RUN11-{route}-SEG{segment}"
        items.append({
            "route": route,
            "room_id": room_id,
            "segment": int(segment),
            "sample_id": sample_id,
            "raw_audio_file": path,
            "wav_file": path.with_name(path.name.replace(".webm", "_16k_mono.wav")),
            "asr_file": ASR_DIR / f"run11_{route}_{room_id}_20260709T0408_seg{segment}_60s_bailian_asr.json",
        })
    return items[:limit] if limit else items


def run(command):
    return subprocess.run(command, text=True, capture_output=True)


def transcode(item, force):
    if item["wav_file"].exists() and not force:
        return {"ok": True, "skipped": True}
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(item["raw_audio_file"]),
        "-ac",
        "1",
        "-ar",
        "16000",
        str(item["wav_file"]),
    ]
    result = run(command)
    return {
        "ok": result.returncode == 0,
        "skipped": False,
        "returncode": result.returncode,
        "stderr_tail": result.stderr.strip().splitlines()[-5:],
    }


def run_asr(item, force):
    if item["asr_file"].exists() and not force:
        return {"ok": True, "skipped": True}
    command = [
        "python3",
        "demo/scripts/bailian_asr_smoke.py",
        str(item["wav_file"]),
        "paraformer-realtime-v2",
        str(item["asr_file"]),
    ]
    result = run(command)
    payload = None
    if result.stdout.strip():
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            payload = {"stdout_tail": result.stdout.strip().splitlines()[-5:]}
    return {
        "ok": result.returncode == 0,
        "skipped": False,
        "returncode": result.returncode,
        "payload": payload,
        "stderr_tail": result.stderr.strip().splitlines()[-5:],
    }


def sentence_count(asr_file: Path):
    if not asr_file.exists():
        return 0
    data = json.loads(asr_file.read_text())
    return len(data.get("final_result", {}).get("output", {}).get("sentence", []))


def captured_at(segment):
    base = datetime(2026, 7, 9, 4, 9, 37, tzinfo=timezone(timedelta(hours=8)))
    return (base + timedelta(seconds=(segment - 1) * 60)).isoformat()


def build_manifest_item(item):
    meta = ROUTE_META[item["route"]]
    return {
        "sample_id": item["sample_id"],
        "room_id": item["room_id"],
        "room_url": meta["room_url"],
        "captured_at": captured_at(item["segment"]),
        "duration_sec": 60,
        "effective_duration_sec": 60.0,
        "platform": "macOS",
        "capture_method": "chrome-cdp-video-captureStream-mediarecorder",
        "audio_file": str(item["wav_file"]),
        "raw_audio_file": str(item["raw_audio_file"]),
        "asr_file": str(item["asr_file"]),
        "notes": (
            "run11 10x60s rolling capture sample; "
            f"{item['route']} {meta['room_name']} ({meta['room_type']}); "
            f"segment {item['segment']:02d}; ASR returned {sentence_count(item['asr_file'])} sentences."
        ),
    }


def append_manifest(items, force):
    existing = load_existing_sample_ids(MANIFEST_PATH)
    appended = 0
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    with MANIFEST_PATH.open("a") as handle:
        for item in items:
            if item["sample_id"] in existing and not force:
                continue
            handle.write(json.dumps(build_manifest_item(item), ensure_ascii=False) + "\n")
            appended += 1
    return appended


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    items = iter_inputs(args.limit)
    report = {"items": len(items), "transcoded": [], "asr": [], "manifest_appended": 0}
    successful_items = []
    for item in items:
        transcode_result = transcode(item, args.force)
        report["transcoded"].append({"sample_id": item["sample_id"], **transcode_result})
        if not transcode_result["ok"]:
            continue
        asr_result = run_asr(item, args.force)
        report["asr"].append({"sample_id": item["sample_id"], **asr_result})
        if asr_result["ok"]:
            successful_items.append(item)

    report["manifest_appended"] = append_manifest(successful_items, args.force)
    output = Path("demo/reports/run11-asr-sample-registration-report.json")
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({
        "output": str(output),
        "items": report["items"],
        "asr_ok": sum(1 for item in report["asr"] if item["ok"]),
        "manifest_appended": report["manifest_appended"],
    }, ensure_ascii=False))
    return 0 if len(successful_items) == len(items) else 1


if __name__ == "__main__":
    raise SystemExit(main())
