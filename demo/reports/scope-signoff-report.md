# Task 0.1 范围评审签收检查报告

输入文件：`demo/scope-review-signoff.json`

## 总览

| 项目 | 值 |
| --- | ---: |
| 必需角色数 | 6 |
| 已确认角色数 | 0 |
| 待确认角色数 | 6 |

## 角色明细

| role | 显示名称 | 状态 | reviewer | confirmed_at | 缺口 |
| --- | --- | --- | --- | --- | --- |
| `asr_ai_engineering` | ASR / AI 研发 | pending | - | - | approved status, reviewer, confirmed_at |
| `backend_engineering` | 服务端研发 | pending | - | - | approved status, reviewer, confirmed_at |
| `client_capture_engineering` | 客户端 / 采集研发 | pending | - | - | approved status, reviewer, confirmed_at |
| `compliance_ops` | 合规 / 运营 | pending | - | - | approved status, reviewer, confirmed_at |
| `product` | 产品负责人 | pending | - | - | approved status, reviewer, confirmed_at |
| `qa` | 测试 / 质量 | pending | - | - | approved status, reviewer, confirmed_at |

## 待确认角色

- `asr_ai_engineering`
- `backend_engineering`
- `client_capture_engineering`
- `compliance_ops`
- `product`
- `qa`

## 异常

- 缺失角色：`[]`
- 重复角色：`[]`
- 无效签收：`[]`

## 判断

- Task 0.1 范围评审签收未通过；仍需产品、研发、测试等角色人工确认。
