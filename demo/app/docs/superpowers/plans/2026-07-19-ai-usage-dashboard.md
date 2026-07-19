# AI Usage Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every current Bailian LLM and ASR call through a common usage gateway, calculate strict allowlisted catalog-price estimates, and expose a user-facing AI usage dashboard.

**Architecture:** A focused SQLite repository owns immutable call facts, provider-reported usage, pricing rules, and dashboard queries. Thin metered provider wrappers capture only documented Bailian response fields; renderer access goes through validated preload IPC. The dashboard aggregates calculated costs while separately exposing missing-usage and missing-price calls.

**Tech Stack:** Electron 39, TypeScript 5.9, React 19, Zod 4, Node SQLite, Recharts 3, Vitest 4.

## Global Constraints

- Do not create a branch, commit, or push changes without explicit user permission.
- Never store API keys, prompts, model response bodies, or ASR text in AI usage tables.
- Never infer missing provider usage or unknown model prices.
- Only `qwen-plus` non-thinking China-mainland pricing and `paraformer-realtime-v2` China-mainland pricing are enabled in v1.
- `qwen-plus` requests must explicitly send `enable_thinking: false`.
- Paraformer billing duration comes only from provider `payload.usage.duration`; cumulative values replace earlier values for the same task and are never summed within that task.
- Usage and call history is retained permanently.

---

## File Structure

- Create `src/main/usage/types.ts`: internal call context, response usage, pricing, and dashboard types.
- Create `src/main/usage/pricing.ts`: strict allowlisted catalog pricing calculator.
- Create `src/main/usage/usage-repository.ts`: SQLite call lifecycle, usage upsert, cost persistence, and dashboard queries.
- Create `src/main/usage/usage-gateway.ts`: common lifecycle facade used by metered providers.
- Create `src/renderer/components/AiUsageDashboard.tsx`: filters, summary, trends, breakdowns, and call table.
- Create `src/renderer/ai-usage.css`: dashboard-only styles.
- Modify `src/main/storage/database.ts`: schema initialization and repository ownership.
- Modify `src/main/llm/types.ts`: return a typed completion envelope containing business output plus confirmed usage.
- Modify `src/main/llm/openai-compatible-provider.ts`: strict Chat Completions response parsing and explicit non-thinking request.
- Modify `src/main/llm/provider-factory.ts`: inject gateway context for Bailian providers.
- Modify `src/main/asr/types.ts`: expose metering lifecycle callbacks without leaking storage into room sessions.
- Modify `src/main/asr/bailian-provider.ts`: capture cumulative provider duration and await `task-finished`.
- Modify `src/main/asr/provider-factory.ts`: inject gateway into Bailian ASR only.
- Modify `src/main/insights/insight-engine.ts`: unwrap typed LLM completion output.
- Modify `src/main/main.ts`: construct gateway, pass attribution context, expose validated usage IPC.
- Modify `src/shared/contracts.ts`: dashboard request/response schemas.
- Modify `src/preload/api.ts` and `src/renderer/global.d.ts`: renderer-safe API.
- Modify `src/renderer/App.tsx` and `src/renderer/main.tsx`: navigation and page mounting.
- Test with focused files under `tests/unit/`.

---

### Task 1: Strict Pricing Calculator

**Files:**
- Create: `src/main/usage/types.ts`
- Create: `src/main/usage/pricing.ts`
- Test: `tests/unit/ai-pricing.test.ts`

**Interfaces:**
- Produces: `calculateCatalogCost(input: PricingInput): PricingResult`.
- `PricingInput` is either `{ apiKind: "chat_completions"; model: string; region: "cn-beijing"; thinkingEnabled: boolean; promptTokens: number; completionTokens: number }` or `{ apiKind: "paraformer_realtime"; model: string; region: "cn-beijing"; billingDurationSeconds: number }`.
- `PricingResult` is `{ status: "calculated"; ruleKey: string; inputCostMicros: number; outputCostMicros: number; totalCostMicros: number; currency: "CNY" } | { status: "price_missing" }`.

- [ ] **Step 1: Write failing boundary tests**

