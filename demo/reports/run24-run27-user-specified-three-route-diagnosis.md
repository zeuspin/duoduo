# run24-run27 用户指定直播间三路并发诊断

## 结论

截至本报告，用户指定直播间内的“三路同时监看”已经有证据支持：run24 和 run25 均能同时启动 3 个无登录 Chrome profile，且三路页面探测均返回 `ok=true`、`audioTrackCount=1`。

但“三路 10 分钟独立音频稳定捕获”尚未解决：run24 和 run25 都出现前两路 10/10 段有效、第三路中途变为 0 字节的情况。run26 和 run27 还显示候选直播间状态会在短时间内波动，部分直播间从先前可捕获变为 `video-not-ready-or-no-audio-track`。

因此当前不能把 Task 1.2 判定为通过。更准确的状态是：

- 3 路匿名播放 / 页面探测：部分通过。
- 2 路 10 分钟独立音频捕获：通过 smoke。
- 3 路 10 分钟独立音频捕获：未通过，需继续定位第三路失效原因。

## 候选池

| 编号 | room_id | 标题 / 说明 |
| --- | --- | --- |
| U1 | `873902239044` | 股市林教头 |
| U2 | `334489081726` | 文鼎（文说股市） |
| U3 | `812755146455` | 海派-和众汇富 |
| U4 | `400595809668` | 汇正首席杨Sir |
| U5 | `373389160165` | 宋半导；run23 探测未就绪 |
| U6 | `773107011629` | 低吸一哥奇点 |

## 执行结果

| run | 组合 | 页面探测 | 捕获结果 | 判断 |
| --- | --- | --- | --- | --- |
| run23 | U1-U5 逐个探测 | U1-U4 通过，U5 不通过 | 未录制 | 可录候选初筛完成 |
| run24 | U1 / U2 / U3 | 3/3 通过 | C1 10/10，C2 10/10，C3 3/10 | 三路监看成立，三路音频未达标 |
| run25 | U1 / U2 / U4 | 3/3 通过 | C1 10/10，C2 10/10，C3 3/10 | 第三路再次中途失效 |
| run26 | U4 / U6 / U1 | 1/3 通过 | 未录制 | U4、U1 当轮视频/音频未就绪 |
| run27 | U2 / U6 / U3 | 2/3 通过 | 未录制 | U3 当轮视频/音频未就绪 |

## 证据文件

| 类型 | 路径 |
| --- | --- |
| 用户候选池 | `demo/reports/user-specified-live-candidates-20260709.md` / `.json` |
| run23 探测汇总 | `demo/reports/run23-user-candidates-probe-summary.md` / `.json` |
| run24 三路 summary | `demo/reports/run24-three-route-rolling-capture-summary.json` |
| run24 C1 有效性 | `demo/reports/run24-c1-u1-rolling-validity-report.md` / `.json` |
| run24 C2 有效性 | `demo/reports/run24-c2-u2-rolling-validity-report.md` / `.json` |
| run24 C3 有效性 | `demo/reports/run24-c3-u3-rolling-validity-report.md` / `.json` |
| run25 三路 summary | `demo/reports/run25-three-route-rolling-capture-summary.json` |
| run25 C1 有效性 | `demo/reports/run25-c1-u1-rolling-validity-report.md` / `.json` |
| run25 C2 有效性 | `demo/reports/run25-c2-u2-rolling-validity-report.md` / `.json` |
| run25 C3 有效性 | `demo/reports/run25-c3-u4-rolling-validity-report.md` / `.json` |
| run26 三路 summary | `demo/reports/run26-three-route-rolling-capture-summary.json` |
| run27 三路 summary | `demo/reports/run27-three-route-rolling-capture-summary.json` |

## 下一步定位建议

1. 不再盲目单路补样本；优先定位第三路并发捕获失效。
2. 对同一 3 个直播间做 3 路短切片，例如 10×30 秒，验证是否仍在约 3 分钟后失效。
3. 交换 route 顺序，确认失败是否总是 C3，还是跟具体直播间相关。
4. 若失败总是 C3，优先调查 Chrome / MediaRecorder / CDP 并发资源限制。
5. 若失败跟直播间相关，把该直播间标为“不适合作为 3 路稳定性样本”，换用 U6 或后续用户指定候选。
