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


def now_iso():
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


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


def probe(port, timeout=20):
    result = run([
        "node",
        "demo/scripts/cdp_live_page_probe.js",
        f"http://127.0.0.1:{port}/json",
    ], timeout=timeout)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload = {"ok": False, "reason": result.stderr.strip() or "invalid-probe-json"}
    payload["probe_returncode"] = result.returncode
    return payload


def load_candidates(path):
    data = json.loads(Path(path).read_text())
    return data.get("candidates", [])


def active_probe_ok(row):
    return bool(row.get("ok")) and int(row.get("audioTrackCount") or 0) > 0


def write_markdown(report, output_md):
    lines = [
        f"# {report['run_id']} 三路匿名播放监控报告",
        "",
        "## 结论",
        "",
        f"- 请求时长：{report['duration_seconds']} 秒",
        f"- 探测间隔：{report['interval_seconds']} 秒",
        f"- 初始可用路数：{report['initial_active_count']} / 3",
        f"- 完成 checkpoint：{report['completed_checkpoints']} / {report['requested_checkpoints']}",
        f"- 全 checkpoint 三路可播放：{report['all_checkpoints_three_ok']}",
        f"- 结论：{report['conclusion']}",
        "",
        "## 路由",
        "",
        "| route | room_id | url |",
        "| --- | --- | --- |",
    ]
    for route in report["routes"]:
        lines.append(f"| {route['route']} | `{route['room_id']}` | `{route['url']}` |")
    lines.extend([
        "",
        "## Checkpoints",
        "",
        "| checkpoint | route | ok | audio | readyState | play | title/reason |",
        "| ---: | --- | --- | ---: | ---: | --- | --- |",
    ])
    for checkpoint in report["checkpoints"]:
        for row in checkpoint["routes"]:
            selected = row.get("selected") or {}
            title_or_reason = row.get("pageTitle") or row.get("targetTitle") or row.get("reason") or ""
            lines.append(
                f"| {checkpoint['checkpoint']} | {row['route']} | {row.get('ok')} | "
                f"{row.get('audioTrackCount')} | {selected.get('readyState')} | "
                f"{row.get('playAttempt')} | {title_or_reason} |"
            )
    output_md.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--candidates", required=True)
    parser.add_argument("--base-port", type=int, default=9721)
    parser.add_argument("--duration-seconds", type=int, default=600)
    parser.add_argument("--interval-seconds", type=int, default=60)
    parser.add_argument("--startup-wait-seconds", type=int, default=35)
    args = parser.parse_args()

    if args.duration_seconds < 1 or args.interval_seconds < 1:
        raise SystemExit("duration-seconds and interval-seconds must be positive")

    guard = run(["python3", "demo/scripts/check_test_process_guard.py", "--max-chrome", "0"])
    if guard.returncode != 0:
        raise SystemExit("process guard failed before playback monitoring")

    candidates = load_candidates(args.candidates)
    if len(candidates) < 3:
        raise SystemExit("at least 3 candidates are required")

    routes = []
    used = set()
    candidate_index = 0
    try:
        for slot in range(1, 4):
            while candidate_index < len(candidates):
                candidate = candidates[candidate_index]
                candidate_index += 1
                if candidate["room_id"] in used:
                    continue
                used.add(candidate["room_id"])
                route = {
                    "route": f"C{slot}",
                    "room_id": candidate["room_id"],
                    "url": candidate["url"],
                    "port": args.base_port + slot - 1,
                    "profile_dir": PROFILE_ROOT / f"{args.run_id}-playback-c{slot}",
                }
                cleanup_profile(route["profile_dir"])
                launch_result = launch(route["profile_dir"], route["port"], route["url"])
                route["launch_returncode"] = launch_result.returncode
                time.sleep(args.startup_wait_seconds)
                initial = probe(route["port"])
                route["initial_probe"] = initial
                if active_probe_ok(initial):
                    routes.append(route)
                    break
                cleanup_profile(route["profile_dir"])

        initial_active_count = len(routes)
        checkpoints = []
        requested_checkpoints = max(1, args.duration_seconds // args.interval_seconds)
        if initial_active_count < 3:
            conclusion = "No-Go: fewer than 3 anonymous playable rooms at startup"
        else:
            start = time.monotonic()
            for checkpoint in range(1, requested_checkpoints + 1):
                target_elapsed = min(args.duration_seconds, checkpoint * args.interval_seconds)
                sleep_for = start + target_elapsed - time.monotonic()
                if sleep_for > 0:
                    time.sleep(sleep_for)
                rows = []
                for route in routes:
                    payload = probe(route["port"])
                    payload["route"] = route["route"]
                    payload["room_id"] = route["room_id"]
                    rows.append(payload)
                checkpoints.append({
                    "checkpoint": checkpoint,
                    "elapsed_seconds": round(time.monotonic() - start, 2),
                    "routes": rows,
                    "three_ok": all(active_probe_ok(row) for row in rows),
                })
            conclusion = (
                "Pass"
                if checkpoints and all(item["three_ok"] for item in checkpoints)
                else "Completed with one or more failed playback checkpoints"
            )
    finally:
        for route in routes:
            cleanup_profile(route["profile_dir"])
        run(["python3", "demo/scripts/check_test_process_guard.py"])

    report = {
        "run_id": args.run_id,
        "created_at": now_iso(),
        "duration_seconds": args.duration_seconds,
        "interval_seconds": args.interval_seconds,
        "requested_checkpoints": max(1, args.duration_seconds // args.interval_seconds),
        "completed_checkpoints": len(checkpoints),
        "initial_active_count": initial_active_count,
        "all_checkpoints_three_ok": bool(checkpoints) and all(item["three_ok"] for item in checkpoints),
        "conclusion": conclusion,
        "routes": [
            {**route, "profile_dir": str(route["profile_dir"])}
            for route in routes
        ],
        "checkpoints": checkpoints,
    }
    output_json = REPORT_DIR / f"{args.run_id}-three-route-playback-monitor.json"
    output_md = REPORT_DIR / f"{args.run_id}-three-route-playback-monitor.md"
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(report, output_md)
    print(json.dumps({
        "output_json": str(output_json),
        "output_md": str(output_md),
        "initial_active_count": initial_active_count,
        "completed_checkpoints": len(checkpoints),
        "all_checkpoints_three_ok": report["all_checkpoints_three_ok"],
        "conclusion": conclusion,
    }, ensure_ascii=False))
    return 0 if report["all_checkpoints_three_ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
