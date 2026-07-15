#!/usr/bin/env python3

import json
from pathlib import Path


OUTPUT_JSON = Path("demo/reports/objective-requirements-audit.json")
OUTPUT_MD = Path("demo/reports/objective-requirements-audit.md")


def load_json(path):
    file_path = Path(path)
    if not file_path.exists() or not file_path.read_text().strip():
        return {}
    return json.loads(file_path.read_text())


def exists(path):
    return Path(path).exists()


def build_requirements():
    acceptance = load_json("demo/reports/demo-acceptance-state.json")
    runner = load_json("demo/reports/demo-acceptance-check-run.json")
    suitability = load_json("demo/reports/sample-suitability-report.json")
    stock_pack = load_json("demo/reports/stock-finance-review-pack-check.json")
    merge_report = load_json("demo/reports/merge-stock-review-pack-report.json")
    scope = load_json("demo/reports/scope-signoff-report.json")
    prd_readback = load_json("demo/reports/prd-readback.json")

    counts = acceptance.get("counts", {})
    tasks = acceptance.get("task_status", {})

    return [
        {
            "id": "read_required_files",
            "requirement": "先阅读 README、execution-inputs、验收计划和 PRD。",
            "status": "pass" if prd_readback.get("line_count", 0) > 0 else "partial",
            "evidence": (
                "README、execution-inputs、计划文件已持续使用；"
                f"PRD readback extracted_lines={prd_readback.get('line_count')}，source={prd_readback.get('source')}"
            ),
            "next_action": "" if prd_readback.get("line_count", 0) > 0 else "生成 demo/reports/prd-readback.md。",
        },
        {
            "id": "all_validation_files_under_demo",
            "requirement": "所有本次验收计划相关文件放入 demo/。",
            "status": "pass",
            "evidence": "新增验收脚本、报告、样本、音频和标注资产均位于 demo/；PRD 保留在 docs/。",
            "next_action": "",
        },
        {
            "id": "do_not_move_prd",
            "requirement": "原始 PRD 保留在 docs/，不要移动。",
            "status": "pass" if exists("docs/多多直播_完整产品需求文档与关键技术验证方案_V1.0.docx") else "fail",
            "evidence": "docs/多多直播_完整产品需求文档与关键技术验证方案_V1.0.docx 存在。",
            "next_action": "",
        },
        {
            "id": "key_not_leaked",
            "requirement": ".env Key 不能打印、复制到文档、提交或泄露。",
            "status": "pass" if runner.get("key_scan_ok") else "fail",
            "evidence": f"统一 runner key_scan_ok={runner.get('key_scan_ok')}；报告只记录 key 名称和扫描状态。",
            "next_action": "继续避免读取或输出 .env 内容。",
        },
        {
            "id": "macos_current_machine",
            "requirement": "当前测试环境以这台 macOS 电脑为准。",
            "status": "pass",
            "evidence": "demo/execution-inputs.md 已记录 macOS、Apple M1 Pro、16GB；所有 Chrome/CDP/ASR 测试均在本机执行。",
            "next_action": "",
        },
        {
            "id": "task_0_1_scope",
            "requirement": "Task 0.1 生成 mvp-scope，整理范围、非目标、MUST/SHOULD/LATER 和 P0 Go/No-Go。",
            "status": "partial" if tasks.get("task_0_1", {}).get("status") != "pass" else "pass",
            "evidence": f"demo/mvp-scope.md 存在；scope signoff {scope.get('approved_count')}/{scope.get('required_count')}；task_0_1={tasks.get('task_0_1', {}).get('status')}",
            "next_action": "需要产品、研发、测试等人工签收。",
        },
        {
            "id": "task_0_2_baseline",
            "requirement": "Task 0.2 建立测试样本和人工标注基线。",
            "status": "partial",
            "evidence": (
                f"manifest={counts.get('manifest_rows')}，ASR segments={counts.get('asr_segment_rows')}，"
                f"workpack={counts.get('human_workpack_rows')}，stock review pack={counts.get('stock_review_pack_rows')}，"
                f"semantic_events={counts.get('semantic_event_rows')}，股票有效样本小时={suitability.get('stock_finance_effective_duration_hours')}"
            ),
            "next_action": "补足 3 小时股票直播样本、人工标准稿和 500 条正式人工标注。",
        },
        {
            "id": "task_1_1_concurrency",
            "requirement": "Task 1.1 验证 3 路匿名直播并行播放。",
            "status": "partial",
            "evidence": tasks.get("task_1_1", {}).get("note", ""),
            "next_action": "补 2 小时稳定性、刷新/关闭一路干扰测试、3 个交易日复测。",
        },
        {
            "id": "task_1_2_audio_asr_before_ui",
            "requirement": "不要先做完整 UI，先验证并发、匿名观看、独立音频和 ASR。",
            "status": "pass",
            "evidence": "当前 demo 资产集中在容器并发、音频捕获、ASR、样本/标注；未搭完整客户端 UI。",
            "next_action": "",
        },
        {
            "id": "per_task_deliverables_and_acceptance",
            "requirement": "每执行一个任务，都要产出交付物，并对照验收标准判断通过/失败/需补测。",
            "status": "pass",
            "evidence": "demo/reports/validation-status-matrix.md、demo-acceptance-state.md、各 run 报告均保留验收判断。",
            "next_action": "",
        },
        {
            "id": "p0_no_go_behavior",
            "requirement": "遇到 P0 验证失败时先暂停依赖任务，输出 No-Go 或降级建议。",
            "status": "partial",
            "evidence": "多路长稳、三路 10 分钟捕获、人工标注未通过时均保持 partial；但尚未形成最终 No-Go，因为仍可继续补测。",
            "next_action": "若后续多轮候选仍无法形成三路稳定捕获，应输出正式 No-Go/降级为单直播。",
        },
        {
            "id": "stock_review_pack_merge_path",
            "requirement": "人工标注材料应可回填并迁入正式标注集。",
            "status": "partial",
            "evidence": (
                f"stock_review_pack_ready={stock_pack.get('review_pack_ready')}；"
                f"merge dry_run matched={merge_report.get('matched_rows')} changed={merge_report.get('changed_rows')} approved={merge_report.get('approved_rows_after_merge')}"
            ),
            "next_action": "等待人工填写 review pack 后执行非 dry-run merge 和 promote。",
        },
    ]


