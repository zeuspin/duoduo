# Immediate Room Deletion Implementation Plan

> **For agentic workers:** Execute inline in the current session. Do not create commits or branches.

**Goal:** Allow a room to be deleted immediately while its automatic probe is queued or pacing, and expose deletion progress or failure in the UI.

**Architecture:** Cancel room-scoped access tasks before awaiting scheduler cancellation. Keep deletion state in the renderer so duplicate actions are prevented and rejected IPC calls become visible.

**Tech Stack:** TypeScript, Electron IPC, React, Vitest, Testing Library.

## Global Constraints

- Do not change the SQLite schema.
- Do not create branches, commits, or pushes.

---

### Task 1: Room-scoped access cancellation

**Files:**
- Modify: `src/main/rooms/douyin-access-coordinator.ts`
- Test: `tests/unit/douyin-access-coordinator.test.ts`

- [ ] Add failing tests proving `cancelRoom(roomId)` rejects queued and pacing tasks with `ACCESS_ROOM_CANCELED` without affecting another room.
- [ ] Run the focused test and confirm the expected failure.
- [ ] Implement room-scoped cancellation and interruption of pacing.
- [ ] Run the focused test and confirm it passes.

### Task 2: Delete pipeline and renderer feedback

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/RoomCardActions.tsx`
- Test: `tests/unit/app-room-form.test.tsx`
- Test: `tests/unit/room-card-actions.test.tsx`

- [ ] Add failing tests for the deleting disabled state and visible failure message.
- [ ] Run the focused tests and confirm the expected failures.
- [ ] Invoke `coordinator.cancelRoom(id)` before `probeScheduler.cancel(id)` in the delete IPC.
- [ ] Track deleting room IDs in React, await removal, show an alert on rejection, and disable the delete menu item while pending.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Verification

- [ ] Run all unit tests.
- [ ] Run TypeScript type checking.
- [ ] Inspect the final diff for unrelated changes and confirm no commit or branch was created.
