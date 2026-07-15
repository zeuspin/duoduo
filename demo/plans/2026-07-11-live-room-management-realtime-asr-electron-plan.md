# Live Room Management and Realtime ASR Electron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and self-verify a macOS Electron client that manages public Douyin live rooms, detects live status, monitors multiple rooms silently, and shows independent realtime Bailian ASR inside each monitored room card.

**Architecture:** Electron main process owns room persistence, isolated Chromium sessions, WebContentsView instances, audio capture, ASR connections, and short replay buffers. A sandboxed React renderer consumes a typed preload API and never receives secrets. Each room is an independent state machine keyed by `room_id`; events flow from room session to ASR service to renderer through validated IPC.

**Tech Stack:** Electron, React, TypeScript, Vite, Vitest, Playwright Electron, Zod, Node `ws`, Phosphor Icons, Recharts, macOS 26 on Apple Silicon.

## Global Constraints

- All files for this implementation and acceptance remain under `demo/`; root `.env` is the only exception.
- Do not create a Git branch or push code without user permission.
- Target the current macOS computer first.
- Do not implement stock, finance, viewpoint extraction, alerts, or investment functionality.
- Do not use Safari, Chrome login state, Douyin credentials, cookies, or account takeover.
- One room equals one isolated Electron Session partition and WebContents.
- All monitored rooms are muted by default; at most one room may play audible audio.
- Capture page-level room audio; system-wide mixed audio is forbidden.
- A real-live acceptance run must not exceed 20 minutes.
- Bailian credentials must never enter the renderer, logs, reports, fixtures, or commits.

---

## File Structure

```text
demo/app/
  electron/main.ts                 # app lifecycle and dependency assembly
  electron/preload.ts              # narrow typed renderer API
  electron/ipc/register-ipc.ts     # validated IPC handlers
  electron/rooms/room-manager.ts   # room state-machine orchestration
  electron/rooms/room-session.ts   # one isolated WebContents per room
  electron/rooms/page-capture.ts   # injected page-level MediaRecorder bridge
  electron/rooms/live-probe.ts     # metadata and live-state extraction
  electron/asr/asr-client.ts       # interface and event types
  electron/asr/bailian-client.ts   # DashScope realtime WebSocket adapter
  electron/asr/fake-asr-client.ts  # deterministic test adapter
  electron/replay/replay-buffer.ts # bounded per-room chunk index
  electron/storage/room-store.ts   # atomic local JSON persistence
  shared/contracts.ts              # Zod schemas and IPC types
  renderer/                        # approved React interaction implementation
  tests/unit/                      # deterministic domain tests
  tests/integration/               # Electron service integration tests
  tests/e2e/                       # packaged workflow tests
  tests/fixtures/live-room/        # local synthetic live pages and audio
  scripts/real-smoke.ts            # opt-in real Douyin + Bailian smoke
```

---

### Task 1: Electron Shell and Security Boundary

**Files:**
- Create: `demo/app/package.json`, `demo/app/electron/main.ts`, `demo/app/electron/preload.ts`
- Create: `demo/app/shared/contracts.ts`, `demo/app/vite.config.ts`, `demo/app/vitest.config.ts`
- Test: `demo/app/tests/unit/preload-contract.test.ts`

**Interfaces:**
- Produces: `window.duoduo.rooms.list()`, `.add(input)`, `.update(id,input)`, `.remove(id)`, `.setMonitoring(id,bool)`, `.play(id|null)`, `.subscribe(listener)`.

- [ ] **Step 1: Write the failing preload contract test**

```ts
expect(Object.keys(createRendererApi(fakeInvoke, fakeSubscribe))).toEqual(["rooms"])
expect(api.rooms.add).toBeTypeOf("function")
expect(api.rooms.subscribe).toBeTypeOf("function")
```

