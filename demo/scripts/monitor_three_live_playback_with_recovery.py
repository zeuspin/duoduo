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


def candidate_label(candidate):
    return candidate.get("code") or candidate["room_id"]


def make_route(run_id, slot, candidate, base_port):
    return {
        "route": f"C{slot}",
        "slot": slot,
        "candidate": candidate,
        "room_id": candidate["room_id"],
        "url": candidate["url"],
        "port": base_port + slot - 1,
        "profile_dir": PROFILE_ROOT / f"{run_id}-recovery-playback-c{slot}",
        "recovery_count": 0,
        "replacement_count": 0,
    }


def next_candidate(candidates, used_room_ids):
    for candidate in candidates:
        if candidate["room_id"] not in used_room_ids:
            return candidate
    return None


def start_route(route, wait_seconds):
    cleanup_profile(route["profile_dir"])
    launch_result = launch(route["profile_dir"], route["port"], route["url"])
    time.sleep(wait_seconds)
    payload = probe(route["port"])
    return {
        "launch_returncode": launch_result.returncode,
        "launch_stderr": launch_result.stderr.strip(),
        "probe": payload,
    }


def recover_route(route, candidates, used_room_ids, wait_seconds, max_recoveries_per_route):
    raw_reason = route.get("last_probe", {}).get("reason", "")
    can_recover = route["recovery_count"] < max_recoveries_per_route
    action = {
        "route": route["route"],
        "old_room_id": route["room_id"],
        "old_url": route["url"],
        "raw_reason": raw_reason,
        "strategy": "",
        "ok": False,
        "probe": None,
    }
    if not can_recover:
        action["strategy"] = "skip-max-recoveries-reached"
        return action

    if "No live.douyin.com page target" in raw_reason or route.get("last_probe", {}).get("probe_returncode") == 1:
        action["strategy"] = "rebuild-same-room"
    else:
        replacement = next_candidate(candidates, used_room_ids)
        if replacement:
            action["strategy"] = "replace-room"
            route["candidate"] = replacement
            route["room_id"] = replacement["room_id"]
            route["url"] = replacement["url"]
            route["replacement_count"] += 1
            used_room_ids.add(replacement["room_id"])
        else:
            action["strategy"] = "rebuild-same-room-no-standby"

    route["recovery_count"] += 1
    result = start_route(route, wait_seconds)
    payload = result["probe"]
    route["last_probe"] = payload
    action.update({
        "new_room_id": route["room_id"],
        "new_url": route["url"],
        "ok": active_probe_ok(payload),
        "probe": payload,
        "launch_returncode": result["launch_returncode"],
        "launch_stderr": result["launch_stderr"],
    })
    return action


