'use strict';

// The spawn decision + spawn for the detached `hooks.js reconcile-background`
// pass — shared by SessionStart (session-start.js) and the unscoped
// `hooks.js reconcile` CLI, which defers its janitorial checks to this same
// pass (#4032). One implementation so both callers gate on the same status
// file and spawn the child the same way.
//
// Never throws: a failed spawn only means this firing's background pass didn't
// run; the next caller retries (the never-break-a-session invariant,
// docs/hooks.md).

const fs = require('fs');
const path = require('path');
const { isFresh } = require('./cache');

const STATUS_FILENAME = 'reconcile-background-status.json';
const HOOKS_JS = path.join(__dirname, '..', '..', 'hooks.js');

function readStatus(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.claude-tweaks', STATUS_FILENAME), 'utf8')); } catch { return null; }
}

/**
 * @param {{ root: string|null|undefined, cwd: string, sessionId?: string, now?: number }} args
 * @returns {{ spawned: boolean, reason: 'spawned'|'fresh'|'spawn-failed'|'no-root' }}
 */
function spawnBackgroundIfStale({ root, cwd, sessionId, now = Date.now() } = {}) {
  if (!root) return { spawned: false, reason: 'no-root' };
  try {
    // TTL-gated by THIS status file's own `completedAt`, deliberately never
    // reconcile()'s shared reconcile-cache.json `lastRunAt` stamp: that stamp
    // fires on ANY fully-completed pr-first pass, including a FAST_CHECKS call
    // that never ran the background checks at all, which would read as a false
    // "fresh" and never spawn (#820 Task 10 fix-up).
    const status = readStatus(root);
    const fresh = isFresh(
      { lastRunAt: status && typeof status.completedAt === 'number' ? status.completedAt : null },
      now,
    );
    if (fresh) return { spawned: false, reason: 'fresh' };

    // Read at call time (not destructured at load) so tests can stub cp.spawn.
    const { spawn } = require('child_process');
    // #1687: thread the session's id into the child's environment so
    // `reconcile-background` can pass it to `reconcile({ sessionId })`, which
    // is what engages archive-merged.js's `isAbandonedInterrupted` ownership
    // gate. A dedicated `CLAUDE_TWEAKS_`-prefixed var, not
    // `CLAUDE_CODE_SESSION_ID` (unreliable for a hook-spawned process); only
    // set when a real id is known — absent means "unresolvable".
    const env = sessionId ? { ...process.env, CLAUDE_TWEAKS_SESSION_ID: sessionId } : process.env;
    const child = spawn(
      process.execPath,
      [HOOKS_JS, 'reconcile-background'],
      // `windowsHide: true` is load-bearing alongside `detached: true`:
      // detaching leaves the child with no inheritable console, and without
      // the flag Windows gives it a VISIBLE one — as it then does for every
      // git process the background pass spawns beneath it.
      { cwd, detached: true, stdio: 'ignore', windowsHide: true, env },
    );
    // An ASYNCHRONOUS spawn failure (EAGAIN under fork pressure) emits 'error'
    // after this function returned; with no listener Node promotes it to an
    // uncaught exception that no surrounding try/catch can absorb. A no-op
    // listener degrades it to the synchronous-failure outcome: no background
    // pass this firing, the next one retries.
    child.on('error', () => { /* silent degrade, never a throw */ });
    child.unref();
    return { spawned: true, reason: 'spawned' };
  } catch {
    return { spawned: false, reason: 'spawn-failed' };
  }
}

module.exports = { spawnBackgroundIfStale, STATUS_FILENAME };
