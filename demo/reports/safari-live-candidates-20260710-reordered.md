# Safari 新候选池重排 2026-07-10

## 重排原因

run38 中 S1 `583183556429` 在第 9 轮出现 `readyState=0`、`audioTrackCount=0`、`play-timeout`，随后自动换源到 S4 并恢复。因此本轮将 run38 中表现稳定的 S2、S3 和换源后有效的 S4 提升为前三路，继续验证三路 10×60 秒无换源稳定捕获。

| 新编号 | 原编号 | room_id | 规范化 URL | 说明 |
| --- | --- | --- | --- | --- |
| R1 | S2 | `305503141482` | `https://live.douyin.com/305503141482` | run38 10/10 有效 |
| R2 | S3 | `848398958216` | `https://live.douyin.com/848398958216` | run38 10/10 有效 |
| R3 | S4 | `857559947435` | `https://live.douyin.com/857559947435` | run38 换源后有效 |
| R4 | S5 | `56106509963` | `https://live.douyin.com/56106509963` | 备用 |
| R5 | S6 | `88057849963` | `https://live.douyin.com/88057849963` | 备用 |
| R6 | S7 | `142040264912` | `https://live.douyin.com/142040264912` | 备用 |
| R7 | S1 | `583183556429` | `https://live.douyin.com/583183556429` | run38 第 9 轮失流，降为末位备用 |

