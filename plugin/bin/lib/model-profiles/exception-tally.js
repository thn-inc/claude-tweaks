'use strict';
// bin/lib/model-profiles/exception-tally.js
//
// The per-design-session tally behind the named frontier exception (#6351).
// One line per counted resolution — `{name}\t{ISO timestamp}` — in
// `{session-dir}/frontier-exception-tally.log`, guarded by a fail-closed
// directory lock so read -> decide -> append is one critical section: five
// parallel readers at count 20 cannot all pass the limit of 22.
//
// A session dir that is missing or not a directory, a lock that cannot be
// taken, an unreadable tally and a failed append all report `reason: 'tally'`
// (fail closed). A tally FILE that does not exist yet inside an existing
// session dir is the fresh-session state and counts 0.
const fs = require('fs');
const path = require('path');
const { canonicalRealpath, lstatType } = require('../path-guard');
const { withLock } = require('../file-lock');

const TALLY_FILE = 'frontier-exception-tally.log';
const LOCK_DIR = '.frontier-exception-tally.lock';
// The lock is held for one read and one append, so 5 s lets every reader of a
// five-wide fan-out queue behind the others; the env knob's 500 ms default is
// never used here. A `tally` step-down from a lock timeout is expected only
// past this wait.
const TALLY_LOCK_WAIT_MS = 5000;

function countUses(text, name) {
  const prefix = `${name}\t`;
  return text.split('\n').filter((l) => l.startsWith(prefix)).length;
}

// -> { ok: true, result } | { ok: false, reason: 'tally' }. An error `decide`
// throws is re-thrown unchanged (lock released, nothing appended) — it is the
// caller's refusal, never a `tally` step-down.
function resolveUnderTally({
  sessionDir, name, decide, env,
  waitMs = TALLY_LOCK_WAIT_MS,
  readTally = (p) => fs.readFileSync(p, 'utf8'),
  appendTally = (p, line) => fs.appendFileSync(p, line),
  now = () => new Date(),
}) {
  const refused = { ok: false, reason: 'tally' };
  const real = canonicalRealpath(sessionDir);
  if (real === null || lstatType(real).type !== 'directory') return refused;
  const tallyPath = path.join(sessionDir, TALLY_FILE);

  const critical = () => {
    let text;
    try {
      text = readTally(tallyPath);
    } catch (e) {
      if (!e || e.code !== 'ENOENT') return refused;
      text = '';
    }
    const result = decide(countUses(text, name));
    if (result && result.model !== undefined) {
      try {
        appendTally(tallyPath, `${name}\t${now().toISOString()}\n`);
      } catch (_e) {
        return refused;
      }
    }
    return { ok: true, result };
  };

  try {
    return withLock(path.join(sessionDir, LOCK_DIR), critical, { failClosed: true, env, waitMs, createParent: false });
  } catch (e) {
    if (e && e.code === 'LOCK_TIMEOUT') return refused;
    throw e;
  }
}

module.exports = { TALLY_FILE, LOCK_DIR, TALLY_LOCK_WAIT_MS, countUses, resolveUnderTally };
