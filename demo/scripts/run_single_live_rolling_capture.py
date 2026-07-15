#!/usr/bin/env python3

import argparse
import json
import shutil
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path


CHROME = "Google Chrome"
PROFILE_ROOT = Path("demo/runtime/chrome-profiles")
REPORT_DIR = Path("demo/reports")


def now_stamp():
    return datetime.now(timezone(timedelta(hours=8))).strftime("%Y%m%dT%H%M")


def run(command, timeout=None):
    return subprocess.run(command, text=True, capture_output=True, timeout=timeout)


def cleanup_profile(profile_dir):
    pattern = f"Google Chrome --user-data-dir={profile_dir.resolve()}"
    subprocess.run(["pkill", "-f", pattern], text=True, capture_output=True)
    time.sleep(1)
    if profile_dir.exists():
        shutil.rmtree(profile_dir, ignore_errors=True)


def launch(profile_dir, port, url):
    profile_dir.mkdir(parents=True, exist_ok=True)
    return run([
        "open",
        "-na",
        CHROME,
        "--args",
        f"--user-data-dir={profile_dir.resolve()}",
        "--no-first-run",
        "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
        f"--remote-debugging-port={port}",
        "--new-window",
        url,
    ])


def probe(port, output_path):
    result = run([
        "node",
        "demo/scripts/cdp_live_page_probe.js",
        f"http://127.0.0.1:{port}/json",
    ], timeout=20)
    output_path.write_text(result.stdout if result.stdout.strip() else "{}\n")
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload = {"ok": False, "reason": result.stderr.strip() or "invalid-probe-json"}
    return result, payload


def rolling_capture(port, stream_code, room_id, stamp, segment_count, segment_seconds, min_bytes):
    return run([
        "bash",
        "demo/scripts/rolling_cdp_audio_capture.sh",
        f"http://127.0.0.1:{port}/json",
        stream_code,
        room_id,
        stamp,
        str(segment_count),
        str(segment_seconds),
        "false",
        str(min_bytes),
    ])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--route", default="C1")
    parser.add_argument("--room-id", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--wait-seconds", type=int, default=60)
    parser.add_argument("--segment-count", type=int, default=10)
    parser.add_argument("--segment-seconds", type=int, default=60)
    parser.add_argument("--min-bytes", type=int, default=1000)
    args = parser.parse_args()

    guard = run(["python3", "demo/scripts/check_test_process_guard.py", "--max-chrome", "0"])
    if guard.returncode != 0:
        raise SystemExit("process guard failed before single capture")

    stamp = now_stamp()
    profile_dir = PROFILE_ROOT / f"{args.run_id}-{args.route}-capture"
    url = f"https://live.douyin.com/{args.room_id}"
    probe_path = REPORT_DIR / f"{args.run_id}-{args.route}-page-probe.json"
    summary_path = REPORT_DIR / f"{args.run_id}-{args.route}-rolling-capture-summary.json"
    stream_code = f"{args.run_id}_{args.route}"
    rolling_summary = Path(
        f"demo/reports/rolling-capture-logs/{stream_code}_{args.room_id}_{stamp}_summary.jsonl"
    )

    cleanup_profile(profile_dir)
    launch_result = launch(profile_dir, args.port, url)
    time.sleep(args.wait_seconds)
    capture_result = None
    probe_result = None
    probe_payload = {"ok": False, "reason": "probe-not-run"}
    try:
        probe_result, probe_payload = probe(args.port, probe_path)
        if probe_result.returncode == 0 and probe_payload.get("ok"):
            capture_result = rolling_capture(
                args.port,
                stream_code,
                args.room_id,
                stamp,
                args.segment_count,
                args.segment_seconds,
                args.min_bytes,
            )
    finally:
        cleanup_profile(profile_dir)
        run(["python3", "demo/scripts/check_test_process_guard.py"])

    report = {
        "run_id": args.run_id,
        "route": args.route,
        "room_id": args.room_id,
        "url": url,
        "stamp": stamp,
        "profile_dir": str(profile_dir),
        "launch_returncode": launch_result.returncode,
        "probe_returncode": probe_result.returncode if probe_result else None,
        "probe_ok": bool(probe_payload.get("ok")),
        "probe_reason": probe_payload.get("reason", ""),
        "capture_returncode": capture_result.returncode if capture_result else None,
        "capture_stdout_tail": (capture_result.stdout.strip().splitlines()[-3:] if capture_result else []),
        "capture_stderr_tail": (capture_result.stderr.strip().splitlines()[-5:] if capture_result else []),
        "probe_file": str(probe_path),
        "rolling_summary_file": str(rolling_summary),
    }
    summary_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({
        "output_json": str(summary_path),
        "probe_ok": report["probe_ok"],
        "capture_returncode": report["capture_returncode"],
        "rolling_summary_file": report["rolling_summary_file"],
    }, ensure_ascii=False))
    return 0 if report["probe_ok"] and report["capture_returncode"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
