# AI 用量与费用看板设计

日期：2026-07-19

## 1. 目标

为配置自有阿里云百炼 API Key 的终端用户提供 AI 用量与目录价费用看板。所有经多多直播发起的百炼调用必须由统一网关记录，新增业务功能不能各自重复实现 Token 或费用统计。

第一版仅覆盖当前已经存在且已核验的接口：

- `qwen-plus` OpenAI-compatible Chat Completions；
- `paraformer-realtime-v2` WebSocket 实时语音识别。

调用记录永久保留。系统不记录 API Key、Prompt、模型回复正文或 ASR 文本。

## 2. 统计与费用边界

费用是按百炼公开目录价计算的预估值，不扣除免费额度、资源包、节省计划、账户折扣或其他优惠。页面固定说明：

> 预估费用按百炼公开目录价计算，仅统计多多直播发起的调用；未扣除免费额度、资源包、节省计划、账户折扣及其他优惠，实际费用以阿里云账单为准。

严格禁止推测用量或价格：

- 仅使用百炼响应中明确返回的计量字段；
- 未返回用量时，Token、计费时长和费用均为空；
- 仅白名单价格规则参与估算；
- 未核验模型仍记录调用与服务端用量，但费用状态为“暂无价格规则”；
- 总览不把缺失费用当作零，必须展示未计入调用数。

## 3. 已核验的接口事实

### 3.1 Chat Completions

百炼成功响应明确包含：

- `id`；
- `model`；
- `usage.prompt_tokens`；
- `usage.completion_tokens`；
- `usage.total_tokens`。

当前观点提炼显式发送 `enable_thinking: false`，不依赖模型默认行为。

### 3.2 Paraformer 实时 ASR

`result-generated` 的最终句事件中，`payload.usage.duration` 表示当前任务累计计费时长，单位为秒。中间结果的 `usage` 为 `null`，`task-finished` 的示例 `usage` 也为 `null`。

同一 `task_id` 的多条最终句不得累加 `usage.duration`；只更新为最新返回值。不同 `task_id` 分别计量后再汇总。

### 3.3 官方来源

- 百炼模型价格：https://help.aliyun.com/zh/model-studio/model-pricing
- 文本生成：https://help.aliyun.com/zh/model-studio/text-generation
- Paraformer 服务端事件：https://help.aliyun.com/zh/model-studio/paraformer-server-events

## 4. 当前价格白名单

### 4.1 `paraformer-realtime-v2`

- 地域：华北 2（北京）；
- 服务部署范围：中国内地；
- 计费：输入音频秒数，输出不计费；
- 目录价：0.00024 元/秒。

公式：

```text
estimated_cost = billing_duration_seconds × 0.00024 元
```

### 4.2 `qwen-plus`

当前稳定版等同于 `qwen-plus-2025-12-01`。中国内地非思考模式目录价如下，单次请求的输入 Token 数决定该次请求全部输入与输出所用阶梯：

| 单次输入 Token | 输入单价（元/百万 Token） | 非思考输出单价（元/百万 Token） |
|---|---:|---:|
| `0 < Token ≤ 128K` | 0.8 | 2 |
| `128K < Token ≤ 256K` | 2.4 | 20 |
| `256K < Token ≤ 1M` | 4.8 | 48 |

公式：

```text
input_cost = prompt_tokens / 1,000,000 × tier.input_price
output_cost = completion_tokens / 1,000,000 × tier.non_thinking_output_price
estimated_cost = input_cost + output_cost
```

超过已核验阶梯、地域不明或思考模式不明时不计算费用。

## 5. 统一 AI Usage Gateway

所有百炼能力必须通过统一网关访问：

```text
业务功能 → AI Usage Gateway → 百炼 Provider → 用量流水与费用估算
```

业务模块只提供归因上下文，不负责解析用量或计算费用。禁止业务模块直接创建或调用百炼 Provider。

当前业务场景只登记真实存在的类型：

- `live_asr`：直播实时语音识别；
- `live_insight`：直播观点提炼；
- `parser_test`：解析器对照测试；
- `connection_test`：百炼服务连接测试。

`feature_key` 是可扩展字符串，不使用数据库枚举。看板只展示实际产生过用量的场景。新增业务接入网关时登记名称并传入归因上下文，不修改底层用量采集逻辑。

用量性质分为：

- `production`：正式业务调用；
- `test`：连接测试、解析器对照测试等。

两者都进入总费用，并支持筛选。

## 6. 数据模型

### 6.1 `ai_runs`

一次用户可理解的业务任务。当前允许部分调用没有 Run；未来多轮任务可用一个 Run 关联多次 Call。

```text
id
feature_key
usage_kind
room_id nullable
parser_id nullable
parser_version_id nullable
status
started_at
completed_at nullable
```

未来业务专属字段保存在各自业务表，并通过 `ai_run_id` 关联，不持续向用量表增加专属列。

### 6.2 `ai_calls`

```text
id
run_id nullable
provider = bailian
feature_key
usage_kind
room_id nullable
parser_id nullable
parser_version_id nullable
api_kind
requested_model
returned_model nullable
provider_request_id nullable
thinking_enabled nullable
status
started_at
completed_at nullable
latency_ms nullable
error_code nullable
retry_of_call_id nullable
```

自动重试是独立 Call，因为可能产生独立费用；通过 `retry_of_call_id` 关联。

