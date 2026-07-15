#!/usr/bin/env python3

import argparse
import json
import re
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse


CHROME_APP = "Google Chrome"
PROFILE_ROOT = Path("demo/runtime/chrome-profiles")
REPORT_DIR = Path("demo/reports/live-run-manifests")
ROOM_RE = re.compile(r"^\d+$")


def now_iso():
    tz = timezone(timedelta(hours=8))
    return datetime.now(tz).isoformat(timespec="seconds")


def normalize_url(raw):
    parsed = urlparse(raw)
    if parsed.netloc and parsed.netloc != "live.douyin.com":
        raise ValueError(f"unsupported host: {parsed.netloc}")
    path = parsed.path if parsed.netloc else raw
    room_id = path.strip("/").split("/")[0]
    if not ROOM_RE.match(room_id):
        raise ValueError(f"invalid room id in URL: {raw}")
    return room_id, f"https://live.douyin.com/{room_id}"


def run_guard(max_chrome):
    result = subprocess.run(
        [
            "python3",
            "demo/scripts/check_test_process_guard.py",
            "--max-chrome",
            str(max_chrome),
        ],
        text=True,
        capture_output=True,
    )
    return {
        "returncode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
        "ok": result.returncode == 0,
    }


def launch_chrome(profile_dir, url, port):
    profile_dir.mkdir(parents=True, exist_ok=True)
    args = [
        "open",
        "-na",
        CHROME_APP,
        "--args",
        f"--user-data-dir={profile_dir.resolve()}",
        "--no-first-run",
        "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
        f"--remote-debugging-port={port}",
        "--new-window",
        url,
    ]
    return subprocess.run(args, text=True, capture_output=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--url", action="append", required=True, help="provide exactly 3 times")
    parser.add_argument("--launch", action="store_true", help="actually launch Chrome; default is dry-run")
    parser.add_argument("--base-port", type=int, default=9241)
    parser.add_argument("--max-existing-chrome", type=int, default=0)
    args = parser.parse_args()

    if len(args.url) != 3:
        raise SystemExit("exactly 3 --url values are required")

    normalized = []
    seen = set()
    for raw in args.url:
        room_id, url = normalize_url(raw)
        if room_id in seen:
            raise SystemExit(f"duplicate room id: {room_id}")
        seen.add(room_id)
        normalized.append((room_id, url))

    guard = run_guard(args.max_existing_chrome)
    actions = []
    for index, (room_id, url) in enumerate(normalized, start=1):
        suffix = chr(ord("a") + index - 1)
        profile_dir = PROFILE_ROOT / f"{args.run_id}-{suffix}"
        port = args.base_port + index - 1
        item = {
            "index": index,
            "room_id": room_id,
            "url": url,
            "profile_dir": str(profile_dir),
            "debug_port": port,
            "launched": False,
            "returncode": None,
        }
        if args.launch:
            if not guard["ok"]:
                item["launch_skipped_reason"] = "process guard failed"
            else:
                result = launch_chrome(profile_dir, url, port)
                item["launched"] = result.returncode == 0
                item["returncode"] = result.returncode
                item["stdout"] = result.stdout.strip()
                item["stderr"] = result.stderr.strip()
        actions.append(item)

    report = {
        "run_id": args.run_id,
        "created_at": now_iso(),
        "dry_run": not args.launch,
        "guard": guard,
        "actions": actions,
        "rules": [
            "Safari 只用于搜索和获取链接，不用于播放或录制。",
            "所有 URL 规范化为 https://live.douyin.com/{room_id}。",
            "启动前必须通过进程守卫。",
            "每轮只启动 3 个独立 Chrome user-data-dir。",
        ],
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    output = REPORT_DIR / f"{args.run_id}.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({
        "output": str(output),
        "dry_run": report["dry_run"],
        "guard_ok": guard["ok"],
        "planned": len(actions),
        "launched": sum(1 for item in actions if item["launched"]),
    }, ensure_ascii=False))
    return 0 if (not args.launch or guard["ok"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
