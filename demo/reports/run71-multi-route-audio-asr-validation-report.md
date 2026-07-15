# run71 多路直播音频 + ASR 阶段验收报告

## 结论

本阶段目标通过。

本阶段只验证：多路公开直播可并行监看、每路音频可独立录制、录制结果可调用百炼 / DashScope ASR 输出文本。不验证股票 / 财经分类、不做两小时长稳、不做人工听写或语义标注。

## 验收结果

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 候选门禁 | 通过 | run70 发现并探测 20 个可播直播间，`can_run_three_route_capture=true` |
| 三路并行录制 | 通过 | run71 初始 3/3 路可用，完成 3/3 轮，每轮 60 秒 |
| 音频片段有效性 | 通过 | 9/9 个片段有效，每个片段 967089 bytes |
| 突然下播适配 | 本轮未触发 | run71 `replacement_events=0`；自适应换源脚本已接入，失败时会从 standby 补位 |
| 音频隔离自动证据 | 通过，带限制 | 三路使用独立匿名 Chrome profile、独立 CDP 端口、页面级 `video.captureStream()` 捕获；ASR 文本明显不同；run44 已证明系统声音不会进入页面捕获 |
| 人工听检 | 未执行 | 当前阶段以自动化证据验收，未做人耳听检 |
| ASR | 通过 | 9/9 个样本转 16 kHz mono WAV 后调用 ASR 成功 |
| 环境清理 | 通过 | 测试 Chrome 进程 0、捕获进程 0、测试 profile 目录 0 |

## 三路信息

| 路 | room_id | URL | 页面标题 | 有效片段 |
| --- | --- | --- | --- | ---: |
| C1 | `478068897604` | `https://live.douyin.com/478068897604` | 大声的抖音直播间 - 抖音直播 | 3 |
| C2 | `575973340980` | `https://live.douyin.com/575973340980` | 王者荣耀猪八（国服阿骨朵）的抖音直播间 - 抖音直播 | 3 |
| C3 | `744549703134` | `https://live.douyin.com/744549703134` | 小白龙🐲¹¹¹的抖音直播间 - 抖音直播 | 3 |

## ASR 结果

| 样本 | ASR 句数 | 文本片段 |
| --- | ---: | --- |
| RUN71-C1-R01 | 1 | 墙围墙台风级。早晨五点钟，其中心位于这闽交界东偏南方向约560公里的西北太平洋洋面上... |
| RUN71-C2-R01 | 10 | 他没大了。 |
| RUN71-C3-R01 | 11 | 开区。 |
| RUN71-C1-R03 | 2 | 超1400人进入这ba比赛场馆躲避台风... |
| RUN71-C2-R03 | 15 | 断下，打通棍子，什么都是。断下。 |
| RUN71-C3-R03 | 10 | 临海啊啊对啊稍等啊，台州临海。 |

## 关键产物

- 候选发现：`demo/reports/discovery-run69-generic-live-links.json`
- 候选门禁：`demo/reports/run70-user-candidates-gate.json`
- 三路捕获摘要：`demo/reports/run71-adaptive-three-route-capture-summary.json`
- ASR 入库报告：`demo/reports/run71-generic-asr-sample-registration-report.json`
- 本阶段机器报告：`demo/reports/run71-multi-route-audio-asr-validation-report.json`
- 清理报告：`demo/reports/test-chrome-profile-cleanup-report.json`

## 边界说明

这个结论只适用于用户最新收敛后的阶段目标。原完整 MVP 验收仍未通过，因为仍缺股票 / 财经稳定候选、人工听写、正式人工语义标注、实时多路 ASR 和更完整的业务评测。
