# Data Management and Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded data retention, storage visibility, safe cleanup, and versioned export/import backup for long-running desktop use.

**Architecture:** A focused maintenance repository owns SQLite aggregation, usage counts, preview, deletion, checkpoint, and vacuum operations. A backup service creates a gzip-compressed, checksummed manifest containing a consistent SQLite backup and durable room images; IPC exposes these operations to a dedicated React data-management view.

**Tech Stack:** Electron 39, TypeScript 5.9, React 19, Zod 4, Node `DatabaseSync`/`node:sqlite.backup`, Node gzip and crypto, Vitest.

## Global Constraints

- Do not create branches, commits, or pushes.
- Default raw observation retention is 30 days; hourly aggregates retain for 365 days; live sessions remain indefinitely.
- ASR defaults to 90 days and diagnostics/log/cache cleanup defaults to 30 days where represented by this application.
- Aggregate and verify before deleting raw observations; failure must leave raw rows intact.
- Cleanup always requires an explicit preview result and a matching preview token.
- Full backup excludes credentials, cookies, login state, diagnostics, temporary audio, and rebuildable caches.
- Restore validates version, checksum, SQLite integrity, and free space before replacing current state.

---

### Task 1: Retention contracts and settings

**Files:**
- Modify: `app/src/shared/contracts.ts`
- Modify: `app/src/main/storage/settings-store.ts`
- Modify: `app/tests/unit/contracts.test.ts`
- Modify: `app/tests/unit/settings-store.test.ts`

**Interfaces:**
- Produces `DataRetentionSettings`, `StorageUsage`, `CleanupRequest`, `CleanupPreview`, and backup result schemas.
- Produces `SettingsStore.getDataRetention()` and `saveDataRetention(value)`.

- [ ] Add failing schema tests for defaults of 30 observation days, 365 aggregate days, 90 ASR days, and 30 log days, rejecting zero/negative or excessive values.
- [ ] Run focused tests and confirm missing schemas/settings methods fail.
- [ ] Implement Zod contracts and settings persistence without altering existing encrypted secrets.
- [ ] Re-run focused tests and expect PASS.

### Task 2: Hourly aggregation and safe cleanup

**Files:**
- Modify: `app/src/main/storage/database.ts`
- Create: `app/src/main/storage/data-maintenance.ts`
- Create: `app/tests/unit/data-maintenance.test.ts`

**Interfaces:**
- Produces `DataMaintenance.getUsage()`.
- Produces `previewCleanup(request): CleanupPreview` and `executeCleanup(request, previewToken)`.
- Produces `runAutomaticRetention(settings, now)`.

- [ ] Add failing tests with observations on both sides of the cutoff, checking hourly sample count/min/max/average and first/last metric values.
- [ ] Add a failing test proving an invalid/stale preview token deletes nothing.
- [ ] Add a failing test proving aggregate failure rolls back and retains raw observations.
- [ ] Run the focused test and confirm missing tables/class failures.
- [ ] Create `room_hourly_aggregates` with `(room_id, hour_started_at)` uniqueness and idempotent upsert.
- [ ] Implement one SQLite transaction that aggregates, validates counts, and deletes only requested rows.
- [ ] Implement per-category usage counts/time bounds plus database/WAL byte sizes supplied by the service.
- [ ] Re-run focused database and maintenance tests and expect PASS.

### Task 3: Versioned full backup and restore

**Files:**
- Create: `app/src/main/storage/backup-service.ts`
- Create: `app/tests/unit/backup-service.test.ts`
- Modify: `app/src/main/storage/database.ts`

**Interfaces:**
- Produces `BackupService.exportTo(destination)`.
- Produces `BackupService.inspect(source)`.
- Produces `BackupService.restoreReplace(source)` and `restoreMerge(source)`.

- [ ] Add failing round-trip tests for SQLite rooms/snapshots plus avatar/cover files and a checksum-tamper rejection test.
- [ ] Add a failing merge test proving stable room IDs and observation keys are deduplicated.
- [ ] Run focused tests and confirm the service is missing.
- [ ] Use `node:sqlite.backup` to create a consistent temporary SQLite file, then package it and durable images into a gzip JSON envelope with SHA-256 manifest hashes.
- [ ] Validate format version, hashes, file sizes, SQLite `integrity_check`, and available disk space before mutation.
- [ ] Implement replace through staged files and atomic renames with rollback copies; implement merge through an attached validated database and conflict-safe inserts.
- [ ] Re-run backup tests and expect PASS.

### Task 4: IPC and automatic daily maintenance

**Files:**
- Modify: `app/src/main/main.ts`
- Modify: `app/src/preload/api.ts`
- Modify: `app/tests/unit/renderer-api.test.ts`

**Interfaces:**
- Produces renderer namespace `data.getUsage/getRetention/saveRetention/previewCleanup/executeCleanup/exportBackup/importBackup/compact`.

- [ ] Add failing renderer API tests for every channel and argument.
- [ ] Run the focused API test and confirm methods are missing.
- [ ] Wire validated IPC handlers, native open/save dialogs, explicit replace/merge import modes, WAL checkpoint, and explicit vacuum.
- [ ] Run automatic retention once after startup and at most once per 24 hours while the app remains open.
- [ ] Re-run API tests and typecheck; expect PASS.

### Task 5: Data-management page

**Files:**
- Create: `app/src/renderer/components/DataManagement.tsx`
- Create: `app/tests/unit/data-management.test.tsx`
- Modify: `app/src/renderer/App.tsx`
- Modify: `app/src/renderer/styles.css`
- Modify: `app/tests/unit/app-room-form.test.tsx`

**Interfaces:**
- Consumes the `window.duoduo.data` API and retention/usage contracts.

- [ ] Add failing component tests for category sizes/counts, retention editing, cleanup preview confirmation, backup export, and replace/merge import choices.
- [ ] Run focused tests and confirm the page/actions are absent.
- [ ] Add “数据管理” to the System navigation and render categorized usage cards, retention controls, and affected-record preview.
- [ ] Require a second explicit click using the returned preview token before cleanup.
- [ ] Add backup/export/import actions, import mode selector, compact action, progress/error messages, and refresh usage after mutations.
- [ ] Add responsive styles consistent with existing panels.
- [ ] Re-run component tests and typecheck; expect PASS.

### Task 6: Full verification

**Files:**
- Modify documentation only if implementation behavior differs from the approved design.

- [ ] Run `npm run test:unit`; expect zero failures.
- [ ] Run `npm run test:integration`; expect zero failures except existing configured skips.
- [ ] Run `npm run typecheck`; expect zero diagnostics.
- [ ] Run `npm run build`; expect Electron Forge packaging exit 0.
- [ ] Confirm no secrets, cookies, login state, generated backup payloads, branch, commit, or push were introduced.
