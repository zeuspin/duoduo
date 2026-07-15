# Run15 页面探测诊断报告

## 结论

run15 使用修正后的 `cdp_live_page_probe.js` 复测 `老李财观`。这次探测没有再整体超时，而是返回结构化失败原因：页面存在 `video` 元素，但 `readyState=0`、`audioTrackCount=0`，且 `play()` 在 2 秒内未完成。因此本轮不进入录音，避免产生 0 字节或不可解释样本。

## 证据

| 项目 | 值 |
| --- | --- |
| URL | `https://live.douyin.com/816173758414` |
| 页面标题 | 老李财观的抖音直播间 - 抖音直播 |
| 探测输出 | `demo/reports/run15-c2-page-probe.json` |
| videoCount | 1 |
| readyState | 0 |
| paused | false |
| playAttempt | `play-timeout` |
| captureStreamAvailable | true |
| audioTrackCount | 0 |
| videoTrackCount | 1 |
| 判断 | `video-not-ready-or-no-audio-track` |

## 工具改进

`demo/scripts/cdp_live_page_probe.js` 已给页面内 `video.play()` 增加 2 秒超时。此前 run13/run14 只能得到整体 8 秒超时；现在可以区分页面存在但 video 未就绪、无音频轨、播放 promise 卡住等情况。

## 后续

- 这不是 Task 1.2 通过证据。
- 后续采样前继续使用页面探测脚本；只有 `ok=true` 且 `audioTrackCount>=1` 才进入滚动捕获。
- 对 `play-timeout` 且 `readyState=0` 的直播间，应换源或刷新重建页面后再探测。
