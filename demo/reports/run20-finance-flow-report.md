# run20 财经直播单路 10 分钟复测报告

## 结论

run20 继续复用 `https://live.douyin.com/16743488023`（大A付老大-九点）做单路 10×60 秒滚动捕获。页面探测通过，10 个 60 秒片段全部生成有效音频流，全部转码并通过百炼 ASR，10 条样本追加到 manifest。

本轮证明同一财经候选在连续多轮中仍可完成单路 10 分钟捕获和 ASR 入库。它仍不能替代三路并发、2 小时长稳或人工听检。

## 关键结果

| 项目 | 结果 |
| --- | --- |
| 候选 URL | `https://live.douyin.com/16743488023` |
| 页面探测 | `ok=true` |
| 滚动捕获 | 10/10 段成功 |
| ffprobe 审计 | 10/10 段有效音频流 |
| ASR 入库 | 10/10 段成功 |
| manifest 追加 | 10 条 |
| 新增后 ASR 片段 | 518 条 |
| 新增后股票 / 财经有效样本时长 | 约 1.1277 小时 |

## 产物

| 类型 | 路径 |
| --- | --- |
| 页面探测 | `demo/reports/run20-C1-page-probe.json` |
| 滚动捕获 summary | `demo/reports/rolling-capture-logs/run20_C1_16743488023_20260709T0811_summary.jsonl` |
| 片段有效性审计 | `demo/reports/run20-c1-finance-rolling-validity-report.md` / `.json` |
| ASR 入库报告 | `demo/reports/run20-c1-finance-asr-sample-registration-report.json` |

## 后续缺口

- Task 0.2 仍缺 3 小时股票 / 财经样本；当前约 1.1277 小时。
- Task 0.2 的机器 workpack 已超过 500 条，但仍缺人工标准稿和 500 条正式人工语义标注；当前正式标注 0 条。
- Task 1.1 / 1.2 仍缺三路同时 10 分钟复测、2 小时稳定性和人工听检。
