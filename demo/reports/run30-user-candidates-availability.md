# run30 用户指定候选当前可用性复查

## 结论

- 当前可捕获候选只有 2 个，少于 3 个，不继续三路录制。

| 编号 | room_id | probe_ok | audio | readyState | play | 标题 / 原因 |
| --- | --- | --- | ---: | ---: | --- | --- |
| U1 | `873902239044` | False | 0 | 0 | play-timeout | video-not-ready-or-no-audio-track |
| U2 | `334489081726` | True | 1 | 4 | ok | 文鼎（文说股市）的抖音直播间 - 抖音直播 |
| U3 | `812755146455` | False | 0 | 0 | play-timeout | video-not-ready-or-no-audio-track |
| U4 | `400595809668` | False | 0 | 0 | play-timeout | video-not-ready-or-no-audio-track |
| U5 | `373389160165` | False | 0 | 0 | play-timeout | video-not-ready-or-no-audio-track |
| U6 | `773107011629` | True | 1 | 4 | ok | 低吸一哥奇点的抖音直播间 - 抖音直播 |

## 判断

- 本轮不产生录音样本。
- 继续保留 run24 / run25 的结论：三路页面探测曾经成立，但三路 10 分钟独立音频捕获尚未达标。
- 当前外部直播状态不足以进行新的三路有效复测。