### 6.3 `ai_call_usage`

```text
call_id
metric
value
unit
```

第一版仅允许以下经过验证的组合：

```text
chat_completions:
- prompt_tokens / token
- completion_tokens / token
- total_tokens / token

paraformer_realtime:
- billing_duration / second
```

代码层为每种接口定义严格响应 Schema。新增指标必须先有官方文档与真实响应验证。

### 6.4 `ai_pricing_rules`

```text
id
model
region
api_kind
thinking_mode nullable
tier_start nullable
tier_end nullable
input_price_micros nullable
output_price_micros nullable
unit
source_url
verified_at
enabled
```

官方页面未提供完整历史调价生效时间，因此不伪造历史 `effective_from`。规则从应用版本核验并发布后用于新调用；历史调用费用不随价格更新而变化。

### 6.5 `ai_call_costs`

```text
call_id
pricing_rule_id nullable
input_cost_micros nullable
output_cost_micros nullable
total_cost_micros nullable
currency = CNY
status = calculated | usage_missing | price_missing
calculated_at
```

金额以人民币微元整数保存，`1 元 = 1,000,000 微元`。

## 7. 网关处理流程

### 7.1 LLM

1. 请求前创建 `ai_calls(running)`。
2. 显式传 `enable_thinking: false`。
3. 严格解析响应的 `id`、`model`、`choices` 和 `usage`。
4. 先保存响应用量，再解析业务 JSON。
5. 按单次 `prompt_tokens` 匹配价格阶梯并固化费用。
6. 更新最终状态。

业务 JSON 校验失败时，只要百炼响应用量有效，仍保存 Token 与费用，调用状态为 `business_output_invalid`。

### 7.2 ASR

1. 每个 WebSocket `task_id` 创建一个 Call。
2. 每次最终句读取 `payload.usage.duration`。
3. 同一 Call 更新累计 `billing_duration`，不得相加。
4. 按 0.00024 元/秒更新固化费用。
5. 正常结束、失败或中断时更新状态。

现有 `close()` 在发送 `finish-task` 后立即关闭连接。实施时改为等待 `task-finished` 或明确超时后关闭，以遵循官方协议；费用仍以最后一次明确返回的 `usage.duration` 为准。

### 7.3 状态

```text
running
succeeded
http_failed
provider_failed
timed_out
cancelled
interrupted
business_output_invalid
```

应用启动时把遗留的 `running` 调用标记为 `interrupted`。错误只保存稳定错误码和脱敏摘要。

## 8. 看板

左侧“系统”区域新增独立入口“AI 用量”。

筛选项：

- 今日、近 7 天、近 30 天、本月、自定义时间；
- 全部、正式、测试；
- 直播间；
- 服务类型；
- 实际产生过用量的模型。

顶部指标：

- 预估费用；
- 输入、输出、总 Token；
- ASR 计费时长；
- AI Run 数和 API Call 数；
- 用量缺失与价格缺失的调用数。

中部展示费用趋势、费用构成和与上一等长周期的变化。下部按以下页签下钻：

1. 业务场景；
2. 直播间；
3. 模型；
4. 调用明细（Run → Call）。

没有直播间归属的调用显示为“系统调用”。看板时间归属按 `started_at`，以用户本地时区展示。

总 Token 使用百炼返回的 `total_tokens`，不以输入与输出相加值替代。若三者不一致，保留原始值、标记异常；费用仍分别使用服务端返回的输入和输出 Token。

## 9. 永久保留与清理

用量流水默认永久保留，不自动过期。现有数据管理能力后续可增加用户主动清理入口，但清理必须显式预览和确认，不属于本功能第一版范围。

## 10. 测试与验收

### 10.1 价格测试

- `qwen-plus` 阶梯边界：1、128K、128K+1、256K、256K+1、1M；
- 输入与非思考输出分别计费；
- 超出阶梯、未知模型、未知地域、用量缺失均不计算；
- ASR 秒数按 0.00024 元/秒计算；
- 验证整数微元换算与聚合。

### 10.2 Provider 契约测试

- 使用官方响应结构固定样本提取 LLM 响应 ID、返回模型和三项 Token；
- ASR 只读取最终句 `usage.duration`；
- 多个最终句更新累计时长而非相加；
- `task-failed` 不产生虚构用量；
- 业务 JSON 无效仍保存已返回用量。

### 10.3 网关覆盖测试

- 当前百炼 Provider 只能由统一网关创建；
- 连接测试与解析器对照测试标记为 `test`；
- 正式观点提炼与实时 ASR 标记为 `production`；
- 自动重试独立记录并保持关联。

### 10.4 真实接口验证

发布前在用户明确授权下使用测试 API Key：

- 执行一次 `qwen-plus` 非思考调用，验证服务端字段与费用；
- 使用固定短音频执行一次 `paraformer-realtime-v2`，验证累计 `usage.duration`；
- 等待百炼控制台数据更新后人工核对。

报告不得包含 API Key、Prompt、模型输出正文或音频内容。

## 11. 不在第一版范围

- 从百炼账户读取真实余额、账单、免费额度或资源包余额；
- 对未知模型猜测价格；
- 对缺失服务端用量进行本地估算；
- 提前创建不存在的 Agent 或业务场景分类；
- 费用预测、预算告警和自动停用；
- 自动更新官方价格。
