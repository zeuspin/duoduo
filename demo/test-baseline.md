# 多多直播股票看盘版测试样本与人工标注基线

## 1. 文档目的

本文件用于定义 `Task 0.2` 的测试样本、人工标准稿、语义片段标注集和指标计算方法。它的目标是让后续 ASR、语义切分、摘要、事件抽取和多直播聚合评测可重复、可复算，而不是依赖主观感觉判断质量。

当前状态：基线规范已建立；已完成真实直播 smoke 样本、run11 两路 10 分钟滚动捕获样本、ASR 输出和机器预标注 seed；3 小时真实股票直播样本、人工标准稿和 500 条正式人工语义标注尚未完成。

## 2. 输入与边界

### 2.1 已提供直播 URL

执行时需实时确认这些 URL 是否仍处于开播、公开、匿名可观看状态。

| 编号 | URL | 用途 | 当前状态 |
| --- | --- | --- | --- |
| R1 | https://live.douyin.com/968029124714 | 主样本候选 | 待实时确认 |
| R2 | https://live.douyin.com/5070656462 | 主样本候选 | 待实时确认 |
| R3 | https://live.douyin.com/735093470182 | 主样本候选 | 待实时确认 |
| R4 | https://live.douyin.com/411844483316 | 备用 / 扩展样本候选 | 待实时确认 |
| R5 | https://live.douyin.com/424269795767 | 备用 / 扩展样本候选 | 待实时确认 |

### 2.1.1 实时筛选候选记录

| 编号 | URL | 直播间 | 筛选时间 | 当前判断 | 备注 |
| --- | --- | --- | --- | --- | --- |
| C1 | https://live.douyin.com/782837937233 | 财经小板总 | 2026-07-09 02:02 后 | 可作为股票 / 财经 ASR 样本候选 | 匿名可打开，页面未显示直播结束；画面和弹幕均为财经、板块、个股相关内容；页面提示浏览器限制静音，正式采样时需解除静音 |
| C2 | https://live.douyin.com/31544105137 | 先机财经 | 2026-07-09 02:20 后 | 可作为股票 / 财经 ASR 样本候选 | Safari 搜索页显示“正在直播”，描述为“板块热点分析和主线挖掘”；02:22 无登录 Chrome 验证标题显示“正在播放音频” |
| C3 | https://live.douyin.com/100263212175 | 江哥财经 | 2026-07-09 02:20 后 | 可作为股票 / 财经 ASR 样本候选 | Safari 搜索页显示“正在直播”，描述为“A股行情分析，今日热点聚焦。”；02:22 无登录 Chrome 验证标题显示“正在播放音频” |
| C4 | https://live.douyin.com/414092641626 | 谷市一代枭雄 | 2026-07-09 02:20 后 | 可作为股票 / 财经 ASR 样本候选 | Safari 搜索页显示“正在直播”，描述为“美联储货币政策对于市场有什么影响？枭雄老师带你解盘”；02:22 无登录 Chrome 验证标题显示“正在播放音频” |
| C5 | https://live.douyin.com/893703096387 | 谢说财经 | 2026-07-09 02:20 后 | 待无登录 Chrome 验证 | Safari 搜索页显示“正在直播”，描述为“谢说财经正在直播” |

候选发现限制：

- Safari 已由用户登录抖音账号，仅允许用于搜索、查找博主和获取直播间链接。
- 不使用 Safari 多开直播，不使用 Safari 做并发播放、音频采集或 ASR 样本录制，避免影响用户账号风控。
- 抖音搜索页在无登录状态下搜索“股票 直播”会触发登录弹窗；若必须搜索博主，可只在已登录 Safari 中查找链接。
- 后续优先从已知直播 URL、用户提供的候选链接、或 Safari 查到的直播间链接中筛选。
- 从 Safari 获取到直播间后，必须规范化为 `https://live.douyin.com/{room_id}`，不保留 `?` 后的查询参数、分享参数或来源参数。
- 规范化链接必须再用无登录状态的独立 Chrome profile / user-data-dir 打开验证，才能进入样本候选。
- 候选必须先人工确认内容类型，避免把跳舞、唱歌、纯卖货直播放入股票看盘 / ASR 样本池。

