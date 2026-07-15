# Demo 04：百炼 ASR Smoke Test 报告

## 1. 验证目标

验证本地捕获的财经直播音频样本能否送入百炼 / DashScope ASR，并返回可用于后续评测的中文转写结果。

本轮是 10 秒 smoke test，不等价于 Task 0.2 的 3 小时样本集，也不等价于完整实时 ASR 稳定性验收。

## 2. 输入样本

| 项目 | 值 |
| --- | --- |
| sample_id | `C1-SMOKE-001` |
| 直播间 | 财经小板总 |
| URL | `https://live.douyin.com/782837937233` |
| 音频来源 | 页面级 `video.captureStream()` 捕获 |
| 输入音频 | `demo/samples/audio/raw/C1_782837937233_20260709_0211_10s_page_capture_16k_mono.wav` |
| 音频格式 | 16 kHz mono WAV |
| 有效时长 | 约 9.96 秒 |

## 3. 执行方式

脚本：

```text
demo/scripts/bailian_asr_smoke.py
```

模型：

```text
paraformer-realtime-v2
```

输出：

```text
demo/samples/transcripts/asr/C1_782837937233_20260709_0211_10s_bailian_asr.json
```

密钥处理：

- 脚本从 `.env` 加载本地 Key。
- 报告和输出文件不写入 Key。
- 控制台只输出状态、模型、样本路径和句子数量。

## 4. 结果摘要

| 项目 | 结果 |
| --- | --- |
| API 状态 | 成功 |
| status_code | 200 |
| sentence_count | 2 |
| usage.duration | 10 |
| 是否返回中文文本 | 是 |

### 4.1 三路 ASR 补测

执行时间：`2026-07-09 02:24` 后。

| 编号 | 输入音频 | ASR 输出 | status | 句子数 |
| --- | --- | --- | --- | ---: |
| C2 | `demo/samples/audio/raw/C2_31544105137_20260709_0224_10s_page_capture_16k_mono.wav` | `demo/samples/transcripts/asr/C2_31544105137_20260709_0224_10s_bailian_asr.json` | 成功 | 3 |
| C3 | `demo/samples/audio/raw/C3_100263212175_20260709_0224_10s_page_capture_16k_mono.wav` | `demo/samples/transcripts/asr/C3_100263212175_20260709_0224_10s_bailian_asr.json` | 成功 | 4 |
| C4 | `demo/samples/audio/raw/C4_414092641626_20260709_0224_10s_page_capture_16k_mono.wav` | `demo/samples/transcripts/asr/C4_414092641626_20260709_0224_10s_bailian_asr.json` | 成功 | 2 |

### 4.2 三路 60 秒 ASR 补测

| 编号 | 输入音频 | ASR 输出 | status | 句子数 | 系统语音关键词 |
| --- | --- | --- | --- | ---: | --- |
| C2 | `demo/samples/audio/raw/C2_31544105137_20260709_0232_60s_page_capture_16k_mono.wav` | `demo/samples/transcripts/asr/C2_31544105137_20260709_0232_60s_bailian_asr.json` | 成功 | 6 | 未出现 |
| C1 | `demo/samples/audio/raw/C1_782837937233_20260709_0232_60s_page_capture_16k_mono.wav` | `demo/samples/transcripts/asr/C1_782837937233_20260709_0232_60s_bailian_asr.json` | 成功 | 8 | 未出现 |
| C4 | `demo/samples/audio/raw/C4_414092641626_20260709_0232_60s_page_capture_16k_mono.wav` | `demo/samples/transcripts/asr/C4_414092641626_20260709_0232_60s_bailian_asr.json` | 成功 | 6 | 未出现 |

### 4.3 三路 3 分钟 ASR 补测

| 编号 | 输入音频 | ASR 输出 | status | 句子数 |
| --- | --- | --- | --- | ---: |
| C2 | `demo/samples/audio/raw/C2_31544105137_20260709_0241_180s_page_capture_16k_mono.wav` | `demo/samples/transcripts/asr/C2_31544105137_20260709_0241_180s_bailian_asr.json` | 成功 | 26 |
| C1 | `demo/samples/audio/raw/C1_782837937233_20260709_0241_180s_page_capture_16k_mono.wav` | `demo/samples/transcripts/asr/C1_782837937233_20260709_0241_180s_bailian_asr.json` | 成功 | 14 |
| C4 | `demo/samples/audio/raw/C4_414092641626_20260709_0241_180s_page_capture_16k_mono.wav` | `demo/samples/transcripts/asr/C4_414092641626_20260709_0241_180s_bailian_asr.json` | 成功 | 11 |

