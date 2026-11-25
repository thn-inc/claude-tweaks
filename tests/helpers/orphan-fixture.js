'use strict';
// tests/helpers/orphan-fixture.js — #3977: the SessionStart banner lists a run
// only when the last reconcile pass cached it as orphaned and its run-liveness
// verdict reads `dead` now. These helpers build both halves for a fixture run.
const fs = require('fs');
const os = require('os');
const path = require('path');

// A pid above every real pid this host hands out but within int32, so
// process.kill(pid, 0) answers ESRCH: the owner-pid probe's death witness.
const DEAD_PID = 2147483646;
const OLD_ISO = '2026-01-01T00:00:00.000Z';

// run-state.json fields for a run whose owner process is gone (a `dead` verdict
// on the real probes, provided the run has a readable events.jsonl and no live
// worktree of its own). Merge into the fixture's own state.
function deadOwner(sessionId = 'dead-session') {
  return {
    sessionId,
    owner: { sessionId, host: os.hostname(), pid: DEAD_PID, pidSource: 'env', pidStartedAt: 'Thu Jan  1 00:00:00 2026', heartbeatAt: OLD_ISO },
  };
}

// Writes the events.jsonl the owner-events probe needs (an old own event).
function writeOldEvents(dir) {
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify({ ts: OLD_ISO, type: 'commit' })}\n`);
}

// Adds `dir` to the main checkout's reconcile-cache.json `orphaned` list.
function seedOrphan(mainRoot, dir, reason = 'PR #7 open, session gone', pr = 7) {
  const file = path.join(mainRoot, '.claude-tweaks', 'reconcile-cache.json');
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* fresh */ }
  const orphaned = Array.isArray(cache.orphaned) ? cache.orphaned : [];
  orphaned.push({ runId: path.basename(dir), runDir: dir, reason, pr });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...cache, orphaned, reportOnlyPassAt: new Date().toISOString() }));
}

module.exports = { DEAD_PID, deadOwner, writeOldEvents, seedOrphan };