### 2.2 数据权限

- 测试音频可以临时保存。
- ASR 文本可以用于评测。
- 允许将样本发送给云端 ASR / 大模型。
- 测试期暂不考虑删除期限。
- `.env` 中的百炼 Key 不得打印、复制到本文件或任何报告中。

### 2.3 非目标

- 不采集登录、付费、粉丝专属或私密直播。
- 不采集弹幕用户身份。
- 不建立公开逐字稿库。
- 不输出买卖建议、目标价、收益概率、仓位或自动交易。

## 3. 样本采集配额

`Task 0.2` 的最低合格样本为 3 小时真实股票直播内容，并覆盖至少 3 个不同直播间。建议采集到 3.5 至 4 小时原始样本，留出不可用片段、静音、广告和异常片段的剔除空间。

| 样本组 | 直播间 | 目标有效时长 | 采集窗口建议 | 覆盖目标 |
| --- | --- | --- | --- | --- |
| S1 | R1 | 60 分钟 | 盘中活跃时段 | 正常语速、主题讨论、数字和板块名 |
| S2 | R2 | 60 分钟 | 盘中活跃时段 | 不同主播风格、风险表达、观点修正 |
| S3 | R3 | 60 分钟 | 盘中活跃时段 | 新闻转述、重复表达、广告夹杂 |
| S4 | R4 或 R5 | 30 到 60 分钟 | 备用窗口 | 背景音乐、口音、快语速、异常样本补充 |

有效样本定义：

- 直播可匿名观看。
- 音频可听清，非长时间静音。
- 样本包含真实股票直播口播内容。
- 每段样本有开始时间、结束时间、直播 URL、采集方式和文件引用。

无效样本定义：

- 需要登录或付费后才能观看。
- 长时间无音频、纯背景音乐或无股票相关内容。
- 音频来源无法确认，或混入其他应用声音。
- 无法关联直播间、时间范围或采集过程。

## 4. 样本文件与目录约定

所有本次验收相关文件放在 `demo/` 下。真实音频如后续采集，建议使用以下目录；目录可在采集任务开始时创建。

```text
demo/
  samples/
    audio/
      raw/
      clips/
    transcripts/
      manual/
      asr/
    annotations/
    manifests/
```

建议命名规则：

```text
{sample_id}_{room_id}_{YYYYMMDD}_{HHMMSS}_{duration_sec}.{ext}
```

示例：

```text
S1_R1_20260708_093000_3600.wav
S1_R1_20260708_093000_manual.jsonl
S1_R1_20260708_093000_annotations.jsonl
```

## 5. 样本清单格式

每次采集完成后，在 `demo/samples/manifests/sample-manifest.jsonl` 中追加一行。

```json
{
  "sample_id": "S1",
  "room_id": "R1",
  "room_url": "https://live.douyin.com/968029124714",
  "captured_at": "2026-07-08T09:30:00+08:00",
  "duration_sec": 3600,
  "effective_duration_sec": 3420,
  "platform": "macOS",
  "capture_method": "pending",
  "audio_file": "demo/samples/audio/raw/S1_R1_20260708_093000_3600.wav",
  "notes": "匿名公开直播，音频清晰，含板块和风险表达"
}
```

必填字段：

- `sample_id`
- `room_id`
- `room_url`
- `captured_at`
- `duration_sec`
- `effective_duration_sec`
- `platform`
- `capture_method`
- `audio_file`
- `notes`

## 6. 人工标准转写格式

人工标准稿用于评估 ASR。每条记录建议为 3 到 15 秒的语音片段，片段不应跨越明显话题切换。

文件路径建议：

```text
demo/samples/transcripts/manual/{sample_id}_{room_id}_{date}_manual.jsonl
```

单条格式：

