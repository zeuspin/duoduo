# 目标要求逐条审计报告

## 总览

| 状态 | 数量 |
| --- | ---: |
| partial | 5 |
| pass | 7 |

## 明细

| id | status | requirement | evidence | next_action |
| --- | --- | --- | --- | --- |
| `read_required_files` | pass | 先阅读 README、execution-inputs、验收计划和 PRD。 | README、execution-inputs、计划文件已持续使用；PRD readback extracted_lines=771，source=docs/多多直播_完整产品需求文档与关键技术验证方案_V1.0.docx |  |
| `all_validation_files_under_demo` | pass | 所有本次验收计划相关文件放入 demo/。 | 新增验收脚本、报告、样本、音频和标注资产均位于 demo/；PRD 保留在 docs/。 |  |
| `do_not_move_prd` | pass | 原始 PRD 保留在 docs/，不要移动。 | docs/多多直播_完整产品需求文档与关键技术验证方案_V1.0.docx 存在。 |  |
| `key_not_leaked` | pass | .env Key 不能打印、复制到文档、提交或泄露。 | 统一 runner key_scan_ok=True；报告只记录 key 名称和扫描状态。 | 继续避免读取或输出 .env 内容。 |
| `macos_current_machine` | pass | 当前测试环境以这台 macOS 电脑为准。 | demo/execution-inputs.md 已记录 macOS、Apple M1 Pro、16GB；所有 Chrome/CDP/ASR 测试均在本机执行。 |  |
| `task_0_1_scope` | partial | Task 0.1 生成 mvp-scope，整理范围、非目标、MUST/SHOULD/LATER 和 P0 Go/No-Go。 | demo/mvp-scope.md 存在；scope signoff 0/6；task_0_1=partial | 需要产品、研发、测试等人工签收。 |
| `task_0_2_baseline` | partial | Task 0.2 建立测试样本和人工标注基线。 | manifest=191，ASR segments=1467，workpack=1467，stock review pack=300，semantic_events=0，股票有效样本小时=3.061 | 补足 3 小时股票直播样本、人工标准稿和 500 条正式人工标注。 |
| `task_1_1_concurrency` | partial | Task 1.1 验证 3 路匿名直播并行播放。 | run45 三路播放监控 3 分钟 smoke 通过；run46 关闭一路干扰 smoke 通过；run47 刷新一路干扰 smoke 通过；run49 2 小时监控完成 12/12 checkpoint，但 C1/C3 失去音轨且后段页面调试目标消失，未通过长稳；run53 通用候选三路自愈 smoke 通过，覆盖页面目标消失重建和音轨失效换源；run57 股票 / 财经候选 10 分钟自愈监控 10/10 checkpoint 通过；run60 股票 / 财经 20 分钟监控在第 10 个 checkpoint 因 C1 失去音轨且无 standby 未通过；run63 当前股票 / 财经候选仅 2 路可捕获；run64 滚动发现命中 1 个已有财经候选，run66 门禁仍仅 2 路可捕获；run68 公开搜索候选 0 路可捕获，不继续无效三路监控；后续单次测试最长 20 分钟，超长测试需申请。 | 补 2 小时稳定性、刷新/关闭一路干扰测试、3 个交易日复测。 |
| `task_1_2_audio_asr_before_ui` | pass | 不要先做完整 UI，先验证并发、匿名观看、独立音频和 ASR。 | 当前 demo 资产集中在容器并发、音频捕获、ASR、样本/标注；未搭完整客户端 UI。 |  |
| `per_task_deliverables_and_acceptance` | pass | 每执行一个任务，都要产出交付物，并对照验收标准判断通过/失败/需补测。 | demo/reports/validation-status-matrix.md、demo-acceptance-state.md、各 run 报告均保留验收判断。 |  |
| `p0_no_go_behavior` | partial | 遇到 P0 验证失败时先暂停依赖任务，输出 No-Go 或降级建议。 | 多路长稳、三路 10 分钟捕获、人工标注未通过时均保持 partial；但尚未形成最终 No-Go，因为仍可继续补测。 | 若后续多轮候选仍无法形成三路稳定捕获，应输出正式 No-Go/降级为单直播。 |
| `stock_review_pack_merge_path` | partial | 人工标注材料应可回填并迁入正式标注集。 | stock_review_pack_ready=True；merge dry_run matched=300 changed=0 approved=0 | 等待人工填写 review pack 后执行非 dry-run merge 和 promote。 |

## 判断

- 该审计用于防止把 partial 误判为 complete。
- 只要存在 `partial` 或 `fail`，本线程目标就不能标记完成。
