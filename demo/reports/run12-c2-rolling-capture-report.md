# Run12 C2 股票样本滚动捕获报告

## 结论

run12 使用无登录 Chrome 单路打开 `老李财观`，页面状态探测通过。随后执行 10×60 秒滚动捕获，但只有前 5 段生成有效音频流，后 5 段为 0 字节文件。因此本轮不能作为 10 分钟稳定捕获通过证据，只能将前 5 个有效 60 秒片段计入 Task 0.2 股票 / 财经样本池。

## 过程

| 项目 | 结果 |
| --- | --- |
| URL | `https://live.douyin.com/816173758414` |
| 直播间 | 老李财观 |
| Chrome profile | `demo/runtime/chrome-profiles/run12-c2` |
| CDP 端口 | `9261` |
| 页面探测 | `demo/reports/run12-c2-page-probe.json`，`ok=true`、`readyState=4`、`audioTrackCount=1` |
| 滚动捕获 summary | `demo/reports/rolling-capture-logs/run12_C2_816173758414_20260709T0438_summary.jsonl` |
| 片段有效性审计 | `demo/reports/run12-c2-rolling-validity-report.md` / `.json` |
| ASR 入库报告 | `demo/reports/run12-c2-asr-sample-registration-report.json` |

## 结果

| 项目 | 数量 |
| --- | ---: |
| 请求片段 | 10 |
| 有效片段 | 5 |
| 无效片段 | 5 |
| ASR 成功片段 | 5 |
| manifest 新增样本 | 5 |

## 判断

- 前 5 段可计入 Task 0.2 股票 / 财经样本池。
- 后 5 段为 0 字节文件，不得入库，不得计入样本时长。
- run12 暴露了一个工具缺口：滚动捕获脚本原始 summary 只看进程退出码，不能识别 0 字节音频；已新增 `demo/scripts/audit_rolling_capture_summary.py` 用于入库前校验。
