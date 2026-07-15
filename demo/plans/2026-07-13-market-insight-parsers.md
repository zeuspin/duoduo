# Market Insight Parsers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned, user-manageable LLM parsers, per-room parser binding, evidence-backed market insight reading, and same-sample main-versus-draft evaluation to the macOS Electron client.

**Architecture:** Keep LLM execution in the Electron main process. SQLite owns parser definitions, immutable versions, room bindings, formal insights, and test-run results; renderer access is restricted to validated preload IPC. Final ASR events enter a per-room batching coordinator, which invokes either Bailian's OpenAI-compatible endpoint or a user-configured OpenAI-compatible endpoint and stores only schema-valid, evidence-backed results.

**Tech Stack:** Electron 39, React 19, TypeScript 5.9, Node SQLite, Zod, native `fetch`, Vitest, Testing Library.

## Global Constraints

- All feature files and reports remain under `demo/`.
- Safari may only be used to discover canonical public room URLs; no recording, monitoring, ASR, LLM call, cookie extraction, or multi-room playback may run in Safari.
- Actual live tests use isolated Electron Sessions with no Safari cookie sharing.
- One room has at most one published parser binding; “no parser” remains valid.
- Draft evaluation never enters the formal insight stream and never triggers an alert.
- Every formal insight must retain room, parser version, natural time, source ASR IDs, and verbatim evidence.
- API keys remain behind `safeStorage`, never enter renderer payloads, logs, reports, SQLite, or screenshots.
- Built-in parser is named `市场观点与情绪提炼`; it treats audience questions, unendorsed quotes, greetings, ads, and unsupported sentiment as noise.
- Version is raised from `0.3.0` to `0.4.0` before packaging.
- Do not create a branch, commit, or push without user permission.

---

### Task 1: Shared Contracts And Immutable Parser Storage

**Files:**
- Modify: `demo/app/src/shared/contracts.ts`
- Modify: `demo/app/src/main/storage/database.ts`
- Test: `demo/app/tests/unit/contracts.test.ts`
- Test: `demo/app/tests/unit/database.test.ts`

**Interfaces:**
- Produces `LlmProviderConfig`, `ParserDefinition`, `ParserVersion`, `RoomParserBinding`, `MarketInsight`, `ParserTestRun` and their Zod schemas.
- Produces repositories `database.parsers`, `database.insights`, and `database.parserTests`.

- [ ] Write failing contract tests for provider authentication, parser draft input, structured insight evidence, and parser test status.
- [ ] Run `npm test -- --run tests/unit/contracts.test.ts` and verify schema exports are missing.
- [ ] Add exact schemas with enums for insight nature, subject kind, direction, alert level, and run status.
- [ ] Write failing SQLite tests for built-in parser initialization, one draft per parser, immutable publish, room binding, formal/test isolation, and evidence pagination.
- [ ] Run `npm test -- --run tests/unit/database.test.ts` and verify repository APIs are missing.
- [ ] Add normalized tables with foreign keys: `parser_definitions`, `parser_versions`, `room_parser_bindings`, `market_insights`, `parser_test_runs`; add repositories and initialize published built-in v1 id `market-insight`.
- [ ] Run both test files and verify PASS.

### Task 2: Secure LLM Provider Configuration

**Files:**
- Modify: `demo/app/src/main/storage/settings-store.ts`
- Create: `demo/app/src/main/llm/types.ts`
- Create: `demo/app/src/main/llm/openai-compatible-provider.ts`
- Create: `demo/app/src/main/llm/provider-factory.ts`
- Test: `demo/app/tests/unit/settings-store.test.ts`
- Test: `demo/app/tests/unit/llm-provider.test.ts`

**Interfaces:**
- Produces `LlmProvider.complete(request: LlmRequest): Promise<unknown>` and `createLlmProvider(config, secret)`.
- `SettingsStore` adds `getLlmConfig()` and `saveLlm(config, secret)` while preserving existing ASR settings.

