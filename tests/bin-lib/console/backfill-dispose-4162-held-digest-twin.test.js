'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { planBatch } = require('../../../plugin/bin/lib/console/backfill-dispose');

const MAIN_SHA = '0123456789abcdef0123456789abcdef01234567';
const CONSOLE_DIR = '/x/pipelines/2026-10-24T090000-spec-12';
const findingItem = (over = {}) => ({
  itemId: 'bf:0000000000000001', itemHash: 'h1', kind: 'finding', section: 'Low-confidence findings', consoleDir: CONSOLE_DIR, storedIndices: [0],
  finding: { lens: '3a', path: 'plugin/skills/review/SKILL.md', line: 9, reporterSeverity: 'medium', kind: 'unconfirmed' },
  claimText: 'The guard runs after the read', context: '- STAGED 10:00:00 — whatever', ...over,
});
const digestV = { outcome: 'digest', severity: 'low', evidence: null, reason: 'verdict:cant-tell', recommendation: null };
const workList = (...runs) => ({ mainSha: MAIN_SHA, runs: runs.map((items, i) => ({ runDir: `/x/pipelines/archive/run-${i}`, items })) });
const plan = (over) => planBatch({ workList: workList([]), verdicts: {}, existingIssues: [], digestComments: [], ...over });

test('a twin of a digest item held by its item marker is a duplicate, not a second line', () => {
  const a = findingItem({ itemId: 'bf:00000000000000q1', itemHash: 'hq1', claimText: 'The guard runs after the read' });
  const pass1 = plan({ workList: workList([a]), verdicts: { [a.itemId]: digestV } });
  assert.strictEqual(pass1.digest.lines.length, 1);
  const digestComments = [{ body: pass1.digest.lines[0], authorAssociation: 'OWNER', url: 'https://x/issues/1426#issuecomment-1' }];
  const newClaim = 'the guard runs after the read (as a later cleaner leaves it)';
  const aAfter = { ...a, claimText: newClaim };
  const bAfter = findingItem({ itemId: 'bf:00000000000000q2', itemHash: 'hq2', claimText: newClaim });
  const out = plan({ workList: workList([aAfter, bAfter]), verdicts: { [aAfter.itemId]: digestV, [bAfter.itemId]: digestV }, digestComments });
  assert.ok(out.digest.duplicates.includes(aAfter.itemId), 'precondition: A is held by its item marker');
  assert.deepStrictEqual(out.digest.lines, [], 'no second digest line for B');
});
