# Demo 02：每容器独立音频捕获验证报告

## 1. 验证目标

验证在当前 macOS 测试电脑上，是否能从单个无登录 Chrome 直播容器中捕获对应直播页面音频，并形成可保存、可转码、可进入 ASR 的音频文件。

本轮是 Task 1.2 的 smoke test，不等价于完整 3 路 2 小时音频隔离验收。

## 2. 执行边界

- Safari 已登录用户抖音账号，仅用于发现直播间链接。
- 播放、捕获、录制只使用无登录 Chrome profile。
- 直播链接使用规范化格式：`https://live.douyin.com/{room_id}`。
- 不读取、不打印、不写入 `.env` 或任何 Key。
- 样本文件均保存到 `demo/` 下。

## 3. 候选直播

| 编号 | URL | 直播间 | 选择原因 | 当前判断 |
| --- | --- | --- | --- | --- |
| C1 | https://live.douyin.com/782837937233 | 财经小板总 | 财经 / 板块 / 个股讨论，匿名可打开 | 可用于音频捕获 smoke test |
| C2 | https://live.douyin.com/31544105137 | 先机财经 | 板块热点分析和主线挖掘 | 可用于三路捕获 smoke test |
| C3 | https://live.douyin.com/100263212175 | 江哥财经 | A 股行情分析，热点聚焦 | 可用于三路捕获 smoke test |
| C4 | https://live.douyin.com/414092641626 | 谷市一代枭雄 | 美联储政策 / 市场影响 / 解盘 | 可用于三路捕获 smoke test |

## 4. 环境检查

| 项目 | 结果 | 说明 |
| --- | --- | --- |
| `ffmpeg` | 可用 | `/opt/homebrew/bin/ffmpeg` |
| `sox` | 未发现 | 本轮不用 |
| `SwitchAudioSource` | 未发现 | 本轮不用 |
| macOS AVFoundation 音频设备枚举 | 未列出设备 | `ffmpeg -f avfoundation -list_devices true -i ""` 未得到可用音频设备列表 |
| HAL 插件 | 存在 | `/Library/Audio/Plug-Ins/HAL` 下有 `OrayVirtualAudioDevice.driver`、`ParrotAudioPlugin.driver` |
| 页面级捕获 | 成功 | Chrome `video.captureStream()` + `MediaRecorder` |

结论：系统级 / 虚拟声卡捕获当前证据不足；页面级捕获是本轮可行路径。

## 5. 执行记录

### 5.1 启动无登录 Chrome

- 时间：`2026-07-09 02:10:13 +0800`
- Profile：`demo/runtime/chrome-profiles/run9-a`
- URL：`https://live.douyin.com/782837937233`
- Chrome 参数：

```text
--user-data-dir=demo/runtime/chrome-profiles/run9-a
--no-first-run
--no-default-browser-check
--autoplay-policy=no-user-gesture-required
--remote-debugging-port=9222
```

窗口标题验证：

```text
财经小板总的抖音直播间 - 抖音直播 - 正在播放音频 - Google Chrome
```

### 5.2 页面级音频捕获

捕获脚本：

```text
demo/scripts/cdp_audio_capture.js
```

输出文件：

```text
demo/samples/audio/raw/C1_782837937233_20260709_0211_10s_page_capture.webm
demo/samples/audio/raw/C1_782837937233_20260709_0211_10s_page_capture_16k_mono.wav
```

捕获结果：

| 项目 | 值 |
| --- | --- |
| 捕获方式 | Chrome DevTools Protocol + 页面 `video.captureStream()` + `MediaRecorder` |
| 捕获时长 | 10000 ms |
| 音频轨道数 | 1 |
| 原始编码 | `audio/webm;codecs=opus` |
| 原始文件大小 | 160661 bytes |
| 转码文件 | 16 kHz mono WAV |

ffprobe / ffmpeg 检查：