def write_markdown(report, output_md):
    lines = [
        f"# {report['run_id']} 三路匿名播放自愈监控报告",
        "",
        "## 结论",
        "",
        f"- 请求时长：{report['duration_seconds']} 秒",
        f"- 探测间隔：{report['interval_seconds']} 秒",
        f"- 初始可用路数：{report['initial_active_count']} / 3",
        f"- 完成 checkpoint：{report['completed_checkpoints']} / {report['requested_checkpoints']}",
        f"- 恢复动作次数：{report['recovery_event_count']}",
        f"- 全 checkpoint 三路最终可播放：{report['all_checkpoints_three_ok_after_recovery']}",
        f"- 是否发生故障注入：{report['injection_enabled']}",
        f"- 结论：{report['conclusion']}",
        "",
        "## 路由终态",
        "",
        "| route | room_id | recovery_count | replacement_count | url |",
        "| --- | --- | ---: | ---: | --- |",
    ]
    for route in report["routes"]:
        lines.append(
            f"| {route['route']} | `{route['room_id']}` | {route['recovery_count']} | "
            f"{route['replacement_count']} | `{route['url']}` |"
        )

    lines.extend([
        "",
        "## Checkpoints",
        "",
        "| checkpoint | route | raw_ok | final_ok | action | room_id | reason/title |",
        "| ---: | --- | --- | --- | --- | --- | --- |",
    ])
    for checkpoint in report["checkpoints"]:
        for row in checkpoint["routes"]:
            raw = row.get("raw_probe") or {}
            final = row.get("final_probe") or {}
            reason = final.get("pageTitle") or final.get("targetTitle") or final.get("reason") or raw.get("reason", "")
            lines.append(
                f"| {checkpoint['checkpoint']} | {row['route']} | {row['raw_ok']} | "
                f"{row['final_ok']} | {row.get('recovery_action', '')} | `{row['room_id']}` | {reason} |"
            )

    if report["recovery_events"]:
        lines.extend(["", "## 恢复事件", ""])
        for event in report["recovery_events"]:
            lines.append(
                f"- checkpoint={event['checkpoint']} route={event['route']} "
                f"strategy={event['strategy']} old=`{event['old_room_id']}` new=`{event.get('new_room_id')}` ok={event['ok']}"
            )
    output_md.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--candidates", required=True)
    parser.add_argument("--base-port", type=int, default=9821)
    parser.add_argument("--duration-seconds", type=int, default=600)
    parser.add_argument("--interval-seconds", type=int, default=60)
    parser.add_argument("--startup-wait-seconds", type=int, default=35)
    parser.add_argument("--recovery-wait-seconds", type=int, default=25)
    parser.add_argument("--max-recoveries-per-route", type=int, default=3)
    parser.add_argument("--inject-close-checkpoint", type=int, default=0)
    parser.add_argument("--inject-close-route", default="C1")
    args = parser.parse_args()

    if args.duration_seconds < 1 or args.interval_seconds < 1:
        raise SystemExit("duration-seconds and interval-seconds must be positive")
    if args.max_recoveries_per_route < 1:
        raise SystemExit("max-recoveries-per-route must be positive")

    guard = run(["python3", "demo/scripts/check_test_process_guard.py", "--max-chrome", "0"])
    if guard.returncode != 0:
        raise SystemExit("process guard failed before recovery playback monitoring")

    candidates = load_candidates(args.candidates)
    if len(candidates) < 3:
        raise SystemExit("at least 3 candidates are required")

    routes = []
    used_room_ids = set()
    checkpoints = []
    recovery_events = []
    initial_active_count = 0
    requested_checkpoints = max(1, args.duration_seconds // args.interval_seconds)

    try:
        for slot in range(1, 4):
            while True:
                candidate = next_candidate(candidates, used_room_ids)
                if not candidate:
                    break
                used_room_ids.add(candidate["room_id"])
                route = make_route(args.run_id, slot, candidate, args.base_port)
                result = start_route(route, args.startup_wait_seconds)
                route["initial_probe"] = result["probe"]
                route["last_probe"] = result["probe"]
                route["launch_returncode"] = result["launch_returncode"]
                route["launch_stderr"] = result["launch_stderr"]
                if active_probe_ok(result["probe"]):
                    routes.append(route)
                    break
                cleanup_profile(route["profile_dir"])

        initial_active_count = len(routes)
        if initial_active_count < 3:
            conclusion = "No-Go: fewer than 3 anonymous playable rooms at startup"
        else:
            start = time.monotonic()
            for checkpoint in range(1, requested_checkpoints + 1):
                target_elapsed = min(args.duration_seconds, checkpoint * args.interval_seconds)
                sleep_for = start + target_elapsed - time.monotonic()
                if sleep_for > 0:
                    time.sleep(sleep_for)

                injected = False
                if args.inject_close_checkpoint == checkpoint:
                    for route in routes:
                        if route["route"] == args.inject_close_route:
                            cleanup_profile(route["profile_dir"])
                            injected = True
                            break

                rows = []
                for route in routes:
                    raw = probe(route["port"])
                    route["last_probe"] = raw
                    raw_ok = active_probe_ok(raw)
                    final = raw
                    action_name = "none"
                    recovery_action = None
                    if not raw_ok:
                        recovery_action = recover_route(
                            route,
                            candidates,
                            used_room_ids,
                            args.recovery_wait_seconds,
                            args.max_recoveries_per_route,
                        )
                        recovery_action["checkpoint"] = checkpoint
                        recovery_events.append(recovery_action)
                        final = recovery_action.get("probe") or raw
                        action_name = recovery_action["strategy"]
                    rows.append({
                        "route": route["route"],
                        "room_id": route["room_id"],
                        "raw_ok": raw_ok,
                        "final_ok": active_probe_ok(final),
                        "raw_probe": raw,
                        "final_probe": final,
                        "recovery_action": action_name,
                    })

                checkpoints.append({
                    "checkpoint": checkpoint,
                    "elapsed_seconds": round(time.monotonic() - start, 2),
                    "injected_close": injected,
                    "routes": rows,
                    "three_ok_after_recovery": all(row["final_ok"] for row in rows),
                })

            conclusion = (
                "Pass"
                if checkpoints and all(item["three_ok_after_recovery"] for item in checkpoints)
                else "Completed with one or more unrecovered playback checkpoints"
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
        "requested_checkpoints": requested_checkpoints,
        "completed_checkpoints": len(checkpoints),
        "initial_active_count": initial_active_count,
        "recovery_event_count": len(recovery_events),
        "injection_enabled": bool(args.inject_close_checkpoint),
        "inject_close_checkpoint": args.inject_close_checkpoint,
        "inject_close_route": args.inject_close_route,
        "all_checkpoints_three_ok_after_recovery": bool(checkpoints) and all(
            item["three_ok_after_recovery"] for item in checkpoints
        ),
        "conclusion": conclusion,
        "routes": [
            {**route, "profile_dir": str(route["profile_dir"])}
            for route in routes
        ],
        "checkpoints": checkpoints,
        "recovery_events": recovery_events,
    }
    output_json = REPORT_DIR / f"{args.run_id}-three-route-playback-recovery-monitor.json"
    output_md = REPORT_DIR / f"{args.run_id}-three-route-playback-recovery-monitor.md"
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str) + "\n")
    write_markdown(report, output_md)
    print(json.dumps({
        "output_json": str(output_json),
        "output_md": str(output_md),
        "initial_active_count": initial_active_count,
        "completed_checkpoints": len(checkpoints),
        "recovery_event_count": len(recovery_events),
        "all_checkpoints_three_ok_after_recovery": report["all_checkpoints_three_ok_after_recovery"],
        "conclusion": conclusion,
    }, ensure_ascii=False))
    return 0 if report["all_checkpoints_three_ok_after_recovery"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
