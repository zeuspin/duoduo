#!/usr/bin/env python3

import argparse
import json
import subprocess
from pathlib import Path


def load_jsonl(path):
    rows = []
    for line in path.read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def ffprobe_audio(path):
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=codec_name,sample_rate,channels",
            "-of",
            "json",
            str(path),
        ],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        return {
            "ok": False,
            "error": result.stderr.strip() or result.stdout.strip(),
            "streams": [],
        }
    data = json.loads(result.stdout or "{}")
    streams = data.get("streams", [])
    return {
        "ok": bool(streams),
        "error": "" if streams else "no-audio-stream",
        "streams": streams,
    }


def load_capture_log(path):
    log_path = Path(path or "")
    if not log_path.exists():
        return None
    text = log_path.read_text().strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw_tail": text.splitlines()[-20:]}


def load_probe(path):
    if not path:
        return None
    probe_path = Path(path or "")
    if not probe_path.exists() or not probe_path.is_file():
        return None
    try:
        return json.loads(probe_path.read_text())
    except json.JSONDecodeError:
        return {"raw_tail": probe_path.read_text().splitlines()[-20:]}


def classify_invalid(row, capture_log, post_failure_probe):
    if row.get("valid_segment"):
        return "valid"
    if post_failure_probe:
        selected = post_failure_probe.get("selected") or {}
        if not post_failure_probe.get("ok") and (
            post_failure_probe.get("audioTrackCount") == 0
            or selected.get("readyState") in {0, None}
            or post_failure_probe.get("reason") == "video-not-ready-or-no-audio-track"
        ):
            return "stream_unavailable_after_failure"
    if capture_log and capture_log.get("ok") and capture_log.get("size") == 0:
        end_state = capture_log.get("endState") or {}
        tracks = end_state.get("audioTracks") or []
        if tracks and all(track.get("readyState") == "ended" for track in tracks):
            return "audio_track_ended"
        return "mediarecorder_empty_blob"
    if row.get("reason") == "audio-file-too-small":
        return "audio_file_too_small"
    if row.get("reason") == "capture-command-failed":
        return "capture_command_failed"
    return "invalid_unknown"


def analyze(rows, min_bytes):
    segments = [row for row in rows if row.get("type") != "summary"]
    audited = []
    for row in segments:
        audio_path = Path(row.get("audio_file", ""))
        exists = audio_path.exists()
        size = audio_path.stat().st_size if exists else 0
        probe = ffprobe_audio(audio_path) if exists and size >= min_bytes else {
            "ok": False,
            "error": "missing-or-too-small",
            "streams": [],
        }
        valid = bool(row.get("ok")) and exists and size >= min_bytes and probe["ok"]
        capture_log = load_capture_log(row.get("log_file"))
        post_failure_probe = load_probe(row.get("post_failure_probe_file"))
        item = {
            **row,
            "exists": exists,
            "actual_bytes": size,
            "min_bytes": min_bytes,
            "audio_probe_ok": probe["ok"],
            "audio_probe_error": probe["error"],
            "valid_segment": valid,
            "capture_log_size": capture_log.get("size") if isinstance(capture_log, dict) else None,
            "capture_log_chunk_count": capture_log.get("chunkCount") if isinstance(capture_log, dict) else None,
            "capture_log_non_empty_chunk_count": capture_log.get("nonEmptyChunkCount") if isinstance(capture_log, dict) else None,
            "post_failure_probe_ok": post_failure_probe.get("ok") if isinstance(post_failure_probe, dict) else None,
            "post_failure_probe_reason": post_failure_probe.get("reason") if isinstance(post_failure_probe, dict) else None,
        }
        item["invalid_classification"] = classify_invalid(item, capture_log, post_failure_probe)
        audited.append(item)
    invalid_tail_count = 0
    for row in reversed(audited):
        if row["valid_segment"]:
            break
        invalid_tail_count += 1
    invalid_class_counts = {}
    for row in audited:
        invalid_class_counts[row["invalid_classification"]] = invalid_class_counts.get(row["invalid_classification"], 0) + 1
    return {
        "segments": audited,
        "requested_segments": len(segments),
        "valid_segments": sum(1 for row in audited if row["valid_segment"]),
        "invalid_segments": sum(1 for row in audited if not row["valid_segment"]),
        "invalid_tail_count": invalid_tail_count,
        "invalid_class_counts": invalid_class_counts,
        "likely_stream_lost_midrun": invalid_tail_count >= 2,
        "valid_audio_files": [row["audio_file"] for row in audited if row["valid_segment"]],
        "invalid_audio_files": [row["audio_file"] for row in audited if not row["valid_segment"]],
        "all_segments_valid": all(row["valid_segment"] for row in audited) if audited else False,
    }


def write_markdown(report, path, source):
    lines = [
        "# 滚动捕获片段有效性审计报告",
        "",
        f"输入 summary：`{source}`",
        "",
        "## 总览",
        "",
        "| 项目 | 值 |",
        "| --- | ---: |",
        f"| 请求片段数 | {report['requested_segments']} |",
        f"| 有效片段数 | {report['valid_segments']} |",
        f"| 无效片段数 | {report['invalid_segments']} |",
        f"| 连续尾部无效片段数 | {report['invalid_tail_count']} |",
        f"| 疑似中途失流 | {report['likely_stream_lost_midrun']} |",
        f"| 是否全部有效 | {report['all_segments_valid']} |",
        f"| 无效分类 | `{json.dumps(report['invalid_class_counts'], ensure_ascii=False)}` |",
        "",
        "## 片段明细",
        "",
        "| 段 | 原始 ok | actual_bytes | audio_probe_ok | valid_segment | 分类 | 文件 |",
        "| ---: | --- | ---: | --- | --- | --- | --- |",
    ]
    for row in report["segments"]:
        lines.append(
            f"| {row.get('segment')} | {row.get('ok')} | {row.get('actual_bytes')} | "
            f"{row.get('audio_probe_ok')} | {row.get('valid_segment')} | "
            f"{row.get('invalid_classification')} | `{row.get('audio_file')}` |"
        )
    path.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--summary", required=True)
    parser.add_argument("--min-bytes", type=int, default=1000)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--output-md", required=True)
    args = parser.parse_args()

    report = analyze(load_jsonl(Path(args.summary)), args.min_bytes)
    output_json = Path(args.output_json)
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    write_markdown(report, Path(args.output_md), args.summary)
    print(json.dumps({
        "output_json": args.output_json,
        "output_md": args.output_md,
        "valid_segments": report["valid_segments"],
        "invalid_segments": report["invalid_segments"],
        "all_segments_valid": report["all_segments_valid"],
    }, ensure_ascii=False))
    return 0 if report["valid_segments"] > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