```json
{
  "segment_id": "S1-R1-MANUAL-000001",
  "sample_id": "S1",
  "room_id": "R1",
  "start_ms": 12500,
  "end_ms": 18400,
  "speaker_label": "anchor",
  "text": "这里先不要追高，等下午确认量能再看。",
  "audibility": "clear",
  "background_noise": "none",
  "transcriber_note": ""
}
```

转写规则：

- 保留否定词、条件词、时间词、数字和板块名。
- 不为了通顺改写原意。
- 口头禅可保留在标准稿中，但可在后续清洗标注中标为低信息。
- 听不清内容使用 `[听不清]`，不能猜测。
- 多个候选词不确定时使用 `transcriber_note` 说明。
- 明显广告、引流、感谢、求关注也需要转写，用于训练过滤和分类。

## 7. 语义片段标注集

`Task 0.2` 的最低目标是 500 条语义片段，其中至少 20% 包含否定、条件、风险或观点反转表达。

当前已有辅助文件：

- `demo/samples/transcripts/asr/asr-segments.jsonl`：由百炼 ASR 结果抽取的机器转写片段，共 317 条。
- `demo/samples/annotations/semantic-events-seed.jsonl`：基于简单规则生成的机器预标注，共 317 条。
- `demo/samples/annotations/human-annotation-workpack.jsonl`：待人工复核工作包，共 317 条，包含 ASR 文本、音频引用、时间戳和预填语义字段。
- `demo/samples/annotations/human-annotation-workpack.csv`：与 JSONL 等价的表格版人工复核工作包，共 317 条数据行和 1 行表头。
- `demo/samples/annotations/stock-finance-review-pack.jsonl`：从 workpack 中筛出的股票 / 财经优先人工复核包，共 120 条，不包含 pipeline-only 样本。
- `demo/samples/annotations/stock-finance-review-pack.csv`：与 JSONL 等价的表格版股票 / 财经优先复核包。
- `demo/reports/stock-finance-review-pack.md`：股票 / 财经优先复核包说明和前 30 条预览。
- `demo/reports/stock-finance-review-pack-check.md` / `.json`：优先复核包组成检查，确认 120 条均来自股票 / 财经房间。
- `demo/reports/stock-review-pack-human-workflow.md`：人工填写、回填总 workpack、迁入正式标注集的操作流程。
- `demo/scripts/merge_stock_review_pack.py`：按 `work_item_id` 将已人工填写的股票 / 财经复核包合并回总 workpack。
- `demo/reports/merge-stock-review-pack-report.json`：当前 dry-run 回填报告，显示 120 条匹配、0 条变更、0 条 approved。
- `demo/reports/annotation-coverage-report.md`：当前 workpack 的数量、字段完整性和覆盖类型缺口检查报告。
- `demo/reports/annotation-coverage-report.json`：同一检查的机器可读结果。
- `demo/samples/annotations/semantic-events.jsonl`：正式人工语义标注集；当前 0 条。
- `demo/reports/promote-reviewed-annotations-report.json`：从 workpack 提升 reviewed / accepted / done 标注到正式集的迁移报告。
- `demo/reports/semantic-events-coverage-report.md` / `.json`：正式标注集的覆盖率检查结果；当前未通过。

注意：`semantic-events-seed.jsonl` 和 `human-annotation-workpack.*` 不属于人工标准稿或正式人工标注集，只能作为人工复核前的待审材料。只有人工填写并复核后，且 `review_status` 为 `reviewed`、`accepted` 或 `done` 的记录，经 `demo/scripts/promote_reviewed_annotations.py` 写入 `semantic-events.jsonl` 后，才能计入 Task 0.2 的 500 条人工标注验收。

### 7.1 run11 增量样本

run11 已将两路 10 分钟稳定滚动捕获样本纳入 Task 0.2 待复核样本池：

