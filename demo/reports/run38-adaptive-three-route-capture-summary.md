# run38 自适应三路捕获报告

## 结论

- 初始可用路数：3 / 3
- 完成切片轮数：10 / 10
- 触发换源次数：1
- 是否满足三路全程有效：False
- 结论：Completed with replacements or invalid segments; not a stable three-route pass

## 切片明细

| round | route | room_id | ok | reason | bytes | action |
| ---: | --- | --- | --- | --- | ---: | --- |
| 1 | C1 | `583183556429` | True |  | 967089 | keep |
| 1 | C2 | `305503141482` | True |  | 967089 | keep |
| 1 | C3 | `848398958216` | True |  | 967089 | keep |
| 2 | C1 | `583183556429` | True |  | 967089 | keep |
| 2 | C2 | `305503141482` | True |  | 967089 | keep |
| 2 | C3 | `848398958216` | True |  | 967089 | keep |
| 3 | C1 | `583183556429` | True |  | 967089 | keep |
| 3 | C2 | `305503141482` | True |  | 967089 | keep |
| 3 | C3 | `848398958216` | True |  | 967089 | keep |
| 4 | C1 | `583183556429` | True |  | 967089 | keep |
| 4 | C2 | `305503141482` | True |  | 967089 | keep |
| 4 | C3 | `848398958216` | True |  | 967089 | keep |
| 5 | C1 | `583183556429` | True |  | 967089 | keep |
| 5 | C2 | `305503141482` | True |  | 967089 | keep |
| 5 | C3 | `848398958216` | True |  | 967089 | keep |
| 6 | C1 | `583183556429` | True |  | 967089 | keep |
| 6 | C2 | `305503141482` | True |  | 967089 | keep |
| 6 | C3 | `848398958216` | True |  | 967089 | keep |
| 7 | C1 | `583183556429` | True |  | 967089 | keep |
| 7 | C2 | `305503141482` | True |  | 967089 | keep |
| 7 | C3 | `848398958216` | True |  | 967089 | keep |
| 8 | C1 | `583183556429` | True |  | 840568 | keep |
| 8 | C2 | `305503141482` | True |  | 967089 | keep |
| 8 | C3 | `848398958216` | True |  | 966123 | keep |
| 9 | C1 | `583183556429` | False | capture-command-failed | 0 | replace |
| 9 | C2 | `305503141482` | True |  | 967089 | keep |
| 9 | C3 | `848398958216` | True |  | 967089 | keep |
| 10 | C1 | `857559947435` | True |  | 966775 | keep |
| 10 | C2 | `305503141482` | True |  | 967089 | keep |
| 10 | C3 | `848398958216` | True |  | 967089 | keep |

## 换源 / 异常事件

- `initial_probe` round=None route=C1 海能-叨哥财经的抖音直播间 - 抖音直播
- `initial_probe` round=None route=C2 财经红姐的抖音直播间 - 抖音直播
- `initial_probe` round=None route=C3 小溪财经的抖音直播间 - 抖音直播
- `replacement` round=9 route=C1 老李财经的抖音直播间 - 抖音直播
