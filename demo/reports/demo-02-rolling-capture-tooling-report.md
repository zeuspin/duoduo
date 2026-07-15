# Demo 02 附录：滚动捕获脚本验证报告

更新时间：2026-07-09

## 1. 目标

补强 10 分钟级音频捕获复测所需的工具能力，确保后续三路直播滚动捕获时：

- 单段失败不会导致整轮无限挂起。
- 每个切片都有独立日志。
- 每轮执行都有可复算 summary。
- 可选择失败后继续收集后续段，或 `fail_fast=true` 立即停止。

## 2. 脚本变更

| 文件 | 变更 |
| --- | --- |
| `demo/scripts/cdp_audio_capture.js` | 增加 Node 侧硬超时，超时时间为捕获时长 + 30 秒 |
| `demo/scripts/cdp_live_page_probe.js` | 给页面内 `video.play()` 增加 2 秒超时，避免页面探测整体卡死；run15 已返回结构化失败原因 |
| `demo/scripts/rolling_cdp_audio_capture.sh` | 增加参数校验、JSONL summary、成功 / 失败计数、`fail_fast` 参数；新增 `min_bytes` 和 `ffprobe` 音频流校验，避免 0 字节文件被计为成功 |
| `demo/scripts/audit_rolling_capture_summary.py` | 对既有 summary 做事后有效性审计，识别 0 字节、文件缺失或无音频流片段 |

## 3. 验证命令

```text
bash -n demo/scripts/rolling_cdp_audio_capture.sh
node --check demo/scripts/cdp_audio_capture.js
demo/scripts/rolling_cdp_audio_capture.sh http://127.0.0.1:9/json TEST 000000 20260709_offline_fail2 1 1 true
```

## 4. 验证结果

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| shell 语法检查 | 通过 | `bash -n` 返回 0 |
| Node 语法检查 | 通过 | `node --check` 返回 0 |
| CDP 不可达失败路径 | 通过 | 脚本返回 `exit_status=1`，未挂起 |
| 失败段日志 | 通过 | `demo/reports/rolling-capture-logs/TEST_000000_20260709_offline_fail2_seg01.json` |
| 汇总 JSONL | 通过 | `demo/reports/rolling-capture-logs/TEST_000000_20260709_offline_fail2_summary.jsonl` |
| 0 字节片段识别 | 通过 | run12 原始 summary 曾把 0 字节片段记为 ok；`demo/reports/run12-c2-rolling-validity-report.md` 将其中 5 段判为无效；脚本现已内置同类校验 |
| 页面探测结构化失败 | 通过 | run15 返回 `play-timeout`、`readyState=0`、`audioTrackCount=0`，见 `demo/reports/run15-page-probe-diagnostic-report.md` |

## 5. 判断

工具层前置能力已补齐：后续可以用该脚本重跑三路 10 分钟滚动捕获，并得到更可靠的失败定位。

这不等价于 Task 1.2 通过。Task 1.2 仍需要重新选择三路稳定直播并实际完成三路 10 分钟滚动捕获、人工听检和隔离复核。
