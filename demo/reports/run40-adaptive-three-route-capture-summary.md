# run40 自适应三路捕获报告

## 结论

- 初始可用路数：3 / 3
- 完成切片轮数：10 / 10
- 触发换源次数：1
- 是否满足三路全程有效：False
- 结论：Completed with replacements or invalid segments; not a stable three-route pass

## 切片明细

| round | route | room_id | ok | reason | bytes | action |
| ---: | --- | --- | --- | --- | ---: | --- |
| 1 | C1 | `848398958216` | True |  | 948719 | keep |
| 1 | C2 | `56106509963` | True |  | 915859 | keep |
| 1 | C3 | `88057849963` | True |  | 39799 | keep |
| 2 | C1 | `848398958216` | True |  | 966123 | keep |
| 2 | C2 | `56106509963` | True |  | 967089 | keep |
| 2 | C3 | `88057849963` | True |  | 966123 | keep |
| 3 | C1 | `848398958216` | True |  | 966123 | keep |
| 3 | C2 | `56106509963` | True |  | 966123 | keep |
| 3 | C3 | `88057849963` | True |  | 966123 | keep |
| 4 | C1 | `848398958216` | True |  | 967089 | keep |
| 4 | C2 | `56106509963` | True |  | 967089 | keep |
| 4 | C3 | `88057849963` | True |  | 967089 | keep |
| 5 | C1 | `848398958216` | True |  | 142291 | keep |
| 5 | C2 | `56106509963` | True |  | 946787 | keep |
| 5 | C3 | `88057849963` | True |  | 967089 | keep |
| 6 | C1 | `848398958216` | False | capture-command-failed | 0 | replace |
| 6 | C2 | `56106509963` | True |  | 946787 | keep |
| 6 | C3 | `88057849963` | True |  | 966123 | keep |
| 7 | C1 | `142040264912` | True |  | 966144 | keep |
| 7 | C2 | `56106509963` | True |  | 945837 | keep |
| 7 | C3 | `88057849963` | True |  | 966123 | keep |
| 8 | C1 | `142040264912` | True |  | 967089 | keep |
| 8 | C2 | `56106509963` | True |  | 966123 | keep |
| 8 | C3 | `88057849963` | True |  | 966123 | keep |
| 9 | C1 | `142040264912` | True |  | 967089 | keep |
| 9 | C2 | `56106509963` | True |  | 966123 | keep |
| 9 | C3 | `88057849963` | True |  | 966123 | keep |
| 10 | C1 | `142040264912` | True |  | 967089 | keep |
| 10 | C2 | `56106509963` | True |  | 940991 | keep |
| 10 | C3 | `88057849963` | True |  | 941957 | keep |

## 换源 / 异常事件

- `initial_probe` round=None route=C1 小溪财经的抖音直播间 - 抖音直播
- `initial_probe` round=None route=C2 no-video-element
- `initial_probe` round=None route=C2 国海小飞鱼的抖音直播间 - 抖音直播
- `initial_probe` round=None route=C3 广发证券修多多的抖音直播间 - 抖音直播
- `replacement` round=6 route=C1 来来财经的抖音直播间 - 抖音直播
