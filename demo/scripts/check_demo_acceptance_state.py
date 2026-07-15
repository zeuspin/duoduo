#!/usr/bin/env python3

import json
from pathlib import Path


REQUIRED_FILES = [
    "demo/README.md",
    "demo/execution-inputs.md",
    "demo/plans/2026-07-08-duoduo-live-mvp-validation-plan.md",
    "demo/mvp-scope.md",
    "demo/scope-review-signoff.json",
    "demo/reports/task-0-1-scope-signoff-pack.md",
    "demo/reports/scope-signoff-report.json",
    "demo/test-baseline.md",
    "demo/reports/demo-00-test-baseline-progress.md",
    "demo/reports/demo-01-container-concurrency-report.md",
    "demo/reports/test-process-guard-report.json",
    "demo/reports/test-chrome-profile-cleanup-report.json",
    "demo/reports/live-run-manifests/run-dry-20260709.json",
    "demo/reports/live-run-manifest-check.json",
    "demo/reports/live-run-observation-sheets/run-dry-20260709.json",
    "demo/scripts/monitor_three_live_playback.py",
    "demo/reports/run45-three-route-playback-monitor.json",
    "demo/scripts/test_three_live_interference.py",
    "demo/reports/run46-three-route-interference-test.json",
    "demo/scripts/cdp_reload_live_page.js",
    "demo/scripts/test_three_live_reload_interference.py",
    "demo/reports/run47-three-route-reload-interference-test.json",
    "demo/reports/run48-user-candidates-gate.json",
    "demo/reports/run49-three-route-playback-monitor.json",
    "demo/reports/run49-playback-long-monitor-failure-analysis.json",
    "demo/scripts/monitor_three_live_playback_with_recovery.py",
    "demo/reports/run50-user-candidates-gate.json",
    "demo/reports/discovery-run51-links.json",
    "demo/reports/run51-discovered-live-candidates.json",
    "demo/reports/run52-user-candidates-gate.json",
    "demo/reports/run53-three-route-playback-recovery-monitor.json",
    "demo/reports/discovery-run54-links.json",
    "demo/reports/run55-historical-stock-finance-candidates.json",
    "demo/reports/run56-user-candidates-gate.json",
    "demo/reports/run57-stock-finance-playback-recovery-candidates.json",
    "demo/reports/run57-three-route-playback-recovery-monitor.json",
    "demo/reports/test-duration-policy.md",
    "demo/reports/run59-long-monitor-aborted-by-duration-policy.json",
    "demo/reports/run60-three-route-playback-recovery-monitor.json",
    "demo/reports/run60-stock-finance-20min-recovery-analysis.json",
    "demo/reports/discovery-run61-stock-search-links.json",
    "demo/reports/discovery-run62-finance-search-links.json",
    "demo/reports/run63-user-candidates-gate.json",
    "demo/reports/run61-run63-stock-finance-candidate-redundancy-report.json",
    "demo/reports/discovery-run64-scroll-live-home-links.json",
    "demo/reports/run65-expanded-stock-finance-candidates.json",
    "demo/reports/run66-user-candidates-gate.json",
    "demo/reports/run64-run66-scroll-discovery-candidate-report.json",
    "demo/reports/run67-public-search-stock-finance-candidates.json",
    "demo/reports/run68-user-candidates-gate.json",
    "demo/reports/run67-run68-public-search-candidate-report.json",
    "demo/reports/task-1-1-candidate-acquisition-blocker.json",
    "demo/reports/multi-route-audio-asr-validation-scope.md",
    "demo/reports/discovery-run69-generic-live-links.json",
    "demo/reports/run69-generic-live-candidates.json",
    "demo/reports/run70-user-candidates-gate.json",
    "demo/reports/run71-adaptive-three-route-capture-summary.json",
    "demo/reports/run71-generic-asr-sample-registration-report.json",
    "demo/reports/run71-multi-route-audio-asr-validation-report.json",
    "demo/reports/live-run-manifests/run9.json",
    "demo/reports/live-run-manifest-check-run9.json",
    "demo/reports/live-run-observation-sheets/run9.json",
    "demo/reports/live-run-run9-probe-report.md",
    "demo/reports/live-run-manifests/run10.json",
    "demo/reports/live-run-manifest-check-run10.json",
    "demo/reports/run10-c1-page-probe.json",
    "demo/reports/run10-c2-page-probe.json",
    "demo/reports/run10-c4-page-probe.json",
    "demo/reports/live-run-run10-page-probe-report.md",
    "demo/reports/live-run-manifests/run11.json",
    "demo/reports/live-run-manifest-check-run11.json",
    "demo/reports/run11-c1-page-probe.json",
    "demo/reports/run11-c2-page-probe.json",
    "demo/reports/run11-c3-page-probe.json",
    "demo/reports/live-run-run11-rolling-capture-report.md",
    "demo/reports/run11-asr-sample-registration-report.json",
    "demo/reports/run12-c2-rolling-capture-report.md",
    "demo/reports/run12-c2-rolling-validity-report.json",
    "demo/reports/run12-c2-asr-sample-registration-report.json",
    "demo/reports/run13-c2-page-probe.json",
    "demo/reports/run14-c1-page-probe.json",
    "demo/reports/run13-run14-page-probe-failure-report.md",
    "demo/reports/run15-c2-page-probe.json",
    "demo/reports/run15-page-probe-diagnostic-report.md",
    "demo/reports/discovery-run16-links.json",
    "demo/reports/run16-c1-candidate-probe.json",
    "demo/reports/run16-c2-candidate-probe.json",
    "demo/reports/run16-discovery-and-candidate-probe-report.md",
    "demo/reports/discovery-run17-links.json",
    "demo/reports/discovery-run17-finance-rescore.json",
    "demo/reports/run17-c1-finance-probe.json",
    "demo/reports/run17-c1-finance-rolling-validity-report.json",
    "demo/reports/run17-c1-finance-asr-sample-registration-report.json",
    "demo/reports/run17-finance-flow-report.md",
    "demo/reports/run19-c1-finance-rolling-validity-report.json",
    "demo/reports/run19-c1-finance-asr-sample-registration-report.json",
    "demo/reports/run19-finance-flow-report.md",
    "demo/reports/run20-c1-finance-rolling-validity-report.json",
    "demo/reports/run20-c1-finance-asr-sample-registration-report.json",
    "demo/reports/run20-finance-flow-report.md",
    "demo/reports/run21-c1-finance-rolling-validity-report.json",
    "demo/reports/run21-c1-finance-asr-sample-registration-report.json",
    "demo/reports/run21-finance-flow-report.md",
    "demo/reports/user-specified-live-candidates-20260709.json",
    "demo/reports/run24-run27-user-specified-three-route-diagnosis.md",
    "demo/reports/run28-run29-current-candidate-availability-report.md",
    "demo/reports/run30-user-candidates-availability.json",
    "demo/reports/run31-user-candidates-gate.json",
    "demo/reports/run32-user-candidates-gate.json",
    "demo/reports/run33-user-candidates-gate.json",
    "demo/reports/live-stream-loss-adaptation-strategy.md",
    "demo/scripts/run_adaptive_three_live_capture.py",
    "demo/reports/safari-live-candidates-20260710.json",
    "demo/reports/run36-user-candidates-gate.json",
    "demo/reports/run37-adaptive-three-route-capture-summary.json",
    "demo/reports/run38-adaptive-three-route-capture-summary.json",
    "demo/reports/safari-live-candidates-20260710-reordered.json",
    "demo/reports/run39-user-candidates-gate.json",
    "demo/reports/run39-recommended-live-candidates.json",
    "demo/reports/run40-adaptive-three-route-capture-summary.json",
    "demo/reports/safari-live-candidates-20260710-refresh2.json",
    "demo/reports/run42-user-candidates-gate.json",
    "demo/reports/run43-adaptive-three-route-capture-summary.json",
    "demo/reports/run38-run40-adaptive-asr-sample-registration-report.json",
    "demo/reports/run43-adaptive-asr-sample-registration-report.json",
    "demo/reports/run44-audio-watermark-isolation-report.json",
    "demo/reports/demo-02-audio-isolation-report.md",
    "demo/reports/demo-04-asr-smoke-report.md",
    "demo/reports/validation-status-matrix.md",
    "demo/reports/demo-acceptance-check-run.json",
    "demo/reports/objective-requirements-audit.json",
    "demo/reports/prd-readback.json",
    "demo/reports/annotation-coverage-report.json",
    "demo/reports/semantic-events-coverage-report.json",
    "demo/reports/sample-suitability-report.json",
    "demo/samples/annotations/stock-finance-review-pack.jsonl",
    "demo/reports/stock-finance-review-pack-check.json",
    "demo/reports/stock-review-pack-human-workflow.md",
    "demo/reports/merge-stock-review-pack-report.json",
    "demo/samples/manifests/sample-manifest.jsonl",
    "demo/samples/transcripts/asr/asr-segments.jsonl",
    "demo/samples/annotations/semantic-events-seed.jsonl",
    "demo/samples/annotations/human-annotation-workpack.jsonl",
    "demo/samples/annotations/semantic-events.jsonl",
]


