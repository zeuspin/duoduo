# Room Grouping and Controlled Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mandatory one-group-per-room organization, immutable group-level parsers, a globally unique running group, and one controlled probe queue while preserving existing trusted room data and ASR shutdown behavior.

**Architecture:** SQLite repositories enforce group capacity, membership, parser references, and the unique active run. `GroupRunService` owns run-state transitions while `ProbeOrchestrator` becomes the only page-probe entry point. Renderer state receives one grouped snapshot and uses the same IPC transaction for drag-and-menu moves.

**Tech Stack:** Electron 39, TypeScript 5.9, React 19, Zod 4, Node SQLite, Vitest, Testing Library.

## Global Constraints

- Every room belongs to exactly one group; no ungrouped state.
- A group contains at most 9 rooms, enforced in a SQLite transaction.
- Users may view groups freely; globally at most one group run is active.
- Only the running group produces scheduled probes and can auto-start monitoring.
- Every page probe uses one global serial queue and a persisted 60-second per-room cooldown.
- Parser definitions are immutable after creation; copy creates a new parser; delete is soft and forbidden while referenced.
- App restart interrupts runs and never resumes network access automatically.
- Group Agent, daily summaries, and RAG are excluded.
- Do not create branches, stage, commit, or push without explicit user permission.

---

### Task 1: Group contracts, schema, repository, and migration

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/storage/database.ts`
- Create: `src/main/groups/group-repository.ts`
- Test: `tests/unit/room-groups.test.ts`
- Modify: `tests/unit/database.test.ts`

**Interfaces:**
- Produces: `RoomGroup`, `GroupedRoomSnapshot`, `GroupRepository.list/create/rename/remove/moveRoom/setParser`.
- `moveRoom(roomId, targetGroupId, position?)` atomically rejects `GROUP_ROOM_LIMIT_REACHED` and `RUNNING_GROUP_LOCKED`.

- [ ] Write failing repository tests proving default migration, mandatory membership, capacity 9, atomic move, empty-only deletion, and stable ordering.
- [ ] Run `npm test -- --run tests/unit/room-groups.test.ts tests/unit/database.test.ts` and confirm failures are caused by missing group APIs/schema.
- [ ] Add Zod contracts for groups and grouped snapshots; add `room_groups`, `rooms.group_id`, `rooms.position_in_group`, and migration that creates one or more default groups in creation order.
- [ ] Implement `GroupRepository` transactions and error codes; expose it as `database.groups`.
- [ ] Re-run the focused tests and `npm run typecheck` until green.

### Task 2: Immutable parser lifecycle and group binding

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/storage/database.ts`
- Modify: `src/main/main.ts`
- Modify: `src/preload/api.ts`
- Modify: `src/renderer/components/ParserManagement.tsx`
- Modify: `src/renderer/components/LiveRoomWorkspace.tsx`
- Test: `tests/unit/parser-management.test.tsx`
- Create: `tests/unit/immutable-parsers.test.ts`

**Interfaces:**
- Produces: `parsers.create(spec)`, `parsers.copy(sourceId, overrides)`, `parsers.remove(id)`, `parsers.get(id)`.
- Removes runtime use of `room_parser_bindings`; insight lookup becomes `room -> group -> parser`.

- [ ] Write failing tests proving saved parser specs cannot update, copy gets a new ID, referenced parsers cannot delete, unreferenced delete is soft, and rooms use their group parser.
- [ ] Run focused tests and confirm expected failures.
- [ ] Add immutable parser storage/migration from published versions; keep historical IDs readable and remove the built-in distinction from renderer behavior.
- [ ] Replace draft/publish/edit IPC and UI with create, test-before-save, read, copy-new, and delete flows.
- [ ] Remove room parser selectors and render the group parser as read-only context in live workspaces.
- [ ] Re-run parser, insight, contracts, typecheck, and focused renderer tests.

### Task 3: Persisted group run state machine

**Files:**
- Create: `src/main/groups/group-run-repository.ts`
- Create: `src/main/groups/group-run-service.ts`
- Modify: `src/main/storage/database.ts`
- Test: `tests/unit/group-run-service.test.ts`

**Interfaces:**
- Produces: `start(groupId)`, `requestStop(groupId)`, `finishStop(runId)`, `failStop(runId,error)`, `retryStop(runId)`, `interruptOnStartup()`.
- Active statuses: `starting | running | stopping | stop_failed`; SQLite enforces one active row globally.

- [ ] Write failing tests for unique active run, start failure cleanup, stopping transitions, stop failure retaining the active slot, retry idempotency, and startup interruption.
- [ ] Run the new tests and confirm missing-service failures.
- [ ] Add `group_runs` schema and unique active-row index.
- [ ] Implement repository transitions and a service whose scheduler/session dependencies are injected.
- [ ] Re-run focused tests and typecheck.

### Task 4: Unified serial probe orchestrator

**Files:**
- Create: `src/main/rooms/probe-orchestrator.ts`
- Modify: `src/main/rooms/probe-scheduler.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/storage/database.ts`
- Test: `tests/unit/probe-orchestrator.test.ts`
- Modify: `tests/unit/probe-scheduler.test.ts`