| 路 | 直播间 | URL | 捕获结果 | ASR 入库 |
| --- | --- | --- | --- | --- |
| C2 | 老李财观 | `https://live.douyin.com/816173758414` | 10×60 秒滚动捕获成功 | 10 个 60 秒样本均完成百炼 ASR |
| C3 | 老林故事会 | `https://live.douyin.com/59041165350` | 10×60 秒滚动捕获成功 | 10 个 60 秒样本均完成百炼 ASR |

批处理报告：`demo/reports/run11-asr-sample-registration-report.json`。

样本适用性审计报告：`demo/reports/sample-suitability-report.md` / `.json`。

更新后的机器侧计数：

| 项目 | 数量 |
| --- | ---: |
| 样本 manifest | 36 |
| ASR 片段 | 317 |
| 机器语义 seed | 317 |
| 待人工复核 workpack | 317 |
| 股票 / 财经优先复核包 | 120 |
| 正式人工语义标注 | 0 |
| 股票 / 财经有效样本时长 | 0.6277 小时 |
| 距 3 小时股票样本缺口 | 8540.23 秒 |

该增量只能证明“真实音频样本和 ASR 待复核材料增加”，不能替代人工听写、人工标注或 3 小时样本验收。特别注意：run11 C3（老林故事会）是口播链路样本，只能计入音频 / ASR pipeline 验证，不能计入股票看盘语义验收。

run12 补充了 `老李财观` 的 5 个有效 60 秒股票 / 财经片段；同轮后 5 段为 0 字节无效文件，已通过 `demo/reports/run12-c2-rolling-validity-report.md` 剔除，不能计入样本时长。

股票 / 财经优先复核包已经准备好，可作为人工听写和语义标注的第一批工作入口。该复核包只证明“待人工处理材料已筛选”，不计入正式人工标注数量。

人工复核完成后的回填链路已经建立：先运行 `merge_stock_review_pack.py --dry-run` 核对变更，再去掉 `--dry-run` 写回总 workpack，随后运行 `promote_reviewed_annotations.py` 和正式覆盖率检查。当前尚未人工填写，因此 dry-run 报告中 `changed_rows=0`、`approved_rows_after_merge=0`。

文件路径建议：

```text
demo/samples/annotations/semantic-events.jsonl
```

单条格式：

```json
{
  "annotation_id": "ANN-000001",
  "source_segment_ids": ["S1-R1-MANUAL-000001"],
  "sample_id": "S1",
  "room_id": "R1",
  "start_ms": 12500,
  "end_ms": 18400,
  "raw_text": "这里先不要追高，等下午确认量能再看。",
  "clean_text": "先不要追高，等下午确认量能再看。",
  "topic": "追高风险",
  "topic_entities": ["量能"],
  "market_entities": [],
  "direction": "cautious",
  "stance": "conditional",
  "conditions": ["下午确认量能"],
  "risk_flags": ["不要追高"],
  "time_horizon": "intraday",
  "content_type": "opinion",
  "source_type": "anchor_judgement",
  "is_news_relay": false,
  "is_independent_view": true,
  "is_same_source_relay": false,
  "is_reversal": false,
  "evidence_text": "先不要追高，等下午确认量能再看",
  "confidence_label": "high",
  "notes": ""
}
```

### 7.1 必填字段

- `annotation_id`
- `source_segment_ids`
- `sample_id`
- `room_id`
- `start_ms`
- `end_ms`
- `raw_text`
- `topic`
- `direction`
- `conditions`
- `risk_flags`
- `content_type`
- `source_type`
- `is_news_relay`
- `is_independent_view`
- `is_same_source_relay`
- `is_reversal`
- `evidence_text`

### 7.2 枚举约定

`direction`：

- `bullish`
- `bearish`
- `neutral`
- `cautious`
- `uncertain`
- `not_applicable`

`stance`：

- `assertive`
- `conditional`
- `risk_warning`
- `news_relay`
- `correction`
- `advertising`
- `chitchat`
- `not_applicable`

`content_type`：