- [ ] **Step 2: Run `npm test -- preload-contract`; expect FAIL because `createRendererApi` does not exist.**
- [ ] **Step 3: Scaffold Electron + Vite and expose only the typed API with `contextBridge`; set `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`.**
- [ ] **Step 4: Run unit test and `npm run build`; expect PASS and Electron bundles produced.**
- [ ] **Step 5: Run Electron smoke; inspect `process.versions.electron` and confirm renderer cannot access `require` or `process`.**

**Acceptance:** App opens on macOS, approved renderer loads, renderer has no Node globals, and only the documented preload API exists.

---

### Task 2: Room Domain Model, URL Normalization, Schedule, and Persistence

**Files:**
- Create: `demo/app/electron/storage/room-store.ts`
- Modify: `demo/app/shared/contracts.ts`
- Test: `demo/app/tests/unit/room-store.test.ts`, `demo/app/tests/unit/room-contract.test.ts`

**Interfaces:**
- Produces: `normalizeDouyinUrl(url): {roomId:string; canonicalUrl:string}`.
- Produces: `RoomStore.list/add/update/remove` and `RoomConfig` with weekly time windows.

- [ ] **Step 1: Add failing tests for canonical links, query stripping, invalid hosts, duplicate room IDs, weekdays, multiple time ranges, and atomic reload.**

```ts
expect(normalizeDouyinUrl("https://live.douyin.com/123?a=1").canonicalUrl)
  .toBe("https://live.douyin.com/123")
await expect(store.add(existingRoom)).rejects.toThrow("ROOM_EXISTS")
```

- [ ] **Step 2: Run the two test files; expect URL and store tests to fail.**
- [ ] **Step 3: Implement Zod schemas and atomic write-to-temp-then-rename persistence under Electron `userData`.**
- [ ] **Step 4: Run tests; expect all persistence and validation cases to pass.**
- [ ] **Step 5: Manually add, edit, delete, restart; verify state survives and removed rooms do not return.**

**Acceptance:** Room CRUD and weekly schedules survive restart; malformed or duplicate rooms never enter storage.

---

### Task 3: Live Status Probe and Metadata Acquisition

**Files:**
- Create: `demo/app/electron/rooms/live-probe.ts`, `demo/app/electron/rooms/room-session.ts`
- Create: `demo/app/tests/fixtures/live-room/{live,offline,login,error}.html`
- Test: `demo/app/tests/integration/live-probe.test.ts`

**Interfaces:**
- Produces: `probeRoom(session, url): Promise<RoomProbeResult>`.
- `RoomProbeResult.status`: `checking|live|offline|login_required|timeout|page_error`.

- [ ] **Step 1: Write fixture-driven failing tests for every status and optional metadata field.**
- [ ] **Step 2: Run probe tests; expect FAIL because isolated sessions and extraction do not exist.**
- [ ] **Step 3: Implement one in-memory `session.fromPartition('room:<id>')` per room, navigation timeout, safe window-open denial, permission denial, and bounded metadata extraction.**
- [ ] **Step 4: Run fixture tests; expect all statuses and metadata to match.**
- [ ] **Step 5: Run an opt-in real-page probe against three anonymous live URLs; save sanitized results under `demo/app/reports/`.**

**Acceptance:** Three rooms probe independently; a timeout/login/error in one room never changes the other results; no cookies or credentials are persisted.

---

### Task 4: Room Manager State Machine and Monitoring Lifecycle

**Files:**
- Create: `demo/app/electron/rooms/room-manager.ts`
- Test: `demo/app/tests/unit/room-manager.test.ts`

**Interfaces:**
- Produces: `RoomManager.startMonitoring`, `stopMonitoring`, `setPlayingRoom`, `snapshot`, `subscribe`.
- States: `idle|starting|monitoring|recovering|stopped|error`.

- [ ] **Step 1: Write failing transition tests, including rapid double-start, stop during start, room going offline, and one-room failure isolation.**
- [ ] **Step 2: Run tests; expect invalid transition failures.**
- [ ] **Step 3: Implement idempotent transitions, per-room AbortController, bounded retry, and cleanup.**
- [ ] **Step 4: Run tests; expect deterministic state sequences and zero leaked fake sessions.**
- [ ] **Step 5: Connect IPC handlers and verify renderer events are validated by shared Zod schemas.**

