# run60 三路匿名播放自愈监控报告

## 结论

- 请求时长：1200 秒
- 探测间隔：120 秒
- 初始可用路数：3 / 3
- 完成 checkpoint：10 / 10
- 恢复动作次数：1
- 全 checkpoint 三路最终可播放：False
- 是否发生故障注入：False
- 结论：Completed with one or more unrecovered playback checkpoints

## 路由终态

| route | room_id | recovery_count | replacement_count | url |
| --- | --- | ---: | ---: | --- |
| C1 | `31544105137` | 1 | 0 | `https://live.douyin.com/31544105137` |
| C2 | `100263212175` | 0 | 0 | `https://live.douyin.com/100263212175` |
| C3 | `816173758414` | 0 | 0 | `https://live.douyin.com/816173758414` |

## Checkpoints

| checkpoint | route | raw_ok | final_ok | action | room_id | reason/title |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | C1 | True | True | none | `31544105137` | 先机财经的抖音直播间 - 抖音直播 |
| 1 | C2 | True | True | none | `100263212175` | 江哥财经的抖音直播间 - 抖音直播 |
| 1 | C3 | True | True | none | `816173758414` | 老李财观的抖音直播间 - 抖音直播 |
| 2 | C1 | True | True | none | `31544105137` | 先机财经的抖音直播间 - 抖音直播 |
| 2 | C2 | True | True | none | `100263212175` | 江哥财经的抖音直播间 - 抖音直播 |
| 2 | C3 | True | True | none | `816173758414` | 老李财观的抖音直播间 - 抖音直播 |
| 3 | C1 | True | True | none | `31544105137` | 先机财经的抖音直播间 - 抖音直播 |
| 3 | C2 | True | True | none | `100263212175` | 江哥财经的抖音直播间 - 抖音直播 |
| 3 | C3 | True | True | none | `816173758414` | 老李财观的抖音直播间 - 抖音直播 |
| 4 | C1 | True | True | none | `31544105137` | 先机财经的抖音直播间 - 抖音直播 |
| 4 | C2 | True | True | none | `100263212175` | 江哥财经的抖音直播间 - 抖音直播 |
| 4 | C3 | True | True | none | `816173758414` | 老李财观的抖音直播间 - 抖音直播 |
| 5 | C1 | True | True | none | `31544105137` | 先机财经的抖音直播间 - 抖音直播 |
| 5 | C2 | True | True | none | `100263212175` | 江哥财经的抖音直播间 - 抖音直播 |
| 5 | C3 | True | True | none | `816173758414` | 老李财观的抖音直播间 - 抖音直播 |
| 6 | C1 | True | True | none | `31544105137` | 先机财经的抖音直播间 - 抖音直播 |
| 6 | C2 | True | True | none | `100263212175` | 江哥财经的抖音直播间 - 抖音直播 |
| 6 | C3 | True | True | none | `816173758414` | 老李财观的抖音直播间 - 抖音直播 |
| 7 | C1 | True | True | none | `31544105137` | 先机财经的抖音直播间 - 抖音直播 |
| 7 | C2 | True | True | none | `100263212175` | 江哥财经的抖音直播间 - 抖音直播 |
| 7 | C3 | True | True | none | `816173758414` | 老李财观的抖音直播间 - 抖音直播 |
| 8 | C1 | True | True | none | `31544105137` | 先机财经的抖音直播间 - 抖音直播 |
| 8 | C2 | True | True | none | `100263212175` | 江哥财经的抖音直播间 - 抖音直播 |
| 8 | C3 | True | True | none | `816173758414` | 老李财观的抖音直播间 - 抖音直播 |
| 9 | C1 | True | True | none | `31544105137` | 先机财经的抖音直播间 - 抖音直播 |
| 9 | C2 | True | True | none | `100263212175` | 江哥财经的抖音直播间 - 抖音直播 |
| 9 | C3 | True | True | none | `816173758414` | 老李财观的抖音直播间 - 抖音直播 |
| 10 | C1 | False | False | rebuild-same-room-no-standby | `31544105137` | 先机财经的抖音直播间 - 抖音直播 |
| 10 | C2 | True | True | none | `100263212175` | 江哥财经的抖音直播间 - 抖音直播 |
| 10 | C3 | True | True | none | `816173758414` | 老李财观的抖音直播间 - 抖音直播 |

## 恢复事件

- checkpoint=10 route=C1 strategy=rebuild-same-room-no-standby old=`31544105137` new=`31544105137` ok=False