def count_jsonl(path):
    file_path = Path(path)
    if not file_path.exists():
        return None
    return sum(1 for line in file_path.read_text().splitlines() if line.strip())


def load_json(path):
    file_path = Path(path)
    if not file_path.exists() or not file_path.read_text().strip():
        return None
    return json.loads(file_path.read_text())


def file_checks():
    return {
        path: Path(path).exists()
        for path in REQUIRED_FILES
    }


def build_report():
    files = file_checks()
    scope = load_json("demo/reports/scope-signoff-report.json") or {}
    workpack_coverage = load_json("demo/reports/annotation-coverage-report.json") or {}
    semantic_coverage = load_json("demo/reports/semantic-events-coverage-report.json") or {}
    process_guard = load_json("demo/reports/test-process-guard-report.json") or {}
    suitability = load_json("demo/reports/sample-suitability-report.json") or {}
    stock_review_pack = load_json("demo/reports/stock-finance-review-pack-check.json") or {}
    long_monitor = load_json("demo/reports/run49-three-route-playback-monitor.json") or {}
    recovery_monitor = load_json("demo/reports/run53-three-route-playback-recovery-monitor.json") or {}
    stock_finance_recovery_monitor = load_json("demo/reports/run57-three-route-playback-recovery-monitor.json") or {}
    stock_finance_20min_monitor = load_json("demo/reports/run60-three-route-playback-recovery-monitor.json") or {}
    latest_stock_finance_gate = load_json("demo/reports/run63-user-candidates-gate.json") or {}
    scroll_discovery_gate = load_json("demo/reports/run66-user-candidates-gate.json") or {}
    public_search_gate = load_json("demo/reports/run68-user-candidates-gate.json") or {}
    current_stage = load_json("demo/reports/run71-multi-route-audio-asr-validation-report.json") or {}

    counts = {
        "manifest_rows": count_jsonl("demo/samples/manifests/sample-manifest.jsonl"),
        "asr_segment_rows": count_jsonl("demo/samples/transcripts/asr/asr-segments.jsonl"),
        "semantic_seed_rows": count_jsonl("demo/samples/annotations/semantic-events-seed.jsonl"),
        "human_workpack_rows": count_jsonl("demo/samples/annotations/human-annotation-workpack.jsonl"),
        "stock_review_pack_rows": count_jsonl("demo/samples/annotations/stock-finance-review-pack.jsonl"),
        "semantic_event_rows": count_jsonl("demo/samples/annotations/semantic-events.jsonl"),
    }
    current_stage_status = {
        "stage_acceptance_pass": bool(current_stage.get("stage_acceptance_pass")),
        "scope": current_stage.get("stage_scope"),
        "capture_summary": (current_stage.get("capture") or {}).get("summary"),
        "capture_valid_segments": (current_stage.get("capture") or {}).get("valid_segments"),
        "capture_completed_rounds": (current_stage.get("capture") or {}).get("completed_rounds"),
        "capture_requested_rounds": (current_stage.get("capture") or {}).get("requested_rounds"),
        "replacement_events": (current_stage.get("capture") or {}).get("replacement_events"),
        "asr_ok": (current_stage.get("asr") or {}).get("asr_ok"),
        "asr_valid_items": (current_stage.get("asr") or {}).get("valid_items"),
        "manual_listening_performed": (current_stage.get("audio_isolation_evidence") or {}).get("manual_listening_performed"),
        "chrome_profile_dir_count_after_cleanup": (current_stage.get("environment_cleanup") or {}).get("chrome_profile_dir_count_after_cleanup"),
        "note": "当前阶段只验证多路直播音频捕获和 ASR；股票 / 财经、长稳、人工标注不纳入本阶段通过标准。",
    }

    task_status = {
        "task_0_1": {
            "artifact_ready": files.get("demo/mvp-scope.md", False),
            "signoff_pass": bool(scope.get("task_0_1_signoff_pass")),
            "approved_count": scope.get("approved_count"),
            "required_count": scope.get("required_count"),
            "status": "pass" if scope.get("task_0_1_signoff_pass") else "partial",
        },
        "task_0_2": {
            "baseline_doc_ready": files.get("demo/test-baseline.md", False),
            "workpack_rows": counts["human_workpack_rows"],
            "semantic_event_rows": counts["semantic_event_rows"],
            "stock_finance_effective_duration_hours": suitability.get("stock_finance_effective_duration_hours"),
            "stock_finance_duration_pass": bool(suitability.get("task_0_2_stock_duration_pass")),
            "stock_review_pack_ready": bool(stock_review_pack.get("review_pack_ready")),
            "workpack_pass": bool(workpack_coverage.get("task_0_2_pass")),
            "semantic_events_pass": bool(semantic_coverage.get("task_0_2_pass")),
            "status": "pass" if semantic_coverage.get("task_0_2_pass") else "partial",
        },
        "task_1_1": {
            "report_ready": files.get("demo/reports/demo-01-container-concurrency-report.md", False),
            "playback_monitor_ready": files.get("demo/reports/run45-three-route-playback-monitor.json", False),
            "interference_test_ready": files.get("demo/reports/run46-three-route-interference-test.json", False),
            "reload_interference_test_ready": files.get("demo/reports/run47-three-route-reload-interference-test.json", False),
            "long_monitor_ready": files.get("demo/reports/run49-three-route-playback-monitor.json", False),
            "long_monitor_completed_checkpoints": long_monitor.get("completed_checkpoints"),
            "long_monitor_requested_checkpoints": long_monitor.get("requested_checkpoints"),
            "long_monitor_all_checkpoints_three_ok": bool(long_monitor.get("all_checkpoints_three_ok")),
            "recovery_monitor_ready": files.get("demo/reports/run53-three-route-playback-recovery-monitor.json", False),
            "recovery_monitor_pass": bool(recovery_monitor.get("all_checkpoints_three_ok_after_recovery")),
            "recovery_event_count": recovery_monitor.get("recovery_event_count"),
            "stock_finance_recovery_monitor_ready": files.get("demo/reports/run57-three-route-playback-recovery-monitor.json", False),
            "stock_finance_recovery_monitor_pass": bool(stock_finance_recovery_monitor.get("all_checkpoints_three_ok_after_recovery")),
            "stock_finance_recovery_completed_checkpoints": stock_finance_recovery_monitor.get("completed_checkpoints"),
            "stock_finance_recovery_requested_checkpoints": stock_finance_recovery_monitor.get("requested_checkpoints"),
            "stock_finance_20min_monitor_ready": files.get("demo/reports/run60-three-route-playback-recovery-monitor.json", False),
            "stock_finance_20min_monitor_pass": bool(stock_finance_20min_monitor.get("all_checkpoints_three_ok_after_recovery")),
            "stock_finance_20min_completed_checkpoints": stock_finance_20min_monitor.get("completed_checkpoints"),
            "stock_finance_20min_requested_checkpoints": stock_finance_20min_monitor.get("requested_checkpoints"),
            "latest_stock_finance_gate_ok_count": latest_stock_finance_gate.get("probe_ok_count"),
            "latest_stock_finance_gate_can_run_three": bool(latest_stock_finance_gate.get("can_run_three_route_capture")),
            "scroll_discovery_gate_ok_count": scroll_discovery_gate.get("probe_ok_count"),
            "scroll_discovery_gate_can_run_three": bool(scroll_discovery_gate.get("can_run_three_route_capture")),
            "public_search_gate_ok_count": public_search_gate.get("probe_ok_count"),
            "public_search_gate_can_run_three": bool(public_search_gate.get("can_run_three_route_capture")),
            "process_guard_ok": bool(process_guard.get("ok")),
            "test_chrome_count": process_guard.get("test_chrome_count"),
            "capture_process_count": process_guard.get("capture_process_count"),
            "status": "partial",
            "note": "run45 三路播放监控 3 分钟 smoke 通过；run46 关闭一路干扰 smoke 通过；run47 刷新一路干扰 smoke 通过；run49 2 小时监控完成 12/12 checkpoint，但 C1/C3 失去音轨且后段页面调试目标消失，未通过长稳；run53 通用候选三路自愈 smoke 通过，覆盖页面目标消失重建和音轨失效换源；run57 股票 / 财经候选 10 分钟自愈监控 10/10 checkpoint 通过；run60 股票 / 财经 20 分钟监控在第 10 个 checkpoint 因 C1 失去音轨且无 standby 未通过；run63 当前股票 / 财经候选仅 2 路可捕获；run64 滚动发现命中 1 个已有财经候选，run66 门禁仍仅 2 路可捕获；run68 公开搜索候选 0 路可捕获，不继续无效三路监控；后续单次测试最长 20 分钟，超长测试需申请。",
        },
        "task_1_2": {
            "report_ready": files.get("demo/reports/demo-02-audio-isolation-report.md", False),
            "status": "partial",
            "note": "run43 三路 16×60 秒 48/48 有效且 0 次换源；run44 系统声水印隔离通过；人工听检、麦克风输入对照和 2 小时稳定性未完成。",
        },
    }

    all_required_files_exist = all(files.values())
    overall_pass = (
        all_required_files_exist
        and task_status["task_0_1"]["status"] == "pass"
        and task_status["task_0_2"]["status"] == "pass"
        and task_status["task_1_1"]["status"] == "pass"
        and task_status["task_1_2"]["status"] == "pass"
    )

    return {
        "all_required_files_exist": all_required_files_exist,
        "missing_files": [path for path, exists in files.items() if not exists],
        "counts": counts,
        "current_stage": current_stage_status,
        "task_status": task_status,
        "overall_acceptance_pass": overall_pass,
        "blocking_gaps": [
            "Task 0.1 缺人工签收" if task_status["task_0_1"]["status"] != "pass" else "",
            "Task 0.2 缺人工标准稿和 500 条正式人工语义标注" if task_status["task_0_2"]["status"] != "pass" else "",
            "Task 1.1 股票 / 财经 10 分钟自愈 smoke 已通过；20 分钟监控因候选池无 standby 未通过；滚动发现和公开搜索后候选池仍不足，需用户补充 4-8 个实时股票 / 财经候选链接",
            "Task 1.2 缺人工听检、麦克风输入对照和长稳验证",
        ],
    }


