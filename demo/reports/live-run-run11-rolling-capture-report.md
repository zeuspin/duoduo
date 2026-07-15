# Run11 三路滚动捕获报告

## 结论

run11 是目前最接近流程可行性目标的一轮：三路无登录 Chrome 启动、CDP 对应检查、捕获前页面状态探测、10 秒页面级录音探测均通过。随后执行 10×60 秒滚动捕获时，C2 和 C3 完整成功，C1 从第 3 段开始连续失败。因此本轮不能判定为“三路 10 分钟稳定通过”，但可以判定“两路 10 分钟稳定 + 三路短探测通过”。

## 候选直播

| 路 | URL | 页面标题 | 类型判断 |
| --- | --- | --- | --- |
| C1 | `https://live.douyin.com/782837937233` | 财经小板总的抖音直播间 | 财经 |
| C2 | `https://live.douyin.com/816173758414` | 老李财观的抖音直播间 | 财经 / K 线 |
| C3 | `https://live.douyin.com/59041165350` | 老林故事会的抖音直播间 | 口播 |

## 启动与探测

| 项目 | 结果 |
| --- | --- |
| manifest | `demo/reports/live-run-manifests/run11.json` |
| manifest/CDP 检查 | `demo/reports/live-run-manifest-check-run11.md`，通过 |
| 页面状态探测 | C1/C2/C3 均 `ok=true`、`readyState=4`、`audioTrackCount=1` |
| 10 秒录音探测 | C1/C2/C3 均成功生成 Opus WebM |
| Safari 使用 | 未用于播放或录制 |
| 清理状态 | run11 测试 Chrome 已关闭；进程守卫通过 |

## 10×60 秒滚动捕获

| 路 | summary | 成功片段 | 失败片段 | 判断 |
| --- | --- | ---: | ---: | --- |
| C1 | `demo/reports/rolling-capture-logs/run11_C1_782837937233_20260709T0408_summary.jsonl` | 2 | 8 | 失败，第 3 段开始退化 |
| C2 | `demo/reports/rolling-capture-logs/run11_C2_816173758414_20260709T0408_summary.jsonl` | 10 | 0 | 通过 10 分钟滚动捕获 |
| C3 | `demo/reports/rolling-capture-logs/run11_C3_59041165350_20260709T0408_summary.jsonl` | 10 | 0 | 通过 10 分钟滚动捕获 |

## 判断

- run11 不能作为 Task 1.2 三路 10 分钟稳定通过证据。
- `老李财观` 和 `老林故事会` 两路在本机当前环境下可作为后续流程候选。
- `财经小板总` 虽然短探测和前 2 段成功，但滚动捕获中途退化，后续应换源或加入失败后刷新/重建页面策略。
