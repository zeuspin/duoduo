# Demo 验收状态矩阵

更新时间：2026-07-11

## 1. 总体结论

当前已经证明以下流程在这台 macOS 测试机上可行：

- Safari 登录账号只用于发现直播间链接，播放和采集使用无登录 Chrome profile。
- 直播链接可规范化为 `https://live.douyin.com/{room_id}` 后由无登录 Chrome 打开。
- 按用户最新收敛范围，run71 已完成“通用直播三路音频捕获 + ASR”阶段验收：run70 门禁 20/20 可捕获，run71 三路 3×60 秒捕获 9/9 片段有效、0 次换源，run71 ASR 9/9 成功，测试 Chrome / 捕获进程 / 测试 profile 已清理为 0。
- 3 个独立 Chrome `user-data-dir` 可以同时播放 3 路匿名公开直播，并完成 10 分钟级流程 smoke test；单路财经候选 run17 / run19 / run20 / run21 完成 10×60 秒稳定捕获和 ASR 入库。
- 2 小时三路匿名播放监控 run49 未通过，且后续根据用户约束不再默认执行超过 20 分钟的测试。run53 证明播放自愈 smoke 可行：页面目标消失可重建同路，音轨失效可换备用源。run57 在股票 / 财经候选上完成 10 分钟自愈监控，10/10 checkpoint 三路可播。run60 执行 20 分钟股票 / 财经监控，第 10 个 checkpoint C1 失去音轨且无 standby，未通过，暴露候选池冗余不足。run64 证明无登录首页滚动发现能命中财经候选，但该候选已在历史白名单中；run66 门禁后仍仅 2 路可捕获。run68 公开搜索候选 0/8 可捕获，不能继续有效三路监控。
- 页面级 `video.captureStream()` + `MediaRecorder` 可以从各自直播页面捕获音频，不依赖整机混音。
- 捕获音频可以保存、转码为 16 kHz mono WAV，并送入百炼 / DashScope ASR 返回中文文本；C1 单路 10 分钟样本已跑通。
- ASR 输出可以抽取为结构化 JSONL，并生成机器初筛语义标注种子。

但当前不应判定为完整 MVP 验收通过。正式验收仍缺少具备备用候选冗余的 20 分钟三路股票 / 财经自愈通过证据、后续复测、人工听检、人工标准稿、500 条人工语义标注、实时多路 ASR、单直播理解和多直播聚合验证。超过 20 分钟的长稳测试需另行说明必要性并取得授权。

机器可读总检查见 `demo/reports/demo-acceptance-state.json`，Markdown 总检查见 `demo/reports/demo-acceptance-state.md`。当前结果为：必需验收资产齐全，但总体验收未通过。

## 2. 状态总表

