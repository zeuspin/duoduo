#!/usr/bin/env python3

import argparse
import json
import shutil
import subprocess
from pathlib import Path


PROFILE_ROOT = Path("demo/runtime/chrome-profiles")
REPORT_JSON = Path("demo/reports/test-chrome-profile-cleanup-report.json")
REPORT_MD = Path("demo/reports/test-chrome-profile-cleanup-report.md")


def run_process_guard():
    result = subprocess.run(
        ["python3", "demo/scripts/check_test_process_guard.py"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return {
            "ok": False,
            "error": "process guard command failed",
            "stdout": result.stdout,
            "stderr": result.stderr,
        }
    try:
        return json.loads(Path("demo/reports/test-process-guard-report.json").read_text())
    except (OSError, json.JSONDecodeError) as exc:
        return {
            "ok": False,
            "error": f"cannot read process guard report: {exc}",
            "stdout": result.stdout,
            "stderr": result.stderr,
        }


def iter_profile_dirs():
    if not PROFILE_ROOT.exists():
        return []
    return sorted(path for path in PROFILE_ROOT.iterdir() if path.is_dir())


def dir_size_bytes(path):
    total = 0
    for file_path in path.rglob("*"):
        if file_path.is_file():
            try:
                total += file_path.stat().st_size
            except OSError:
                pass
    return total


def build_report(apply_cleanup):
    guard = run_process_guard()
    profile_dirs = iter_profile_dirs()
    deletable = []
    skipped = []

    if not guard.get("ok"):
        skipped = [{"path": str(path), "reason": "process guard not ok"} for path in profile_dirs]
        deleted = []
    else:
        for path in profile_dirs:
            size = dir_size_bytes(path)
            item = {"path": str(path), "size_bytes": size}
            if apply_cleanup:
                shutil.rmtree(path)
                item["deleted"] = True
            else:
                item["deleted"] = False
            deletable.append(item)
        deleted = [item for item in deletable if item["deleted"]]

    return {
        "profile_root": str(PROFILE_ROOT),
        "apply_cleanup": apply_cleanup,
        "process_guard_ok": bool(guard.get("ok")),
        "test_chrome_count": guard.get("test_chrome_count"),
        "capture_process_count": guard.get("capture_process_count"),
        "candidate_count": len(profile_dirs),
        "deleted_count": len(deleted),
        "deleted_size_bytes": sum(item["size_bytes"] for item in deleted),
        "candidates": deletable,
        "skipped": skipped,
        "ok": bool(guard.get("ok")),
    }


def write_markdown(report):
    lines = [
        "# 测试 Chrome Profile 清理报告",
        "",
        "| 项目 | 值 |",
        "| --- | ---: |",
        f"| process_guard_ok | {report['process_guard_ok']} |",
        f"| test_chrome_count | {report['test_chrome_count']} |",
        f"| capture_process_count | {report['capture_process_count']} |",
        f"| candidate_count | {report['candidate_count']} |",
        f"| deleted_count | {report['deleted_count']} |",
        f"| deleted_size_bytes | {report['deleted_size_bytes']} |",
        "",
    ]
    if report["skipped"]:
        lines.extend(["## 跳过", ""])
        for item in report["skipped"]:
            lines.append(f"- `{item['path']}`：{item['reason']}")
    else:
        lines.extend(["## 清理对象", ""])
        if report["candidates"]:
            for item in report["candidates"]:
                state = "已删除" if item["deleted"] else "dry-run"
                lines.append(f"- `{item['path']}`：{state}，{item['size_bytes']} bytes")
        else:
            lines.append("- 无")
    REPORT_MD.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Delete test Chrome profile directories.")
    args = parser.parse_args()

    REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
    report = build_report(args.apply)
    REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(report)
    print(json.dumps({
        "output_json": str(REPORT_JSON),
        "output_md": str(REPORT_MD),
        "apply_cleanup": report["apply_cleanup"],
        "process_guard_ok": report["process_guard_ok"],
        "candidate_count": report["candidate_count"],
        "deleted_count": report["deleted_count"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