Cover `qwen-plus` prompt counts `1`, `131072`, `131073`, `262144`, `262145`, and `1048576`; assert non-thinking rates of `0.8/2`, `2.4/20`, and `4.8/48` yuan per million tokens. Assert thinking mode, unknown model, unknown region, zero tokens, and values above 1M return `price_missing`. Assert `paraformer-realtime-v2` at 3600 seconds equals 864000 micros.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- --run tests/unit/ai-pricing.test.ts`

Expected: FAIL because `src/main/usage/pricing.ts` does not exist.

- [ ] **Step 3: Implement immutable allowlisted rules**

Use integer arithmetic where possible. Convert token cost with `Math.round(tokens * yuanPerMillion)` because one yuan-per-million-token equals one micro-yuan per token. Convert ASR with `Math.round(seconds * 240)` micro-yuan. Do not export a generic fallback rate.

- [ ] **Step 4: Run pricing tests**

Run: `npm test -- --run tests/unit/ai-pricing.test.ts`

Expected: PASS.

---

### Task 2: Usage Repository and Database Schema

**Files:**
- Create: `src/main/usage/usage-repository.ts`
- Modify: `src/main/storage/database.ts`
- Test: `tests/unit/ai-usage-repository.test.ts`

**Interfaces:**
- Produces `AiUsageRepository.startCall(context): number`.
- Produces `AiUsageRepository.completeLlm(callId, response): void` where response contains confirmed response ID, returned model, prompt/completion/total tokens, and business status.
- Produces `AiUsageRepository.updateAsrDuration(callId, taskId, durationSeconds): void` using an upsert that replaces the prior duration.
- Produces `AiUsageRepository.finishCall(callId, status, errorCode?): void`.
- Produces `AiUsageRepository.markRunningInterrupted(): number`.
- Consumes `calculateCatalogCost` from Task 1.

- [ ] **Step 1: Write failing repository tests**

Create an in-memory `DuoduoDatabase(":memory:")`. Assert schema creation; LLM call persistence; no prompt/response columns; ASR duration `3 → 8` stores `8`, not `11`; known prices create calculated costs; unknown models create `price_missing`; missing usage creates `usage_missing`; running calls become interrupted on restart reconciliation; and dashboard aggregation does not treat missing costs as zero.

- [ ] **Step 2: Run focused repository tests**

Run: `npm test -- --run tests/unit/ai-usage-repository.test.ts`

Expected: FAIL because the repository and schema are absent.

- [ ] **Step 3: Add schema and repository**

Create `ai_runs`, `ai_calls`, `ai_call_usage`, and `ai_call_costs` with foreign keys and indexes on `started_at`, `feature_key`, `room_id`, `requested_model`, and `status`. Store public IDs as UUID text and costs as integer micros. Add `readonly aiUsage` to `DuoduoDatabase`; call `markRunningInterrupted()` after construction.

- [ ] **Step 4: Implement transaction-safe lifecycle methods**

Each completion/update transaction must persist usage and its cost status atomically. `finishCall` must not overwrite `business_output_invalid`. Reject negative or non-integer usage values before writes.

- [ ] **Step 5: Run repository and existing database tests**

Run: `npm test -- --run tests/unit/ai-usage-repository.test.ts tests/unit/data-maintenance.test.ts tests/unit/database.test.ts`

Expected: PASS; if `database.test.ts` is not present, Vitest reports only the two existing targeted files and the command must be adjusted to actual files discovered with `rg --files tests/unit`.

---

### Task 3: Meter Chat Completions Through the Gateway

**Files:**
- Create: `src/main/usage/usage-gateway.ts`
- Modify: `src/main/llm/types.ts`
- Modify: `src/main/llm/openai-compatible-provider.ts`
- Modify: `src/main/llm/provider-factory.ts`
- Modify: `src/main/insights/insight-engine.ts`
- Modify: `src/main/main.ts`
- Modify: `tests/unit/llm-provider.test.ts`
- Test: `tests/unit/ai-usage-gateway.test.ts`

**Interfaces:**
- Produces `AiUsageGateway.begin(context): MeteredCall`.
- `MeteredCall` exposes `succeedLlm(usage)`, `fail(status, errorCode?)`, and `businessOutputInvalid()`; terminal methods are idempotent.
- `LlmProvider.complete()` returns `{ output: unknown; metering: { responseId: string; returnedModel: string; promptTokens: number; completionTokens: number; totalTokens: number } }`.

- [ ] **Step 1: Extend provider tests with the official response shape**

Use a fixture containing `id`, `model`, `choices`, and `usage`. Assert request JSON contains `enable_thinking: false`; assert the returned metering envelope preserves all confirmed usage. Add malformed/missing usage cases and assert they fail with `LLM_USAGE_INVALID` rather than creating guessed values.

- [ ] **Step 2: Run tests and observe failure**

Run: `npm test -- --run tests/unit/llm-provider.test.ts tests/unit/ai-usage-gateway.test.ts`

Expected: FAIL on missing typed usage and gateway.

- [ ] **Step 3: Implement strict Zod response parsing**

Parse only `id`, `model`, `choices[0].message.content`, and the three documented usage integers. Preserve existing JSON-fence stripping for business output. Never persist response content in gateway or repository.

- [ ] **Step 4: Wire LLM attribution**

Use `live_insight/production` for live coordinator analysis, `parser_test/test` for both published and draft comparison calls, and `connection_test/test` for LLM test calls. Pass room/parser/version identifiers already available at those call sites.

- [ ] **Step 5: Preserve usage when business JSON is invalid**

Move business schema parsing after metering success. On invalid business output, mark `business_output_invalid` while retaining provider usage and calculated cost.

- [ ] **Step 6: Run LLM, insight, and parser tests**

Run: `npm test -- --run tests/unit/llm-provider.test.ts tests/unit/ai-usage-gateway.test.ts tests/unit/insight-engine.test.ts tests/unit/parser-management.test.tsx`

Expected: PASS.

---

### Task 4: Meter Paraformer Through the Gateway

**Files:**
- Modify: `src/main/asr/types.ts`
- Modify: `src/main/asr/bailian-provider.ts`
- Modify: `src/main/asr/provider-factory.ts`
- Modify: `src/main/rooms/room-session.ts`
- Modify: `src/main/main.ts`
- Test: `tests/unit/bailian-asr.test.ts`
- Test: `tests/unit/ai-usage-gateway.test.ts`

**Interfaces:**
- Bailian ASR accepts a metering factory that starts `live_asr/production` or `connection_test/test` calls.
- The session sends confirmed cumulative duration to `MeteredCall.updateAsrDuration(taskId, seconds)`.
- `close()` resolves on matching `task-finished` or rejects/times out with a stable terminal status.

- [ ] **Step 1: Add failing ASR usage tests**

Extend the existing fake socket test with final events containing durations `3` and `8`. Assert only `8` persists. Assert intermediate `usage:null` does nothing, `task-failed` records the provider error code without usage, and `close()` waits for `task-finished` rather than closing immediately.

- [ ] **Step 2: Run focused ASR tests**

Run: `npm test -- --run tests/unit/bailian-asr.test.ts tests/unit/ai-usage-gateway.test.ts`

Expected: FAIL on missing usage and premature close.

- [ ] **Step 3: Parse documented server events**

Add strict event schemas for `task-started`, `result-generated`, `task-finished`, and `task-failed`. Read duration only when `sentence_end === true` and `usage.duration` is a nonnegative integer. Do not calculate duration from PCM bytes.

- [ ] **Step 4: Implement protocol-correct shutdown**

After `finish-task`, wait for the matching `task-finished`; add a bounded timeout that closes resources and marks the call timed out. Preserve existing listener cleanup and failure propagation.

- [ ] **Step 5: Wire ASR attribution and run tests**

Run: `npm test -- --run tests/unit/bailian-asr.test.ts tests/unit/room-session.test.ts tests/unit/ai-usage-gateway.test.ts`

Expected: PASS.

---

### Task 5: Dashboard Contracts, Queries, and IPC

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/usage/usage-repository.ts`
- Modify: `src/main/main.ts`
- Modify: `src/preload/api.ts`
- Modify: `src/renderer/global.d.ts`
- Test: `tests/unit/ai-usage-query.test.ts`
- Create: `tests/unit/preload-api.test.ts`

