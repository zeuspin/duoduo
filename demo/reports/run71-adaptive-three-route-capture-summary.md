# run71 自适应三路捕获报告

## 结论

- 初始可用路数：3 / 3
- 完成切片轮数：3 / 3
- 触发换源次数：0
- 是否满足三路全程有效：True
- 结论：Pass

## 切片明细

| round | route | room_id | ok | reason | bytes | action |
| ---: | --- | --- | --- | --- | ---: | --- |
| 1 | C1 | `478068897604` | True |  | 967089 | keep |
| 1 | C2 | `575973340980` | True |  | 967089 | keep |
| 1 | C3 | `744549703134` | True |  | 967089 | keep |
| 2 | C1 | `478068897604` | True |  | 967089 | keep |
| 2 | C2 | `575973340980` | True |  | 967089 | keep |
| 2 | C3 | `744549703134` | True |  | 967089 | keep |
| 3 | C1 | `478068897604` | True |  | 967089 | keep |
| 3 | C2 | `575973340980` | True |  | 967089 | keep |
| 3 | C3 | `744549703134` | True |  | 967089 | keep |

## 换源 / 异常事件

- `initial_probe` round=None route=C1 大声的抖音直播间 - 抖音直播
- `initial_probe` round=None route=C2 王者荣耀猪八（国服阿骨朵）的抖音直播间 - 抖音直播
- `initial_probe` round=None route=C3 小白龙🐲¹¹¹的抖音直播间 - 抖音直播
