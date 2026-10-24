'use strict';
// Run-liveness timing constants (#3973) — module constants, not policy keys.
// Must not require hooks/context.js (context.js requires this directory).

// At most one owner-block heartbeat write per this interval.
const HEARTBEAT_THROTTLE_MS = 60_000;
// A heartbeat / commit younger than this counts as positive liveness evidence.
const LIVE_WINDOW_MS = 10 * 60_000;
// A legacy run (no owner block) with no activity for this long is presumed dead.
const LEGACY_DEAD_MS = 72 * 3_600_000;

module.exports = { HEARTBEAT_THROTTLE_MS, LIVE_WINDOW_MS, LEGACY_DEAD_MS };