**Interfaces:**
- Produces `AiUsageQuerySchema` with ISO `from/to`, optional `usageKind`, `roomId`, `apiKind`, and `model`.
- Produces `AiUsageDashboardSchema` containing summary, daily/hourly trend points, feature/room/model breakdowns, and paginated call rows.
- Renderer calls `window.duoduo.aiUsage.getDashboard(query)` and `listCalls(queryWithCursor)`.

- [ ] **Step 1: Write failing query tests**

Seed calls across time, production/test, rooms, models, calculated/missing states. Assert inclusive start/exclusive end filtering, local-date bucketing performed from explicit query offsets, accurate missing counts, system-call grouping for null room IDs, and stable pagination.

- [ ] **Step 2: Run focused tests**

Run: `npm test -- --run tests/unit/ai-usage-query.test.ts tests/unit/preload-api.test.ts`

Expected: FAIL because contracts and APIs are absent.

- [ ] **Step 3: Implement validated IPC**

Parse every renderer request with Zod in main. Return only schema-validated dashboard data. Do not expose raw SQL rows or error messages. Use `ai-usage:get-dashboard` and `ai-usage:list-calls` channels.

- [ ] **Step 4: Run query, preload, and contract tests**

Run: `npm test -- --run tests/unit/ai-usage-query.test.ts tests/unit/preload-api.test.ts tests/unit/contracts.test.ts`