| 任务 | 原验收目标 | 当前状态 | 当前证据 | 仍缺内容 |
| --- | --- | --- | --- | --- |
| Task 0.1 MVP 范围和降级边界 | 输出 MVP 范围、非目标、Go / No-Go，并由产品 / 研发 / 测试确认 | 部分完成 | `demo/mvp-scope.md` 已覆盖 MUST / SHOULD / LATER 与降级边界；`scope-review-signoff.json` 和 `scope-signoff-report.md` 已建立签收入口 | 缺产品、研发、测试三方正式确认记录；当前 0/6 已确认 |
| Task 0.2 测试样本和人工标注基线 | 不少于 3 小时真实股票直播样本、人工标准稿、500 条语义标注 | 部分完成，样本时长已达标 | `demo/test-baseline.md`、182 条 manifest、1467 条 ASR 片段、1467 条机器标注种子、1467 条人工标注 workpack、300 条股票 / 财经优先人工复核包、复核包回填 dry-run、覆盖率检查报告、正式标注迁移脚本；样本适用性审计显示股票 / 财经有效样本 3.061 小时；run38/run40/run43 有效片段已完成 ASR 入库 | 缺人工听写、正式人工语义标注、可复算指标集；当前正式标注 0 条，manual_text 0 条 |
| Task 1.1 三路匿名直播并行播放 | 至少一种方案 3 路连续播放并且任一路异常不影响其他路；当前执行约束为单次不超过 20 分钟 | 自动化播放、关闭干扰、刷新干扰、自愈 smoke 通过；股票 / 财经 10 分钟自愈 smoke 通过；20 分钟监控未通过；当前候选池不足，等待用户补充实时候选 | run8 三路独立 Chrome 持续超过 10 分钟，并按用户调整的流程口径收敛；run9 三路启动和 CDP 对应通过；run45 使用三路无登录 Chrome 播放监控 180 秒，3 个 checkpoint 均 `ok=true`、`audioTrackCount=1`、`readyState=4`；run46 初始三路可播放，关闭 C1 后 C2/C3 仍 `ok=true`；run47 刷新 C1 后 C1/C2/C3 均仍可播放；run48 长监控前门禁 3/3 可捕获；run49 完成 12/12 checkpoint，但 `all_checkpoints_three_ok=false`；run53 自愈 smoke 通过，C1 页面目标消失后重建成功，C2 音轨失效后换源成功，C3 未受影响；run57 股票 / 财经三路 10 分钟自愈监控 10/10 checkpoint 通过；run59 2 小时长测因新时长约束终止；run60 股票 / 财经三路 20 分钟监控完成 10/10 checkpoint，但第 10 个 checkpoint C1 失去音轨且无备用候选，最终未通过；run61/run62 无登录搜索未发现新直播链接；run63 历史候选复查仅 2 路可捕获；run64 滚动首页发现命中财经小板总；run66 扩展门禁仍仅 2 路可捕获；run67/run68 公开搜索候选 0/8 可捕获；`task-1-1-candidate-acquisition-blocker` 已记录候选获取阻塞 | 需用户从 Safari 登录态直播首页补充 4-8 个规范化股票 / 财经直播链接 |
| Task 1.2 每容器独立音频捕获 | 3 路无串音，不采集系统 / 麦克风 / 其他应用声音，连续 2 小时无不可恢复断流 | 部分通过，16 分钟三路无换源短稳通过，系统声隔离水印通过 | 单路 10 秒、三路 10 秒、三路 60 秒、三路 180 秒页面级捕获均生成非静音文件；C1 10 分钟单文件和 10×60 秒滚动切片成功；run11 三路页面探测和 10 秒捕获均成功，C2/C3 10×60 秒成功，C1 2/10 成功；run12 暴露 0 字节片段并已补有效性校验；用户指定直播间 run24/run25 均三路页面探测通过，但 C1/C2 10/10 有效、C3 仅 3/10 有效；run38/run40 证明自动补位流程可恢复；run43 三路 16×60 秒 48/48 有效、0 次换源、结论 Pass；run44 页面 440Hz / 系统 1234Hz 水印隔离测试通过，page/system 能量比 310526860.20 | 缺人工听检、麦克风输入对照和 2 小时稳定性；run43 满足 10 分钟级流程验证，但不替代原计划 2 小时长稳 |
| 百炼 ASR smoke | 捕获音频可进入 ASR 并返回可评测中文文本 | 通过 smoke | C1/C2/C3/C4 10 秒 ASR 成功；C2/C1/C4 60 秒与 180 秒 ASR 成功；C1 10 分钟 ASR 成功并返回 48 句 | 缺实时三路 ASR、ASR 质量指标评测、热词和成本延迟评估 |

## 3. 已保留的关键产物

