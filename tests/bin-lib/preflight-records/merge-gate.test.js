'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MERGE_STATE_RE, mergeStateDemands, planMergeGateSplit,
} = require('../../../plugin/bin/lib/preflight-records/merge-gate');

const issue = (number, body) => ({ number, title: `T${number}`, body, labels: [] });
function fixture(entries) {
  const issues = new Map(entries.map(([n, body]) => [n, issue(n, body)]));
  return issues;
}

test('MERGE_STATE_RE: strict integration-branch merge-state forms match; content-satisfiable forms do not', () => {
  for (const s of [
    'confirm `#2670` and `#2681` are actually merged (not merely `CLOSED`)',
    'must be merged to the integration branch before starting',
    'After #1811 merges to `main`, re-confirm',
    'once #12 is merged into main',
    'until it is merged to origin/main',
  ]) assert.match(s, MERGE_STATE_RE, s);
  for (const s of [
    '| #620 | deferral gate contract | must be merged first |',
    'do not start until #533 is merged',
    'Batch ledger drills, gated on the merged ceiling',
    "extend the fallback to recognize `byNumber.state === 'MERGED'`",
    'must be merged into this leaf\'s build base',
  ]) assert.doesNotMatch(s, MERGE_STATE_RE, s);
});

test('mergeStateDemands: only Deliverables/Prerequisites lines, only candidate refs, code-span refs count', () => {
  const body = [
    '## Current State', 'Once #10 is actually merged this matters.',
    '## Deliverables (Phase 1)', '### Sub-heading stays in section',
    '- [ ] confirm `#10` is actually merged before touching anything',
    '- [ ] #11 is actually merged too (not a candidate)',
    '## Gotchas', '- #10 must be merged to the integration branch (outside the section)',
  ].join('\r\n');
  const got = mergeStateDemands(body, [10]);
  assert.deepEqual(got.map((d) => d.requires), [10]);
  assert.match(got[0].line, /confirm `#10` is actually merged/);
});

test('mergeStateDemands: a Prerequisites table row with the strict form gates its named prerequisite', () => {
  const body = ['## Prerequisites', '| Spec | Title | Status |', '|---|---|---|',
    '| #528 | routine-kickoff wrapper skill | must be merged to the integration branch before starting |'].join('\n');
  assert.deepEqual(mergeStateDemands(body, [528, 529]).map((d) => d.requires), [528]);
});

test('AC2.1: planMergeGateSplit: #2682 shape — gated target and its in-run dependent deferred, independent kept, rerun composed', () => {
  const issues = fixture([
    [2670, '## Deliverables\n- [ ] do the thing'],
    [2682, '## Deliverables\n- [ ] confirm `#2670` is actually merged (not merely CLOSED)'],
    [2690, '## Deliverables\n- [ ] builds on #2682'],
    [2700, '## Deliverables\n- [ ] unrelated'],
  ]);
  const records = {
    2670: { blockedBy: [] }, 2682: { blockedBy: [2670] }, 2690: { blockedBy: [2682] }, 2700: { blockedBy: [] },
  };
  const split = planMergeGateSplit({ issues, records, numbers: [2670, 2682, 2690, 2700] });
  assert.deepEqual(split.gates, [{ record: 2682, requires: [2670], line: '- [ ] confirm `#2670` is actually merged (not merely CLOSED)' }]);
  assert.deepEqual(split.deferred, [2682, 2690]);
  assert.deepEqual(split.kept, [2670, 2700]);
  assert.equal(split.rerun, '/claude-tweaks:flow #2682,#2690');
});

test('planMergeGateSplit: generic "must be merged first" decomposition family proceeds — nothing deferred', () => {
  const issues = fixture([
    [620, '## Deliverables\n- [ ] contract'],
    [621, '## Prerequisites\n| #620 | deferral gate contract | must be merged first |'],
  ]);
  const records = { 620: { blockedBy: [] }, 621: { blockedBy: [620] } };
  const split = planMergeGateSplit({ issues, records, numbers: [620, 621] });
  assert.deepEqual(split, { gates: [], deferred: [], kept: [620, 621], rerun: null });
});

test('planMergeGateSplit: strict line naming a blocker NOT in the run, or an in-run record that is NOT a blocker, gates nothing', () => {
  const issues = fixture([
    [1, '## Deliverables\n- [ ] confirm #99 is actually merged'],
    [2, '## Deliverables\n- [ ] confirm #1 is actually merged'],
  ]);
  const records = { 1: { blockedBy: [99] }, 2: { blockedBy: [] } };
  const split = planMergeGateSplit({ issues, records, numbers: [1, 2] });
  assert.deepEqual(split.deferred, []);
  assert.deepEqual(split.kept, [1, 2]);
});
