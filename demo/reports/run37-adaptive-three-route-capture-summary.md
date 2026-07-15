# run37 自适应三路捕获报告

## 结论

- 初始可用路数：3 / 3
- 完成切片轮数：1 / 1
- 触发换源次数：0
- 是否满足三路全程有效：True
- 结论：Pass

## 切片明细

| round | route | room_id | ok | reason | bytes | action |
| ---: | --- | --- | --- | --- | ---: | --- |
| 1 | C1 | `583183556429` | True |  | 160661 | keep |
| 1 | C2 | `305503141482` | True |  | 160661 | keep |
| 1 | C3 | `848398958216` | True |  | 160661 | keep |

## 换源 / 异常事件

- `initial_probe` round=None route=C1 海能-叨哥财经的抖音直播间 - 抖音直播
- `initial_probe` round=None route=C2 财经红姐的抖音直播间 - 抖音直播
- `initial_probe` round=None route=C3 小溪财经的抖音直播间 - 抖音直播