- `greeting`
- `thanks`
- `follow_request`
- `advertising`
- `news_relay`
- `opinion`
- `risk_warning`
- `condition`
- `correction`
- `unrelated_chat`
- `uncertain`

`source_type`：

- `anchor_judgement`
- `news_relay`
- `viewer_interaction`
- `advertising`
- `unknown`

`confidence_label`：

- `high`
- `medium`
- `low`

## 8. 覆盖要求

500 条语义标注片段应至少覆盖以下类型。

| 类型 | 最低数量 | 说明 |
| --- | ---: | --- |
| 主题 / 板块 / 股票口语实体 | 150 | 用于主题实体召回率和聚合测试。 |
| 数字、比例、时间或价格口语 | 80 | 用于数字准确率测试。 |
| 否定表达 | 50 | 如“不追高”“不是买点”“别急”。 |
| 条件表达 | 50 | 如“如果放量”“等确认”“除非回踩”。 |
| 风险提示 | 50 | 如“风险大”“可能回落”“注意高位”。 |
| 新闻转述 | 40 | 用于区分新闻转述和主播独立判断。 |
| 主播独立观点 | 80 | 用于独立观点识别。 |
| 同源 / 重复转述 | 30 | 用于虚假共识控制。 |
| 观点反转 / 修正 | 20 | 用于事件修正、撤回和版本链测试。 |
| 广告、寒暄、感谢、求关注 | 60 | 用于无效内容过滤。 |

说明：同一片段可以命中多个类型，但用于“至少 20% 包含否定、条件、风险或反转”的统计时，按唯一片段计数。

## 9. 指标定义

### 9.1 字符错误率 CER

用于 ASR 基础准确率评估。

```text
CER = (S + D + I) / N
```

- `S`：替换字符数
- `D`：删除字符数
- `I`：插入字符数
- `N`：人工标准稿字符数

验收使用方式：

- 按样本、主播、噪声类型分别统计。
- CER 不单独作为 Go / No-Go 门槛，但用于解释实体、否定和数字错误。

### 9.2 主题实体召回率

```text
主题实体召回率 = 正确识别的主题实体数 / 人工标注主题实体总数
```

MVP 阶段目标：

- 不低于 90%。

### 9.3 否定 / 风险表达召回率

```text
否定风险召回率 = 正确保留的否定、条件和风险表达数 / 人工标注否定、条件和风险表达总数
```

MVP PRD 底线：

- 不低于 95%。

当前验证计划阶段目标：

- 不低于 97%。

### 9.4 数字准确率

```text
数字准确率 = 正确识别的数字表达数 / 人工标注数字表达总数
```

数字表达包括：

- 价格
- 涨跌幅
- 时间
- 仓位口语
- 量能
- 板块轮动中的序数或比例

注意：即使产品不输出交易建议，数字识别错误仍可能改变主播原意，因此需要单独统计。

### 9.5 方向识别准确率

```text
方向识别准确率 = 方向标签正确的事件数 / 需要判断方向的人工标注事件数
```

MVP 阶段目标：

- 不低于 90%。

方向标签只用于整理主播表达，不得转化为交易建议。

### 9.6 条件和风险召回率

```text
条件风险召回率 = 正确提取条件和风险的事件数 / 人工标注含条件或风险的事件数
```

MVP 阶段目标：

- 不低于 95%。

### 9.7 虚假共识率

```text
虚假共识率 = 被系统误判为独立共识的同源或重复事件数 / 所有系统判定为共识的事件数
```

MVP 阶段目标：

- 不高于 5%。

### 9.8 少数观点保留率

```text
少数观点保留率 = 被系统保留展示的少数观点数 / 人工标注少数观点总数
```

建议目标：

- 不低于 90%。

## 10. 评测输出格式

每次评测应产出一份 JSON 或 Markdown 报告，至少包含：

- 样本清单和有效时长。
- 使用的 ASR / 模型 / 规则版本。
- 各指标总体值。
- 各指标按主播、样本、噪声类型的拆分。
- 失败案例列表。
- 是否达到 Go / No-Go 门槛。
- 若未达标，对应降级建议。

