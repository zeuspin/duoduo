# Monitoring Lifecycle Design

## Goal

Treat a broadcaster going offline as a normal monitored-room state, automatically resume monitoring after the broadcaster returns, and prevent repeated renderer/session creation from exhausting Electron resources.

## State model

- `starting`: initial page probe and capture startup.
- `monitoring`: the room is live and audio/ASR capture is active.
- `waiting_for_live`: the room is offline; audio, ASR, BrowserWindow, and its temporary session have been released while a low-frequency probe waits for the room to return.
- `recovering`: a bounded recovery from a technical renderer, page, or ASR failure.
- `error`: technical recovery is exhausted. A circuit-breaker probe may later retry without a hot loop.
- `stopped`: the user disabled monitoring; no retry or probe remains.

## Failure classification

`AUDIO_TRACK_ENDED`, `VIDEO_NOT_FOUND`, `AUDIO_TRACK_NOT_FOUND`, and a successful probe returning `offline` mean the live broadcast ended or is unavailable. They transition to `waiting_for_live` instead of `error`.

Renderer crashes, page evaluation failures, and ASR failures are technical failures. They use bounded exponential recovery. Repeated failure cycles are rate-limited across session boundaries so a temporary success cannot reset the circuit immediately.

## Waiting and resumption

Waiting rooms are probed without starting ASR capture. Only one timer/probe/session may exist per room. The default probe interval is 60 seconds and can be shortened in tests. When a probe reports `live`, the manager starts one fresh capture session. Disabling monitoring aborts the wait immediately.

## Resource lifecycle

Each `RoomSession` owns its Electron partition reference. Closing always unregisters capture, stops the AudioContext, closes ASR, destroys the BrowserWindow, clears temporary partition storage, and releases references. Startup failure performs the same cleanup before propagating the error.

Audio chunks remain bounded and transferred as ArrayBuffers. The main process must not accumulate promises or unbounded audio queues.

## Main window resilience

The main window listens for `render-process-gone`. One automatic reload is allowed for a crash; repeated crashes within a cooldown show a recoverable error page instead of an indefinite white window.

## Diagnostics

Monitoring transitions and failure classifications are written to a rotating local diagnostic log without secrets. This preserves the first triggering event after the application exits.

## Verification

- Unit tests cover offline transition, single waiting probe, automatic resumption, cancellation, bounded technical recovery, and cleanup after failed startup.
- Existing unit and integration tests remain green.
- Type checking and packaging succeed.
- A resource-soak scenario repeatedly cycles live/offline and verifies bounded process count and zero remaining processes after shutdown.
