#!/usr/bin/env python3

import argparse
import json
import subprocess
from pathlib import Path


CHROME_PROFILE_MARKER = "/Users/xuke/Documents/getian/duoduo/demo/runtime/chrome-profiles/"
CAPTURE_MARKERS = [
    "node demo/scripts/cdp_audio_capture.js",
    "rolling_cdp_audio_capture.sh",
]


def ps_lines():
    result = subprocess.run(["ps", "aux"], check=True, capture_output=True, text=True)
    return result.stdout.splitlines()


def is_self_or_search(line):
    return (
        "check_test_process_guard.py" in line
        or " rg " in line
        or "grep" in line
    )


def collect_processes(lines):
    chrome = []
    capture = []
    for line in lines:
        if is_self_or_search(line):
            continue
        if "Google Chrome" in line and CHROME_PROFILE_MARKER in line:
            chrome.append(line)
        if any(marker in line for marker in CAPTURE_MARKERS):
            capture.append(line)
    return chrome, capture


def build_report(max_chrome):
    chrome, capture = collect_processes(ps_lines())
    ok = len(chrome) <= max_chrome and not capture
    return {
        "ok": ok,
        "max_allowed_test_chrome": max_chrome,
        "test_chrome_count": len(chrome),
        "capture_process_count": len(capture),
        "test_chrome_processes": chrome,
        "capture_processes": capture,
        "rules": [
            "同一时间最多保留 3 个本次验收使用的 Chrome 主实例。",
            "每个实例只打开 1 个有效直播窗口。",
            "开始新 run 前必须先关闭旧 run 实例并复查进程列表。",
            "存在捕获进程残留时不得启动下一轮验收。",
        ],
    }


def write_markdown(report, path):
    lines = [
        "# 测试浏览器进程守卫报告",
        "",
        "| 项目 | 值 |",
        "| --- | ---: |",
        f"| 是否通过 | {report['ok']} |",
        f"| 测试 Chrome 数量 | {report['test_chrome_count']} |",
        f"| 允许最大测试 Chrome 数量 | {report['max_allowed_test_chrome']} |",
        f"| 捕获进程残留数量 | {report['capture_process_count']} |",
        "",
        "## 规则",
        "",
    ]
    for rule in report["rules"]:
        lines.append(f"- {rule}")
    lines.extend(["", "## 测试 Chrome 进程", ""])
    if report["test_chrome_processes"]:
        for line in report["test_chrome_processes"]:
            lines.append(f"- `{line}`")
    else:
        lines.append("- 无")
    lines.extend(["", "## 捕获进程", ""])
    if report["capture_processes"]:
        for line in report["capture_processes"]:
            lines.append(f"- `{line}`")
    else:
        lines.append("- 无")
    path.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-chrome", type=int, default=3)
    parser.add_argument("--output-json", default="demo/reports/test-process-guard-report.json")
    parser.add_argument("--output-md", default="demo/reports/test-process-guard-report.md")
    args = parser.parse_args()

    report = build_report(args.max_chrome)
    output_json = Path(args.output_json)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(report, Path(args.output_md))
    print(json.dumps({
        "output_json": str(output_json),
        "output_md": args.output_md,
        "ok": report["ok"],
        "test_chrome_count": report["test_chrome_count"],
        "capture_process_count": report["capture_process_count"],
    }, ensure_ascii=False))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