| 类型 | 路径 | 说明 |
| --- | --- | --- |
| 计划 | `demo/plans/2026-07-08-duoduo-live-mvp-validation-plan.md` | 原始分阶段验收计划 |
| 总体验收资产检查 | `demo/reports/demo-acceptance-state.md` / `.json` | 关键文件、计数和任务状态总检查；当前总体验收未通过 |
| 统一验收检查运行报告 | `demo/reports/demo-acceptance-check-run.md` / `.json` | 串行运行范围签收、样本适用性、覆盖率、复核包、进程守卫、总资产和 key 扫描；必要检查通过但总体验收未通过 |
| 目标要求逐条审计 | `demo/reports/objective-requirements-audit.md` / `.json` | 对执行提示词关键要求逐条绑定证据；当前存在 partial，目标未完成 |
| PRD readback | `demo/reports/prd-readback.md` / `.json` | 从 docs 原始 PRD 抽取 771 行文本和关键词命中，证明 PRD 已被读取且未移动原文 |
| 输入约束 | `demo/execution-inputs.md` | 环境、权限、Safari 使用边界、Key 使用边界 |
| 链接规范 | `demo/link-normalization.md` | 抖音直播链接去参数规则 |
| 范围边界 | `demo/mvp-scope.md` | MVP 范围、非目标和 Go / No-Go |
| 范围签收模板 | `demo/scope-review-signoff.json` | Task 0.1 人工评审签收入口 |
| Task 0.1 签收包 | `demo/reports/task-0-1-scope-signoff-pack.md` | 给产品、研发、测试、合规角色使用的签收说明和检查命令 |
| 范围签收报告 | `demo/reports/scope-signoff-report.md` / `.json` | 当前 Task 0.1 签收未通过：0/6 已确认 |
| 测试基线 | `demo/test-baseline.md` | 候选直播间、样本池、ASR 片段和标注种子说明 |
| 并发报告 | `demo/reports/demo-01-container-concurrency-report.md` | Task 1.1 执行记录 |
| 测试进程守卫报告 | `demo/reports/test-process-guard-report.md` / `.json` | 当前测试 Chrome 0 个、捕获进程 0 个；后续复测前用于防止重复窗口污染 |
| 测试 Profile 清理报告 | `demo/reports/test-chrome-profile-cleanup-report.md` / `.json` | 已清理历史无登录测试 Chrome Profile；后续复测前仍先跑进程守卫 |
| 三路直播受控启动 dry-run | `demo/reports/live-run-manifests/run-dry-20260709.json` | C1/C2/C4 规范化 URL、profile、CDP 端口规划；未实际启动 Chrome |
| 三路启动 manifest 检查 | `demo/reports/live-run-manifest-check.md` / `.json` | dry-run manifest 离线校验通过；未执行 CDP 检查 |
| 三路长稳观察表 | `demo/reports/live-run-observation-sheets/run-dry-20260709.md` / `.json` | 基于 dry-run manifest 生成；包含 2 小时 checkpoint、干扰测试和 Safari / Chrome 实例限制；当前不能作为稳定性证据 |
| run9 探测报告 | `demo/reports/live-run-run9-probe-report.md` | 三路启动和 CDP 对应通过；页面级捕获探测仅 C1 成功，C2 / C4 超时 |
| run10 页面探测报告 | `demo/reports/live-run-run10-page-probe-report.md` | 捕获前页面状态探测脚本验证；C1 可捕获，C2 / C4 8 秒超时 |
| run11 滚动捕获报告 | `demo/reports/live-run-run11-rolling-capture-report.md` | C1/C2/C3 三路短探测通过；C2/C3 10×60 秒成功，C1 2/10 成功 |
| run11 ASR 样本入库报告 | `demo/reports/run11-asr-sample-registration-report.json` | C2/C3 共 20 个 60 秒成功片段已转码、ASR，并纳入 manifest |
| run12 C2 捕获报告 | `demo/reports/run12-c2-rolling-capture-report.md` | 单路 C2 前 5 个 60 秒片段有效并入库，后 5 段 0 字节无效 |
| run12 C2 有效性审计 | `demo/reports/run12-c2-rolling-validity-report.md` / `.json` | 识别滚动捕获 summary 中 5 个有效片段、5 个无效 0 字节片段 |
| run12 C2 ASR 入库报告 | `demo/reports/run12-c2-asr-sample-registration-report.json` | 5 个有效 60 秒片段已转码、ASR，并纳入 manifest |
| run13/run14 页面探测失败报告 | `demo/reports/run13-run14-page-probe-failure-report.md` | 老李财观、财经小板总页面可见，但页面状态探测连续超时，未进入录音 |
| run15 页面探测诊断报告 | `demo/reports/run15-page-probe-diagnostic-report.md` | 修复探测脚本后，老李财观返回 video 未就绪且无音频轨，未进入录音 |
| run16 候选发现与探测报告 | `demo/reports/run16-discovery-and-candidate-probe-report.md` | 无登录首页未发现明显财经候选；两个既有财经候选等待 60 秒后仍无音频轨，未录音 |
| run17 财经单路流程报告 | `demo/reports/run17-finance-flow-report.md` | 无登录首页发现疑似财经候选；单路 10×60 秒捕获、ffprobe、ASR、manifest 入库均成功 |
| run19 财经单路复测报告 | `demo/reports/run19-finance-flow-report.md` | 同一财经候选单路 10×60 秒复测成功；修复单路捕获脚本 Profile 清理竞态 |
| run20 财经单路复测报告 | `demo/reports/run20-finance-flow-report.md` | 同一财经候选第三轮单路 10×60 秒复测成功；机器 workpack 已超过 500 条 |
| run21 财经单路复测报告 | `demo/reports/run21-finance-flow-report.md` | 同一财经候选第四轮单路 10×60 秒复测成功；机器 workpack 增至 599 条 |
| run24-run27 三路并发诊断 | `demo/reports/run24-run27-user-specified-three-route-diagnosis.md` | 用户指定直播间测试结论：三路监看部分成立，三路 10 分钟独立音频尚未稳定达标 |
| run28-run29 候选可用性诊断 | `demo/reports/run28-run29-current-candidate-availability-report.md` | 当前用户指定候选中仅 U2/U6 可捕获，少于 3 个，暂停无效三路录制 |
| run30 候选可用性复查 | `demo/reports/run30-user-candidates-availability.md` / `.json` | 再次复查 U1-U6，当前仍仅 U2/U6 可捕获，不继续无效三路录制 |
| run31 候选门禁复查 | `demo/reports/run31-user-candidates-gate.md` / `.json` | 使用门禁脚本复查 U1-U6，当前仍仅 U2/U6 可捕获；门禁阻止三路录制 |
| run32 候选门禁复查 | `demo/reports/run32-user-candidates-gate.md` / `.json` | 再次复查 U1-U6，当前仍仅 U2/U6 可捕获；继续阻止三路无效录制 |
| run33 候选门禁复查 | `demo/reports/run33-user-candidates-gate.md` / `.json` | 连续第三次复查 U1-U6，当前仍仅 U2/U6 可捕获；三路复测需要外部直播状态变化或新增候选 |
| 下播 / 无流适配策略 | `demo/reports/live-stream-loss-adaptation-strategy.md` / `demo/scripts/run_adaptive_three_live_capture.py` | 已区分直播源失效与捕获链路失败；失败段后保存页面探测；自适应三路短切片换源脚本已实现，待实录验证 |
| Safari 新候选池 | `demo/reports/safari-live-candidates-20260710.md` / `.json` | 使用 Safari 登录态直播首页只获取规范化链接；后续探测和采集均使用无登录 Chrome profile |
| run36 新候选门禁 | `demo/reports/run36-user-candidates-gate.md` / `.json` | Safari 新候选池 7/7 可捕获，推荐 S1/S2/S3 进入三路验证 |
| run37 自适应 10 秒 smoke | `demo/reports/run37-adaptive-three-route-capture-summary.md` / `.json` | 初始 3/3 可用，三路 10 秒切片均有效，未触发换源 |
| run38 自适应 10×60 秒 | `demo/reports/run38-adaptive-three-route-capture-summary.md` / `.json` | 完成 10 轮；第 9 轮 C1 原直播源 `video-not-ready-or-no-audio-track`，自动换到 S4 后第 10 轮恢复；不计为稳定三路通过 |
| run39 重排候选门禁 | `demo/reports/run39-user-candidates-gate.md` / `.json` | 重排后 5/7 可捕获；R1/R7 当前已无音频轨，推荐 R2/R3/R4 进入复测 |
| run40 自适应 10×60 秒 | `demo/reports/run40-adaptive-three-route-capture-summary.md` / `.json` | 完成 10 轮；第 6 轮 C1 原直播源 `video-not-ready-or-no-audio-track`，自动换到备用后第 7-10 轮恢复；不计为稳定三路通过 |
| run42 第二批候选门禁 | `demo/reports/run42-user-candidates-gate.md` / `.json` | Safari refresh2 新候选 6/6 可捕获，推荐 F1/F2/F3 |
| run43 自适应 16×60 秒 | `demo/reports/run43-adaptive-three-route-capture-summary.md` / `.json` | 三路 16 轮全部有效，48/48 有效片段，0 次换源，结论 Pass |
| run44 系统声水印隔离 | `demo/reports/run44-audio-watermark-isolation-report.md` / `.json` | 页面捕获 440Hz 水印，系统同时播放 1234Hz；捕获文件 page/system 能量比 310526860.20，系统声未进入页面捕获 |
| run45 三路播放监控 smoke | `demo/reports/run45-three-route-playback-monitor.md` / `.json` | 不录音，仅监控播放状态；3 分钟、3 个 checkpoint、三路全部 `ok=true` |
| run46 关闭一路干扰 smoke | `demo/reports/run46-three-route-interference-test.md` / `.json` | 初始三路全部可播放；关闭 C1 后 C2/C3 仍可播放 |
| run47 刷新一路干扰 smoke | `demo/reports/run47-three-route-reload-interference-test.md` / `.json` | 初始三路全部可播放；刷新 C1 后 C1/C2/C3 仍可播放 |
| run48 长监控前门禁 | `demo/reports/run48-user-candidates-gate.md` / `.json` | refresh2 候选池门禁 3/3 可捕获，允许进入三路长监控 |
| run49 三路播放 2 小时监控 | `demo/reports/run49-three-route-playback-monitor.md` / `.json` | 完成 12/12 checkpoint，但 `all_checkpoints_three_ok=false`；失败集中在直播源音轨消失和后段页面目标消失，不能计为 Task 1.1 通过 |
| run49 长稳失败分析 | `demo/reports/run49-playback-long-monitor-failure-analysis.md` / `.json` | 当前 Task 1.1 No-Go；下一步需要补直播源失效、页面目标消失和单路重建自愈 |
| run50 refresh2 候选复查 | `demo/reports/run50-user-candidates-gate.md` / `.json` | refresh2 候选当前 0/6 可捕获，阻止无效三路自愈 smoke |
| run51 无登录首页发现 | `demo/reports/discovery-run51-links.md` / `.json` | 发现 20 个通用直播链接，0 个财经关键词候选；仅用于播放自愈链路验证 |
| run52 通用候选门禁 | `demo/reports/run52-user-candidates-gate.md` / `.json` | run51 通用候选 20/20 可捕获，推荐前三路进入自愈 smoke |
| run53 三路播放自愈 smoke | `demo/reports/run53-three-route-playback-recovery-monitor.md` / `.json` | 3 分钟、3 个 checkpoint、故障注入开启；C1 重建同房间成功，C2 自然失效后换源成功，最终三路全 checkpoint 可播放 |
| run54 无登录首页发现 | `demo/reports/discovery-run54-links.md` / `.json` | 发现 20 个通用直播链接，0 个财经关键词候选；不能直接用于股票 / 财经自愈验证 |
| run55 历史股票 / 财经候选池 | `demo/reports/run55-historical-stock-finance-candidates.md` / `.json` | 从样本适用性白名单整理 22 个历史股票 / 财经候选 |
| run56 历史股票 / 财经候选门禁 | `demo/reports/run56-user-candidates-gate.md` / `.json` | 3/22 可捕获，推荐 `31544105137`、`100263212175`、`816173758414` |
| run57 股票 / 财经播放自愈 smoke | `demo/reports/run57-three-route-playback-recovery-monitor.md` / `.json` | 先机财经、江哥财经、老李财观三路 10 分钟监控，10/10 checkpoint 全部可播，未触发恢复 |
| 测试时长约束 | `demo/reports/test-duration-policy.md` | 单次直播测试最长 20 分钟；超过 20 分钟需先说明必要性并取得授权 |
| run59 2 小时长测终止 | `demo/reports/run59-long-monitor-aborted-by-duration-policy.md` / `.json` | 按新时长约束终止，不计为通过或失败 |
| run60 股票 / 财经 20 分钟监控 | `demo/reports/run60-three-route-playback-recovery-monitor.md` / `.json` | 完成 10/10 checkpoint；第 10 个 checkpoint C1 失去音轨，重建同房间仍失败，因无 standby 未通过 |
| run60 失败分析 | `demo/reports/run60-stock-finance-20min-recovery-analysis.md` / `.json` | 结论：候选池冗余不足；下一轮需至少 4-5 个当前可捕获股票 / 财经候选 |
| run61 股票搜索发现 | `demo/reports/discovery-run61-stock-search-links.md` / `.json` | 无登录搜索 `股票直播`，未抽取到直播链接 |
| run62 财经搜索发现 | `demo/reports/discovery-run62-finance-search-links.md` / `.json` | 无登录搜索 `财经直播`，未抽取到直播链接 |
| run63 历史候选复查 | `demo/reports/run63-user-candidates-gate.md` / `.json` | 当前仅 2/22 个历史股票 / 财经候选可捕获，不足以启动三路监控 |
| run61-run63 候选冗余报告 | `demo/reports/run61-run63-stock-finance-candidate-redundancy-report.md` / `.json` | 当前 No-Go 原因为股票 / 财经候选池不足，不计为三路容器链路失败 |
| run64 滚动首页发现 | `demo/reports/discovery-run64-scroll-live-home-links.md` / `.json` | 无登录直播首页滚动 8 次，发现 20 个链接，其中 1 个财经关键词候选 `782837937233` |
| run65 扩展候选池 | `demo/reports/run65-expanded-stock-finance-candidates.md` / `.json` | 历史白名单 + run64 财经候选合并，候选仍为 22 个，未新增独立财经房间 |
| run66 扩展候选门禁 | `demo/reports/run66-user-candidates-gate.md` / `.json` | 当前仅 2/22 个扩展股票 / 财经候选可捕获，不足以启动三路监控 |
| run64-run66 滚动发现报告 | `demo/reports/run64-run66-scroll-discovery-candidate-report.md` / `.json` | 发现能力增强但仍未补足候选池；不计为三路容器失败 |
| run67 公开搜索候选 | `demo/reports/run67-public-search-stock-finance-candidates.md` / `.json` | 公开网页搜索整理 8 个股票 / 财经候选 |
| run68 公开搜索候选门禁 | `demo/reports/run68-user-candidates-gate.md` / `.json` | 公开搜索候选 0/8 可捕获，不能补充 standby |
| run67-run68 公开搜索报告 | `demo/reports/run67-run68-public-search-candidate-report.md` / `.json` | 公开搜索未补足当前可播候选，下一步仍需实时选流 |
| Task 1.1 候选获取阻塞 | `demo/reports/task-1-1-candidate-acquisition-blocker.md` / `.json` | 自动发现路径已耗尽；需要用户补充 4-8 个规范化股票 / 财经直播链接 |
| 当前阶段范围 | `demo/reports/multi-route-audio-asr-validation-scope.md` | 用户最新收敛范围：只验证多路直播音频捕获和 ASR，不验证股票 / 财经 |
| run69 通用直播发现 | `demo/reports/discovery-run69-generic-live-links.md` / `.json` | 从无登录直播首页发现 20 个通用直播链接 |
| run70 通用候选门禁 | `demo/reports/run70-user-candidates-gate.md` / `.json` | run69 候选 20/20 可捕获，推荐 `478068897604`、`575973340980`、`744549703134` |
| run71 三路音频捕获 | `demo/reports/run71-adaptive-three-route-capture-summary.md` / `.json` | 三路 3×60 秒捕获，完成 3/3 轮，9/9 片段有效，0 次换源，结论 Pass |
| run71 三路 ASR | `demo/reports/run71-generic-asr-sample-registration-report.json` | 9 个有效片段全部转码并调用 ASR 成功，manifest 追加 9 条 |
| run71 当前阶段验收报告 | `demo/reports/run71-multi-route-audio-asr-validation-report.md` / `.json` | 当前阶段“多路直播音频捕获 + ASR”通过；未做人耳听检，旧完整 MVP 仍未通过 |
| 样本适用性审计 | `demo/reports/sample-suitability-report.md` / `.json` | 区分股票 / 财经样本和 pipeline-only 样本；当前股票 / 财经有效样本约 3.061 小时，已达到 3 小时时长门槛 |
| 音频报告 | `demo/reports/demo-02-audio-isolation-report.md` | Task 1.2 执行记录 |
| 滚动捕获工具报告 | `demo/reports/demo-02-rolling-capture-tooling-report.md` | 捕获脚本硬超时、失败日志和 summary 验证 |
| ASR 报告 | `demo/reports/demo-04-asr-smoke-report.md` | 百炼 ASR smoke 记录 |
| 样本清单 | `demo/samples/manifests/sample-manifest.jsonl` | 182 条样本记录 |
| ASR 片段 | `demo/samples/transcripts/asr/asr-segments.jsonl` | 1467 条机器抽取 ASR 片段 |
| 语义种子 | `demo/samples/annotations/semantic-events-seed.jsonl` | 1467 条机器初筛标注，均需人工复核 |
| 人工标注工作包 | `demo/samples/annotations/human-annotation-workpack.jsonl` / `.csv` | 1467 条待人工填写和复核的标注入口 |
| 标注覆盖率报告 | `demo/reports/annotation-coverage-report.md` / `.json` | 当前 workpack 未通过 Task 0.2：数量已达 500，但 manual_text 0、reviewed 0；其中非股票 pipeline-only 样本不能计入股票语义验收 |
| 股票 / 财经优先复核包 | `demo/samples/annotations/stock-finance-review-pack.jsonl` / `.csv` | 300 条股票 / 财经片段，优先覆盖数字、否定、条件、风险和实体表达 |
| 股票 / 财经复核包检查 | `demo/reports/stock-finance-review-pack-check.md` / `.json` | 300/300 条组成检查通过，非股票样本 0 条；不代表人工标注完成 |
| 人工复核回填流程 | `demo/reports/stock-review-pack-human-workflow.md` | 说明复核包填写、dry-run 回填、正式迁移和覆盖率检查步骤 |
| 复核包回填 dry-run | `demo/reports/merge-stock-review-pack-report.json` | 当前 300 条匹配、0 条变更、0 条 approved，符合未人工填写状态 |
| 正式语义标注集 | `demo/samples/annotations/semantic-events.jsonl` | 当前 0 条；仅 reviewed / accepted / done 可迁入 |
| 正式标注覆盖率报告 | `demo/reports/semantic-events-coverage-report.md` / `.json` | 当前正式标注集未通过 Task 0.2：缺 500 条 |

