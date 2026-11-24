'use strict';
// Run-liveness timing constants (#3973) — module constants, not policy keys.
// Must not require hooks/context.js (context.js requires this directory).

// At most one owner-block heartbeat write per this interval.
const HEARTBEAT_THROTTLE_MS = 60_000;
// A heartbeat / commit younger than this counts as positive liveness evidence.
const LIVE_WINDOW_MS = 10 * 60_000;
// A legacy run (no owner block) with no activity for this long is presumed dead.
// 72 h was a design-time judgment (2026-10-22 run-directory-cleanup design,
// "Claude's calls" 3; consumed since, read it at git show 19ea1a6b4:docs/superpowers/specs/2026-10-22-run-directory-cleanup-design.md),
// not a measured value — no measurement behind the specific
// number is recorded. Consistent with the design's "close runs conservatively"
// intent. #3973: the windows are "tuned only with evidence and never in the
// fail-open direction"; the design adds that they "must not move in the fail-open
// direction without a measured reason". Also reused as reconcile's `unknown`
// fallback floor (archive-merged.js).
const LEGACY_DEAD_MS = 72 * 3_600_000;

module.exports = { HEARTBEAT_THROTTLE_MS, LIVE_WINDOW_MS, LEGACY_DEAD_MS };
