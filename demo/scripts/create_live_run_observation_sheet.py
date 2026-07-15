#!/usr/bin/env python3

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path


CHECKPOINTS = [
    ("start", 0, "三路均显示目标直播页和正在播放音频，才可开始计时。"),
    ("plus_10m", 10, "流程可行性 smoke checkpoint。"),
    ("plus_30m", 30, "确认无登录弹窗、停流、页面异常。"),
    ("plus_60m", 60, "确认三路仍独立播放。"),
    ("plus_90m", 90, "确认无静音误判或页面刷新需求。"),
    ("plus_120m", 120, "正式 2 小时稳定性 checkpoint。"),
]

INTERFERENCE_TESTS = [
    {
        "id": "refresh_one_route",
        "action": "刷新一路直播页面",
        "pass_criteria": "被刷新一路可恢复播放，其他两路不停止、不刷新、不弹登录。",
    },
    {
        "id": "close_one_route",
        "action": "关闭一路 Chrome 测试实例",
        "pass_criteria": "关闭一路后，其他两路继续播放并保持独立音频状态。",
    },
    {
        "id": "abnormal_exit_one_route",
        "action": "异常结束一路测试 Chrome 进程",
        "pass_criteria": "其他两路不受影响；被结束一路在重新启动后仍使用独立 profile。",
    },
]


def load_json(path):
    return json.loads(path.read_text())


def parse_started_at(value):
    if not value:
        return None
    return datetime.fromisoformat(value)


def validate_actions(actions):
    issues = []
    if len(actions) != 3:
        issues.append(f"expected 3 actions, got {len(actions)}")
    urls = [item.get("url") for item in actions]
    profiles = [item.get("profile_dir") for item in actions]
    ports = [item.get("debug_port") for item in actions]
    if len(set(urls)) != len(urls):
        issues.append("duplicate live URL")
    if len(set(profiles)) != len(profiles):
        issues.append("duplicate Chrome profile")
    if len(set(ports)) != len(ports):
        issues.append("duplicate CDP port")
    for item in actions:
        url = item.get("url", "")
        if not url.startswith("https://live.douyin.com/") or "?" in url or "#" in url:
            issues.append(f"non-normalized URL: {url}")
    return issues


def make_checkpoints(started_at):
    rows = []
    for key, offset_minutes, instruction in CHECKPOINTS:
        target_at = None
        if started_at:
            target_at = (started_at + timedelta(minutes=offset_minutes)).isoformat()
        rows.append({
            "checkpoint": key,
            "target_at": target_at,
            "instruction": instruction,
            "route_status": [
                {
                    "index": route_index,
                    "page_title": "",
                    "live_status": "",
                    "audio_status": "",
                    "login_prompt": "",
                    "notes": "",
                }
                for route_index in [1, 2, 3]
            ],
        })
    return rows


def build_sheet(manifest_path, started_at_value):
    manifest = load_json(manifest_path)
    actions = manifest.get("actions", [])
    action_issues = validate_actions(actions)
    dry_run = bool(manifest.get("dry_run"))
    started_at = parse_started_at(started_at_value)
    eligible_for_timer = (not dry_run) and not action_issues and bool(started_at)
    return {
        "run_id": manifest.get("run_id"),
        "manifest": str(manifest_path),
        "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "manifest_created_at": manifest.get("created_at"),
        "dry_run": dry_run,
        "started_at": started_at.isoformat() if started_at else None,
        "eligible_for_timer": eligible_for_timer,
        "preflight": {
            "guard_ok": bool((manifest.get("guard") or {}).get("ok")),
            "three_routes": len(actions) == 3,
            "unique_urls_profiles_ports": not action_issues,
            "safari_playback_allowed": False,
            "normalized_urls_only": not [
                item for item in actions
                if "?" in item.get("url", "") or "#" in item.get("url", "")
            ],
            "issues": action_issues,
        },
        "actions": actions,
        "start_criteria": [
            "只使用未登录的独立 Chrome user-data-dir 播放直播。",
            "每轮最多 3 个测试 Chrome 实例。",
            "三路 URL 必须形如 https://live.douyin.com/{room_id}，不保留多余参数。",
            "三路页面均为目标直播间，且观察到正在播放音频，才可开始 2 小时计时。",
            "若为 dry-run，只能验证计划和参数，不能作为播放稳定性证据。",
        ],
        "checkpoints": make_checkpoints(started_at),
        "interference_tests": INTERFERENCE_TESTS,
        "acceptance_criteria": [
            "至少一种方案满足 3 路直播连续播放 2 小时。",
            "任一路刷新、关闭、异常退出不导致其他直播停止。",
            "不要求、不输入、不保存任何抖音账号信息。",
            "重复 3 个交易日后，核心方案仍能稳定并行。",
        ],
        "current_status": "template_only" if dry_run else "ready_for_observation",
    }