**Acceptance:** Starting/stopping is idempotent; every room is independently cancellable; app quit destroys every live session.

---

### Task 5: Independent Page-Level Audio Capture

**Files:**
- Create: `demo/app/electron/rooms/page-capture.ts`, `demo/app/electron/rooms/live-room-preload.ts`
- Test: `demo/app/tests/integration/page-capture.test.ts`, `demo/app/tests/integration/audio-isolation.test.ts`

**Interfaces:**
- Produces: `AudioChunk {roomId, sequence, startedAt, endedAt, mimeType, bytes}`.
- Consumes: page `HTMLVideoElement.captureStream()` and `MediaRecorder`.

- [ ] **Step 1: Write failing fixture tests using distinct 440Hz/660Hz room audio and a 1234Hz system watermark.**
- [ ] **Step 2: Run tests; expect no chunks before capture implementation.**
- [ ] **Step 3: Inject the capture bridge, transfer bounded chunks to main, enforce monotonic sequence IDs, and keep WebContents audio muted.**
- [ ] **Step 4: Run tests; expect both room frequencies in their own chunks and no 1234Hz watermark.**
- [ ] **Step 5: Stop one room and verify the other continues producing increasing sequence IDs.**

**Acceptance:** At least three fixture rooms record concurrently without cross-room or system-audio contamination; stopping/reloading one does not interrupt the others.

---

### Task 6: Bailian Realtime ASR Adapter

**Files:**
- Create: `demo/app/electron/asr/{asr-client,bailian-client,fake-asr-client}.ts`
- Test: `demo/app/tests/unit/asr-client.test.ts`, `demo/app/tests/integration/bailian-smoke.test.ts`

**Interfaces:**
- Produces: `AsrEvent {roomId, sessionId, segmentId, startMs, endMs, text, isFinal}`.
- `AsrClient.open(roomId)`, `.write(chunk)`, `.close()`.

- [ ] **Step 1: Write failing tests for room routing, partial replacement, final de-duplication, reconnect, and secret redaction.**
- [ ] **Step 2: Run tests with fake WebSocket; expect adapter tests to fail.**
- [ ] **Step 3: Implement DashScope WebSocket adapter using `paraformer-realtime-v2`; read Key only in main process and redact headers/errors.**
- [ ] **Step 4: Run deterministic fake-server tests; expect ordered room-scoped events and no key in captured logs.**
- [ ] **Step 5: With `.env` loaded locally, send an existing `demo/samples` audio fixture; expect at least one final non-empty ASR event.**

**Acceptance:** Three ASR sessions operate concurrently, every event has the correct room ID, reconnect does not duplicate final text, and secret scan returns no matches.

---

### Task 7: Renderer Integration with Approved Interaction

**Files:**
- Move/adapt: `demo/prototype/src/*` to `demo/app/renderer/`
- Create: `demo/app/renderer/store/room-store.ts`, `demo/app/renderer/components/{MonitoringCard,PoolCard,PlayerDrawer,AddRoomDialog}.tsx`
- Test: `demo/app/tests/unit/renderer-room-flow.test.tsx`

**Interfaces:**
- Consumes preload API and `RoomSnapshot`/`AsrEvent` contracts.

- [ ] **Step 1: Write failing UI tests for add, card migration, per-card ASR isolation, stop monitoring, and single playback drawer.**
- [ ] **Step 2: Run renderer tests; expect failures while mock-only state remains.**
- [ ] **Step 3: Replace mock data with preload-backed state; preserve approved square-corner Admindek visual baseline.**
- [ ] **Step 4: Run tests; expect ASR for room A never appears in room B and no global ASR panel exists.**
- [ ] **Step 5: Run screenshot QA at 1440×1000 and 1100×800; verify no overlaps, clipped actions, or horizontal page overflow.**

