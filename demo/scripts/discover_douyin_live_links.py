#!/usr/bin/env python3

import argparse
import json
import re
import shutil
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path


CHROME = "Google Chrome"
PROFILE_ROOT = Path("demo/runtime/chrome-profiles")
REPORT_DIR = Path("demo/reports")
FINANCE_KEYWORDS = [
    "股票",
    "财经",
    "股市",
    "大盘",
    "看盘",
    "板块",
    "行情",
    "指数",
    "a股",
    "A股",
    "沪深",
    "涨停",
    "交易",
    "金融",
    "证券",
    "基金",
    "利好",
    "主线",
    "市场主线",
    "大A",
    "大a",
]


def now_stamp():
    return datetime.now(timezone(timedelta(hours=8))).strftime("%Y%m%dT%H%M%S")


def run(command, timeout=None):
    return subprocess.run(command, text=True, capture_output=True, timeout=timeout)


def cleanup_profile(profile_dir):
    pattern = f"Google Chrome --user-data-dir={profile_dir.resolve()}"
    subprocess.run(["pkill", "-f", pattern], text=True, capture_output=True)
    time.sleep(1)
    if profile_dir.exists():
        shutil.rmtree(profile_dir)


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


def score_link(link):
    text = link.get("text", "")
    lowered = text.lower()
    hits = [keyword for keyword in FINANCE_KEYWORDS if keyword.lower() in lowered]
    score = len(hits)
    return {
        **link,
        "finance_keyword_hits": hits,
        "finance_score": score,
        "normalized_url": f"https://live.douyin.com/{link.get('room_id')}",
    }


def extract_links(port, scroll_count, scroll_wait_ms):
    result = run([
        "node",
        "demo/scripts/cdp_extract_live_links.js",
        f"http://127.0.0.1:{port}/json",
        str(scroll_count),
        str(scroll_wait_ms),
    ], timeout=20)
    payload = {
        "command_returncode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }
    if result.returncode == 0:
        payload["discovery"] = json.loads(result.stdout)
    else:
        payload["discovery"] = None
    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default=f"discovery-{now_stamp()}")
    parser.add_argument("--port", type=int, default=9361)
    parser.add_argument("--wait-seconds", type=int, default=45)
    parser.add_argument("--scroll-count", type=int, default=0)
    parser.add_argument("--scroll-wait-ms", type=int, default=1200)
    parser.add_argument("--url", default="https://live.douyin.com/?from_nav=1")
    parser.add_argument("--keep-profile", action="store_true")
    args = parser.parse_args()

    guard = run(["python3", "demo/scripts/check_test_process_guard.py", "--max-chrome", "0"])
    if guard.returncode != 0:
        raise SystemExit("process guard failed before discovery")

    profile_dir = PROFILE_ROOT / args.run_id
    cleanup_profile(profile_dir)
    launch_result = launch(profile_dir, args.port, args.url)
    time.sleep(args.wait_seconds)
    try:
        payload = extract_links(args.port, args.scroll_count, args.scroll_wait_ms)
    finally:
        if not args.keep_profile:
            cleanup_profile(profile_dir)

    discovery = payload.get("discovery") or {}
    links = [score_link(link) for link in discovery.get("links", [])]
    finance_candidates = sorted(
        [link for link in links if link["finance_score"] > 0],
        key=lambda item: (-item["finance_score"], item["room_id"]),
    )
    report = {
        "run_id": args.run_id,
        "created_at": datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds"),
        "source_url": args.url,
        "profile_dir": str(profile_dir),
        "profile_kept": args.keep_profile,
        "launch_returncode": launch_result.returncode,
        "scroll_count": args.scroll_count,
        "scroll_wait_ms": args.scroll_wait_ms,
        "extract_returncode": payload["command_returncode"],
        "pageTitle": discovery.get("pageTitle"),
        "pageUrl": discovery.get("pageUrl"),
        "link_count": len(links),
        "finance_candidate_count": len(finance_candidates),
        "finance_candidates": finance_candidates,
        "links": links,
        "stderr": payload["stderr"],
    }

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    output_json = REPORT_DIR / f"{args.run_id}-links.json"
    output_md = REPORT_DIR / f"{args.run_id}-links.md"
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    lines = [
        f"# {args.run_id} 抖音直播链接发现报告",
        "",
        f"- source_url: `{args.url}`",
        f"- scroll_count: {args.scroll_count}",
        f"- link_count: {len(links)}",
        f"- finance_candidate_count: {len(finance_candidates)}",
        "",
        "## 财经候选",
        "",
    ]
    if finance_candidates:
        for link in finance_candidates:
            lines.append(
                f"- `{link['normalized_url']}` score={link['finance_score']} "
                f"hits={','.join(link['finance_keyword_hits'])} text={link['text']}"
            )
    else:
        lines.append("- 未发现含股票 / 财经关键词的候选。")
    lines.extend(["", "## 全部链接", ""])
    for link in links:
        text = re.sub(r"\s+", " ", link.get("text", "")).strip()
        lines.append(f"- `{link['normalized_url']}` {text}")
    output_md.write_text("\n".join(lines) + "\n")
    print(json.dumps({
        "output_json": str(output_json),
        "output_md": str(output_md),
        "link_count": len(links),
        "finance_candidate_count": len(finance_candidates),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
