# Task 0.1 MVP 范围评审签收包

## 目的

本文件用于组织人工评审 `demo/mvp-scope.md`。签收完成前，Task 0.1 只能视为“材料已准备”，不能视为验收通过。

## 待评审材料

| 文件 | 用途 |
| --- | --- |
| `demo/mvp-scope.md` | MVP 范围、非目标、MUST / SHOULD / LATER、P0 Go / No-Go 边界 |
| `demo/test-baseline.md` | Task 0.2 样本和标注基线，辅助判断范围是否可验收 |
| `demo/reports/validation-status-matrix.md` | 当前各任务状态和缺口 |
| `demo/reports/objective-requirements-audit.md` | 执行目标逐条审计 |
| `demo/scope-review-signoff.json` | 签收填写入口 |

## 签收角色与确认点

| role | 显示名称 | 必须确认 |
| --- | --- | --- |
| `product` | 产品负责人 | MUST / SHOULD / LATER 分类符合首版目标；非目标足够明确 |
| `client_capture_engineering` | 客户端 / 采集研发 | 3 路匿名容器、独立音频、后台稳定性验收口径可执行 |
| `asr_ai_engineering` | ASR / AI 研发 | ASR 指标、语义完整性指标、事件字段和降级边界可执行 |
| `backend_engineering` | 服务端研发 | 私人数据、结构化共建、版本链和权限隔离边界可执行 |
| `qa` | 测试 / 质量 | 每个 MUST 项都有可复算或可观察的验收方式 |
| `compliance_ops` | 合规 / 运营 | 不登录、不荐股、不公开逐字稿、投诉删除入口等边界足够 |

## 填写方式

在 `demo/scope-review-signoff.json` 对应 role 中填写：

```json
{
  "role": "product",
  "display_name": "产品负责人",
  "status": "approved",
  "confirmed_at": "2026-07-09T10:30:00+08:00",
  "reviewer": "评审人姓名",
  "confirmation": "MUST / SHOULD / LATER 分类符合首版目标；非目标足够明确。",
  "notes": "如有保留意见写在这里"
}
```

允许的通过状态：

- `approved`
- `accepted`
- `confirmed`

## 检查命令

```text
python3 demo/scripts/check_scope_signoff.py
python3 demo/scripts/run_demo_acceptance_checks.py
```

## 通过标准

- 6 个必需 role 全部存在。
- 每个 role 的 `status` 为 `approved`、`accepted` 或 `confirmed`。
- 每个 role 都填写 `reviewer` 和 `confirmed_at`。
- `demo/reports/scope-signoff-report.json` 中 `task_0_1_signoff_pass=true`。

## 当前状态

当前 6 个角色均为 `pending`，Task 0.1 签收未通过。