| 检查项 | 结果 |
| --- | --- |
| 音频流 | Opus, 48000 Hz, stereo |
| 解码时长 | 约 9.96 秒 |
| mean_volume | -16.4 dB |
| max_volume | -1.0 dB |
| 是否静音 | 否 |

### 5.3 三路页面级捕获补测

执行时间：`2026-07-09 02:24` 左右。

三路无登录 Chrome profile：

| 编号 | Profile | DevTools 端口 | URL | 标题状态 |
| --- | --- | ---: | --- | --- |
| C2 | `run11-a` | 9223 | https://live.douyin.com/31544105137 | 显示“正在播放音频” |
| C3 | `run11-b` | 9224 | https://live.douyin.com/100263212175 | 显示“正在播放音频” |
| C4 | `run11-c` | 9225 | https://live.douyin.com/414092641626 | 显示“正在播放音频” |

捕获文件：

| 编号 | WebM | WAV | mean_volume | max_volume | 判断 |
| --- | --- | --- | ---: | ---: | --- |
| C2 | `demo/samples/audio/raw/C2_31544105137_20260709_0224_10s_page_capture.webm` | `demo/samples/audio/raw/C2_31544105137_20260709_0224_10s_page_capture_16k_mono.wav` | -20.4 dB | -1.0 dB | 非静音 |
| C3 | `demo/samples/audio/raw/C3_100263212175_20260709_0224_10s_page_capture.webm` | `demo/samples/audio/raw/C3_100263212175_20260709_0224_10s_page_capture_16k_mono.wav` | -18.1 dB | -1.7 dB | 非静音 |
| C4 | `demo/samples/audio/raw/C4_414092641626_20260709_0224_10s_page_capture.webm` | `demo/samples/audio/raw/C4_414092641626_20260709_0224_10s_page_capture_16k_mono.wav` | -35.9 dB | -15.9 dB | 非静音，音量偏低 |

### 5.4 三路 60 秒捕获与系统声音隔离对照

执行时间：`2026-07-09 02:32` 左右。

run12 原计划使用 C2/C3/C4；其中 C3（江哥财经）在本轮未显示“正在播放音频”，因此关闭 C3，改用已验证的 C1（财经小板总）补足第三路。最终三路为 C2、C1、C4。

系统声音对照：

```text
say 'system audio isolation test should not be captured by page level recorder'
```

该系统语音在三路 60 秒页面级捕获期间播放。后续 ASR 文本中未发现 `system audio isolation`、`system`、`isolation`、`page level recorder` 等关键词。

| 编号 | WebM | WAV | mean_volume | max_volume | ASR 句子数 | 系统语音关键词 |
| --- | --- | --- | ---: | ---: | ---: | --- |
| C2 | `demo/samples/audio/raw/C2_31544105137_20260709_0232_60s_page_capture.webm` | `demo/samples/audio/raw/C2_31544105137_20260709_0232_60s_page_capture_16k_mono.wav` | -20.2 dB | -0.9 dB | 6 | 未出现 |
| C1 | `demo/samples/audio/raw/C1_782837937233_20260709_0232_60s_page_capture.webm` | `demo/samples/audio/raw/C1_782837937233_20260709_0232_60s_page_capture_16k_mono.wav` | -18.9 dB | -0.9 dB | 8 | 未出现 |
| C4 | `demo/samples/audio/raw/C4_414092641626_20260709_0232_60s_page_capture.webm` | `demo/samples/audio/raw/C4_414092641626_20260709_0232_60s_page_capture_16k_mono.wav` | -32.1 dB | -8.9 dB | 6 | 未出现 |

### 5.5 三路 3 分钟捕获稳定性补测

执行时间：`2026-07-09 02:41` 左右。

三路仍使用 C2、C1、C4。捕获期间未额外播放系统语音，只观察较长时间页面级捕获是否能完整生成文件。