def write_markdown(requirements):
    lines = [
        "# 目标要求逐条审计报告",
        "",
        "## 总览",
        "",
        "| 状态 | 数量 |",
        "| --- | ---: |",
    ]
    status_counts = {}
    for item in requirements:
        status_counts[item["status"]] = status_counts.get(item["status"], 0) + 1
    for status, count in sorted(status_counts.items()):
        lines.append(f"| {status} | {count} |")
    lines.extend([
        "",
        "## 明细",
        "",
        "| id | status | requirement | evidence | next_action |",
        "| --- | --- | --- | --- | --- |",
    ])
    for item in requirements:
        lines.append(
            f"| `{item['id']}` | {item['status']} | {item['requirement']} | "
            f"{item['evidence']} | {item['next_action']} |"
        )
    lines.extend([
        "",
        "## 判断",
        "",
        "- 该审计用于防止把 partial 误判为 complete。",
        "- 只要存在 `partial` 或 `fail`，本线程目标就不能标记完成。",
    ])
    OUTPUT_MD.write_text("\n".join(lines) + "\n")


def main():
    requirements = build_requirements()
    report = {
        "requirements": requirements,
        "status_counts": {
            status: sum(1 for item in requirements if item["status"] == status)
            for status in sorted({item["status"] for item in requirements})
        },
        "objective_complete": all(item["status"] == "pass" for item in requirements),
    }
    OUTPUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(requirements)
    print(json.dumps({
        "output_json": str(OUTPUT_JSON),
        "output_md": str(OUTPUT_MD),
        "objective_complete": report["objective_complete"],
        "status_counts": report["status_counts"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
