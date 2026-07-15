# Run9 三路直播探测报告

## 结论

run9 可证明三路无登录 Chrome 实例能按规范 URL 启动并通过 CDP 对应到目标直播页，但不能证明三路页面级音频捕获可稳定运行。C1 的 10 秒页面级捕获成功，C2 和 C4 在 40 秒硬超时后失败，因此本轮不进入 10 分钟三路捕获或 2 小时稳定性计时。

## 启动条件

| 项目 | 结果 |
| --- | --- |
| manifest | `demo/reports/live-run-manifests/run9.json` |
| 启动方式 | 3 个独立 Chrome `user-data-dir` |
| Safari 使用 | 未用于播放或录制 |
| 启动前进程守卫 | 通过 |
| 实际启动测试 Chrome | 3 |
| URL 规范化 | 通过 |
| CDP 页面对应检查 | 通过，见 `demo/reports/live-run-manifest-check-run9.md` |
| 观察表 | `demo/reports/live-run-observation-sheets/run9.md` |

## 10 秒捕获探测

| 路 | room_id | 结果 | 证据 |
| --- | --- | --- | --- |
| C1 | `782837937233` | 成功 | `demo/samples/audio/raw/run9_C1_782837937233_probe10s_page_capture.webm`，`ffprobe` 显示 Opus 音频流，文件大小 160661 bytes |
| C2 | `31544105137` | 失败 | `cdp_audio_capture.js` 在 40 秒硬超时后退出 |
| C4 | `414092641626` | 失败 | `cdp_audio_capture.js` 在 40 秒硬超时后退出 |

## 处置

- 未继续执行 10 分钟三路滚动捕获。
- 已按 `user-data-dir=...run9-` 精确关闭 run9 的 3 个测试 Chrome 实例。
- 已刷新 `demo/reports/test-process-guard-report.md` / `.json`，当前 `test_chrome_count=0`，`capture_process_count=0`。

## 判断

本轮是有价值的失败样本：播放页面启动链路可用，但页面级捕获仍存在按直播间差异化挂起的问题。后续需要在进入长稳前先补“捕获前页面状态探测”和“不可录路快速跳过或换源”逻辑。
