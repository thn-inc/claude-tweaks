'use strict';
// The deferral-route run tally (#5933): `{run-dir}/deferral-route-tally.log`, one line per agent-raised
// final `file` verdict, `{ISO}\t{reason}\t{rule}\n`. The count is the number of non-empty lines, which is
// what the run-filed-record-cap policy key is compared against.
//
// Concurrency: the file is create-or-append with NO lock. The only write is a single `appendFileSync` of
// one line, and each such append is atomic on a local filesystem. The count-then-append sequence in the
// caller is not: parallel callers can each read the count before any of them appends, so under
// concurrency the cap is best-effort and a run can file up to the cap plus the number of simultaneous
// callers.
//
// The file is private to `deferral-route.js`; nothing else reads or writes it.
//
// `reason` and `rule` must come from closed vocabularies (`DEFER_REASONS`, `RULES`): `tallyLine` does not
// defend against a tab or newline in them, and a newline would split one verdict into two counted lines.
//
// Absence is `ENOENT` alone (a missing tally counts 0). Any other read error, and every append error,
// is rethrown for the caller to fail loud: a swallowed error would read as 0 and under-count the cap.
const fs = require('fs');
const path = require('path');

const TALLY_FILE = 'deferral-route-tally.log';

function readTallyCount(runDir, { fsImpl = fs } = {}) {
  let text;
  try {
    text = fsImpl.readFileSync(path.join(runDir, TALLY_FILE), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return 0;
    throw err;
  }
  return text.split('\n').filter((line) => line.trim() !== '').length;
}

function tallyLine({ reason, rule, now }) {
  return `${now.toISOString()}\t${reason}\t${rule}\n`;
}

function appendTally(runDir, { reason, rule, now = new Date() }, { fsImpl = fs } = {}) {
  fsImpl.appendFileSync(path.join(runDir, TALLY_FILE), tallyLine({ reason, rule, now }));
}

module.exports = { TALLY_FILE, readTallyCount, tallyLine, appendTally };
