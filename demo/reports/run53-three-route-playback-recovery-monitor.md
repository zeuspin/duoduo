# run53 三路匿名播放自愈监控报告

## 结论

- 请求时长：180 秒
- 探测间隔：60 秒
- 初始可用路数：3 / 3
- 完成 checkpoint：3 / 3
- 恢复动作次数：2
- 全 checkpoint 三路最终可播放：True
- 是否发生故障注入：True
- 结论：Pass

## 路由终态

| route | room_id | recovery_count | replacement_count | url |
| --- | --- | ---: | ---: | --- |
| C1 | `832957564336` | 1 | 0 | `https://live.douyin.com/832957564336` |
| C2 | `276124613032` | 1 | 1 | `https://live.douyin.com/276124613032` |
| C3 | `346291052058` | 0 | 0 | `https://live.douyin.com/346291052058` |

## Checkpoints

| checkpoint | route | raw_ok | final_ok | action | room_id | reason/title |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | C1 | True | True | none | `832957564336` | 趣游台州的抖音直播间 - 抖音直播 |
| 1 | C2 | True | True | none | `539351689019` | 竞锐体育毛锅的抖音直播间 - 抖音直播 |
| 1 | C3 | True | True | none | `346291052058` | 璐崽（声控助眠）的抖音直播间 - 抖音直播 |
| 2 | C1 | False | True | rebuild-same-room | `832957564336` | 趣游台州的抖音直播间 - 抖音直播 |
| 2 | C2 | False | True | replace-room | `276124613032` | 靳七游戏的抖音直播间 - 抖音直播 |
| 2 | C3 | True | True | none | `346291052058` | 璐崽（声控助眠）的抖音直播间 - 抖音直播 |
| 3 | C1 | True | True | none | `832957564336` | 趣游台州的抖音直播间 - 抖音直播 |
| 3 | C2 | True | True | none | `276124613032` | 靳七游戏的抖音直播间 - 抖音直播 |
| 3 | C3 | True | True | none | `346291052058` | 璐崽（声控助眠）的抖音直播间 - 抖音直播 |

## 恢复事件

- checkpoint=2 route=C1 strategy=rebuild-same-room old=`832957564336` new=`832957564336` ok=True
- checkpoint=2 route=C2 strategy=replace-room old=`539351689019` new=`276124613032` ok=True
