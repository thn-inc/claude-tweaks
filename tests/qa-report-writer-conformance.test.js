'use strict';
// #3328: pins qa-reporting.md's Phase 5 routing of report.json through
// bin/qa-report.js (the deterministic writer) and Phase 4's story-bug routing
// via the results payload's `category`. Each claim matches the live prose AND
// fails against the frozen pre-change text, so a green run proves the pattern
// can go red [IL-105].
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const REPORTING_FULL = readText(path.join(ROOT, 'plugin/skills/test/qa-reporting.md'));
// The Phase 5 pins read only the Phase 5 section, so a call relocated elsewhere in the file goes red.
const PHASE5_AT = REPORTING_FULL.indexOf('## Phase 5: Report');
const PHASE5_END = REPORTING_FULL.indexOf('## Phase 5.5');
assert.ok(PHASE5_AT >= 0 && PHASE5_END > PHASE5_AT, 'Phase 5 section boundaries must be found');
const PHASE5 = REPORTING_FULL.slice(PHASE5_AT, PHASE5_END);

// Pre-change Phase 4 classification intro (qa-reporting.md before #3328).
const PRE_PHASE4 = 'After collecting all agent reports, classify each failure into one of 5 categories using heuristic rules. Classification is automated — override categories in the findings table if needed.';
// Pre-change Phase 5 item 25 lead through the Canonical schema sentence (qa-reporting.md before #3328).
const PRE_PHASE5 = '25. Write report artifacts to disk:\n\n**`{RUN_DIR}/report.json`** — machine-readable:\n\n**Canonical schema.** The `page_inventories` array below (`interactive_elements`/`forms`/`navigation`/`accessibility`/`layout`) re-specifies the same nested shape declared canonical by `agents/qa-agent.md`\'s `## Report` section — this file\'s `page_inventories` block must be kept byte-for-byte in sync with it.';

function pinned(live, control, pattern, msg) {
  assert.match(live, pattern, msg);
  assert.doesNotMatch(control, pattern, 'pattern must NOT match the pre-change text (proves it can go red)');
}

test('Phase 5 invokes the report.json writer', () => {
  pinned(
    PHASE5,
    PRE_PHASE5,
    /bin\/qa-report\.js" --results "\{RUN_DIR\}\/story-results\.json" --out "\{RUN_DIR\}\/report\.json"/,
    'Phase 5 must run qa-report.js with --results and --out',
  );
});

test('report.json is never hand-composed', () => {
  pinned(PHASE5, PRE_PHASE5, /never compose or hand-edit `report\.json`/, 'Phase 5 must forbid hand-composing report.json');
});

test('the writer runs before the QA pass stamp write', () => {
  const writerAt = PHASE5.indexOf('bin/qa-report.js" --results');
  const stampAt = PHASE5.indexOf('bin/qa-stamp.js" --write');
  assert.ok(writerAt >= 0, 'the writer invocation must be present');
  assert.ok(stampAt >= 0, 'the stamp write must be present');
  assert.ok(writerAt < stampAt, 'report.json must be written before the stamp reads it');
});

test("story-bug is routed through the results payload's category", () => {
  pinned(
    REPORTING_FULL,
    PRE_PHASE4,
    /`category`[^\n]{0,200}story-bug|story-bug[^\n]{0,200}`category`/,
    'Phase 4 must say story-bug is recorded as the story\'s `category` in the results payload',
  );
});
