'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planBatch } = require('../../../plugin/bin/lib/console/backfill-dispose');
const { fingerprintFromBasis } = require('../../../plugin/bin/lib/health-core/fingerprint');

const MAIN_SHA = '0123456789abcdef0123456789abcdef01234567';
const CONSOLE_DIR = '/x/pipelines/2026-10-24T090000-spec-12';
const findingItem = (over = {}) => ({
  itemId: 'bf:0000000000000001', itemHash: 'h1', kind: 'finding', section: 'Low-confidence findings', consoleDir: CONSOLE_DIR, storedIndices: [0],
  finding: { lens: '3a', path: 'plugin/skills/review/SKILL.md', line: 9, reporterSeverity: 'medium', kind: 'unconfirmed' },
  claimText: 'The guard runs after the read', context: '- STAGED 10:00:00 — whatever', ...over,
});
const EVIDENCE = { path: 'plugin/skills/review/SKILL.md', line: 12, quote: 'guard(x); read(x);' };
const confirmed = () => ({ outcome: 'confirmed', severity: 'medium', evidence: EVIDENCE, reason: 'confirmed by tiebreak', recommendation: null });
const backfillFingerprint = (itemId) => fingerprintFromBasis('consolebackfill', [itemId]);
const workList = (...runs) => ({ mainSha: MAIN_SHA, runs: runs.map((items, i) => ({ runDir: `/x/pipelines/archive/run-${i}`, items })) });

test('a twin of an unverdicted item matched by its item marker reuses that record', () => {
  const a = findingItem({ itemId: 'bf:00000000000000p1', itemHash: 'hp1', claimText: 'The guard runs after the read, as a later cleaner leaves it' });
  const b = { ...a, itemId: 'bf:00000000000000p2', itemHash: 'hp2' };
  const existingIssues = [{ number: 4190, title: 'x', body: `Some record.\n<!-- work-fingerprint: ${backfillFingerprint(a.itemId)} -->` }];
  const out = planBatch({ workList: workList([a, b]), verdicts: { [b.itemId]: confirmed() }, existingIssues, digestComments: [] });
  assert.deepStrictEqual(out.reuse.find((r) => r.itemId === a.itemId).number, 4190);
  assert.deepStrictEqual(out.file, [], 'B must not be filed as a new record');
});
