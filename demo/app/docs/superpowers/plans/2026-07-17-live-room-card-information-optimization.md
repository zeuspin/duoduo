# Live Room Card Information Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify prepared-room cards, display follower counts consistently, and support per-room automatic monitoring when a room goes live.

**Architecture:** Extend the existing `Room` persistence model with `autoMonitorOnLive`, expose one renderer API operation to change it, and keep the actual transition into monitoring on the existing `rooms:set-monitoring`/manager path. Extract small pure presentation and auto-trigger helpers so state rules can be tested without Electron windows; `App.tsx` composes those helpers into the current card.

**Tech Stack:** TypeScript 5.9, React 19, Electron 39, Zod 4, Node SQLite, Vitest, Testing Library.

## Global Constraints

- Do not create a branch or push code.
- Preserve unrelated existing working-tree changes.
- Do not add new Douyin page requests or change follower collection behavior.
- `autoMonitorOnLive` is independent per room and defaults to `false` for existing data.
- Missing follower counts display `主播粉丝 待获取`; they must never be coerced to zero.
- Offline cards show status, schedule, and simplified relative detection time in the cover area.
- Live cards highlight the manual join action.
- Remove the URL, `数据积累中`, and the old detailed detection line from prepared cards.

---

### Task 1: Persist the per-room automatic-monitoring setting

**Files:**
- Modify: `src/shared/contracts.ts`
- Modify: `src/main/storage/database.ts`
- Modify: `src/preload/api.ts`
- Modify: `src/main/main.ts`
- Test: `tests/unit/contracts.test.ts`
- Test: `tests/unit/database.test.ts`
- Test: `tests/unit/renderer-api.test.ts`

**Interfaces:**
- Produces: `Room.autoMonitorOnLive: boolean`.
- Produces: `rooms.setAutoMonitorOnLive(roomId: string, enabled: boolean)` in the renderer API.
- Produces: repository method `setAutoMonitorOnLive(roomId: string, enabled: boolean): Promise<Room>`.

- [ ] **Step 1: Write failing contract, database, and renderer API tests**

Add assertions that `RoomSchema` defaults a missing `autoMonitorOnLive` to `false`, SQLite saves and reloads `true`, and the renderer API invokes `rooms:set-auto-monitor-on-live` with the room ID and boolean.

```ts
expect(RoomSchema.parse(existingRoom).autoMonitorOnLive).toBe(false);
await database.rooms.setAutoMonitorOnLive("123", true);
expect((await database.rooms.list())[0].autoMonitorOnLive).toBe(true);
await api.rooms.setAutoMonitorOnLive("123", true);
expect(invoke).toHaveBeenCalledWith("rooms:set-auto-monitor-on-live", "123", true);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --run tests/unit/contracts.test.ts tests/unit/database.test.ts tests/unit/renderer-api.test.ts`

Expected: failures report the missing property/repository/API method.

- [ ] **Step 3: Implement the minimal persistence and IPC surface**

Add `autoMonitorOnLive: z.boolean().default(false)` to `RoomSchema`; add an `auto_monitor_on_live INTEGER NOT NULL DEFAULT 0` column with an idempotent migration for existing databases; include the field in inserts, reads, legacy imports, and backup column-aware merges. Add the repository setter, renderer API method, and IPC handler that persists the setting and broadcasts the room snapshot.

```ts
ipcMain.handle("rooms:set-auto-monitor-on-live", async (_event, roomId, enabled) => {
  await rooms.setAutoMonitorOnLive(z.string().min(1).parse(roomId), Boolean(enabled));
  await broadcastSnapshot();
  return snapshot();
});
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --run tests/unit/contracts.test.ts tests/unit/database.test.ts tests/unit/renderer-api.test.ts`

Expected: all selected suites pass.

### Task 2: Trigger automatic monitoring exactly once per live transition

**Files:**
- Create: `src/main/rooms/auto-monitor.ts`
- Modify: `src/main/main.ts`
- Test: `tests/unit/auto-monitor.test.ts`

