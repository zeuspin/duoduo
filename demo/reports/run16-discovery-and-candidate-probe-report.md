# Run16 候选发现与财经直播探测报告

## 结论

run16 使用无登录 Chrome 从抖音直播首页抽取当前在线直播链接，本轮首页 DOM 中未发现明显股票 / 财经候选。随后复测两个既有财经候选 `老李财观` 和 `财经小板总`，两者均可打开页面，但 60 秒等待后页面探测仍返回 `readyState=0`、`audioTrackCount=0`、`play-timeout`。因此本轮未进入录音，也未新增样本。

## 首页 discovery

| 项目 | 值 |
| --- | --- |
| discovery 输出 | `demo/reports/discovery-run16-links.json` |
| 使用浏览器 | 无登录 Chrome profile `discovery-run16` |
| Safari 使用 | 未使用 |
| 结果 | 抽取到 20 个直播链接，未发现明显股票 / 财经候选 |

## 既有财经候选复测

| 候选 | URL | 等待时间 | 探测输出 | 结果 |
| --- | --- | ---: | --- | --- |
| 老李财观 | `https://live.douyin.com/816173758414` | 60 秒 | `demo/reports/run16-c2-candidate-probe.json` | `video-not-ready-or-no-audio-track` |
| 财经小板总 | `https://live.douyin.com/782837937233` | 60 秒 | `demo/reports/run16-c1-candidate-probe.json` | `video-not-ready-or-no-audio-track` |

## 判断

- 本轮没有可入库的股票 / 财经新样本。
- 当前候选页面虽然存在，但无法确认可捕获音频轨，不应进入滚动捕获。
- 后续需要新的财经直播候选，或在用户登录 Safari 中只做选流后，把规范化链接交给无登录 Chrome 采集。