## 4. 当前候选直播间

| 编号 | URL | 说明 | 当前用途 |
| --- | --- | --- | --- |
| C1 | `https://live.douyin.com/782837937233` | 财经小板总 | 60 秒 / 180 秒 / 600 秒捕获与 ASR |
| C2 | `https://live.douyin.com/31544105137` | 先机财经 | 10 秒 / 60 秒 / 180 秒捕获与 ASR |
| C3 | `https://live.douyin.com/100263212175` | 江哥财经 | 10 秒捕获与 ASR，后续一次未显示音频 |
| C4 | `https://live.douyin.com/414092641626` | 谷市一代枭雄 | 10 秒 / 60 秒 / 180 秒捕获与 ASR |
| C5 | `https://live.douyin.com/893703096387` | 谢说财经 | 10 分钟补测中捕获挂起，需重验 |
| C6 | `https://live.douyin.com/16743488023` | 大A付老大-九点 | run17 单路 10×60 秒捕获、ASR 和入库成功 |

## 5. 下一步执行清单

1. 对 C2 / C1 / C4 的 60 秒和 180 秒 WAV 做人工听检，确认每个文件只包含对应直播间声音，无串音。
2. 增加更强隔离对照：播放一段可识别外部音频或系统声音水印，确认不会进入页面级捕获文件和 ASR 文本。
3. 使用已增加硬超时的页面级捕获脚本复测三路 10 分钟滚动捕获，并继续补分段失败恢复、页面播放状态探测。
4. 使用 `demo/scripts/cdp_live_page_probe.js` 对候选直播做捕获前状态探测；只有三路均 `ok=true` 且存在音频轨，才进入录音。
5. 使用观察表 `demo/reports/live-run-observation-sheets/run-dry-20260709.md` 执行下一轮三路长稳启动前检查，确保每轮最多 3 个无登录 Chrome 测试实例。
6. 重新选择三路稳定财经直播，做 10 分钟三路滚动捕获。
7. 基于 `stock-finance-review-pack` 做第一批人工听写和语义复核，先标 50 到 100 条高质量人工语义片段，再扩大到正式 500 条。
8. 重新获取股票 / 财经候选池，先确保至少 4-5 个当前可捕获候选，再执行不超过 20 分钟的三路自愈监控；候选不足时停止测试并记录 No-Go。
9. 后续扩样时优先选择股票 / 财经直播；口播、故事会、唱歌、跳舞和纯卖货样本只能作为音频链路对照，不计入 Task 0.2 股票样本时长。

## 6. 风险与边界

- 当前流程依赖抖音直播页面存在可捕获的 `video` 元素；若页面实现变化，页面级捕获脚本需要重验。
- Chrome 窗口标题“正在播放音频”只能作为播放状态证据之一，不能替代人工听检。
- ASR smoke 只证明“能识别出文本”，不证明金融语义理解准确。
- 机器语义标注种子不能作为验收基线，必须经过人工复核。
- 本轮未使用 Safari 播放、录制或多开直播，Safari 只应继续作为登录态选流工具使用。
