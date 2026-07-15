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


def active_probe_ok(row):
    selected = row.get("selected") or {}
    return (
        bool(row.get("ok"))
        and int(row.get("audioTrackCount") or 0) > 0
        and int(selected.get("readyState") or 0) >= 2
    )


def load_candidates(path):
    data = json.loads(Path(path).read_text())
    return data.get("candidates", [])


def write_markdown(report, output_md):
    lines = [
        f"# {report['run_id']} 三路关闭干扰测试报告",
        "",
        "## 结论",
        "",
        f"- 初始三路可播放：{report['initial_three_ok']}",
        f"- 关闭路由：{report['closed_route']}",
        f"- 关闭后剩余两路可播放：{report['remaining_routes_ok_after_close']}",
        f"- 是否通过：{report['pass']}",
        "",
        "## 初始探测",
        "",
        "| route | room_id | ok | audio | readyState | play | title/reason |",
        "| --- | --- | --- | ---: | ---: | --- | --- |",
    ]
    for row in report["initial_probes"]:
        selected = row.get("selected") or {}
        title_or_reason = row.get("pageTitle") or row.get("targetTitle") or row.get("reason") or ""
        lines.append(
            f"| {row['route']} | `{row['room_id']}` | {row.get('ok')} | "
            f"{row.get('audioTrackCount')} | {selected.get('readyState')} | "
            f"{row.get('playAttempt')} | {title_or_reason} |"
        )
    lines.extend([
        "",
        "## 关闭后探测",
        "",
        "| route | room_id | ok | audio | readyState | play | title/reason |",
        "| --- | --- | --- | ---: | ---: | --- | --- |",
    ])
    for row in report["after_close_probes"]:
        selected = row.get("selected") or {}
        title_or_reason = row.get("pageTitle") or row.get("targetTitle") or row.get("reason") or ""
        lines.append(
            f"| {row['route']} | `{row['room_id']}` | {row.get('ok')} | "
            f"{row.get('audioTrackCount')} | {selected.get('readyState')} | "
            f"{row.get('playAttempt')} | {title_or_reason} |"
        )
    output_md.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--candidates", required=True)
    parser.add_argument("--base-port", type=int, default=9761)
    parser.add_argument("--startup-wait-seconds", type=int, default=30)
    parser.add_argument("--after-close-wait-seconds", type=int, default=20)
    parser.add_argument("--close-route", default="C1", choices=["C1", "C2", "C3"])
    args = parser.parse_args()

    guard = run(["python3", "demo/scripts/check_test_process_guard.py", "--max-chrome", "0"])
    if guard.returncode != 0:
        raise SystemExit("process guard failed before interference test")

    candidates = load_candidates(args.candidates)
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
                    "profile_dir": PROFILE_ROOT / f"{args.run_id}-interference-c{slot}",
                }
                cleanup_profile(route["profile_dir"])
                launch(route["profile_dir"], route["port"], route["url"])
                time.sleep(args.startup_wait_seconds)
                first_probe = probe(route["port"])
                if active_probe_ok(first_probe):
                    route["initial_probe"] = first_probe
                    routes.append(route)
                    break
                cleanup_profile(route["profile_dir"])

        initial_probes = []
        for route in routes:
            payload = probe(route["port"])
            payload["route"] = route["route"]
            payload["room_id"] = route["room_id"]
            initial_probes.append(payload)
        initial_three_ok = len(routes) == 3 and all(active_probe_ok(row) for row in initial_probes)

        closed_route = next((route for route in routes if route["route"] == args.close_route), None)
        if closed_route:
            cleanup_profile(closed_route["profile_dir"])
        time.sleep(args.after_close_wait_seconds)

        after_close_probes = []
        for route in routes:
            if route["route"] == args.close_route:
                continue
            payload = probe(route["port"])
            payload["route"] = route["route"]
            payload["room_id"] = route["room_id"]
            after_close_probes.append(payload)
        remaining_ok = bool(after_close_probes) and all(active_probe_ok(row) for row in after_close_probes)
    finally:
        for route in routes:
            cleanup_profile(route["profile_dir"])
        run(["python3", "demo/scripts/check_test_process_guard.py"])

    report = {
        "run_id": args.run_id,
        "created_at": now_iso(),
        "closed_route": args.close_route,
        "initial_three_ok": initial_three_ok,
        "remaining_routes_ok_after_close": remaining_ok,
        "pass": initial_three_ok and remaining_ok,
        "routes": [
            {**route, "profile_dir": str(route["profile_dir"])}
            for route in routes
        ],
        "initial_probes": initial_probes,
        "after_close_probes": after_close_probes,
    }
    output_json = REPORT_DIR / f"{args.run_id}-three-route-interference-test.json"
    output_md = REPORT_DIR / f"{args.run_id}-three-route-interference-test.md"
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(report, output_md)
    print(json.dumps({
        "output_json": str(output_json),
        "output_md": str(output_md),
        "initial_three_ok": report["initial_three_ok"],
        "remaining_routes_ok_after_close": report["remaining_routes_ok_after_close"],
        "pass": report["pass"],
    }, ensure_ascii=False))
    return 0 if report["pass"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