### 4.4 10 分钟 ASR 补测

| 编号 | 输入音频 | ASR 输出 | status | 句子数 |
| --- | --- | --- | --- | ---: |
| C1 | `demo/samples/audio/raw/C1_782837937233_20260709_0253_600s_page_capture_16k_mono.wav` | `demo/samples/transcripts/asr/C1_782837937233_20260709_0253_600s_bailian_asr.json` | 成功 | 48 |

识别文本片段：

```text
呃。
您峰说这个京东出中报了啊，中报预告了啊，那这些前排的权重啊，人家的人家。
```

### 4.5 run11 两路 10 分钟滚动分段 ASR

执行时间：`2026-07-09 04:09` 后。

run11 中 C2（老李财观）和 C3（老林故事会）各完成 10 个 60 秒页面级滚动捕获片段。已将 20 个 WebM 片段转码为 16 kHz mono WAV，并逐个送入百炼 ASR。

| 项目 | 结果 |
| --- | ---: |
| 待处理 60 秒片段 | 20 |
| ASR 成功片段 | 20 |
| manifest 新增样本 | 20 |
| ASR segments 总数 | 293 |
| 待人工复核 workpack 总数 | 293 |

批处理报告：

```text
demo/reports/run11-asr-sample-registration-report.json
```

代表性输出文件：

```text
demo/samples/transcripts/asr/run11_C2_816173758414_20260709T0408_seg01_60s_bailian_asr.json
demo/samples/transcripts/asr/run11_C3_59041165350_20260709T0408_seg01_60s_bailian_asr.json
```

## 5. 判断

| 验收项 | 当前判断 | 证据 |
| --- | --- | --- |
| 捕获音频可送入百炼 ASR。 | 通过 | C1/C2/C3/C4 均完成 ASR smoke，返回成功状态。 |
| ASR 返回可评测文本。 | 通过 | 10 秒、60 秒、3 分钟、10 分钟样本均返回中文句子；10 分钟 C1 返回 48 句；run11 C2/C3 共 20 个 60 秒片段全部 ASR 成功。 |
| 可用于完整 ASR 质量评测。 | 未通过 / 样本不足 | 已有单路 10 分钟样本和两路 10×60 秒分段样本，但仍不满足 Task 0.2 的 3 小时股票直播、人工标准稿和 500 人工片段要求。 |
| 可用于实时多路 ASR 稳定性判断。 | 未验证 | 本轮只验证单个已保存音频文件，不验证三路实时流。 |

## 6. 当前结论

- 百炼 ASR smoke test 通过。
- 页面级捕获音频可以转码为 16 kHz mono WAV，并成功得到中文转写。
- 三路财经直播 10 秒样本均可进入百炼 ASR 并返回句子。
- 三路财经直播 60 秒样本也均可进入百炼 ASR 并返回句子，且未识别出系统语音对照关键词。
- 三路财经直播 3 分钟样本均可进入百炼 ASR 并返回句子。
- C1 10 分钟样本可进入百炼 ASR 并返回 48 句。
- run11 C2/C3 共 20 个 60 秒滚动片段均可进入百炼 ASR，并已重建为 293 条 ASR segment 和 293 条待人工复核 workpack。
- 后续可以继续推进 ASR 流程验证，但必须补足真实财经直播样本和人工标注基线。

## 7. 下一步

1. 对 C2/C1/C4 的 60 秒输出做人工听写抽检，判断 ASR 文本是否保留板块名、数字、否定词和条件表达。
2. 将 ASR 输出和人工听写片段对齐，开始最小 CER / 关键词召回评测。
3. 对 run11 C2/C3 的 60 秒分段输出做人工听写抽检，判断滚动分段 ASR 是否存在断句、漏句或主题漂移。
4. 继续验证三路分段滚动捕获 + 分段 ASR，避免长文件失败影响整段结果。
5. 若离线文件 ASR 效果可接受，再做三路实时 ASR smoke。
