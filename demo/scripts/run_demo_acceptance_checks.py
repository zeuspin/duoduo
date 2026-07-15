#!/usr/bin/env python3

import json
import re
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path


REPORT_JSON = Path("demo/reports/demo-acceptance-check-run.json")
REPORT_MD = Path("demo/reports/demo-acceptance-check-run.md")
KEY_PATTERN = re.compile(
    "|".join([
        r"sk-" + r"[0-9a-f]{32}",
        "BAILIAN" + r"_API_KEY=.*" + r"sk-",
        "DASHSCOPE" + r"_API_KEY=.*" + r"sk-",
    ])
)


CHECKS = [
    {
        "id": "scope_signoff",
        "command": ["python3", "demo/scripts/check_scope_signoff.py"],
        "required_for_overall": False,
    },
    {
        "id": "sample_suitability",
        "command": ["python3", "demo/scripts/audit_sample_suitability.py"],
        "required_for_overall": True,
    },
    {
        "id": "annotation_coverage",
        "command": ["python3", "demo/scripts/check_annotation_coverage.py"],
        "required_for_overall": True,
    },
    {
        "id": "semantic_events_coverage",
        "command": [
            "python3",
            "demo/scripts/check_annotation_coverage.py",
            "--input",
            "demo/samples/annotations/semantic-events.jsonl",
            "--output-json",
            "demo/reports/semantic-events-coverage-report.json",
            "--output-md",
            "demo/reports/semantic-events-coverage-report.md",
        ],
        "required_for_overall": True,
    },
    {
        "id": "stock_review_pack",
        "command": ["python3", "demo/scripts/check_stock_review_pack.py"],
        "required_for_overall": True,
    },
    {
        "id": "merge_stock_review_pack_dry_run",
        "command": ["python3", "demo/scripts/merge_stock_review_pack.py", "--dry-run"],
        "required_for_overall": True,
    },
    {
        "id": "process_guard",
        "command": ["python3", "demo/scripts/check_test_process_guard.py"],
        "required_for_overall": True,
    },
    {
        "id": "demo_acceptance_state",
        "command": ["python3", "demo/scripts/check_demo_acceptance_state.py"],
        "required_for_overall": True,
    },
    {
        "id": "objective_requirements_audit",
        "command": ["python3", "demo/scripts/audit_objective_requirements.py"],
        "required_for_overall": True,
    },
]


def run_command(command):
    result = subprocess.run(command, text=True, capture_output=True)
    return {
        "command": command,
        "returncode": result.returncode,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }


def scan_key_patterns():
    findings = []
    for path in Path("demo").rglob("*"):
        if not path.is_file() or "runtime" in path.parts or "__pycache__" in path.parts:
            continue
        try:
            text = path.read_text(errors="ignore")
        except UnicodeDecodeError:
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            if KEY_PATTERN.search(line):
                findings.append({"path": str(path), "line": line_number})
    return findings


def load_json(path):
    file_path = Path(path)
    if not file_path.exists() or not file_path.read_text().strip():
        return None
    return json.loads(file_path.read_text())


def build_report():
    checks = []
    for check in CHECKS:
        result = run_command(check["command"])
        checks.append({
            **check,
            **result,
            "ok": result["returncode"] == 0,
        })

    key_findings = scan_key_patterns()
    acceptance_state = load_json("demo/reports/demo-acceptance-state.json") or {}
    stock_review_pack = load_json("demo/reports/stock-finance-review-pack-check.json") or {}
    sample_suitability = load_json("demo/reports/sample-suitability-report.json") or {}
    annotation_coverage = load_json("demo/reports/annotation-coverage-report.json") or {}
    semantic_coverage = load_json("demo/reports/semantic-events-coverage-report.json") or {}
    objective_audit = load_json("demo/reports/objective-requirements-audit.json") or {}

    required_checks_ok = all(check["ok"] for check in checks if check["required_for_overall"])
    return {
        "generated_at": datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds"),
        "checks": checks,
        "required_checks_ok": required_checks_ok,
        "key_scan_ok": not key_findings,
        "key_scan_findings": key_findings,
        "overall_acceptance_pass": bool(acceptance_state.get("overall_acceptance_pass")),
        "counts": acceptance_state.get("counts", {}),
        "stock_review_pack_ready": bool(stock_review_pack.get("review_pack_ready")),
        "stock_finance_effective_duration_hours": sample_suitability.get("stock_finance_effective_duration_hours"),
        "stock_finance_duration_gap_sec": sample_suitability.get("stock_finance_duration_gap_sec"),
        "workpack_rows": annotation_coverage.get("total_rows"),
        "workpack_gap": annotation_coverage.get("total_gap"),
        "semantic_event_rows": semantic_coverage.get("total_rows"),
        "semantic_event_pass": bool(semantic_coverage.get("task_0_2_pass")),
        "objective_complete": bool(objective_audit.get("objective_complete")),
        "objective_status_counts": objective_audit.get("status_counts", {}),
    }


def write_markdown(report):
    lines = [
        "# Demo 统一验收检查运行报告",
        "",
        f"生成时间：`{report['generated_at']}`",
        "",
        "## 总览",
        "",
        "| 项目 | 值 |",
        "| --- | --- |",
        f"| 必需检查是否通过 | {report['required_checks_ok']} |",
        f"| key 扫描是否通过 | {report['key_scan_ok']} |",
        f"| 总体验收是否通过 | {report['overall_acceptance_pass']} |",
        f"| 目标逐条审计是否完成 | {report['objective_complete']} |",
        f"| 股票 / 财经有效样本小时 | {report['stock_finance_effective_duration_hours']} |",
        f"| 距 3 小时股票样本缺口秒 | {report['stock_finance_duration_gap_sec']} |",
        f"| workpack 行数 | {report['workpack_rows']} |",
        f"| workpack 距 500 条缺口 | {report['workpack_gap']} |",
        f"| 正式语义标注行数 | {report['semantic_event_rows']} |",
        f"| 股票复核包 ready | {report['stock_review_pack_ready']} |",
        "",
        "## 检查项",
        "",
        "| id | required | returncode | ok |",
        "| --- | --- | ---: | --- |",
    ]
    for check in report["checks"]:
        lines.append(
            f"| {check['id']} | {check['required_for_overall']} | {check['returncode']} | {check['ok']} |"
        )
    lines.extend([
        "",
        "## key 扫描",
        "",
    ])
    if report["key_scan_findings"]:
        for finding in report["key_scan_findings"]:
            lines.append(f"- `{finding['path']}:{finding['line']}`")
    else:
        lines.append("- 未发现 key 形态字符串。")
    lines.extend([
        "",
        "## 判断",
        "",
        "- 本报告证明检查链路可复跑，不代表总体验收通过。",
        "- 当前 `overall_acceptance_pass=false` 时，仍需继续补样本、人工标注和长稳验证。",
    ])
    REPORT_MD.write_text("\n".join(lines) + "\n")


def main():
    report = build_report()
    REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(report)
    print(json.dumps({
        "output_json": str(REPORT_JSON),
        "output_md": str(REPORT_MD),
        "required_checks_ok": report["required_checks_ok"],
        "key_scan_ok": report["key_scan_ok"],
        "overall_acceptance_pass": report["overall_acceptance_pass"],
    }, ensure_ascii=False))
    return 0 if report["required_checks_ok"] and report["key_scan_ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