| 编号 | WebM | WAV | mean_volume | max_volume | ASR 句子数 | 判断 |
| --- | --- | --- | ---: | ---: | ---: | --- |
| C2 | `demo/samples/audio/raw/C2_31544105137_20260709_0241_180s_page_capture.webm` | `demo/samples/audio/raw/C2_31544105137_20260709_0241_180s_page_capture_16k_mono.wav` | -19.8 dB | -0.9 dB | 26 | 3 分钟完整、非静音 |
| C1 | `demo/samples/audio/raw/C1_782837937233_20260709_0241_180s_page_capture.webm` | `demo/samples/audio/raw/C1_782837937233_20260709_0241_180s_page_capture_16k_mono.wav` | -20.9 dB | -1.3 dB | 14 | 3 分钟完整、非静音 |
| C4 | `demo/samples/audio/raw/C4_414092641626_20260709_0241_180s_page_capture.webm` | `demo/samples/audio/raw/C4_414092641626_20260709_0241_180s_page_capture_16k_mono.wav` | -18.6 dB | -0.8 dB | 11 | 3 分钟完整、非静音 |

### 5.6 10 分钟捕获补测

执行时间：`2026-07-09 02:53` 到 `2026-07-09 03:23` 左右。

本轮先尝试 C2/C1/C4 三路 600 秒页面级捕获。C2 立即返回 `no-audio-tracks`，因此替换为 C5。随后 C1 生成完整 600 秒文件，C4/C5 的 600 秒捕获进程超过 18 分钟仍未返回且未写出文件，已终止并记录为失败。为排查长文件风险，追加了 10 段 60 秒滚动切片；C1 的 10 段全部成功，C4/C5 第 1 段仍未按 60 秒返回，已终止。事后已在 `demo/scripts/cdp_audio_capture.js` 增加 Node 侧硬超时，防止后续分段捕获无限挂起。滚动捕获脚本的工具层验证见 `demo/reports/demo-02-rolling-capture-tooling-report.md`。

| 编号 | URL | 结果 | 证据 |
| --- | --- | --- | --- |
| C1 | `https://live.douyin.com/782837937233` | 10 分钟单文件成功；10×60 秒滚动切片成功 | `C1_782837937233_20260709_0253_600s_page_capture.webm`，转码后 WAV 时长 600.000 秒；mean_volume -20.5 dB，max_volume -1.3 dB；滚动切片 10 个文件均生成 |
| C2 | `https://live.douyin.com/31544105137` | 本轮不可用 | 捕获返回 `no-audio-tracks`、`paused: true`、`readyState: 0` |
| C4 | `https://live.douyin.com/414092641626` | 10 分钟和 60 秒滚动补测挂起 | 捕获进程超过预期未返回，未生成本轮 600 秒或滚动切片文件 |
| C5 | `https://live.douyin.com/893703096387` | 10 分钟和 60 秒滚动补测挂起 | 捕获进程超过预期未返回，未生成本轮 600 秒或滚动切片文件 |

### 5.7 run11 三路 10 分钟滚动捕获补测

执行时间：`2026-07-09 04:09` 到 `2026-07-09 04:22` 左右。

本轮先通过无登录 Chrome discovery 从抖音直播首页抽取候选链接，选择 C1（财经小板总）、C2（老李财观，K 线主题）和 C3（老林故事会，口播）。三路启动和 CDP 页面对应检查通过，捕获前页面状态探测均返回 `ok=true`、`readyState=4`、`audioTrackCount=1`，三路 10 秒页面级捕获均成功。随后执行 10×60 秒滚动捕获，结果如下：