**Interfaces:**
- Produces: `enqueueRoom`, `enqueueGroup`, `cancelRun`, `pause`, `resume`, `state`.
- Priority: `room_refresh > group_refresh > scheduled`; queued tasks dedupe by room and upgrade priority.
- Persists actual access attempts in `room_probe_access`; cooldown is 60 seconds across restarts.

- [ ] Write failing tests for serial execution, dedupe, priority upgrade, persisted cooldown, group batch reuse, cancellation by run ID, and paused verification state.
- [ ] Run focused tests and confirm expected failures.
- [ ] Add access-state table/repository and implement the orchestrator around the existing `probeRoom` callback.
- [ ] Route scheduler tasks, room refresh, group refresh, and startup behavior through the orchestrator; remove direct probe entry paths.
- [ ] Ensure result handling re-reads room membership, group run, and auto-monitor state before starting monitoring.
- [ ] Re-run orchestrator, scheduler, room-session, verification, and typecheck suites.

### Task 5: Group lifecycle IPC and application bootstrap

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/shared/contracts.ts`
- Modify: `src/preload/api.ts`
- Modify: `src/renderer/global.d.ts`
- Test: `tests/unit/renderer-api.test.ts`
- Create: `tests/integration/group-lifecycle.test.ts`

**Interfaces:**
- Adds IPC: `groups:list`, `groups:create`, `groups:rename`, `groups:remove`, `groups:move-room`, `groups:set-parser`, `groups:start`, `groups:stop`, `groups:retry-stop`, `groups:refresh`.
- Group snapshot includes groups, room membership/order, active run, and refresh progress.

- [ ] Write failing renderer API and integration tests for every IPC method and start/stop behavior.
- [ ] Run tests and confirm missing API failures.
- [ ] Add Zod input schemas and IPC handlers; never trust renderer capacity or run-state checks.
- [ ] Change bootstrap so no room schedules or monitoring sessions restore automatically; interrupt stale runs before first snapshot.
- [ ] Re-run lifecycle, renderer API, database, and typecheck tests.

### Task 6: Grouped room workspace UI

**Files:**
- Create: `src/renderer/components/RoomGroupWorkspace.tsx`
- Create: `src/renderer/group-workspace.css`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/main.tsx`
- Modify: `src/renderer/components/RoomCardActions.tsx`
- Test: `tests/unit/room-group-workspace.test.tsx`
- Modify: `tests/unit/app-room-form.test.tsx`

**Interfaces:**
- Consumes the group snapshot and IPC from Task 5.
- Emits the same `moveRoom` action from drag/drop and the accessible move menu.

- [ ] Write failing renderer tests for free viewed-group switching, persistent running-group banner, disabled competing start, capacity labels, full-group targets, running-group locks, refresh progress, and drag/menu equivalence.
- [ ] Run focused renderer tests and confirm missing-component failures.
- [ ] Build the confirmed high-fidelity grouped layout using existing card components and styles.
- [ ] Add group create/rename/delete/parser dialogs and require a target group in the add-room form.
- [ ] Add drag handles plus a keyboard-accessible “移动到分组” menu; rollback and refresh on backend conflict.
- [ ] Re-run focused UI tests and typecheck.

### Task 7: Stop progress, late-result safety, and diagnostics

**Files:**
- Modify: `src/main/rooms/room-manager.ts`
- Modify: `src/main/groups/group-run-service.ts`
- Modify: `src/main/rooms/probe-orchestrator.ts`
- Modify: `src/main/main.ts`
- Modify: `src/renderer/components/RoomGroupWorkspace.tsx`
- Test: `tests/unit/group-stop-lifecycle.test.ts`
- Modify: `tests/unit/room-session.test.ts`

**Interfaces:**
- Stop progress reports `{ total, completed, failedRoomIds }`.
- Probe completion may save status but calls auto-monitor only after validating the current `groupRunId`.

- [ ] Write failing tests proving pending tasks cancel, in-flight results cannot auto-monitor after stop, ASR sessions finish before release, failed stops retain the run slot, and retry only targets unfinished rooms.
- [ ] Run focused tests and confirm behavior failures.
- [ ] Implement progress-aware group shutdown and late-result guard.
- [ ] Add diagnostic fields for source, run ID, cooldown reuse, merge/cancel outcome, and auto-monitor decision without recording page content.
- [ ] Render stopping progress and retry controls.
- [ ] Re-run stop lifecycle, ASR usage, diagnostics, and typecheck tests.

### Task 8: Migration, nine-room verification, and full regression

**Files:**
- Modify: `tests/unit/database.test.ts`
- Create: `tests/integration/group-migration.test.ts`
- Create: `tests/integration/nine-room-group.test.ts`
- Modify: `docs/superpowers/specs/2026-07-20-room-grouping-and-controlled-scheduling-design.md` only if implementation exposes a verified contradiction.

**Interfaces:**
- Proves the shipped system against every acceptance criterion in the design spec.

- [ ] Add migration fixtures for 0, 1, 9, 10, and 19 existing rooms and conflicting room parser bindings.
- [ ] Verify all migrated rooms are grouped, old monitoring flags do not restore access, and published parsers remain readable.
- [ ] Add a nine-room lifecycle test covering start, simultaneous monitoring, stop, ASR usage close, and no tenth member.
- [ ] Run `npm run typecheck`, `npm test`, and `npm run build`.
- [ ] Audit every requirement in the design spec against code or test evidence; leave the goal active if any evidence is missing.
