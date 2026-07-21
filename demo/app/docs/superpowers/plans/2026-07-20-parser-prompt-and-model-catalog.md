# Parser Prompt and Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace option-built parser rules with a visible full prompt, add a verified Bailian model and pricing catalog, preserve legacy parsers, and remove the obsolete parser sample-test path.

**Architecture:** Introduce a shared, versioned model catalog and a versioned parser-spec union. A single prompt materializer returns the exact system prompt for both legacy and new parsers, while pricing calculation consumes the same catalog. The renderer only edits `name`, `model`, and `prompt`; formal insight execution remains unchanged except for reading the materialized prompt.

**Tech Stack:** TypeScript, Zod, React, Electron IPC, Vitest, SQLite.

## Global Constraints

- Do not create a branch, commit, stage, or push without user permission.
- New parsers only expose name, model, and full prompt.
- Existing parsers remain readable and executable without a destructive migration.
- Every selectable model must have official Beijing availability, compatibility, and pricing evidence.
- Do not affect live monitoring, ASR, group-level parser binding, formal insights, or unified AI metering.
- Parser sample testing is removed; LLM connection testing remains.

---

### Task 1: Shared Bailian model catalog and price calculation

**Files:**
- Create: `src/shared/bailian-model-catalog.ts`
- Modify: `src/main/usage/pricing.ts`
- Test: `tests/unit/bailian-model-catalog.test.ts`
- Test: `tests/unit/ai-pricing.test.ts`

**Interfaces:**
- Produces: `BAILIAN_PARSER_MODELS`, `DEFAULT_PARSER_MODEL_ID`, `getBailianParserModel(id)`, and price tiers expressed as CNY per million tokens.
- Consumes: `PricingInput` and produces the existing `PricingResult` contract.

- [ ] Write a failing catalog test that expects all nine approved IDs, default `qwen3.7-plus-2026-05-26`, Beijing availability, checked date, and complete non-thinking price tiers.
- [ ] Run `npm test -- --run tests/unit/bailian-model-catalog.test.ts` and verify failure because the catalog module does not exist.
- [ ] Implement the immutable shared catalog with labels, vendor groups, positioning, version kind, official source URL, checked date, and price tiers.
- [ ] Run the catalog test and verify it passes.
- [ ] Extend pricing tests for every catalog model, tier boundaries, unknown models, zero input tokens, and over-context requests; verify the new cases fail against the single-model calculator.
- [ ] Refactor `calculateCatalogCost` to select the catalog tier and preserve the Paraformer rule; run both pricing test files and verify they pass.

### Task 2: Versioned parser specs and exact prompt materialization

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/insights/market-prompt.ts`
- Modify: `src/main/storage/database.ts`
- Test: `tests/unit/contracts.test.ts`
- Test: `tests/unit/immutable-parsers.test.ts`
- Test: `tests/unit/insight-engine.test.ts`

**Interfaces:**
- Produces: `LegacyParserSpec`, `ParserSpecV2`, union `ParserSpec`, `DEFAULT_PARSER_PROMPT`, and `materializeParserPrompt(spec): string`.
- New spec shape: `{ schemaVersion: 2, name: string, model: string, prompt: string }`.
- Legacy shape remains the current objectives/filters/normalization schema.

- [ ] Add failing contract tests that parse both legacy and V2 specs, reject empty V2 prompts, and reject V2 models outside the selectable catalog.
- [ ] Run the contract tests and verify they fail because V2 is unsupported.
- [ ] Define the discriminated-compatible schema union and exported types while preserving legacy parse behavior.
- [ ] Add failing prompt tests proving V2 returns its prompt byte-for-byte and legacy prompt materialization equals the former generated prompt.
- [ ] Replace `buildMarketSystemPrompt` internals with `materializeParserPrompt`, export the full default prompt, and verify prompt tests pass.
- [ ] Add failing immutable-parser tests proving create uses V2, legacy records still load, and copy from legacy stores a V2 materialized prompt.
- [ ] Update immutable parser creation/copying with catalog validation for new parsers and legacy compatibility; run storage and insight tests.

### Task 3: Simplified parser management UI

**Files:**
- Modify: `src/renderer/components/ParserManagement.tsx`
- Modify: `src/renderer/forms.css`
- Modify: `tests/unit/parser-management.test.tsx`

**Interfaces:**
- Consumes: `BAILIAN_PARSER_MODELS`, `DEFAULT_PARSER_MODEL_ID`, `DEFAULT_PARSER_PROMPT`, `materializeParserPrompt`.
- Produces: UI submissions containing only the V2 parser spec.

- [ ] Replace current renderer tests with failing assertions that the editor only exposes name, model, and prompt; defaults to Qwen 3.7 Plus; and does not render removed fields or sample testing.
- [ ] Add failing UI tests for grouped model options, pricing tiers on selection, `qwen-plus` rolling label, exact old-prompt viewing, and legacy-to-V2 copy.
- [ ] Run `npm test -- --run tests/unit/parser-management.test.tsx` and verify the expected failures.
- [ ] Refactor `ParserManagement` to use the three-field V2 editor, model price card, full prompt view/copy, and legacy materialization.
- [ ] Add focused CSS for the prompt editor and price card using existing design tokens.
- [ ] Run the component test and verify it passes.

### Task 4: Remove the parser sample-test vertical path

**Files:**
- Modify: `src/preload/api.ts`
- Modify: `src/main/main.ts`
- Modify: `tests/unit/renderer-api.test.ts`
- Modify: `tests/unit/parser-management.test.tsx`

**Interfaces:**
- Removes: renderer `parsers.test`, IPC `parsers:test-immutable`, temporary parser run creation, and `parser_test` metering path from this feature.
- Preserves: `llm.test`, `InsightEngine`, parser list/create/copy/remove, and formal insight metering.

- [ ] Add a failing renderer API assertion that the parser API keys are exactly `list`, `create`, `copy`, and `remove`.
- [ ] Remove the preload method and main IPC handler, then run renderer API tests.
- [ ] Use `rg "parsers:test-immutable|parsers\.test|PARSER_TEST_NO_ASR|featureKey: \"parser_test\"" src tests` and require no obsolete feature references, excluding historical usage aggregation fixtures that intentionally describe past records.
- [ ] Run parser management, renderer API, AI usage, and insight tests to prove the retained paths still work.

### Task 5: Full regression and Electron acceptance

**Files:**
- Modify only if verification exposes a scoped defect.

**Interfaces:**
- Consumes all previous task outputs.
- Produces fresh verification evidence.

- [ ] Run `npx prettier --check` on every file changed by this plan and fix only this plan's formatting.
- [ ] Run `npm run typecheck` and fix all introduced type errors.
- [ ] Run `npm test -- --run` and require zero failures.
- [ ] Run `npm run build` and require successful Electron packaging.
- [ ] Run `npm run test:e2e-insights` to verify parser creation, group binding, formal insight generation, metering, and renderer navigation.
- [ ] Run `npm run test:e2e-fixture` to verify nine-room monitoring and ASR remain unaffected.
- [ ] Audit every acceptance criterion in `docs/superpowers/specs/2026-07-20-parser-prompt-and-model-catalog-design.md` against code and fresh test evidence.

