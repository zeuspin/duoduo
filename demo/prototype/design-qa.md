# Design QA V3

## Comparison Target

- Visual reference: `/Users/xuke/Documents/getian/duoduo/demo/reports/design-references/admindek-course-view.png`
- Implementation screenshot: `/Users/xuke/Documents/getian/duoduo/demo/prototype/qa-v3/01-separated-asr.png`
- Desktop viewport: 2880 × 2000 CSS pixels
- State: two monitored rooms with independent ASR; two unmonitored rooms in the candidate pool

## Design Decision

The former global ASR stream was removed because mixing multiple live-room contexts increased reading interference. Monitored and unmonitored rooms now use different card anatomy:

- Monitored rooms: one full-width horizontal work card per room, with identity and metrics on the left and that room's live ASR on the right.
- Unmonitored rooms: compact image-led cards in a responsive grid.
- Starting or stopping monitoring moves the room between sections and changes its card layout.

## Interaction Verification

- `王者猪八` moved from the candidate grid to the monitoring list after clicking `加入实时监看`.
- Monitoring heading changed from `2 路独立转写` to `3 路独立转写`.
- Candidate count changed from 2 to 1.
- The newly monitored room displayed an isolated `等待主播说话` ASR state.
- Stopping monitoring moved the room back to the candidate grid and restored both counts.
- Clicking a timestamped ASR row inside `大声直播间` opened the correct playback/history drawer.
- Browser console errors: none.

## Required Fidelity Surfaces

- Typography: Inter with Chinese system fallbacks; compact operational hierarchy and normal letter spacing.
- Layout: fixed sidebar and header, single-column monitoring work cards, three-column candidate cards, and no global ASR panel.
- Colors: reference-aligned blue-gray shell with blue monitoring state, red live state, green playback action, and neutral candidate state.
- Imagery: locally persisted prototype cover images; production will use Douyin covers or captured room frames.
- Copy: monitoring, playback, independent ASR, waiting-for-speech, live state, and candidate state are explicitly separated.
- Radius: content cards, controls, labels, dialogs, and transcript surfaces use square corners; only semantic circles and the top brand mark are exempt.

## Findings

No actionable P0, P1, or P2 issues remain for this interaction-confirmation prototype.

## Follow-up Polish

- P3: test horizontal monitored-card density with long transcript sentences and 5–8 concurrent rooms.
- P3: decide whether each card shows the latest 3, 5, or time-window-based ASR items.
- P3: replace prototype images when real Douyin image extraction is available.

final result: passed
