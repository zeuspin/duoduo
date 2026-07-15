# 直播下播 / 无流适配策略

## 背景

三路直播测试中出现过两类现象：

- 候选直播间在探测时没有可用 `video` 或音频轨，返回 `video-not-ready-or-no-audio-track`。
- 三路并发录制中，某一路前几段有效，后续变成 0 字节。

这两类现象不能都简单归因为“音频分离失败”。它们可能是直播间下播、页面流中断、音频轨消失，也可能是 MediaRecorder / CDP 捕获链路失效。验收策略需要把这几类情况分开记录和处理。

## 适配原则

1. 候选门禁优先：少于 3 个可捕获直播间时，不启动三路录制。
2. 分段捕获：每路按固定片段写文件，避免一个直播间下播污染整轮证据。
3. 失败即时诊断：某段 0 字节、无音频流或命令失败时，立即对该页面执行 `cdp_live_page_probe.js`，保存失败后的页面状态。
4. 分类判断：报告中区分 `stream_unavailable_after_failure`、`audio_track_ended`、`mediarecorder_empty_blob`、`audio_file_too_small`、`capture_command_failed`。
5. 候选替换：后续如果要维持“三路监看”，应从 standby 候选池中补位，而不是继续录制无流页面。

## 当前已落地

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 候选池门禁 | 已实现 | `demo/scripts/probe_user_candidates_gate.py` |
| 少于 3 个可捕获时停止三路录制 | 已实现 | run31 / run32 / run33 门禁报告 |
| 失败段后保存页面探测 | 已实现 | `demo/scripts/rolling_cdp_audio_capture.sh` |
| 有效性审计识别尾部连续无效 | 已实现 | `demo/scripts/audit_rolling_capture_summary.py` |
| 候选自动替换继续录制 | 已实现并完成短测 | `demo/scripts/run_adaptive_three_live_capture.py`、run37 / run38 |

## 最新验证

- run36：从 Safari 直播首页重新获取 7 个财经 / 行情候选，并用无登录 Chrome 门禁探测，7/7 可捕获。
- run37：三路 10 秒自适应捕获通过，未触发换源。
- run38：三路 10×60 秒完成；第 9 轮 C1 原直播源失败，失败后探针显示 `readyState=0`、`audioTrackCount=0`、`play-timeout`，脚本自动换到 S4 后第 10 轮恢复。
- run39：基于 run38 结果重排候选后重新门禁，当前 5/7 可捕获，R1/R7 已变为 `video-not-ready-or-no-audio-track`。
- run40：三路 10×60 秒完成；第 6 轮 C1 原直播源失败，失败后探针同样显示 `readyState=0`、`audioTrackCount=0`、`play-timeout`，脚本自动换到备用候选后第 7-10 轮恢复。
- run42：Safari refresh2 新候选门禁 6/6 可捕获。
- run43：三路 16×60 秒完成，48/48 有效，0 次换源，结论 Pass。
- 当前结论：自动补位流程可行；run43 已补上 10 分钟级无换源短稳证据，但原计划 2 小时长稳、人工听检和其他应用声音对照仍未完成。

## 当前验收判断

- 如果某路在录制前探测失败：判为直播源当前不可用，不进入录制。
- 如果某路录制中失败，且失败后探测显示无音频轨或 `readyState=0`：判为疑似直播源中途失流，不直接判定音频分离失败。
- 如果某路录制中失败，但失败后探测仍显示 video ready、音频轨存在：更偏向捕获链路问题，需要定位 MediaRecorder / CDP 并发限制。
- 只有 3 路同时完成目标时长，且每路分段均有效，才能判定“三路独立音频稳定捕获”通过。

## 后续建议

1. 在至少 3 个候选同时可捕获时，运行短切片三路测试，例如 `8×30s`。
2. 如果第三路再次失败，优先查看失败段 `post_failure_probe_file`：
   - 无音频轨：走候选替换策略。
   - 有音频轨但 0 字节：定位捕获链路。
3. 使用 `run_adaptive_three_live_capture.py` 运行一轮短切片验证；如果初始可捕获候选少于 3 个，直接 No-Go，不进入无效录制。
4. 产品层面应显示“直播已下播 / 流中断 / 自动换源”，并保留前后两个 session，不把它们合并为同一路连续 ASR。
