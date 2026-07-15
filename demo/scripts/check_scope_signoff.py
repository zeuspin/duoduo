#!/usr/bin/env python3

import argparse
import json
from pathlib import Path


APPROVED_STATUSES = {"approved", "accepted", "confirmed"}


def load_json(path):
    return json.loads(path.read_text())


def analyze(data):
    required_roles = set(data.get("required_roles", []))
    signoffs = data.get("signoffs", [])
    by_role = {item.get("role"): item for item in signoffs}
    missing_roles = sorted(required_roles - set(by_role))
    duplicate_roles = sorted({
        item.get("role")
        for item in signoffs
        if [entry.get("role") for entry in signoffs].count(item.get("role")) > 1
    })
    pending = []
    approved = []
    invalid = []
    role_details = []

    for role in sorted(required_roles):
        item = by_role.get(role)
        if not item:
            role_details.append({
                "role": role,
                "display_name": "",
                "status": "missing",
                "reviewer": "",
                "confirmed_at": "",
                "result": "missing",
                "missing_fields": ["role entry"],
                "confirmation": "",
            })
            continue
        status = str(item.get("status", "")).strip().lower()
        reviewer = str(item.get("reviewer", "")).strip()
        confirmed_at = str(item.get("confirmed_at", "")).strip()
        missing_fields = []
        if status in APPROVED_STATUSES and reviewer and confirmed_at:
            approved.append(role)
            result = "approved"
        elif status in APPROVED_STATUSES:
            if not reviewer:
                missing_fields.append("reviewer")
            if not confirmed_at:
                missing_fields.append("confirmed_at")
            invalid.append({
                "role": role,
                "reason": "approved status requires reviewer and confirmed_at",
                "missing_fields": missing_fields,
            })
            result = "invalid"
        else:
            pending.append(role)
            result = "pending"
            if status in {"", "pending"}:
                missing_fields.append("approved status")
            if not reviewer:
                missing_fields.append("reviewer")
            if not confirmed_at:
                missing_fields.append("confirmed_at")

        role_details.append({
            "role": role,
            "display_name": str(item.get("display_name", "")).strip(),
            "status": status,
            "reviewer": reviewer,
            "confirmed_at": confirmed_at,
            "result": result,
            "missing_fields": missing_fields,
            "confirmation": str(item.get("confirmation", "")).strip(),
        })

    pass_gate = not missing_roles and not duplicate_roles and not invalid and len(approved) == len(required_roles)
    return {
        "required_roles": sorted(required_roles),
        "approved_roles": approved,
        "pending_roles": pending,
        "missing_roles": missing_roles,
        "duplicate_roles": duplicate_roles,
        "invalid_signoffs": invalid,
        "role_details": role_details,
        "approved_count": len(approved),
        "required_count": len(required_roles),
        "task_0_1_signoff_pass": pass_gate,
    }


def write_markdown(report, path, source):
    lines = [
        "# Task 0.1 范围评审签收检查报告",
        "",
        f"输入文件：`{source}`",
        "",
        "## 总览",
        "",
        "| 项目 | 值 |",
        "| --- | ---: |",
        f"| 必需角色数 | {report['required_count']} |",
        f"| 已确认角色数 | {report['approved_count']} |",
        f"| 待确认角色数 | {len(report['pending_roles'])} |",
        "",
        "## 角色明细",
        "",
        "| role | 显示名称 | 状态 | reviewer | confirmed_at | 缺口 |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for item in report["role_details"]:
        missing = ", ".join(item["missing_fields"]) if item["missing_fields"] else "无"
        lines.append(
            f"| `{item['role']}` | {item['display_name']} | {item['status']} | "
            f"{item['reviewer'] or '-'} | {item['confirmed_at'] or '-'} | {missing} |"
        )
    lines.extend([
        "",
        "## 待确认角色",
        "",
    ])
    if report["pending_roles"]:
        for role in report["pending_roles"]:
            lines.append(f"- `{role}`")
    else:
        lines.append("- 无")
    lines.extend([
        "",
        "## 异常",
        "",
        f"- 缺失角色：`{json.dumps(report['missing_roles'], ensure_ascii=False)}`",
        f"- 重复角色：`{json.dumps(report['duplicate_roles'], ensure_ascii=False)}`",
        f"- 无效签收：`{json.dumps(report['invalid_signoffs'], ensure_ascii=False)}`",
        "",
        "## 判断",
        "",
    ])
    if report["task_0_1_signoff_pass"]:
        lines.append("- Task 0.1 范围评审签收通过。")
    else:
        lines.append("- Task 0.1 范围评审签收未通过；仍需产品、研发、测试等角色人工确认。")
    path.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="demo/scope-review-signoff.json")
    parser.add_argument("--output-json", default="demo/reports/scope-signoff-report.json")
    parser.add_argument("--output-md", default="demo/reports/scope-signoff-report.md")
    args = parser.parse_args()

    data = load_json(Path(args.input))
    report = analyze(data)
    output_json = Path(args.output_json)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(report, Path(args.output_md), args.input)
    print(json.dumps({
        "input": args.input,
        "output_json": str(output_json),
        "output_md": args.output_md,
        "task_0_1_signoff_pass": report["task_0_1_signoff_pass"],
        "approved_count": report["approved_count"],
        "required_count": report["required_count"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
