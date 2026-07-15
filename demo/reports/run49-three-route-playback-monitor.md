# run49 三路匿名播放监控报告

## 结论

- 请求时长：7200 秒
- 探测间隔：600 秒
- 初始可用路数：3 / 3
- 完成 checkpoint：12 / 12
- 全 checkpoint 三路可播放：False
- 结论：Completed with one or more failed playback checkpoints

## 路由

| route | room_id | url |
| --- | --- | --- |
| C1 | `5583822346` | `https://live.douyin.com/5583822346` |
| C2 | `632263122130` | `https://live.douyin.com/632263122130` |
| C3 | `746541295999` | `https://live.douyin.com/746541295999` |

## Checkpoints

| checkpoint | route | ok | audio | readyState | play | title/reason |
| ---: | --- | --- | ---: | ---: | --- | --- |
| 1 | C1 | True | 1 | 4 | ok | 九方钱老虎的抖音直播间 - 抖音直播 |
| 1 | C2 | True | 1 | 4 | ok | A股小王子的抖音直播间 - 抖音直播 |
| 1 | C3 | True | 1 | 4 | ok | 峰哥说财经的抖音直播间 - 抖音直播 |
| 2 | C1 | False | 0 | 0 | ok | 九方钱老虎的抖音直播间 - 抖音直播 |
| 2 | C2 | True | 1 | 4 | ok | A股小王子的抖音直播间 - 抖音直播 |
| 2 | C3 | True | 1 | 4 | ok | 峰哥说财经的抖音直播间 - 抖音直播 |
| 3 | C1 | False | 0 | 0 | play-timeout | 九方钱老虎的抖音直播间 - 抖音直播 |
| 3 | C2 | True | 1 | 4 | ok | A股小王子的抖音直播间 - 抖音直播 |
| 3 | C3 | True | 1 | 4 | ok | 峰哥说财经的抖音直播间 - 抖音直播 |
| 4 | C1 | False | 0 | 0 | play-timeout | 九方钱老虎的抖音直播间 - 抖音直播 |
| 4 | C2 | True | 1 | 4 | ok | A股小王子的抖音直播间 - 抖音直播 |
| 4 | C3 | False | 0 | 0 | ok | 峰哥说财经的抖音直播间 - 抖音直播 |
| 5 | C1 | False | 0 | 0 | play-timeout | 九方钱老虎的抖音直播间 - 抖音直播 |
| 5 | C2 | True | 1 | 4 | ok | A股小王子的抖音直播间 - 抖音直播 |
| 5 | C3 | False | 0 | 0 | play-timeout | 峰哥说财经的抖音直播间 - 抖音直播 |
| 6 | C1 | False | 0 | 0 | play-timeout | 九方钱老虎的抖音直播间 - 抖音直播 |
| 6 | C2 | True | 1 | 4 | ok | A股小王子的抖音直播间 - 抖音直播 |
| 6 | C3 | False | 0 | 0 | play-timeout | 峰哥说财经的抖音直播间 - 抖音直播 |
| 7 | C1 | False | 0 | 0 | play-timeout | 九方钱老虎的抖音直播间 - 抖音直播 |
| 7 | C2 | True | 1 | 4 | ok | A股小王子的抖音直播间 - 抖音直播 |
| 7 | C3 | False | 0 | 0 | play-timeout | 峰哥说财经的抖音直播间 - 抖音直播 |
| 8 | C1 | False | 0 | 0 | play-timeout | 九方钱老虎的抖音直播间 - 抖音直播 |
| 8 | C2 | True | 1 | 4 | ok | A股小王子的抖音直播间 - 抖音直播 |
| 8 | C3 | False | 0 | 0 | play-timeout | 峰哥说财经的抖音直播间 - 抖音直播 |
| 9 | C1 | False | 0 | 0 | play-timeout | 九方钱老虎的抖音直播间 - 抖音直播 |
| 9 | C2 | True | 1 | 4 | ok | A股小王子的抖音直播间 - 抖音直播 |
| 9 | C3 | False | 0 | 0 | play-timeout | 峰哥说财经的抖音直播间 - 抖音直播 |
| 10 | C1 | False | 0 | 0 | play-timeout | 九方钱老虎的抖音直播间 - 抖音直播 |
| 10 | C2 | True | 1 | 4 | ok | A股小王子的抖音直播间 - 抖音直播 |
| 10 | C3 | False | 0 | 0 | play-timeout | 峰哥说财经的抖音直播间 - 抖音直播 |
| 11 | C1 | False | None | None | None | Error: No live.douyin.com page target with webSocketDebuggerUrl found
    at getPageTarget (/Users/xuke/Documents/getian/duoduo/demo/scripts/cdp_live_page_probe.js:13:11)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async /Users/xuke/Documents/getian/duoduo/demo/scripts/cdp_live_page_probe.js:134:18 |
| 11 | C2 | False | None | None | None | Error: No live.douyin.com page target with webSocketDebuggerUrl found
    at getPageTarget (/Users/xuke/Documents/getian/duoduo/demo/scripts/cdp_live_page_probe.js:13:11)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async /Users/xuke/Documents/getian/duoduo/demo/scripts/cdp_live_page_probe.js:134:18 |
| 11 | C3 | False | None | None | None | Error: No live.douyin.com page target with webSocketDebuggerUrl found
    at getPageTarget (/Users/xuke/Documents/getian/duoduo/demo/scripts/cdp_live_page_probe.js:13:11)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async /Users/xuke/Documents/getian/duoduo/demo/scripts/cdp_live_page_probe.js:134:18 |
| 12 | C1 | False | None | None | None | Error: No live.douyin.com page target with webSocketDebuggerUrl found
    at getPageTarget (/Users/xuke/Documents/getian/duoduo/demo/scripts/cdp_live_page_probe.js:13:11)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async /Users/xuke/Documents/getian/duoduo/demo/scripts/cdp_live_page_probe.js:134:18 |
| 12 | C2 | False | None | None | None | Error: No live.douyin.com page target with webSocketDebuggerUrl found
    at getPageTarget (/Users/xuke/Documents/getian/duoduo/demo/scripts/cdp_live_page_probe.js:13:11)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async /Users/xuke/Documents/getian/duoduo/demo/scripts/cdp_live_page_probe.js:134:18 |
| 12 | C3 | False | None | None | None | Error: No live.douyin.com page target with webSocketDebuggerUrl found
    at getPageTarget (/Users/xuke/Documents/getian/duoduo/demo/scripts/cdp_live_page_probe.js:13:11)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async /Users/xuke/Documents/getian/duoduo/demo/scripts/cdp_live_page_probe.js:134:18 |