**Acceptance:** All visible state comes from Electron services; monitored/unmonitored cards migrate correctly; each monitored card shows only its own latest ASR.

---

### Task 8: Single-Room Playback and Short Replay Buffer

**Files:**
- Create: `demo/app/electron/replay/replay-buffer.ts`, `demo/app/electron/rooms/player-view.ts`
- Test: `demo/app/tests/unit/replay-buffer.test.ts`, `demo/app/tests/integration/player-view.test.ts`

**Interfaces:**
- Produces: `ReplayBuffer.append/findByTimestamp/prune` and `PlayerView.show(roomId)/hide/switchTo`.

- [ ] **Step 1: Write failing tests for timestamp lookup, bounded pruning, one-audible-room invariant, switch, and close-without-stop.**
- [ ] **Step 2: Run tests; expect replay and player tests to fail.**
- [ ] **Step 3: Implement bounded per-room chunk indexing and one reusable WebContentsView bound to the selected room session.**
- [ ] **Step 4: Run tests; expect old room muted before new room unmuted and monitoring counts unchanged.**
- [ ] **Step 5: Click ASR timestamps in Electron E2E; verify replay position changes and “回到直播” returns to the live edge.**

**Acceptance:** At most one room is audible; closing or switching the drawer never stops background ASR; replay resolves to the correct room and time range.

---

### Task 9: Recovery, Cleanup, and Observability

**Files:**
- Create: `demo/app/electron/observability/sanitized-logger.ts`
- Test: `demo/app/tests/integration/recovery.test.ts`, `demo/app/tests/integration/cleanup.test.ts`

**Interfaces:**
- Produces sanitized lifecycle events and `shutdown(): Promise<CleanupReport>`.

- [ ] **Step 1: Write failing tests for page crash, audio disappearance, ASR disconnect, room offline, app quit, and key/cookie redaction.**
- [ ] **Step 2: Run tests; expect leaked resources and missing recovery events.**
- [ ] **Step 3: Implement bounded room-only recovery, terminal offline state, resource registry, and sanitized structured logs.**
- [ ] **Step 4: Run tests; expect zero remaining sessions, WebContents, ASR sockets, temp chunks, and replay handles.**
- [ ] **Step 5: Run `rg` secret/cookie scan over `demo/app`; expect no matches.**

**Acceptance:** Failure of one room is isolated; shutdown report shows all tracked resources at zero; logs contain no secrets or login state.

---

### Task 10: Automated E2E and Real 20-Minute Acceptance

**Files:**
- Create: `demo/app/tests/e2e/live-room-workflow.spec.ts`
- Create: `demo/app/scripts/real-smoke.ts`
- Create: `demo/app/reports/acceptance-template.md`

**Interfaces:**
- Consumes all prior production interfaces; produces machine JSON and human Markdown reports.

- [ ] **Step 1: Write failing Playwright Electron E2E for CRUD → probe → monitor three → independent ASR → play/switch → stop → restart.**
- [ ] **Step 2: Run E2E with local fixture rooms and fake ASR; expect initial workflow failures.**
- [ ] **Step 3: Fix only integration gaps; rerun until fixture E2E passes three consecutive times.**
- [ ] **Step 4: Run real smoke with at least three currently live anonymous rooms and Bailian for 10 minutes, never exceeding 20 minutes.**
- [ ] **Step 5: Verify each room emits at least one distinct final ASR event, one playback switch leaves other ASR active, and cleanup counts are zero.**
- [ ] **Step 6: Generate `demo/app/reports/final-acceptance.{md,json}` and run build, unit, integration, E2E, secret scan, and process guard.**

**Acceptance:** Fixture E2E passes three consecutive times; real run has at least three independently routed ASR streams; one-audible-room rule holds; no residual processes/sessions remain; final report contains no sensitive data.

---

## Final Commands

```bash
cd demo/app
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
npm run scan:secrets
npm run guard:processes
```

Expected: every command exits `0`; final acceptance JSON reports `stage_acceptance_pass=true`.