**Interfaces:**
- Produces: `shouldAutoMonitor(room: Room, previousStatus: RoomSnapshot["status"] | undefined, nextStatus: RoomSnapshot["status"]): boolean`.
- Consumes: the Task 1 `Room.autoMonitorOnLive` field and repository setter.

- [ ] **Step 1: Write the failing transition-policy tests**

Cover disabled settings, offline-to-live, undefined-to-live for a room already live when enabled, live-to-live de-duplication, and non-live results.

```ts
expect(shouldAutoMonitor(enabledRoom, "offline", "live")).toBe(true);
expect(shouldAutoMonitor(enabledRoom, undefined, "live")).toBe(true);
expect(shouldAutoMonitor(enabledRoom, "live", "live")).toBe(false);
expect(shouldAutoMonitor(disabledRoom, "offline", "live")).toBe(false);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --run tests/unit/auto-monitor.test.ts`

Expected: module/function does not exist.

- [ ] **Step 3: Implement the pure policy and integrate it with probe completion**

Implement the predicate with no side effects. Before persisting a prepared probe result, capture the previous snapshot status; after a trusted `live` result is persisted, load the room and call one shared `startRoomMonitoring(id)` function only when the predicate returns true. Reuse the same shared function from the manual `rooms:set-monitoring` handler. When the automatic setting is enabled through IPC while the latest snapshot is already `live`, call that shared function immediately. Preserve access-coordinator checks and existing rollback behavior.

```ts
export function shouldAutoMonitor(room: Room, previousStatus: RoomSnapshot["status"] | undefined, nextStatus: RoomSnapshot["status"]): boolean {
  return room.autoMonitorOnLive && nextStatus === "live" && previousStatus !== "live";
}
```

- [ ] **Step 4: Run policy and affected scheduler/manager tests**

Run: `npm test -- --run tests/unit/auto-monitor.test.ts tests/unit/probe-scheduler.test.ts tests/unit/room-manager.test.ts`

Expected: all selected suites pass with no duplicate monitoring starts.

### Task 3: Render the simplified prepared-room card

**Files:**
- Modify: `src/renderer/room-card-presenter.ts`
- Modify: `src/renderer/components/RoomIntelligence.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/unit/room-card-presenter.test.ts`
- Test: `tests/unit/room-intelligence-ui.test.tsx`
- Test: `tests/unit/app-room-form.test.tsx`

**Interfaces:**
- Produces: `compactCount(value?: number): string` returning `待获取` for `undefined`.
- Produces: `compactCheckedAt(checkedAt: string, now?: number): string` returning copy such as `96 分钟前检测`.
- Consumes: Task 1 `rooms.setAutoMonitorOnLive` and `Room.autoMonitorOnLive`.

- [ ] **Step 1: Write failing presenter and UI tests**

Test minute/hour relative copies, missing follower copy, absence of URL/`数据积累中`/old detection text, cover metadata, live button highlighting, offline button availability, data-details placement, and per-room checkbox calls.

```tsx
expect(screen.getByText("主播粉丝").parentElement).toHaveTextContent("126.4 万");
expect(screen.queryByText("https://live.douyin.com/123")).toBeNull();
expect(screen.queryByText("数据积累中")).toBeNull();
expect(screen.getByRole("button", { name: "加入实时监看" })).not.toBeDisabled();
fireEvent.click(screen.getByRole("checkbox", { name: "开播后自动监看" }));
await waitFor(() => expect(window.duoduo.rooms.setAutoMonitorOnLive).toHaveBeenCalledWith("123", true));
```

- [ ] **Step 2: Run focused UI tests and verify RED**

Run: `npm test -- --run tests/unit/room-card-presenter.test.ts tests/unit/room-intelligence-ui.test.tsx tests/unit/app-room-form.test.tsx`

Expected: assertions fail against the current checkbox, URL, badge, and old detection line.

- [ ] **Step 3: Implement minimal presenter helpers and card markup**

