# run17 财经直播单路 10 分钟流程报告

## 结论

run17 使用无登录 Chrome profile 从抖音直播首页发现并补录一个疑似财经候选 `https://live.douyin.com/16743488023`。该候选完成单路页面探测、10×60 秒滚动捕获、ffprobe 有效性审计、转码、百炼 ASR 和 manifest 入库。

本轮只证明“单路财经直播 10 分钟流程可行”，不替代三路并发 10 分钟、2 小时长稳、人工听检或 500 条人工语义标注。

## 关键结果

| 项目 | 结果 |
| --- | --- |
| 候选来源 | `demo/reports/discovery-run17-links.json` |
| 财经候选补识别 | `demo/reports/discovery-run17-finance-rescore.json` |
| 候选 URL | `https://live.douyin.com/16743488023` |
| 候选标题 | 利好信号出现？市场主线看它！ @大A付老大-九点 |
| 页面探测 | `ok=true` |
| 滚动捕获 | 10/10 段成功 |
| ffprobe 审计 | 10/10 段有效音频流 |
| ASR 入库 | 10/10 段成功 |
| manifest 追加 | 10 条 |
| 新增 ASR 片段 | ASR 总片段从 317 增至 373 |
| 股票 / 财经有效样本时长 | 从约 0.6277 小时增至 0.7944 小时 |

## 产物

| 类型 | 路径 |
| --- | --- |
| 发现报告 | `demo/reports/discovery-run17-links.md` / `.json` |
| 财经候选补识别 | `demo/reports/discovery-run17-finance-rescore.md` / `.json` |
| 单候选页面探测 | `demo/reports/run17-c1-finance-probe.json` |
| 捕获前页面探测 | `demo/reports/run17-C1-finance-page-probe.json` |
| 滚动捕获 summary | `demo/reports/run17-c1-finance-rolling-capture-summary.json` |
| 片段有效性审计 | `demo/reports/run17-c1-finance-rolling-validity-report.md` / `.json` |
| ASR 入库报告 | `demo/reports/run17-c1-finance-asr-sample-registration-report.json` |

## 后续缺口

- Task 0.2 仍缺 3 小时股票 / 财经样本；当前约 0.7944 小时。
- Task 0.2 仍缺人工标准稿和 500 条正式人工语义标注；当前正式标注 0 条。
- Task 1.1 / 1.2 仍缺三路同时 10 分钟复测、2 小时稳定性和人工听检。
