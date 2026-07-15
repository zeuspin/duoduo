# Demo 总体验收资产检查报告

## 总览

| 项目 | 值 |
| --- | --- |
| 必需文件是否齐全 | True |
| 总体验收是否通过 | False |
| 当前阶段是否通过 | True |

## 计数

| 项目 | 数量 |
| --- | ---: |
| manifest_rows | 191 |
| asr_segment_rows | 1467 |
| semantic_seed_rows | 1467 |
| human_workpack_rows | 1467 |
| stock_review_pack_rows | 300 |
| semantic_event_rows | 0 |

## 当前阶段

| 项目 | 值 |
| --- | --- |
| 范围 | multi-route live audio capture and ASR validation only |
| 是否通过 | True |
| 捕获轮次 | 3/3 |
| 有效片段 | 9 |
| 换源次数 | 0 |
| ASR 成功 | 9/9 |
| 人工听检 | False |
| 测试 profile 目录 | 0 |
| 说明 | 当前阶段只验证多路直播音频捕获和 ASR；股票 / 财经、长稳、人工标注不纳入本阶段通过标准。 |

## 任务状态

| 任务 | 状态 | 说明 |
| --- | --- | --- |
| task_0_1 | partial | 签收 0/6 |
| task_0_2 | partial | workpack 1467 条，正式标注 0 条，股票有效样本 3.061 小时 |
| task_1_1 | partial | run45 三路播放监控 3 分钟 smoke 通过；run46 关闭一路干扰 smoke 通过；run47 刷新一路干扰 smoke 通过；run49 2 小时监控完成 12/12 checkpoint，但 C1/C3 失去音轨且后段页面调试目标消失，未通过长稳；run53 通用候选三路自愈 smoke 通过，覆盖页面目标消失重建和音轨失效换源；run57 股票 / 财经候选 10 分钟自愈监控 10/10 checkpoint 通过；run60 股票 / 财经 20 分钟监控在第 10 个 checkpoint 因 C1 失去音轨且无 standby 未通过；run63 当前股票 / 财经候选仅 2 路可捕获；run64 滚动发现命中 1 个已有财经候选，run66 门禁仍仅 2 路可捕获；run68 公开搜索候选 0 路可捕获，不继续无效三路监控；后续单次测试最长 20 分钟，超长测试需申请。 run49=12/12 checkpoints，all_three_ok=False；run53_recovery_pass=True，recovery_events=2；run57_stock_finance_recovery=10/10，pass=True；run60_20min=10/10，pass=False；run63_gate_ok=2，can_run_three=False；run66_gate_ok=2，can_run_three=False；run68_gate_ok=0，can_run_three=False；当前测试 Chrome 0，捕获进程 0 |
| task_1_2 | partial | run43 三路 16×60 秒 48/48 有效且 0 次换源；run44 系统声水印隔离通过；人工听检、麦克风输入对照和 2 小时稳定性未完成。 |

## 缺口

- Task 0.1 缺人工签收
- Task 0.2 缺人工标准稿和 500 条正式人工语义标注
- Task 1.1 股票 / 财经 10 分钟自愈 smoke 已通过；20 分钟监控因候选池无 standby 未通过；滚动发现和公开搜索后候选池仍不足，需用户补充 4-8 个实时股票 / 财经候选链接
- Task 1.2 缺人工听检、麦克风输入对照和长稳验证