- [ ] Write failing settings tests proving encrypted LLM secret recovery and no plaintext in settings JSON.
- [ ] Extend settings storage with separate `llmProvider` and validated secret references.
- [ ] Write provider tests against a local HTTP fixture for Bailian endpoint mapping, custom endpoint mapping, JSON response extraction, timeout, HTTP error redaction, and connection test.
- [ ] Implement native-fetch provider with 30-second abort timeout and no secret-bearing error text.
- [ ] Run `npm test -- --run tests/unit/settings-store.test.ts tests/unit/llm-provider.test.ts` and verify PASS.

### Task 3: Conservative Market Insight Prompt And Engine

**Files:**
- Create: `demo/app/src/main/insights/market-prompt.ts`
- Create: `demo/app/src/main/insights/insight-engine.ts`
- Create: `demo/app/src/main/insights/insight-coordinator.ts`
- Test: `demo/app/tests/unit/insight-engine.test.ts`
- Test: `demo/app/tests/integration/insight-coordinator.test.ts`

**Interfaces:**
- Consumes final `StoredAsrEvent`, a bound published parser version, and `LlmProvider`.
- Produces schema-valid `MarketInsight` rows and per-room status `{ idle | buffering | analyzing | error }`.

- [ ] Write prompt tests proving the prompt explicitly distinguishes explicit, conditional, quote, inference, fact, and noise and requires evidence copied from input.
- [ ] Write engine tests for valid insights, empty/noise output, unsupported evidence rejection, malformed JSON rejection, duplicate suppression, and natural-time propagation.
- [ ] Implement strict JSON extraction and evidence substring validation before insert.
- [ ] Write coordinator tests for 8-second debounce, maximum buffer flush, per-room isolation, one in-flight request per room, and shutdown cleanup.
- [ ] Implement bounded room buffers and a serial queue per room; failures update only that room.
- [ ] Run both test files and verify PASS.

### Task 4: Main-Process Wiring And Validated IPC

**Files:**
- Modify: `demo/app/src/main/main.ts`
- Modify: `demo/app/src/preload/api.ts`
- Modify: `demo/app/tests/unit/renderer-api.test.ts`
- Create: `demo/app/tests/integration/parser-ipc-contract.test.ts`

**Interfaces:**
- Produces renderer APIs `llm.get/save/test`, `parsers.list/createDraft/updateDraft/publish/removeDraft/bindRoom/runTest`, and `insights.list/subscribe`.
- Emits `insights:changed` and `parser-runs:changed` without exposing secrets.

- [ ] Add failing renderer API tests for the exact channel names and arguments.
- [ ] Add Zod validation for every IPC request and response.
- [ ] Wire final ASR persistence to `InsightCoordinator.accept()` without delaying ASR rendering.
- [ ] Restore bindings and coordinator state on launch; stop timers and in-flight work before database close.
- [ ] Add integration tests proving draft results cannot appear in formal insight queries and one room's LLM error does not affect another.
- [ ] Run the focused tests and verify PASS.

### Task 5: Parser Management, Editing, And Room Binding UI

**Files:**
- Create: `demo/app/src/renderer/components/ParserManagement.tsx`
- Create: `demo/app/src/renderer/components/ParserEditor.tsx`
- Create: `demo/app/src/renderer/parser.css`
- Modify: `demo/app/src/renderer/App.tsx`
- Modify: `demo/app/src/renderer/global.d.ts`
- Test: `demo/app/tests/unit/parser-management.test.tsx`

**Interfaces:**
- Consumes renderer parser and LLM APIs.
- Produces the approved management table, structured editor, room binding list, draft deletion confirmation, and publish confirmation.

