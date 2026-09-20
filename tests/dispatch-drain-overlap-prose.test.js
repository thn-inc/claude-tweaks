// tests/dispatch-drain-overlap-prose.test.js
//
// Pins record #1985's prose wiring: dispatch/SKILL.md Step 5 must record
// each dispatched group's own PR into a session-scoped drain-PR list; Step 4
// must re-check every subsequent group against the union of the pre-drain
// snapshot and that list, logging a STAGED line attributed to the drain;
// settle-and-merge.md's Auto-merge gate must hold on a still-open drain
// overlap before merge-check; cross-pr-overlap-report.md must document both
// new invocations while leaving the pre-drain report unchanged. The
// mechanical half (detectCrossPRFileOverlap's additive source attribution)
// is pinned separately in tests/bin-lib/issues/grouping.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const DISPATCH_SKILL = read('plugin/skills/dispatch/SKILL.md');
const SETTLE_AND_MERGE = read('plugin/skills/dispatch/settle-and-merge.md');
const CROSS_PR_REPORT = read('plugin/skills/dispatch/cross-pr-overlap-report.md');
const DRAIN_PR_OVERLAP = read('plugin/skills/dispatch/drain-pr-overlap.md');

test('Step 5 points to drain-pr-overlap.md\'s Step 5 section for recording each group\'s own PR', () => {
  assert.match(DISPATCH_SKILL, /Record this group's own PR into the firing's drain-PR list \(refs #1985\)/);
  assert.match(DISPATCH_SKILL, /drain-pr-overlap\.md/);
  assert.match(DRAIN_PR_OVERLAP, /dispatch-drain-prs\.json/);
  assert.match(DRAIN_PR_OVERLAP, /gh pr view \{n\} --json number,files,closingIssuesReferences/);
  assert.match(DRAIN_PR_OVERLAP, /never a repeated `gh pr list`/);
});

test('Step 4 points to drain-pr-overlap.md\'s Step 4 section, which re-checks against the union of pre-drain + drain PRs, tagging source: drain', () => {
  assert.match(DISPATCH_SKILL, /Cross-PR overlap re-check against this drain's own in-flight PRs \(refs #1985\)/);
  assert.match(DRAIN_PR_OVERLAP, /detectCrossPRFileOverlap/);
  assert.match(DRAIN_PR_OVERLAP, /source: 'drain'/);
  assert.match(DRAIN_PR_OVERLAP, /\(opened by this drain, group \{k\}\)/);
  assert.match(DRAIN_PR_OVERLAP, /STAGED \{time\} — dispatch: group \[\{issues\}\] overlaps drain PR/);
  assert.match(DRAIN_PR_OVERLAP, /Still a warning, never a gate/);
});

test('Step 4\'s re-check pointer runs before Mint this group\'s run directory', () => {
  const recheckIdx = DISPATCH_SKILL.indexOf('Cross-PR overlap re-check against this drain');
  const mintIdx = DISPATCH_SKILL.indexOf('**Mint this group\'s run directory.**');
  assert.ok(recheckIdx !== -1 && mintIdx !== -1);
  assert.ok(recheckIdx < mintIdx);
});

test('the Auto-merge gate points to drain-pr-overlap.md\'s hold section, which holds on a live drain overlap before merge-check and releases once the overlapping PR merges/closes', () => {
  assert.match(SETTLE_AND_MERGE, /Drain-overlap hold, before `merge-check`/);
  assert.match(SETTLE_AND_MERGE, /drain-pr-overlap\.md/);
  assert.match(DRAIN_PR_OVERLAP, /AUTO \{time\} — Auto-merge gate: group \[\{issues\}\] held — overlaps drain PR/);
  assert.match(DRAIN_PR_OVERLAP, /merge\s+order is a human call/);
  assert.match(DRAIN_PR_OVERLAP, /it is not a\s*persisted hold/);
  const holdIdx = SETTLE_AND_MERGE.indexOf('Drain-overlap hold, before');
  const authIdx = SETTLE_AND_MERGE.indexOf('1. **Authorization**');
  assert.ok(holdIdx !== -1 && authIdx !== -1 && holdIdx < authIdx, 'the hold pointer runs before Authorization/Content judgment');
});

test('cross-pr-overlap-report.md documents both new invocation sites and states the pre-drain report is unchanged', () => {
  assert.match(CROSS_PR_REPORT, /## Second and third invocation \(refs #1985\)/);
  assert.match(CROSS_PR_REPORT, /`dispatch\/SKILL\.md` Step 4/);
  assert.match(CROSS_PR_REPORT, /`dispatch\/settle-and-merge\.md`'s Auto-merge gate/);
  assert.match(CROSS_PR_REPORT, /byte-identical guarantee holds/);
});

test('the cited grouping.js primitive carries the additive source attribution', () => {
  const { detectCrossPRFileOverlap } = require('../plugin/bin/lib/issues/grouping');
  const overlaps = detectCrossPRFileOverlap(
    [{ number: 1, keyFiles: ['a.js'] }],
    [{ number: 2, files: ['a.js'], closingIssueNumbers: [], source: 'drain' }],
  );
  assert.strictEqual(overlaps[0].source, 'drain');
});
