# Live Room Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-room parser binding, room-scoped insight reading, bounded top notifications, and persistent notification timeout settings to the live monitoring workspace.

**Architecture:** Keep ASR unchanged as the primary path. Renderer parser binding calls existing validated IPC; formal insight persistence emits room-scoped changes, while new focused React components read and present those insights without affecting RoomManager or capture sessions.

**Tech Stack:** Electron 39, React 19, TypeScript, Zod, SQLite, Vitest, Testing Library.

## Global Constraints

- All files remain under `demo/`.
- Parser operations never call RoomManager, RoomSession, playback, or ASR provider APIs.
- Historical insights do not generate startup notifications.
- Notifications are bounded to 20 and all timers are cleared on dismissal/unmount.
- Version becomes `0.5.0`; no branch, commit, or push.

---

### Task 1: Persistent notification preference

**Files:** `src/shared/contracts.ts`, `src/main/storage/settings-store.ts`, `src/main/main.ts`, `src/preload/api.ts`, related unit tests.

- [ ] Add failing tests for `null | 10 | 30 | 60`, persistence, exact preload channels and invalid value rejection.
- [ ] Add `InsightNotificationSettingsSchema`, SettingsStore get/save methods, validated IPC and preload API.
- [ ] Run focused settings, contracts and renderer API tests.

### Task 2: Room-scoped insight panel and binding control

**Files:** create `src/renderer/components/LiveInsightPanel.tsx`, create `src/renderer/components/LiveRoomWorkspace.tsx`, modify `App.tsx`, CSS and UI tests.

- [ ] Add failing tests proving each room lists only its own insights and binds/unbinds published parsers.
- [ ] Add ASR/观点 tabs, parser selector, 20-row first page, older-page loading, evidence expansion and disabled-parser status.
- [ ] Add a test proving binding calls do not invoke rooms monitoring APIs and ASR remains rendered.
- [ ] Run focused UI tests.

### Task 3: Bounded notification rail and navigation

**Files:** create `src/renderer/components/InsightNotificationRail.tsx`, modify `App.tsx`, add UI tests.

- [ ] Add fake-timer tests for no startup history, new-ID dedup, 20-item bound, manual close, 10/30/60 timeout and never timeout.
- [ ] Implement horizontal top rail and room/insight navigation callback.
- [ ] Scroll the room card into view, activate insight tab, highlight the selected insight, then dismiss the notification.
- [ ] Verify all timers are cleared on unmount.

### Task 4: Global setting UI and delivery

**Files:** modify settings modal in `App.tsx`, styles, package files, acceptance report and E2E.

- [ ] Add UI test for loading, saving and restoring timeout preference.
- [ ] Add the select control to global settings without changing ASR credentials behavior.
- [ ] Add Electron fixture injection proving a new insight produces a clickable top notification and correct card navigation.
- [ ] Run typecheck, all tests, packaged three-room ASR E2E, secret scan and residual-process check.
- [ ] Set `0.5.0`, build DMG/ZIP, run packaged E2E and record SHA-256.