- [ ] Write UI tests for navigation, built-in parser row, edit-creates-draft copy, room binding/no-parser, draft save, same-sample test entry, and publish confirmation.
- [ ] Implement `解析器管理` and `观点中心` sidebar destinations using the existing restrained rectangular visual language.
- [ ] Implement structured fields for objectives, filters, normalization policy, model, endpoint, and credential reference; keep raw prompt under an advanced disclosure.
- [ ] Implement room binding controls with current live/ASR state and explicit `仅保留 ASR` state.
- [ ] Run `npm test -- --run tests/unit/parser-management.test.tsx` and verify PASS.

### Task 6: Insight Reading And Version Comparison UI

**Files:**
- Create: `demo/app/src/renderer/components/InsightCenter.tsx`
- Create: `demo/app/src/renderer/components/ParserComparison.tsx`
- Create: `demo/app/src/renderer/insights.css`
- Test: `demo/app/tests/unit/insight-center.test.tsx`
- Test: `demo/app/tests/unit/parser-comparison.test.tsx`

**Interfaces:**
- Consumes paginated formal insights and stored parser test runs.
- Produces evidence-first insight timeline and side-by-side same-sample comparison.

- [ ] Write UI tests for explicit/conditional/inference labeling, evidence and natural time, room filter, historical pagination, zero state, error state, and low-confidence visual demotion.
- [ ] Implement insight summary metrics and one-room-at-a-time evidence context; do not create a mixed raw-ASR stream.
- [ ] Write comparison tests for identical sample range, separate published/draft columns, manual correctness marks, run metrics, and publish action.
- [ ] Implement comparison view and preserve parser version on historical rows.
- [ ] Run both test files and verify PASS.

### Task 7: Fixture Evaluation And Electron E2E

**Files:**
- Create: `demo/app/tests/fixtures/insights/market-asr.json`
- Create: `demo/app/tests/fixtures/insights/gold-labels.json`
- Create: `demo/app/tests/electron/insight-parser-e2e.cjs`
- Create: `demo/app/scripts/evaluate-parser.mjs`
- Modify: `demo/app/package.json`

**Interfaces:**
- Produces `npm run evaluate:parser` and `npm run test:e2e-insights` reports under `demo/app/reports/`.

- [ ] Add at least 20 deterministic fixture segments covering valid market views, conditional views, audience questions, unendorsed quotes, greetings, ads, repeated views, and ambiguous sector aliases.
- [ ] Implement an evaluator reporting precision, recall, nature accuracy, evidence consistency, and schema validity against gold labels.
- [ ] Build an Electron E2E fixture: configure fake LLM, bind parser, inject ASR, verify formal insights, run draft comparison, publish, unbind, restart, and verify persistence.
- [ ] Run E2E three times; require no residual renderer, timer, request, or application process.

### Task 8: Real Safari Discovery, Isolated Live Smoke, And macOS Delivery

**Files:**
- Create: `demo/app/reports/insight-real-smoke.json`
- Create: `demo/app/reports/insight-real-smoke.png`
- Modify: `demo/app/reports/acceptance-status.md`
- Modify: `demo/app/package.json`
- Modify: `demo/app/package-lock.json`

**Interfaces:**
- Consumes canonical room URLs discovered read-only in Safari and then opens them only in isolated application Sessions.
- Produces macOS `v0.4.0` DMG/ZIP and acceptance evidence.

- [ ] Use Safari only to identify 3–5 currently live market-related rooms; copy only canonical `https://live.douyin.com/<id>` URLs and close discovery tabs.
- [ ] Run isolated application monitoring for 10–20 minutes maximum with real ASR and LLM; Safari remains closed to those rooms during capture.
- [ ] Verify each insight has supporting ASR evidence and manually label false positives, unsupported inferences, and useful results.
- [ ] Run full typecheck, unit/integration tests, audio isolation, crash isolation, parser evaluation, Electron E2E, secret scan, and residual-process check.
- [ ] Set version `0.4.0`, package macOS ARM64 DMG/ZIP, run packaged-app E2E, verify DMG checksum, and update acceptance report.

