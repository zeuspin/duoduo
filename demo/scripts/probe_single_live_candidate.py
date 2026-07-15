#!/usr/bin/env python3

import argparse
import json
import subprocess
import time
from pathlib import Path


CHROME = "Google Chrome"


def run(command, timeout=None):
    return subprocess.run(command, text=True, capture_output=True, timeout=timeout)


def launch(profile_dir, port, url):
    Path(profile_dir).mkdir(parents=True, exist_ok=True)
    return run([
        "open",
        "-na",
        CHROME,
        "--args",
        f"--user-data-dir={Path(profile_dir).resolve()}",
        "--no-first-run",
        "--no-default-browser-check",
        "--autoplay-policy=no-user-gesture-required",
        f"--remote-debugging-port={port}",
        "--new-window",
        url,
    ])


def cleanup(profile_dir):
    pattern = f"Google Chrome --user-data-dir={Path(profile_dir).resolve()}"
    subprocess.run(["pkill", "-f", pattern], text=True, capture_output=True)


def probe(port, output_path):
    result = run([
        "node",
        "demo/scripts/cdp_live_page_probe.js",
        f"http://127.0.0.1:{port}/json",
    ], timeout=20)
    payload = {
        "command_returncode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }
    try:
        payload["probe"] = json.loads(result.stdout)
    except json.JSONDecodeError:
        payload["probe"] = None
    Path(output_path).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--wait-seconds", type=int, default=45)
    parser.add_argument("--output-json", required=True)
    args = parser.parse_args()

    profile_dir = f"demo/runtime/chrome-profiles/{args.run_id}"
    cleanup(profile_dir)
    launch_result = launch(profile_dir, args.port, args.url)
    time.sleep(args.wait_seconds)
    try:
        payload = probe(args.port, args.output_json)
    finally:
        cleanup(profile_dir)
        time.sleep(2)
    summary = {
        "output_json": args.output_json,
        "url": args.url,
        "launch_returncode": launch_result.returncode,
        "probe_returncode": payload["command_returncode"],
        "probe_ok": bool((payload.get("probe") or {}).get("ok")),
        "reason": (payload.get("probe") or {}).get("reason") or payload.get("stderr"),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0 if summary["probe_ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
