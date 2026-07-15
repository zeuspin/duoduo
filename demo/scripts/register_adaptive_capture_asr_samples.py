#!/usr/bin/env python3

import argparse
import json
import subprocess
from pathlib import Path


ASR_DIR = Path("demo/samples/transcripts/asr")
MANIFEST_PATH = Path("demo/samples/manifests/sample-manifest.jsonl")

ROOM_META = {
    "305503141482": ("财经红姐", "股票 / 财经", "stock_finance"),
    "583183556429": ("海能-叨哥财经", "股票 / 财经", "stock_finance"),
    "848398958216": ("小溪财经", "股票 / 财经", "stock_finance"),
    "857559947435": ("老李财经", "股票 / 财经", "stock_finance"),
    "56106509963": ("国海小飞鱼", "股票 / 财经", "stock_finance"),
    "88057849963": ("广发证券修多多", "股票 / 财经", "stock_finance"),
    "142040264912": ("来来财经", "股票 / 财经", "stock_finance"),
    "5583822346": ("九方钱老虎", "股票 / 财经", "stock_finance"),
    "632263122130": ("A股小王子", "股票 / 财经", "stock_finance"),
    "746541295999": ("峰哥说财经", "股票 / 财经", "stock_finance"),
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


def run(command):
    return subprocess.run(command, text=True, capture_output=True)


def sentence_count(path):
    if not path.exists():
        return 0
    data = json.loads(path.read_text())
    return len(data.get("final_result", {}).get("output", {}).get("sentence", []))


def make_item(run_id, event):
    route = event["route"]
    round_id = int(event["round"])
    room_id = event["room_id"]
    room_name, room_type, suitability = ROOM_META.get(
        room_id,
        (f"room {room_id}", "unknown", "unknown"),
    )
    raw_audio = Path(event["summary_file"]).parent
    audio_file = Path(load_first_segment_event(Path(event["summary_file"]))["audio_file"])
    wav_file = audio_file.with_name(audio_file.name.replace(".webm", "_16k_mono.wav"))
    asr_file = ASR_DIR / audio_file.name.replace(".webm", "_bailian_asr.json")
    sample_id = f"{run_id.upper()}-{route}-R{round_id:02d}"
    return {
        "sample_id": sample_id,
        "run_id": run_id,
        "route": route,
        "round": round_id,
        "room_id": room_id,
        "room_name": room_name,
        "room_type": room_type,
        "suitability": suitability,
        "started_at": load_first_segment_event(Path(event["summary_file"])).get("started_at"),
        "raw_audio_file": audio_file,
        "wav_file": wav_file,
        "asr_file": asr_file,
        "summary_file": event["summary_file"],
        "unused_raw_dir_marker": str(raw_audio),
    }


def load_first_segment_event(summary_file):
    for line in summary_file.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("type") != "summary":
            return row
    raise ValueError(f"missing segment event in {summary_file}")


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


def manifest_item(item):
    return {
        "sample_id": item["sample_id"],
        "room_id": item["room_id"],
        "room_url": f"https://live.douyin.com/{item['room_id']}",
        "captured_at": item["started_at"],
        "duration_sec": 60,
        "effective_duration_sec": 60.0,
        "platform": "macOS",
        "capture_method": "chrome-cdp-video-captureStream-mediarecorder-adaptive-three-route",
        "audio_file": str(item["wav_file"]),
        "raw_audio_file": str(item["raw_audio_file"]),
        "asr_file": str(item["asr_file"]),
        "notes": (
            f"{item['run_id']} adaptive valid capture sample; {item['route']} round {item['round']:02d}; "
            f"{item['room_name']} ({item['room_type']}); suitability={item['suitability']}; "
            f"ASR returned {sentence_count(item['asr_file'])} sentences."
        ),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--adaptive-summary", action="append", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    items = []
    for summary_path in args.adaptive_summary:
        report = load_json(Path(summary_path))
        run_id = report["run_id"]
        for event in report.get("events", []):
            if event.get("type") == "segment" and event.get("ok"):
                items.append(make_item(run_id, event))

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
