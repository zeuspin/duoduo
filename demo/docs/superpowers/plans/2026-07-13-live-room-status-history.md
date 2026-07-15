# Live Room Status History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize pasted Douyin URLs and add durable avatar identity, automatically refreshed live imagery, heat snapshots, and inferred live sessions.

**Architecture:** Extend the existing probe result with optional, source-aware metrics; persist one latest row plus append-only observations and derived session rows in SQLite. Keep binary avatar and cover assets in independent atomic caches, expose them through custom protocols, and render cards from the latest state.

**Tech Stack:** Electron 39, TypeScript 5.9, React 19, Zod 4, Node `DatabaseSync` SQLite, Vitest.

## Global Constraints

- Do not create branches or push code.
- Missing heat metrics are `NULL`, never zero.
- Avatar is fetched once and changes only through the explicit refresh action.
- Live imagery refreshes with successful live probes and retains only one file per room.
- A technical error does not end a session; three consecutive unknown results spanning at least ten minutes mark it `end_pending`.
- This plan implements the first delivery slice. Retention aggregation, data-management UI, and backup/import are a later plan against the same design.

---

### Task 1: URL normalization regression coverage

**Files:**
- Modify: `app/tests/unit/contracts.test.ts`
- Modify: `app/src/shared/contracts.ts`

**Interfaces:**
- Produces: `normalizeDouyinUrl(value): { roomId: string; canonicalUrl: string }` accepting query strings, fragments, and a trailing slash.

- [ ] Add tests proving the supplied browser URL, a fragment, and a trailing slash normalize to `https://live.douyin.com/591958226292`, while foreign hosts and extra path segments fail.
- [ ] Run `npm test -- --run tests/unit/contracts.test.ts` and verify the new cases fail only if current behavior is insufficient.
- [ ] Make the smallest parser correction required; keep strict HTTPS/host/numeric path validation.
- [ ] Re-run the focused test and expect PASS.

### Task 2: Probe metadata and metric parsing

**Files:**
- Modify: `app/tests/unit/live-probe.test.ts`
- Modify: `app/src/main/rooms/live-probe.ts`

**Interfaces:**
- Produces: `parseCompactCount(value: string): number | undefined`.
- Produces: `RoomProbeResult` optional `avatar`, `viewerCount`, `followerCount`, `totalViewerCount`, `likeCount`, `metricRaw`, and `metricQuality` fields.

- [ ] Write focused tests for plain integers, commas, `万`, `亿`, blanks, and unrelated text.
- [ ] Run the focused tests and verify failure because the parser/fields do not exist.
- [ ] Implement a pure compact-number parser with finite, nonnegative integer output.
- [ ] Expand page inspection to collect candidate avatar metadata and labelled metric text without including cookies or page storage.
- [ ] Return optional parsed metrics and raw labels; do not change status classification when metadata is absent.
- [ ] Run the live-probe unit tests and expect PASS.

### Task 3: Latest state, observations, and live-session persistence

**Files:**
- Modify: `app/src/shared/contracts.ts`
- Modify: `app/src/main/storage/database.ts`
- Modify: `app/tests/unit/database.test.ts`

**Interfaces:**
- Produces: extended `RoomSnapshot` latest-state contract.
- Produces: `database.snapshots.record(snapshot)` which updates latest state, appends an observation, and updates a live session transactionally.
- Produces: `database.snapshots.listHistory(roomId, limit)` and `database.snapshots.listSessions(roomId)` for tests and future UI.

- [ ] Write database tests for nullable metrics and two distinct observations with unchanged values.
- [ ] Write transition tests for offline → live → live → offline session bounds and summaries.
- [ ] Write error-sequence tests proving errors do not close sessions and the third error after ten minutes marks `end_pending`.
- [ ] Run the database tests and verify failure on missing tables/APIs.
- [ ] Add additive startup migrations for latest-state columns, append-only `room_observations`, and `live_sessions` with indexes.
- [ ] Implement transactional recording and deterministic state transition logic using supplied ISO timestamps.
- [ ] Preserve last good descriptive fields/assets in latest state while observations retain the actual nullable result.
- [ ] Re-run database tests and expect PASS.

### Task 4: Independent avatar and live-image caches

**Files:**
- Modify: `app/src/main/rooms/cover-cache.ts`
- Create: `app/src/main/rooms/avatar-cache.ts`
- Create: `app/tests/unit/avatar-cache.test.ts`
- Modify: `app/src/main/main.ts`
- Modify: `app/src/preload/api.ts`
- Modify: `app/src/preload/preload.ts`

**Interfaces:**
- Produces: `AvatarCache.ensure(roomId, url)` that never overwrites an existing avatar.
- Produces: `AvatarCache.refresh(roomId, url)` that atomically overwrites only after a successful download.
- Produces: IPC `rooms:refresh-avatar` and renderer API `rooms.refreshAvatar(roomId)`.

- [ ] Test first-write, no-overwrite, refresh-overwrite, and failed-refresh preservation.
- [ ] Run the avatar-cache tests and verify failure because the class is missing.
- [ ] Implement atomic avatar writes in an `avatars` directory.
- [ ] Change live probe persistence so every successful `live` probe refreshes the single cover, while offline/error preserves it.
- [ ] Ensure avatar automatically only when latest state has no avatar; add explicit refresh IPC.
- [ ] Register separate `duoduo-avatar://` and existing `duoduo-cover://` resource handlers.
- [ ] Run cache tests, preload/API tests, and typecheck; expect PASS.

### Task 5: Card state presentation

**Files:**
- Modify: `app/src/renderer/App.tsx`
- Modify: `app/src/renderer/styles.css`
- Modify: `app/tests/unit/app-room-form.test.tsx`

**Interfaces:**
- Consumes: extended `RoomSnapshot`, `duoduo-avatar://`, and `rooms.refreshAvatar(roomId)`.

- [ ] Add component tests for normalized submission, live card avatar overlay/current viewers, and offline centered avatar.
- [ ] Run the component tests and verify visual assertions fail.
- [ ] Refactor `Cover` to render live, offline, checking, and error variants without losing the last valid visual.
- [ ] Rename “更新主图” actions to “更新头像” and connect explicit avatar refresh.
- [ ] Display current viewers only when present; display last stop and prior session duration only when available.
- [ ] Add responsive styles for small top-left live avatar and large centered offline avatar.
- [ ] Re-run component tests and typecheck; expect PASS.

### Task 6: Integration verification and documentation alignment

**Files:**
- Modify: `docs/superpowers/specs/2026-07-13-live-room-status-history-design.md` only if implementation reveals a factual mismatch.

**Interfaces:**
- Consumes all prior task interfaces.

- [ ] Run `npm run test:unit` from `demo/app`; expect all unit tests PASS.
- [ ] Run `npm run test:integration`; expect all integration tests PASS.
- [ ] Run `npm run typecheck`; expect zero diagnostics.
- [ ] Run `npm run build`; expect Electron Forge packaging to complete.
- [ ] Inspect the final diff/file list and confirm no secrets, cookies, generated packages, branch creation, or push occurred.
- [ ] Record any environment-only verification limitation in the handoff instead of claiming it passed.