Move schedule and relative detection copy into `Cover` metadata slots for offline cards. Make `RoomIntelligenceBadges` omit `insufficient_data` and expose the `数据详情` trigger as a cover action. Add the fixed follower row, manual join button, and adjacent controlled checkbox. Use `snapshot.status === "live"` for the highlighted class. On setting changes, call `setAutoMonitorOnLive`; on manual join, call the existing `setMonitoring` API.

```tsx
<button className={`join-monitoring ${snapshot?.status === "live" ? "live" : ""}`} disabled={accessBlocked} onClick={() => void window.duoduo.rooms.setMonitoring(room.roomId, true)}>加入实时监看</button>
<label className="auto-monitor"><input type="checkbox" checked={room.autoMonitorOnLive} onChange={(event) => void window.duoduo.rooms.setAutoMonitorOnLive(room.roomId, event.currentTarget.checked)} />开播后自动监看</label>
```

- [ ] **Step 4: Add the balanced-layout styles**

Add cover metadata positioning, top-right data-details button, fixed follower row, neutral join button, and live highlighted join button. Reuse existing colors, border radii, spacing, and focus-visible conventions; do not add a new design-token system.

- [ ] **Step 5: Run focused UI tests and verify GREEN**

Run: `npm test -- --run tests/unit/room-card-presenter.test.ts tests/unit/room-intelligence-ui.test.tsx tests/unit/app-room-form.test.tsx`

Expected: all selected suites pass.

### Task 4: Remove the insufficient-data generation path and verify regressions

**Files:**
- Modify: `src/main/rooms/room-intelligence.ts`
- Test: `tests/unit/room-intelligence.test.ts`
- Test: `tests/unit/contracts.test.ts`

**Interfaces:**
- Preserves: historical `TransparentLabelSchema` compatibility with `insufficient_data`.
- Changes: new summaries no longer generate an `insufficient_data` label.

- [ ] **Step 1: Change the existing intelligence test to require no placeholder label**

```ts
expect(summary.labels).toEqual([]);
expect(summary.allLabels).toEqual([]);
```

- [ ] **Step 2: Run the intelligence test and verify RED**

Run: `npm test -- --run tests/unit/room-intelligence.test.ts`

Expected: current implementation returns `数据积累中`.

- [ ] **Step 3: Remove only the placeholder-label generation branch**

Return the real calculated labels without appending an `insufficient_data` label when the list is empty. Keep schema compatibility and all real-label thresholds unchanged.

- [ ] **Step 4: Run the complete unit suite and typecheck**

Run: `npm run typecheck && npm run test:unit`

Expected: TypeScript exits 0 and all unit tests pass.

- [ ] **Step 5: Run build-level verification**

Run: `npm run build`

Expected: Electron Forge packages the application successfully.

### Task 5: Visual acceptance and final hygiene

**Files:**
- Verify: `src/renderer/App.tsx`
- Verify: `src/renderer/styles.css`
- Verify: generated local fixture screenshot/report only if the existing fixture supports the card states.

**Interfaces:**
- Consumes all prior tasks; produces no new API.

- [ ] **Step 1: Run the relevant existing fixture E2E if available**

Run: `npm run test:e2e-fixture`

Expected: fixture completes without Electron errors and produces its existing report/screenshot artifacts.

- [ ] **Step 2: Inspect the rendered card at normal and narrow widths**

Confirm the chosen balanced layout: data details in the cover top-right, offline metadata in the cover top-left, follower row in the body, and action/checkbox alignment without overlap.

- [ ] **Step 3: Review the final diff without modifying unrelated files**

Run: `git diff --check && git status --short && git diff -- src/shared/contracts.ts src/main/storage/database.ts src/main/rooms/auto-monitor.ts src/main/main.ts src/preload/api.ts src/renderer/room-card-presenter.ts src/renderer/components/RoomIntelligence.tsx src/renderer/App.tsx src/renderer/styles.css tests/unit`

Expected: no whitespace errors; only scoped changes are attributed to this task. Do not commit, branch, or push unless the user separately requests it.
