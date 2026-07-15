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
LOG_DIR = REPORT_DIR / "rolling-capture-logs"


def now_stamp():
    return datetime.now(timezone(timedelta(hours=8))).strftime("%Y%m%dT%H%M%S")


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


def probe(port, output_path, timeout=20):
    result = run([
        "node",
        "demo/scripts/cdp_live_page_probe.js",
        f"http://127.0.0.1:{port}/json",
    ], timeout=timeout)
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload = {"ok": False, "reason": result.stderr.strip() or "invalid-probe-json"}
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    return result, payload


def capture_one_segment(port, stream_code, room_id, stamp, segment_seconds, min_bytes):
    command = [
        "bash",
        "demo/scripts/rolling_cdp_audio_capture.sh",
        f"http://127.0.0.1:{port}/json",
        stream_code,
        room_id,
        stamp,
        "1",
        str(segment_seconds),
        "false",
        str(min_bytes),
    ]
    return subprocess.Popen(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def read_first_summary_event(summary_file):
    if not summary_file.exists():
        return {"ok": False, "reason": "missing-summary-file"}
    for line in summary_file.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("type") != "summary":
            return row
    return {"ok": False, "reason": "missing-segment-event"}


def candidate_label(candidate):
    return candidate.get("code") or candidate["room_id"]


def make_route(run_id, slot, candidate, base_port):
    return {
        "slot": slot,
        "route": f"C{slot}",
        "candidate": candidate,
        "room_id": candidate["room_id"],
        "url": candidate["url"],
        "port": base_port + slot - 1,
        "profile_dir": PROFILE_ROOT / f"{run_id}-adaptive-c{slot}",
        "failure_streak": 0,
        "replacement_count": 0,
        "active": False,
    }


def launch_and_probe_route(run_id, route, wait_seconds):
    cleanup_profile(route["profile_dir"])
    launch_result = launch(route["profile_dir"], route["port"], route["url"])
    time.sleep(wait_seconds)
    probe_file = REPORT_DIR / f"{run_id}-{route['route']}-{candidate_label(route['candidate']).lower()}-adaptive-probe.json"
    probe_result, payload = probe(route["port"], probe_file)
    route.update({
        "launch_returncode": launch_result.returncode,
        "launch_stderr": launch_result.stderr.strip(),
        "probe_file": str(probe_file),
        "probe_returncode": probe_result.returncode,
        "probe_ok": bool(payload.get("ok")),
        "probe_reason": payload.get("reason", ""),
        "page_title": payload.get("pageTitle") or payload.get("targetTitle"),
        "audio_track_count": payload.get("audioTrackCount"),
        "active": bool(payload.get("ok")),
    })
    return route["active"]


def next_candidate(candidates, used_room_ids):
    for candidate in candidates:
        if candidate["room_id"] not in used_room_ids:
            return candidate
    return None


def write_report(run_id, report):
    output_json = REPORT_DIR / f"{run_id}-adaptive-three-route-capture-summary.json"
    output_md = REPORT_DIR / f"{run_id}-adaptive-three-route-capture-summary.md"
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str) + "\n")

    lines = [
        f"# {run_id} 自适应三路捕获报告",
        "",
        "## 结论",
        "",
        f"- 初始可用路数：{report['initial_active_count']} / 3",
        f"- 完成切片轮数：{report['completed_rounds']} / {report['requested_rounds']}",
        f"- 触发换源次数：{report['replacement_events']}",
        f"- 是否满足三路全程有效：{report['all_rounds_three_valid']}",
        f"- 结论：{report['conclusion']}",
        "",
        "## 切片明细",
        "",
        "| round | route | room_id | ok | reason | bytes | action |",
        "| ---: | --- | --- | --- | --- | ---: | --- |",
    ]
    for event in report["events"]:
        if event["type"] != "segment":
            continue
        lines.append(
            f"| {event['round']} | {event['route']} | `{event['room_id']}` | "
            f"{event['ok']} | {event.get('reason', '')} | {event.get('bytes', 0)} | {event.get('action', '')} |"
        )
    if report["events"]:
        lines.extend(["", "## 换源 / 异常事件", ""])
        for event in report["events"]:
            if event["type"] == "segment":
                continue
            lines.append(f"- `{event['type']}` round={event.get('round')} route={event.get('route')} {event.get('message', '')}")
    output_md.write_text("\n".join(lines) + "\n")
    return output_json, output_md


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--candidates", default="demo/reports/user-specified-live-candidates-20260709.json")
    parser.add_argument("--base-port", type=int, default=9521)
    parser.add_argument("--wait-seconds", type=int, default=45)
    parser.add_argument("--segment-count", type=int, default=10)
    parser.add_argument("--segment-seconds", type=int, default=60)
    parser.add_argument("--min-bytes", type=int, default=1000)
    parser.add_argument("--replace-after-failures", type=int, default=1)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.segment_count < 1 or args.segment_seconds < 1:
        raise SystemExit("segment-count and segment-seconds must be positive")
    if args.replace_after_failures < 1:
        raise SystemExit("replace-after-failures must be positive")

    data = json.loads(Path(args.candidates).read_text())
    candidates = data.get("candidates", [])
    if len(candidates) < 3:
        raise SystemExit("at least 3 candidates are required")

    if args.dry_run:
        report = {
            "run_id": args.run_id,
            "created_at": now_iso(),
            "dry_run": True,
            "candidate_count": len(candidates),
            "requested_rounds": args.segment_count,
            "completed_rounds": 0,
            "initial_active_count": 0,
            "replacement_events": 0,
            "all_rounds_three_valid": False,
            "conclusion": "dry-run only; no live capture attempted",
            "events": [],
        }
        output_json, output_md = write_report(args.run_id, report)
        print(json.dumps({"output_json": str(output_json), "output_md": str(output_md), "dry_run": True}, ensure_ascii=False))
        return 0

    guard = run(["python3", "demo/scripts/check_test_process_guard.py", "--max-chrome", "0"])
    if guard.returncode != 0:
        raise SystemExit("process guard failed before adaptive capture")

    events = []
    used_room_ids = set()
    routes = []
    try:
        for slot in range(1, 4):
            while True:
                candidate = next_candidate(candidates, used_room_ids)
                if not candidate:
                    break
                used_room_ids.add(candidate["room_id"])
                route = make_route(args.run_id, slot, candidate, args.base_port)
                ok = launch_and_probe_route(args.run_id, route, args.wait_seconds)
                events.append({
                    "type": "initial_probe",
                    "route": route["route"],
                    "room_id": route["room_id"],
                    "ok": ok,
                    "message": route.get("probe_reason") or route.get("page_title") or "",
                })
                if ok:
                    routes.append(route)
                    break
                cleanup_profile(route["profile_dir"])

        active_count = sum(1 for route in routes if route["active"])
        completed_rounds = 0
        replacement_events = 0
        all_rounds_three_valid = active_count == 3

        if active_count < 3:
            conclusion = "No-Go: initial capturable rooms fewer than 3; adaptive capture not started"
        else:
            conclusion = "completed"
            for round_index in range(1, args.segment_count + 1):
                stamp = f"{now_stamp()}_r{round_index:02d}"
                processes = []
                for route in routes:
                    if route["active"]:
                        stream_code = f"{args.run_id}_{route['route']}"
                        process = capture_one_segment(
                            route["port"],
                            stream_code,
                            route["room_id"],
                            stamp,
                            args.segment_seconds,
                            args.min_bytes,
                        )
                        processes.append((route, stream_code, stamp, process))

                round_valid = True
                for route, stream_code, segment_stamp, process in processes:
                    stdout, stderr = process.communicate()
                    summary_file = LOG_DIR / f"{stream_code}_{route['room_id']}_{segment_stamp}_summary.jsonl"
                    row = read_first_summary_event(summary_file)
                    ok = process.returncode == 0 and bool(row.get("ok"))
                    if ok:
                        route["failure_streak"] = 0
                    else:
                        route["failure_streak"] += 1
                        round_valid = False
                    event = {
                        "type": "segment",
                        "round": round_index,
                        "route": route["route"],
                        "room_id": route["room_id"],
                        "ok": ok,
                        "reason": row.get("reason", ""),
                        "bytes": row.get("bytes", 0),
                        "summary_file": str(summary_file),
                        "stdout_tail": stdout.strip().splitlines()[-3:],
                        "stderr_tail": stderr.strip().splitlines()[-5:],
                        "action": "keep",
                    }
                    events.append(event)

                    if route["failure_streak"] >= args.replace_after_failures:
                        replacement = next_candidate(candidates, used_room_ids)
                        if not replacement:
                            route["active"] = False
                            event["action"] = "deactivate-no-standby"
                            events.append({
                                "type": "replacement_failed",
                                "round": round_index,
                                "route": route["route"],
                                "room_id": route["room_id"],
                                "message": "no unused standby candidate available",
                            })
                            continue
                        old_room = route["room_id"]
                        cleanup_profile(route["profile_dir"])
                        route.update({
                            "candidate": replacement,
                            "room_id": replacement["room_id"],
                            "url": replacement["url"],
                            "failure_streak": 0,
                            "replacement_count": route["replacement_count"] + 1,
                            "active": False,
                        })
                        used_room_ids.add(replacement["room_id"])
                        replacement_events += 1
                        replacement_ok = launch_and_probe_route(args.run_id, route, args.wait_seconds)
                        event["action"] = "replace"
                        events.append({
                            "type": "replacement",
                            "round": round_index,
                            "route": route["route"],
                            "old_room_id": old_room,
                            "room_id": replacement["room_id"],
                            "ok": replacement_ok,
                            "message": route.get("probe_reason") or route.get("page_title") or "",
                        })
                        if not replacement_ok:
                            round_valid = False

                completed_rounds = round_index
                if not round_valid or sum(1 for route in routes if route["active"]) < 3:
                    all_rounds_three_valid = False
                if sum(1 for route in routes if route["active"]) < 3:
                    conclusion = "No-Go: active capturable routes dropped below 3 and no usable standby remained"
                    break
            else:
                conclusion = "Pass" if all_rounds_three_valid else "Completed with replacements or invalid segments; not a stable three-route pass"
    finally:
        for route in routes:
            cleanup_profile(route["profile_dir"])
        run(["python3", "demo/scripts/check_test_process_guard.py"])

    report = {
        "run_id": args.run_id,
        "created_at": now_iso(),
        "dry_run": False,
        "candidate_count": len(candidates),
        "requested_rounds": args.segment_count,
        "completed_rounds": completed_rounds,
        "initial_active_count": active_count,
        "replacement_events": replacement_events,
        "all_rounds_three_valid": all_rounds_three_valid,
        "conclusion": conclusion,
        "routes": [
            {
                **route,
                "profile_dir": str(route["profile_dir"]),
            }
            for route in routes
        ],
        "events": events,
    }
    output_json, output_md = write_report(args.run_id, report)
    print(json.dumps({
        "output_json": str(output_json),
        "output_md": str(output_md),
        "initial_active_count": active_count,
        "replacement_events": replacement_events,
        "all_rounds_three_valid": all_rounds_three_valid,
        "conclusion": conclusion,
    }, ensure_ascii=False))
    return 0 if all_rounds_three_valid else 2


if __name__ == "__main__":
    raise SystemExit(main())