| 编号 | URL | 页面标题 | 10 秒探测 | 10×60 秒滚动捕获 | 判断 |
| --- | --- | --- | --- | --- | --- |
| C1 | `https://live.douyin.com/782837937233` | 财经小板总的抖音直播间 | 成功 | 2/10 成功，8/10 失败 | 中途退化，不通过 |
| C2 | `https://live.douyin.com/816173758414` | 老李财观的抖音直播间 | 成功 | 10/10 成功 | 通过 10 分钟滚动捕获 |
| C3 | `https://live.douyin.com/59041165350` | 老林故事会的抖音直播间 | 成功 | 10/10 成功 | 通过 10 分钟滚动捕获 |

详细记录见 `demo/reports/live-run-run11-rolling-capture-report.md`。本轮不能判定为三路 10 分钟稳定通过，但已经将失败范围收敛到 C1 中途退化，并验证 C2/C3 两路可稳定滚动捕获 10 分钟。

## 6. 验收标准对照

| Task 1.2 验收标准 | 当前判断 | 证据 |
| --- | --- | --- |
| 3 路音频无串音。 | 初步通过 / 需人工听检确认 | C2/C3/C4 曾使用三个独立 Chrome profile、三个独立 CDP 端口分别从各自页面 `video` 元素捕获短音频；文件互相独立。尚未做人工听检或声纹/内容比对。10 分钟补测未形成三路同时成功。 |
| 系统提示音、麦克风、其他浏览器或其他应用声音不进入任一路正式音频。 | 初步通过 | 60 秒三路捕获期间播放了系统 `say()` 语音；三路 ASR 文本均未出现系统语音关键词。仍建议后续用更强声学水印做复核。 |
| 每个音频片段可定位到唯一容器、直播会话、序号和起止时间。 | 通过 | manifest 已记录 C1/C2/C3/C4 的 room_url、room_id、capture_method、audio_file、raw_audio_file、asr_file。 |
| 连续 2 小时无不可恢复断流。 | 未验证 | 用户已将当前流程验证收敛为 10 分钟级 smoke test；本轮仅 C1 10 分钟成功，C4/C5 长段和滚动捕获出现挂起。 |
| 若只能录制整机混音，则 No-Go。 | 未触发 | 本轮不是整机混音，而是页面级捕获。 |

## 7. 当前结论

- 单路页面级音频捕获 smoke test 通过。
- 三路财经直播页面级捕获 smoke test 初步通过：C2/C3/C4 均可在无登录 Chrome 中播放，并各自捕获 10 秒非静音音频。
- 三路 60 秒捕获补测初步通过：C2/C1/C4 均生成 60 秒非静音音频，且系统 `say()` 语音未进入 ASR 文本。
- 三路 3 分钟捕获稳定性补测初步通过：C2/C1/C4 均生成 3 分钟完整非静音音频，并可进入 ASR。
- 10 分钟补测中，C1 单路 600 秒捕获、转码、音量检查和 10×60 秒滚动切片成功。
- 10 分钟补测未形成三路同时成功：C2 本轮无音轨，C4/C5 长段和滚动捕获挂起。
- run11 补测中，三路启动、页面探测和 10 秒捕获均成功；10×60 秒滚动捕获中 C2/C3 均 10/10 成功，C1 为 2/10 成功、8/10 失败。
- 捕获工具已增加硬超时、JSONL summary 和失败计数，后续复测可稳定落盘失败证据。
- 该路径比整机混音更符合“每容器独立音频”的方向。
- Task 1.2 尚未完整通过，因为还未做人工听检确认、强隔离对照、三路 10 分钟稳定捕获和长时间稳定性验证。

## 8. 下一步

1. 对 C2/C1/C4 三个 60 秒 WAV 做人工听检，确认内容确实来自对应直播间且无串音。
2. 用更强的系统声音水印或播放其他应用声音复核隔离结论。
3. 使用已增加硬超时的捕获脚本复测 C4/C5 或新候选直播，并继续补页面状态探测和分段失败恢复。
4. 保留 `老李财观` 和 `老林故事会` 作为下一轮候选，替换 C1 后再做 10 分钟三路滚动捕获。
5. 若捕获稳定，进入三路实时 ASR smoke。
