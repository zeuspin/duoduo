#!/usr/bin/env python3

import argparse
import functools
import http.server
import json
import math
import os
import shutil
import subprocess
import threading
import time
import wave
import urllib.request
from pathlib import Path


CHROME_APP = "Google Chrome"
CHROME_BIN = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
PROFILE_ROOT = Path("demo/runtime/chrome-profiles")
REPORT_DIR = Path("demo/reports")
RAW_DIR = Path("demo/samples/audio/raw")
TMP_DIR = Path("demo/runtime/audio-isolation")


def run(command, timeout=None):
    return subprocess.run(command, text=True, capture_output=True, timeout=timeout)


def cleanup_profile(profile_dir):
    pattern = f"Google Chrome --user-data-dir={profile_dir.resolve()}"
    subprocess.run(["pkill", "-f", pattern], text=True, capture_output=True)
    time.sleep(1)
    if profile_dir.exists():
        shutil.rmtree(profile_dir, ignore_errors=True)


def goertzel(samples, sample_rate, freq):
    coeff = 2 * math.cos(2 * math.pi * freq / sample_rate)
    q0 = q1 = q2 = 0.0
    for sample in samples:
        q0 = coeff * q1 - q2 + sample
        q2 = q1
        q1 = q0
    real = q1 - q2 * math.cos(2 * math.pi * freq / sample_rate)
    imag = q2 * math.sin(2 * math.pi * freq / sample_rate)
    return real * real + imag * imag


def read_wav_mono(path):
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        sample_rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())
    width = 2
    values = []
    for index in range(0, len(frames), width * channels):
        total = 0
        for channel in range(channels):
            start = index + channel * width
            total += int.from_bytes(frames[start:start + width], "little", signed=True)
        values.append(total / channels / 32768.0)
    return sample_rate, values


