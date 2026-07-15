# Run10 捕获前页面状态探测报告

## 结论

`cdp_live_page_probe.js` 能在录音前快速判断直播页是否具备可捕获音频轨。run10 的三路页面启动和 CDP 对应检查通过，但只有 C1 在 8 秒内返回可捕获状态，C2 / C4 均触发页面探测超时。因此，下一轮三路录音前应先运行该探测脚本，筛掉超时直播间或换源。

## 启动条件

| 项目 | 结果 |
| --- | --- |
| manifest | `demo/reports/live-run-manifests/run10.json` |
| manifest 检查 | `demo/reports/live-run-manifest-check-run10.md`，通过 |
| 测试 Chrome 实例 | 3 个独立 `user-data-dir` |
| Safari 使用 | 未用于播放或录制 |
| 清理状态 | run10 测试 Chrome 已关闭；进程守卫通过 |

## 页面探测结果

| 路 | URL | 探测结果 | 证据 |
| --- | --- | --- | --- |
| C1 | `https://live.douyin.com/782837937233` | 通过 | `demo/reports/run10-c1-page-probe.json`：`readyState=4`、`paused=false`、`audioTrackCount=1` |
| C2 | `https://live.douyin.com/31544105137` | 失败 | `demo/reports/run10-c2-page-probe.json`：8 秒超时 |
| C4 | `https://live.douyin.com/414092641626` | 失败 | `demo/reports/run10-c4-page-probe.json`：8 秒超时 |

## 后续规则

- 三路录音前先对每个端口运行 `demo/scripts/cdp_live_page_probe.js`。
- 任一路探测失败时，不启动该路录音，优先换财经直播间。
- 只有三路均返回 `ok=true` 且 `audioTrackCount>=1`，才进入 10 分钟滚动捕获。
