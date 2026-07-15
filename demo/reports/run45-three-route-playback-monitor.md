# run45 三路匿名播放监控报告

## 结论

- 请求时长：180 秒
- 探测间隔：60 秒
- 初始可用路数：3 / 3
- 完成 checkpoint：3 / 3
- 全 checkpoint 三路可播放：True
- 结论：Pass

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
| 2 | C1 | True | 1 | 4 | ok | 九方钱老虎的抖音直播间 - 抖音直播 |
| 2 | C2 | True | 1 | 4 | ok | A股小王子的抖音直播间 - 抖音直播 |
| 2 | C3 | True | 1 | 4 | ok | 峰哥说财经的抖音直播间 - 抖音直播 |
| 3 | C1 | True | 1 | 4 | ok | 九方钱老虎的抖音直播间 - 抖音直播 |
| 3 | C2 | True | 1 | 4 | ok | A股小王子的抖音直播间 - 抖音直播 |
| 3 | C3 | True | 1 | 4 | ok | 峰哥说财经的抖音直播间 - 抖音直播 |