def write_report(report, output_json, output_md):
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    lines = [
        "# 页面级音频捕获水印隔离测试",
        "",
        "## 结论",
        "",
        f"- 页面音频水印：{report['page_tone_hz']} Hz",
        f"- 系统声音水印：{report['system_tone_hz']} Hz",
        f"- 页面频率能量：{report['page_tone_power']:.6f}",
        f"- 系统频率能量：{report['system_tone_power']:.6f}",
        f"- 能量比 page/system：{report['page_to_system_power_ratio']:.2f}",
        f"- 是否通过：{report['pass']}",
        "",
        "## 判定",
        "",
        report["interpretation"],
        "",
        "## 文件",
        "",
        f"- 捕获音频：`{report['captured_webm']}`",
        f"- 分析 WAV：`{report['captured_wav']}`",
        f"- 页面媒体：`{report['page_media']}`",
        f"- 系统水印：`{report['system_tone_file']}`",
    ]
    output_md.write_text("\n".join(lines) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", default="audio-watermark")
    parser.add_argument("--port", type=int, default=9631)
    parser.add_argument("--http-port", type=int, default=9632)
    parser.add_argument("--duration-ms", type=int, default=8000)
    parser.add_argument("--page-tone-hz", type=int, default=440)
    parser.add_argument("--system-tone-hz", type=int, default=1234)
    parser.add_argument("--ratio-threshold", type=float, default=20.0)
    args = parser.parse_args()

    profile_dir = PROFILE_ROOT / f"{args.run_id}-profile"
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    page_media = TMP_DIR / f"{args.run_id}-page-{args.page_tone_hz}hz.webm"
    system_tone = TMP_DIR / f"{args.run_id}-system-{args.system_tone_hz}hz.wav"
    html_file = TMP_DIR / f"{args.run_id}.html"
    captured_webm = RAW_DIR / f"{args.run_id}_page_capture_with_system_{args.system_tone_hz}hz.webm"
    captured_wav = RAW_DIR / f"{args.run_id}_page_capture_with_system_{args.system_tone_hz}hz_16k.wav"

    run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=black:s=320x180:r=30:d={args.duration_ms / 1000 + 2}",
        "-f", "lavfi", "-i", f"sine=frequency={args.page_tone_hz}:sample_rate=48000:duration={args.duration_ms / 1000 + 2}",
        "-shortest", "-c:v", "libvpx-vp9", "-c:a", "libopus", str(page_media),
    ])
    run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"sine=frequency={args.system_tone_hz}:sample_rate=48000:duration={args.duration_ms / 1000 + 2}",
        "-ac", "1", str(system_tone),
    ])
    html_file.write_text(
        "<!doctype html><meta charset='utf-8'><title>audio-isolation-test</title>"
        "<video id='v' autoplay loop controls playsinline "
        f"src='{page_media.name}'></video>"
        "<script>v.volume=1; v.muted=false; v.play();</script>\n"
    )

    cleanup_profile(profile_dir)
    httpd = None
    try:
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(TMP_DIR))
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", args.http_port), handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        urllib.request.urlopen(
            f"http://127.0.0.1:{args.http_port}/{html_file.name}",
            timeout=5,
        )
        chrome_command = [
            str(CHROME_BIN) if CHROME_BIN.exists() else CHROME_APP,
            f"--user-data-dir={profile_dir.resolve()}",
            "--no-first-run",
            "--no-default-browser-check",
            "--autoplay-policy=no-user-gesture-required",
            f"--remote-debugging-port={args.port}",
            "--new-window",
            f"http://127.0.0.1:{args.http_port}/{html_file.name}",
        ]
        launch = subprocess.Popen(chrome_command, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        time.sleep(1)
        if launch.poll() not in {None, 0}:
            stdout, stderr = launch.communicate(timeout=5)
            raise SystemExit(stderr.strip() or stdout.strip() or "failed to launch Chrome")
        time.sleep(6)
        try:
            targets = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{args.port}/json", timeout=5).read())
        except Exception as error:
            targets = [{"error": str(error)}]
        (REPORT_DIR / f"{args.run_id}-audio-watermark-cdp-targets.json").write_text(
            json.dumps(targets, ensure_ascii=False, indent=2) + "\n"
        )
        system_player = subprocess.Popen(["afplay", str(system_tone)])
        capture = run([
            "node", "demo/scripts/cdp_audio_capture_any.js",
            f"http://127.0.0.1:{args.port}/json",
            str(captured_webm),
            str(args.duration_ms),
            html_file.name,
        ], timeout=args.duration_ms / 1000 + 40)
        system_player.wait(timeout=20)
        if capture.returncode != 0:
            raise SystemExit(capture.stderr.strip() or capture.stdout.strip())
    finally:
        cleanup_profile(profile_dir)
        if httpd:
            httpd.shutdown()
            httpd.server_close()

    convert = run([
        "ffmpeg", "-y", "-i", str(captured_webm), "-ac", "1", "-ar", "16000", str(captured_wav),
    ])
    if convert.returncode != 0:
        raise SystemExit(convert.stderr.strip())

    sample_rate, samples = read_wav_mono(captured_wav)
    page_power = goertzel(samples, sample_rate, args.page_tone_hz)
    system_power = goertzel(samples, sample_rate, args.system_tone_hz)
    ratio = page_power / max(system_power, 1e-12)
    passed = ratio >= args.ratio_threshold
    report = {
        "run_id": args.run_id,
        "page_tone_hz": args.page_tone_hz,
        "system_tone_hz": args.system_tone_hz,
        "sample_rate": sample_rate,
        "sample_count": len(samples),
        "page_tone_power": page_power,
        "system_tone_power": system_power,
        "page_to_system_power_ratio": ratio,
        "ratio_threshold": args.ratio_threshold,
        "pass": passed,
        "interpretation": (
            "捕获音频中页面水印能量显著高于系统声音水印，说明页面级 captureStream 录到的是页面媒体流，"
            "系统 afplay 声音没有以可检测水印进入正式捕获文件。"
            if passed else
            "系统声音水印能量过高，不能证明页面级捕获隔离系统声音。"
        ),
        "captured_webm": str(captured_webm),
        "captured_wav": str(captured_wav),
        "page_media": str(page_media),
        "system_tone_file": str(system_tone),
    }
    output_json = REPORT_DIR / f"{args.run_id}-audio-watermark-isolation-report.json"
    output_md = REPORT_DIR / f"{args.run_id}-audio-watermark-isolation-report.md"
    write_report(report, output_json, output_md)
    print(json.dumps({
        "output_json": str(output_json),
        "output_md": str(output_md),
        "pass": passed,
        "page_to_system_power_ratio": ratio,
    }, ensure_ascii=False))
    return 0 if passed else 2


if __name__ == "__main__":
    raise SystemExit(main())
