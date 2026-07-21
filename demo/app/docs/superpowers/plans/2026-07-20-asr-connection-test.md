# ASR Connection Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a valid Bailian API key from being rejected with `NO_VALID_AUDIO_ERROR` during connection testing.

**Architecture:** Add an internal abort path for a started Bailian session. Connection testing will use that path after `task-started`, while production session shutdown continues using `finish-task` and waiting for `task-finished`.

**Tech Stack:** TypeScript, Vitest, WebSocket (`ws`)

## Global Constraints

- Do not change normal ASR session shutdown semantics.
- Do not send synthetic audio during connection testing.
- Do not create a branch, commit, or push.

---

### Task 1: Bailian connection-test lifecycle

**Files:**
- Modify: `demo/app/src/main/asr/bailian-provider.ts`
- Test: `demo/app/tests/unit/bailian-asr.test.ts`

**Interfaces:**
- Consumes: `BailianProvider.testConnection(): Promise<ConnectionTestResult>`
- Produces: an internal session abort operation used only by `testConnection()`

- [ ] **Step 1: Write the failing test**

Add a test that starts `testConnection()`, emits `task-started`, and asserts that the promise succeeds, the socket closes, and the only sent message is `run-task`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/bailian-asr.test.ts`

Expected: the test waits for normal `finish-task` completion or observes an unwanted `finish-task` message.

- [ ] **Step 3: Write minimal implementation**

Add an internal `abort()` operation to `BailianSession` that marks the session closed, closes the socket, and clears listeners. Change `testConnection()` to call `abort()` after `open()` resolves.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
npm test -- tests/unit/bailian-asr.test.ts
npm run typecheck
npm run test:unit
```

Expected: all commands exit successfully with zero failures.

