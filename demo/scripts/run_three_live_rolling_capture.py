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


def launch(profile_dir, port, room_id):
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
        f"https://live.douyin.com/{room_id}",
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


def start_capture(port, stream_code, room_id, stamp, segment_count, segment_seconds, min_bytes):
    return subprocess.Popen(
        [
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
        ],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--room-id", action="append", required=True, help="provide exactly 3 times")
    parser.add_argument("--base-port", type=int, default=9381)
    parser.add_argument("--wait-seconds", type=int, default=60)
    parser.add_argument("--segment-count", type=int, default=10)
    parser.add_argument("--segment-seconds", type=int, default=60)
    parser.add_argument("--min-bytes", type=int, default=1000)
    args = parser.parse_args()

    if len(args.room_id) != 3:
        raise SystemExit("exactly 3 --room-id values are required")
    if len(set(args.room_id)) != 3:
        raise SystemExit("room ids must be unique")

    guard = run(["python3", "demo/scripts/check_test_process_guard.py", "--max-chrome", "0"])
    if guard.returncode != 0:
        raise SystemExit("process guard failed before three-route capture")

    stamp = now_stamp()
    routes = []
    for index, room_id in enumerate(args.room_id, start=1):
        route = f"C{index}"
        port = args.base_port + index - 1
        profile_dir = PROFILE_ROOT / f"{args.run_id}-{route}-capture"
        routes.append({
            "route": route,
            "room_id": room_id,
            "port": port,
            "profile_dir": profile_dir,
            "stream_code": f"{args.run_id}_{route}",
        })

    for route in routes:
        cleanup_profile(route["profile_dir"])

    try:
        for route in routes:
            launch_result = launch(route["profile_dir"], route["port"], route["room_id"])
            route["launch_returncode"] = launch_result.returncode
            route["launch_stderr"] = launch_result.stderr.strip()

        time.sleep(args.wait_seconds)

        all_probe_ok = True
        for route in routes:
            probe_path = REPORT_DIR / f"{args.run_id}-{route['route']}-page-probe.json"
            probe_result, probe_payload = probe(route["port"], probe_path)
            route["probe_file"] = str(probe_path)
            route["probe_returncode"] = probe_result.returncode
            route["probe_ok"] = bool(probe_payload.get("ok"))
            route["probe_reason"] = probe_payload.get("reason", "")
            route["page_title"] = probe_payload.get("pageTitle") or probe_payload.get("targetTitle")
            route["audio_track_count"] = probe_payload.get("audioTrackCount")
            if not route["probe_ok"]:
                all_probe_ok = False

        processes = []
        if all_probe_ok:
            for route in routes:
                process = start_capture(
                    route["port"],
                    route["stream_code"],
                    route["room_id"],
                    stamp,
                    args.segment_count,
                    args.segment_seconds,
                    args.min_bytes,
                )
                route["rolling_summary_file"] = (
                    f"demo/reports/rolling-capture-logs/"
                    f"{route['stream_code']}_{route['room_id']}_{stamp}_summary.jsonl"
                )
                processes.append((route, process))

            for route, process in processes:
                stdout, stderr = process.communicate()
                route["capture_returncode"] = process.returncode
                route["capture_stdout_tail"] = stdout.strip().splitlines()[-3:]
                route["capture_stderr_tail"] = stderr.strip().splitlines()[-5:]
        else:
            for route in routes:
                route.setdefault("capture_returncode", None)
                route.setdefault("rolling_summary_file", "")
    finally:
        for route in routes:
            cleanup_profile(route["profile_dir"])
        run(["python3", "demo/scripts/check_test_process_guard.py"])

    report = {
        "run_id": args.run_id,
        "stamp": stamp,
        "room_ids": args.room_id,
        "all_probe_ok": all(route.get("probe_ok") for route in routes),
        "all_capture_ok": all(route.get("capture_returncode") == 0 for route in routes),
        "routes": [
            {
                **route,
                "profile_dir": str(route["profile_dir"]),
            }
            for route in routes
        ],
    }
    output = REPORT_DIR / f"{args.run_id}-three-route-rolling-capture-summary.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({
        "output_json": str(output),
        "all_probe_ok": report["all_probe_ok"],
        "all_capture_ok": report["all_capture_ok"],
        "routes": [
            {
                "route": route["route"],
                "room_id": route["room_id"],
                "probe_ok": route.get("probe_ok"),
                "capture_returncode": route.get("capture_returncode"),
            }
            for route in routes
        ],
    }, ensure_ascii=False))
    return 0 if report["all_probe_ok"] and report["all_capture_ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