建议机器可读结果：

```json
{
  "run_id": "eval-20260708-001",
  "sample_manifest": "demo/samples/manifests/sample-manifest.jsonl",
  "model_version": "pending",
  "cer": 0.0,
  "topic_entity_recall": 0.0,
  "negation_risk_recall": 0.0,
  "number_accuracy": 0.0,
  "direction_accuracy": 0.0,
  "condition_risk_recall": 0.0,
  "false_consensus_rate": 0.0,
  "minority_view_retention": 0.0,
  "go_no_go": "pending"
}
```

## 11. 标注质量控制

- 每批至少抽查 10% 标注片段。
- 否定、条件、风险、观点反转片段优先复核。
- 同一规则不明确时，更新本文件后再继续标注。
- 标注者不得把主播未说出的股票、理由或结论补进 `clean_text` 或 `evidence_text`。
- 新闻转述必须标记为 `is_news_relay: true`，不能默认作为主播独立观点。
- 低置信或听不清片段可以保留，但不得作为高优先级摘要的正样本。

## 12. 当前缺口

| 验收项 | 当前状态 | 缺口 |
| --- | --- | --- |
| 测试样本总时长不少于 3 小时 | 未达成 | 已有 smoke 样本和 C1 10 分钟样本，但尚未达到 3 小时。 |
| 标注片段不少于 500 条 | 未达成 | 已有 130 条机器 seed 和 130 条待人工 workpack；正式 `semantic-events.jsonl` 当前 0 条。 |
| 每条标注片段包含原文、时间范围、主题、方向、条件、风险、证据字段 | 部分具备 | 第 7 节已定义字段；workpack 已预置字段，待人工填写和复核。 |
| 至少 20% 片段包含否定、条件、风险或反转表达 | 规范已定义，数据未达成 | 第 8 节已定义最低覆盖要求；待真实标注验证。 |
| 任一指标都能由标注数据复算，不能只靠人工主观打分 | 规范已定义，数据未达成 | 第 9 和第 10 节定义公式和输出；待实现评测脚本或手工复算表。 |

## 13. Task 0.2 自检

| 验收标准 | 当前判断 | 证据 |
| --- | --- | --- |
| 测试样本总时长不少于 3 小时。 | 未通过 | 已有 smoke 样本和 C1 10 分钟样本，但远低于 3 小时。 |
| 标注片段不少于 500 条。 | 未通过 | 已有 130 条机器 seed 和 130 条待人工 workpack；正式 `semantic-events.jsonl` 当前 0 条。 |
| 每条标注片段包含原文、时间范围、主题、方向、条件、风险、证据字段。 | 部分具备 | 第 7 节定义了必填字段；workpack 已预置字段，待人工填写和复核。 |
| 至少 20% 片段包含否定、条件、风险或反转表达。 | 规范通过，数据待验证 | 第 8 节定义了覆盖要求。 |
| 任一指标都能由标注数据复算，不能只靠人工主观打分。 | 规范通过，数据待验证 | 第 9 和第 10 节定义了公式和评测输出。 |

## 14. 下一步建议

1. 先从 `demo/samples/annotations/human-annotation-workpack.csv` 抽取 50 到 100 条做人工听写和语义复核。
2. 将人工确认可用的行标为 `reviewed`、`accepted` 或 `done`，再运行 `demo/scripts/promote_reviewed_annotations.py` 生成正式 `semantic-events.jsonl`。
3. 根据 `demo/reports/annotation-coverage-report.md` 和 `demo/reports/semantic-events-coverage-report.md` 优先补采新闻转述、主播独立观点、同源重复、观点反转和低价值内容样本。
4. 继续用稳定容器方案采集 3 小时以上音频样本。
5. 采集完成后补齐 `demo/samples/manifests/sample-manifest.jsonl`、人工标准稿和 500 条语义标注。
6. 标注数据达标后，再将本任务从“规范完成、数据未达成”更新为“通过”。
