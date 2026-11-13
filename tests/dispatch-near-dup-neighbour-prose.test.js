// tests/dispatch-near-dup-neighbour-prose.test.js
//
// Pins record #3520's prose (AC6): dispatch's Step 3 near-duplicate paragraph no
// longer calls the cross-group pass "warning only, never a gate" -- weak pairs
// warn, strong pairs feed the neighbour-in-flight guard and the explicit-list
// predicted-conflict line. The templates named here are the ones the sub-files
// give; bin/lib/dispatch/near-dup-pairs.js is exercised in tests/bin-lib/dispatch/.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { rankNext } = require('../plugin/bin/lib/dispatch/queue-pull');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const collapse = (s) => s.replace(/\s+/g, ' ');

const SKILL = read('plugin/skills/dispatch/SKILL.md');
const PAIRS = read('plugin/skills/dispatch/near-duplicate-pairs.md');
const REPORT = read('plugin/skills/dispatch/neighbour-in-flight-report.md');
const REPORTING = read('plugin/skills/dispatch/reporting.md');
const DOCS = read('docs/plugin-structure.md');

const PREDICTED_LINE = '`#{A} / #{B} predicted to conflict (near-duplicate: {signals}; shared: {sharedAnchors}); dispatch order #{A} then #{B}, merge #{A} first`';
const DECISION_LINE = 'AUTO {time} — dispatch: predicted conflict #{A} / #{B} (near-duplicate: {signals}); merge #{A} first. Reversibility: n/a.';

function nearDupParagraph() {
  const start = SKILL.indexOf('**Near-duplicate candidate warning (refs #1944).**');
  assert.ok(start !== -1, 'the paragraph heading is present');
  const next = SKILL.indexOf('\n**', start + 5);
  return collapse(SKILL.slice(start, next === -1 ? undefined : next));
}

test('SKILL.md Step 3 near-duplicate paragraph is no longer warning-only, cites #3520 and near-duplicate-pairs.md', () => {
  const para = nearDupParagraph();
  assert.doesNotMatch(para, /Warning\s+only, never a gate/);
  assert.match(para, /#3520/);
  assert.match(para, /near-duplicate-pairs\.md/);
  assert.match(para, /strong/);
  assert.match(para, /weak/);
});

test('SKILL.md explicit-list bullet delegates the predicted-conflict line to near-duplicate-pairs.md', () => {
  const start = SKILL.indexOf('**`#N[,#M,#O...]`**');
  assert.ok(start !== -1, 'the explicit-list bullet is present');
  const bullet = collapse(SKILL.slice(start, SKILL.indexOf('\n### Step 4', start)));
  assert.match(bullet, /near-duplicate-pairs\.md/);
  assert.match(bullet, /both still dispatch/);
});

test('near-duplicate-pairs.md carries both predicted-conflict templates verbatim and names its inputs', () => {
  const flat = collapse(PAIRS);
  assert.ok(flat.includes(collapse(PREDICTED_LINE)), 'printed line template');
  assert.ok(flat.includes(collapse(DECISION_LINE)), 'decisions.md line template');
  assert.match(PAIRS, /predictedConflicts/);
  assert.match(PAIRS, /dispatch-near-dup-pairs\.json/);
  // #5230: the path comes from session-tmp-resolve.js directly; the CLI pull sets no
  // $DISPATCH_NEAR_DUP_PAIRS and the session never reads queue-pull-script.md for it.
  assert.ok(PAIRS.includes('`node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-near-dup-pairs.json`'), 'the path resolve');
  assert.doesNotMatch(PAIRS, /queue-pull-script\.md|DISPATCH_NEAR_DUP_PAIRS/);
});

test('neighbour-in-flight-report.md renders a near-duplicate neighbour and keeps the file form', () => {
  assert.ok(collapse(REPORT).includes('#{m} (near-duplicate: {signals}; shared: {sharedAnchors})'));
  assert.ok(collapse(REPORT).includes('#{m} ({files})'));
});

test('reporting.md carries the group predicted-conflict line', () => {
  assert.ok(collapse(REPORTING).includes('predicted conflict with #{partner} (PR #{pr}) — merge #{first} first'));
});

// #5230: the `next` ranking is the queue-pull module's rankNext; the group shape is
// queue-pull.test.js's RANK_CASES neighbour case (a high group, a medium one).
test('the next ranking skips a group whose neighbour-in-flight entry names a strong near-duplicate neighbour (#3520)', () => {
  const rec = (number, priority, createdAt) => ({ number, createdAt, facets: { priority } });
  const highOld = [rec(2, 'high', '2026-02-01T00:00:00Z')];
  const med = [rec(3, 'medium', '2026-01-01T00:00:00Z')];
  const nearDupNeighbour = {
    reason: 'neighbour-in-flight',
    records: [2],
    detail: { neighbours: [{ number: 9, files: [], signals: ['body-anchor-overlap'], sharedAnchors: ['alpha.one', 'beta.two'] }] },
  };
  assert.deepEqual(rankNext([highOld, med], [], {}), highOld, 'control: with no entry the high group is picked');
  assert.deepEqual(rankNext([highOld, med], [nearDupNeighbour], {}), med);
});

test('docs/plugin-structure.md names the new module and sub-file', () => {
  assert.match(DOCS, /near-dup-pairs\.js/);
  assert.match(DOCS, /near-duplicate-pairs\.md/);
});
