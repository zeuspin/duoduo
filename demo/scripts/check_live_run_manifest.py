#!/usr/bin/env python3

import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path


def load_json(path):
    return json.loads(path.read_text())


def fetch_cdp(port, timeout=2):
    url = f"http://127.0.0.1:{port}/json"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return {
                "ok": True,
                "targets": json.loads(response.read().decode("utf-8")),
                "error": "",
            }
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return {
            "ok": False,
            "targets": [],
            "error": str(exc),
        }


def validate_actions(actions):
    issues = []
    if len(actions) != 3:
        issues.append(f"expected 3 actions, got {len(actions)}")
    urls = [item.get("url") for item in actions]
    ports = [item.get("debug_port") for item in actions]
    profiles = [item.get("profile_dir") for item in actions]
    if len(set(urls)) != len(urls):
        issues.append("duplicate normalized URL found")
    if len(set(ports)) != len(ports):
        issues.append("duplicate CDP debug port found")
    if len(set(profiles)) != len(profiles):
        issues.append("duplicate profile_dir found")
    for item in actions:
        url = item.get("url", "")
        if not url.startswith("https://live.douyin.com/"):
            issues.append(f"non-normalized live URL: {url}")
        if "?" in url or "#" in url:
            issues.append(f"URL still contains query or fragment: {url}")
    return issues


def inspect_cdp(actions):
    details = []
    for item in actions:
        port = item.get("debug_port")
        expected_url = item.get("url")
        result = fetch_cdp(port)
        live_targets = [
            target for target in result["targets"]
            if target.get("type") == "page" and "live.douyin.com" in target.get("url", "")
        ]
        details.append({
            "debug_port": port,
            "expected_url": expected_url,
            "cdp_ok": result["ok"],
            "error": result["error"],
            "live_page_count": len(live_targets),
            "live_pages": [
                {
                    "title": target.get("title", ""),
                    "url": target.get("url", ""),
                }
                for target in live_targets
            ],
            "expected_url_found": any(target.get("url") == expected_url for target in live_targets),
        })
    return details


def write_markdown(report, path):
    lines = [
        "# 三路直播启动 Manifest 检查报告",
        "",
        "| 项目 | 值 |",
        "| --- | --- |",
        f"| manifest | `{report['manifest']}` |",
        f"| dry_run | {report['dry_run']} |",
        f"| 离线 manifest 校验 | {report['manifest_ok']} |",
        f"| CDP 检查 | {report['cdp_checked']} |",
        f"| 总体通过 | {report['ok']} |",
        "",
        "## Manifest 问题",
        "",
    ]
    if report["manifest_issues"]:
        for issue in report["manifest_issues"]:
            lines.append(f"- {issue}")
    else:
        lines.append("- 无")
    lines.extend(["", "## CDP 详情", ""])
    if report["cdp_details"]:
        for item in report["cdp_details"]:
            lines.append(
                f"- port `{item['debug_port']}`: cdp_ok={item['cdp_ok']}, "
                f"live_page_count={item['live_page_count']}, expected_url_found={item['expected_url_found']}"
            )
    else:
        lines.append("- 未执行 CDP 检查")
    path.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--check-cdp", action="store_true")
    parser.add_argument("--output-json", default="demo/reports/live-run-manifest-check.json")
    parser.add_argument("--output-md", default="demo/reports/live-run-manifest-check.md")
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    manifest = load_json(manifest_path)
    actions = manifest.get("actions", [])
    manifest_issues = validate_actions(actions)
    cdp_details = inspect_cdp(actions) if args.check_cdp else []
    cdp_ok = all(item["cdp_ok"] and item["expected_url_found"] for item in cdp_details) if args.check_cdp else True
    manifest_ok = not manifest_issues
    ok = manifest_ok and cdp_ok
    report = {
        "manifest": str(manifest_path),
        "dry_run": manifest.get("dry_run"),
        "manifest_ok": manifest_ok,
        "manifest_issues": manifest_issues,
        "cdp_checked": args.check_cdp,
        "cdp_details": cdp_details,
        "ok": ok,
    }
    output_json = Path(args.output_json)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(report, Path(args.output_md))
    print(json.dumps({
        "output_json": str(output_json),
        "output_md": args.output_md,
        "manifest_ok": manifest_ok,
        "cdp_checked": args.check_cdp,
        "ok": ok,
    }, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