Expected: PASS.

---

### Task 6: AI Usage Dashboard UI

**Files:**
- Create: `src/renderer/components/AiUsageDashboard.tsx`
- Create: `src/renderer/ai-usage.css`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/main.tsx`
- Test: `tests/unit/ai-usage-dashboard.test.tsx`

**Interfaces:**
- Consumes `window.duoduo.aiUsage.getDashboard()` and `listCalls()` from Task 5.
- Produces a new `usage` App view and “AI 用量” system navigation item.

- [ ] **Step 1: Write failing renderer tests**

Mock dashboard data and assert: catalog-price disclaimer; period and production/test filters; estimated cost; input/output/total tokens; ASR seconds formatted as duration; Run/Call counts; missing usage/price notices; expense trend; feature/room/model tabs; system-call label; and call detail rows without prompt or response fields.

- [ ] **Step 2: Run the renderer test**

Run: `npm test -- --run tests/unit/ai-usage-dashboard.test.tsx`

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement summary-first layout A**

Add the independent system navigation item. Use four summary cards, a Recharts cost trend, a service-cost composition panel, analysis tabs, and a paginated call table. Show only filters with data except standard time and usage-kind filters.

- [ ] **Step 4: Implement honest empty and partial-data states**

Empty state explains that usage begins after metered Bailian calls. Partial state says exactly how many calls lack provider usage or price rules. Never render missing cost as `¥0.00`.

- [ ] **Step 5: Run UI tests and typecheck**

Run: `npm test -- --run tests/unit/ai-usage-dashboard.test.tsx && npm run typecheck`

Expected: PASS.

---

### Task 7: Full Verification and Documentation Audit

**Files:**
- Modify if needed: `docs/superpowers/specs/2026-07-19-ai-usage-dashboard-design.md`
- Modify if needed: `docs/superpowers/plans/2026-07-19-ai-usage-dashboard.md`

**Interfaces:**
- Verifies all prior task outputs; produces no new runtime interface.

- [ ] **Step 1: Run all unit and integration tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run static and secret checks**

Run: `npm run typecheck && npm run scan:secrets`

Expected: both commands exit 0.

- [ ] **Step 3: Build the Electron application**

Run: `npm run build`

Expected: package completes without TypeScript, Vite, or Electron Forge errors.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intentional files are modified. Do not stage or commit.

- [ ] **Step 5: Report deferred live verification**

Do not call a real paid API without explicit authorization. Report the exact command/test harness needed for one `qwen-plus` and one fixed-audio Paraformer smoke test, and mark live console reconciliation as pending until the user authorizes credentials and cost.