def write_markdown(sheet, output_path):
    lines = [
        "# 三路直播稳定性观察表",
        "",
        "## Run 元数据",
        "",
        "| 项目 | 值 |",
        "| --- | --- |",
        f"| run_id | `{sheet['run_id']}` |",
        f"| manifest | `{sheet['manifest']}` |",
        f"| dry_run | {sheet['dry_run']} |",
        f"| started_at | {sheet['started_at'] or ''} |",
        f"| eligible_for_timer | {sheet['eligible_for_timer']} |",
        f"| current_status | {sheet['current_status']} |",
        "",
        "## 启动动作",
        "",
        "| 路 | room_id | URL | profile | CDP port |",
        "| ---: | --- | --- | --- | ---: |",
    ]
    for item in sheet["actions"]:
        lines.append(
            f"| {item.get('index')} | `{item.get('room_id')}` | "
            f"{item.get('url')} | `{item.get('profile_dir')}` | {item.get('debug_port')} |"
        )

    lines.extend([
        "",
        "## 启动前检查",
        "",
        "| 项目 | 值 |",
        "| --- | --- |",
    ])
    for key, value in sheet["preflight"].items():
        if key == "issues":
            continue
        lines.append(f"| {key} | {value} |")
    lines.extend(["", "问题："])
    if sheet["preflight"]["issues"]:
        for issue in sheet["preflight"]["issues"]:
            lines.append(f"- {issue}")
    else:
        lines.append("- 无")

    lines.extend(["", "## 开始计时标准", ""])
    for item in sheet["start_criteria"]:
        lines.append(f"- {item}")

    lines.extend([
        "",
        "## 观察 Checkpoint",
        "",
        "| Checkpoint | 目标时间 | 记录要求 | 路 1 | 路 2 | 路 3 |",
        "| --- | --- | --- | --- | --- | --- |",
    ])
    for checkpoint in sheet["checkpoints"]:
        route_cells = ["待记录", "待记录", "待记录"]
        lines.append(
            f"| {checkpoint['checkpoint']} | {checkpoint['target_at'] or ''} | "
            f"{checkpoint['instruction']} | {' | '.join(route_cells)} |"
        )

    lines.extend([
        "",
        "## 干扰测试",
        "",
        "| 测试 | 操作 | 通过标准 | 结果 |",
        "| --- | --- | --- | --- |",
    ])
    for item in sheet["interference_tests"]:
        lines.append(
            f"| {item['id']} | {item['action']} | {item['pass_criteria']} | 待记录 |"
        )

    lines.extend(["", "## 验收标准", ""])
    for item in sheet["acceptance_criteria"]:
        lines.append(f"- {item}")
    output_path.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--started-at", default="")
    parser.add_argument("--output-json", default="")
    parser.add_argument("--output-md", default="")
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    run_id = load_json(manifest_path).get("run_id")
    output_dir = Path("demo/reports/live-run-observation-sheets")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_json = Path(args.output_json) if args.output_json else output_dir / f"{run_id}.json"
    output_md = Path(args.output_md) if args.output_md else output_dir / f"{run_id}.md"

    sheet = build_sheet(manifest_path, args.started_at)
    output_json.write_text(json.dumps(sheet, ensure_ascii=False, indent=2) + "\n")
    write_markdown(sheet, output_md)
    print(json.dumps({
        "output_json": str(output_json),
        "output_md": str(output_md),
        "eligible_for_timer": sheet["eligible_for_timer"],
        "current_status": sheet["current_status"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
