#!/usr/bin/env python3

import argparse
import json
import re
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path


ASR_DIR = Path("demo/samples/transcripts/asr")
MANIFEST_PATH = Path("demo/samples/manifests/sample-manifest.jsonl")
FILE_RE = re.compile(
    r"(?P<run>run\d+)_(?P<route>C\d+)_(?P<room_id>\d+)_(?P<stamp>\d{8}T\d{4})_seg(?P<segment>\d{2})_60s_page_capture\.webm$"
)

ROOM_META = {
    "816173758414": {
        "room_name": "老李财观",
        "room_url": "https://live.douyin.com/816173758414",
        "room_type": "财经 / K 线",
        "suitability": "stock_finance",
    },
    "16743488023": {
        "room_name": "大A付老大-九点",
        "room_url": "https://live.douyin.com/16743488023",
        "room_type": "股票 / 财经",
        "suitability": "stock_finance",
    },
    "873902239044": {
        "room_name": "股市林教头",
        "room_url": "https://live.douyin.com/873902239044",
        "room_type": "股票 / 股市",
        "suitability": "stock_finance",
    },
    "334489081726": {
        "room_name": "文鼎（文说股市）",
        "room_url": "https://live.douyin.com/334489081726",
        "room_type": "股票 / 股市",
        "suitability": "stock_finance",
    },
    "812755146455": {
        "room_name": "海派-和众汇富",
        "room_url": "https://live.douyin.com/812755146455",
        "room_type": "股票 / 投顾",
        "suitability": "stock_finance",
    },
    "400595809668": {
        "room_name": "汇正首席杨Sir",
        "room_url": "https://live.douyin.com/400595809668",
        "room_type": "股票 / 投顾",
        "suitability": "stock_finance",
    },
    "773107011629": {
        "room_name": "用户指定 U6",
        "room_url": "https://live.douyin.com/773107011629",
        "room_type": "股票 / 财经候选",
        "suitability": "stock_finance",
    },
}


def load_json(path):
    return json.loads(path.read_text())


def load_existing_sample_ids(path):
    ids = set()
    if not path.exists():
        return ids
    for line in path.read_text().splitlines():
        if line.strip():
            ids.add(json.loads(line).get("sample_id"))
    return ids


def parse_item(audio_file):
    path = Path(audio_file)
    match = FILE_RE.match(path.name)
    if not match:
        raise ValueError(f"unsupported audio filename: {path.name}")
    data = match.groupdict()
    meta = ROOM_META.get(data["room_id"], {
        "room_name": "unknown",
        "room_url": f"https://live.douyin.com/{data['room_id']}",
        "room_type": "unknown",
        "suitability": "unknown",
    })
    sample_id = f"{data['run'].upper()}-{data['route']}-SEG{data['segment']}"
    wav_file = path.with_name(path.name.replace(".webm", "_16k_mono.wav"))
    asr_file = ASR_DIR / (
        f"{data['run']}_{data['route']}_{data['room_id']}_{data['stamp']}_"
        f"seg{data['segment']}_60s_bailian_asr.json"
    )
    return {
        **data,
        **meta,
        "sample_id": sample_id,
        "raw_audio_file": path,
        "wav_file": wav_file,
        "asr_file": asr_file,
    }


def run(command):
    return subprocess.run(command, text=True, capture_output=True)


def transcode(item, force):
    if item["wav_file"].exists() and not force:
        return {"ok": True, "skipped": True}
    result = run([
        "ffmpeg",
        "-y",
        "-i",
        str(item["raw_audio_file"]),
        "-ac",
        "1",
        "-ar",
        "16000",
        str(item["wav_file"]),
    ])
    return {
        "ok": result.returncode == 0,
        "skipped": False,
        "returncode": result.returncode,
        "stderr_tail": result.stderr.strip().splitlines()[-5:],
    }


def run_asr(item, force):
    if item["asr_file"].exists() and not force:
        return {"ok": True, "skipped": True}
    result = run([
        "python3",
        "demo/scripts/bailian_asr_smoke.py",
        str(item["wav_file"]),
        "paraformer-realtime-v2",
        str(item["asr_file"]),
    ])
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


def sentence_count(path):
    if not path.exists():
        return 0
    data = json.loads(path.read_text())
    return len(data.get("final_result", {}).get("output", {}).get("sentence", []))


def captured_at_from_item(item):
    base = datetime.strptime(item["stamp"], "%Y%m%dT%H%M").replace(tzinfo=timezone(timedelta(hours=8)))
    return (base + timedelta(seconds=(int(item["segment"]) - 1) * 60)).isoformat()


def manifest_item(item):
    return {
        "sample_id": item["sample_id"],
        "room_id": item["room_id"],
        "room_url": item["room_url"],
        "captured_at": captured_at_from_item(item),
        "duration_sec": 60,
        "effective_duration_sec": 60.0,
        "platform": "macOS",
        "capture_method": "chrome-cdp-video-captureStream-mediarecorder",
        "audio_file": str(item["wav_file"]),
        "raw_audio_file": str(item["raw_audio_file"]),
        "asr_file": str(item["asr_file"]),
        "notes": (
            f"{item['run']} valid rolling capture sample; {item['route']} {item['room_name']} "
            f"({item['room_type']}); segment {int(item['segment']):02d}; "
            f"suitability={item['suitability']}; ASR returned {sentence_count(item['asr_file'])} sentences."
        ),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--validity-report", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    report = load_json(Path(args.validity_report))
    items = [parse_item(row["audio_file"]) for row in report.get("segments", []) if row.get("valid_segment")]
    output = {"valid_items": len(items), "transcoded": [], "asr": [], "manifest_appended": 0}
    successful = []
    for item in items:
        transcode_result = transcode(item, args.force)
        output["transcoded"].append({"sample_id": item["sample_id"], **transcode_result})
        if not transcode_result["ok"]:
            continue
        asr_result = run_asr(item, args.force)
        output["asr"].append({"sample_id": item["sample_id"], **asr_result})
        if asr_result["ok"]:
            successful.append(item)

    existing = load_existing_sample_ids(MANIFEST_PATH)
    with MANIFEST_PATH.open("a") as handle:
        for item in successful:
            if item["sample_id"] in existing and not args.force:
                continue
            handle.write(json.dumps(manifest_item(item), ensure_ascii=False) + "\n")
            output["manifest_appended"] += 1

    output_json = Path(args.output_json)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({
        "output_json": args.output_json,
        "valid_items": output["valid_items"],
        "asr_ok": sum(1 for row in output["asr"] if row["ok"]),
        "manifest_appended": output["manifest_appended"],
    }, ensure_ascii=False))
    return 0 if len(successful) == len(items) else 1


if __name__ == "__main__":
    raise SystemExit(main())
