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


def probe(port):
    result = run([
        "node",
        "demo/scripts/cdp_live_page_probe.js",
        f"http://127.0.0.1:{port}/json",
    ], timeout=20)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload = {"ok": False, "reason": result.stderr.strip() or "invalid-probe-json"}
    return result, payload


def probe_batch(run_id, candidates, base_port, wait_seconds):
    launched = []
    for index, candidate in enumerate(candidates):
        port = base_port + index
        profile_dir = PROFILE_ROOT / f"{run_id}-{candidate['code'].lower()}-gate"
        cleanup_profile(profile_dir)
        launch_result = launch(profile_dir, port, candidate["url"])
        launched.append({
            **candidate,
            "port": port,
            "profile_dir": profile_dir,
            "launch_returncode": launch_result.returncode,
            "launch_stderr": launch_result.stderr.strip(),
        })

    time.sleep(wait_seconds)

    rows = []
    for item in launched:
        try:
            probe_result, payload = probe(item["port"])
            probe_file = REPORT_DIR / f"{run_id}-{item['code'].lower()}-gate-probe.json"
            probe_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
            selected = payload.get("selected") or {}
            rows.append({
                "code": item["code"],
                "room_id": item["room_id"],
                "url": item["url"],
                "probe_ok": bool(payload.get("ok")),
                "reason": payload.get("reason", ""),
                "page_title": payload.get("pageTitle") or payload.get("targetTitle"),
                "audio_track_count": payload.get("audioTrackCount"),
                "video_track_count": payload.get("videoTrackCount"),
                "ready_state": selected.get("readyState"),
                "network_state": selected.get("networkState"),
                "play_attempt": payload.get("playAttempt"),
                "probe_returncode": probe_result.returncode,
                "probe_file": str(probe_file),
            })
        finally:
            cleanup_profile(item["profile_dir"])
    return rows


def write_reports(run_id, rows, output_json, output_md):
    ok_rows = [row for row in rows if row["probe_ok"]]
    report = {
        "run_id": run_id,
        "created_at": now_iso(),
        "probe_ok_count": len(ok_rows),
        "can_run_three_route_capture": len(ok_rows) >= 3,
        "recommended_room_ids": [row["room_id"] for row in ok_rows[:3]],
        "candidates": rows,
    }
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")

    lines = [
        f"# {run_id} 用户指定候选门禁复查",
        "",
        "## 结论",
        "",
    ]
    if report["can_run_three_route_capture"]:
        lines.append(f"- 当前可捕获候选 {len(ok_rows)} 个，可以继续三路短切片验证。")
        lines.append(f"- 推荐前三个：`{', '.join(report['recommended_room_ids'])}`。")
    else:
        lines.append(f"- 当前可捕获候选 {len(ok_rows)} 个，少于 3 个，不继续三路录制。")
    lines.extend([
        "",
        "| 编号 | room_id | probe_ok | audio | readyState | play | 标题 / 原因 |",
        "| --- | --- | --- | ---: | ---: | --- | --- |",
    ])
    for row in rows:
        title_or_reason = row["page_title"] if row["probe_ok"] else row["reason"]
        lines.append(
            f"| {row['code']} | `{row['room_id']}` | {row['probe_ok']} | "
            f"{row['audio_track_count']} | {row['ready_state']} | {row['play_attempt']} | {title_or_reason} |"
        )
    output_md.write_text("\n".join(lines) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--candidates", default="demo/reports/user-specified-live-candidates-20260709.json")
    parser.add_argument("--base-port", type=int, default=9451)
    parser.add_argument("--wait-seconds", type=int, default=45)
    parser.add_argument("--batch-size", type=int, default=3)
    args = parser.parse_args()

    if args.batch_size < 1 or args.batch_size > 3:
        raise SystemExit("batch-size must be between 1 and 3")

    guard = run(["python3", "demo/scripts/check_test_process_guard.py", "--max-chrome", "0"])
    if guard.returncode != 0:
        raise SystemExit("process guard failed before candidate probing")

    data = json.loads(Path(args.candidates).read_text())
    candidates = data.get("candidates", [])
    rows = []
    for offset in range(0, len(candidates), args.batch_size):
        batch = candidates[offset:offset + args.batch_size]
        rows.extend(probe_batch(
            args.run_id,
            batch,
            args.base_port + offset,
            args.wait_seconds,
        ))

    output_json = REPORT_DIR / f"{args.run_id}-user-candidates-gate.json"
    output_md = REPORT_DIR / f"{args.run_id}-user-candidates-gate.md"
    report = write_reports(args.run_id, rows, output_json, output_md)
    run(["python3", "demo/scripts/check_test_process_guard.py"])
    print(json.dumps({
        "output_json": str(output_json),
        "output_md": str(output_md),
        "probe_ok_count": report["probe_ok_count"],
        "can_run_three_route_capture": report["can_run_three_route_capture"],
        "recommended_room_ids": report["recommended_room_ids"],
    }, ensure_ascii=False))
    return 0 if report["can_run_three_route_capture"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