def write_markdown(report, output_path):
    lines = [
        "# Demo 总体验收资产检查报告",
        "",
        "## 总览",
        "",
        "| 项目 | 值 |",
        "| --- | --- |",
        f"| 必需文件是否齐全 | {report['all_required_files_exist']} |",
        f"| 总体验收是否通过 | {report['overall_acceptance_pass']} |",
        f"| 当前阶段是否通过 | {report.get('current_stage', {}).get('stage_acceptance_pass')} |",
        "",
        "## 计数",
        "",
        "| 项目 | 数量 |",
        "| --- | ---: |",
    ]
    for key, value in report["counts"].items():
        lines.append(f"| {key} | {value} |")

    lines.extend([
        "",
        "## 当前阶段",
        "",
        "| 项目 | 值 |",
        "| --- | --- |",
        f"| 范围 | {report.get('current_stage', {}).get('scope')} |",
        f"| 是否通过 | {report.get('current_stage', {}).get('stage_acceptance_pass')} |",
        f"| 捕获轮次 | {report.get('current_stage', {}).get('capture_completed_rounds')}/{report.get('current_stage', {}).get('capture_requested_rounds')} |",
        f"| 有效片段 | {report.get('current_stage', {}).get('capture_valid_segments')} |",
        f"| 换源次数 | {report.get('current_stage', {}).get('replacement_events')} |",
        f"| ASR 成功 | {report.get('current_stage', {}).get('asr_ok')}/{report.get('current_stage', {}).get('asr_valid_items')} |",
        f"| 人工听检 | {report.get('current_stage', {}).get('manual_listening_performed')} |",
        f"| 测试 profile 目录 | {report.get('current_stage', {}).get('chrome_profile_dir_count_after_cleanup')} |",
        f"| 说明 | {report.get('current_stage', {}).get('note')} |",
        "",
        "## 任务状态",
        "",
        "| 任务 | 状态 | 说明 |",
        "| --- | --- | --- |",
    ])
    for task, data in report["task_status"].items():
        note = data.get("note", "")
        if task == "task_0_1":
            note = f"签收 {data.get('approved_count')}/{data.get('required_count')}"
        if task == "task_0_2":
            note = (
                f"workpack {data.get('workpack_rows')} 条，正式标注 {data.get('semantic_event_rows')} 条，"
                f"股票有效样本 {data.get('stock_finance_effective_duration_hours')} 小时"
            )
        if task == "task_1_1":
            note = (
                f"{note} run49={data.get('long_monitor_completed_checkpoints')}/"
                f"{data.get('long_monitor_requested_checkpoints')} checkpoints，"
                f"all_three_ok={data.get('long_monitor_all_checkpoints_three_ok')}；"
                f"run53_recovery_pass={data.get('recovery_monitor_pass')}，"
                f"recovery_events={data.get('recovery_event_count')}；"
                f"run57_stock_finance_recovery={data.get('stock_finance_recovery_completed_checkpoints')}/"
                f"{data.get('stock_finance_recovery_requested_checkpoints')}，"
                f"pass={data.get('stock_finance_recovery_monitor_pass')}；"
                f"run60_20min={data.get('stock_finance_20min_completed_checkpoints')}/"
                f"{data.get('stock_finance_20min_requested_checkpoints')}，"
                f"pass={data.get('stock_finance_20min_monitor_pass')}；"
                f"run63_gate_ok={data.get('latest_stock_finance_gate_ok_count')}，"
                f"can_run_three={data.get('latest_stock_finance_gate_can_run_three')}；"
                f"run66_gate_ok={data.get('scroll_discovery_gate_ok_count')}，"
                f"can_run_three={data.get('scroll_discovery_gate_can_run_three')}；"
                f"run68_gate_ok={data.get('public_search_gate_ok_count')}，"
                f"can_run_three={data.get('public_search_gate_can_run_three')}；"
                f"当前测试 Chrome {data.get('test_chrome_count')}，捕获进程 {data.get('capture_process_count')}"
            )
        lines.append(f"| {task} | {data.get('status')} | {note} |")

    lines.extend([
        "",
        "## 缺口",
        "",
    ])
    gaps = [gap for gap in report["blocking_gaps"] if gap]
    for gap in gaps:
        lines.append(f"- {gap}")
    if not gaps:
        lines.append("- 无")
    output_path.write_text("\n".join(lines) + "\n")


def main():
    report = build_report()
    output_json = Path("demo/reports/demo-acceptance-state.json")
    output_md = Path("demo/reports/demo-acceptance-state.md")
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(report, output_md)
    print(json.dumps({
        "output_json": str(output_json),
        "output_md": str(output_md),
        "overall_acceptance_pass": report["overall_acceptance_pass"],
        "all_required_files_exist": report["all_required_files_exist"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
