'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { sessionTmpPath } = require('../plugin/bin/lib/session-tmp');

// A bare-drain firing's own re-selection guard: a group whose attempt this
// firing did not end in a live-held or resolved disposition (claim-contest/
// in-flight pre-flight stop, or an ordinary build/test failure before the
// retry ceiling) keeps exactly the labels it had before the attempt --
// `settle-and-merge.md`'s Claim-contest special case adds neither `bot:*`
// label nor releases anything to release. Without an explicit exclusion,
// the very next iteration of the *same* firing re-ranks the identical group
// back to the top and reproduces the identical stop. This test extracts and
// runs the actual `next-ranking.md` script (not a reimplementation) against
// synthetic group data, proving a `reason: 'firing'` entry in the unified
// `dispatch-exclusions.json` (#1752; formerly its own dispatch-firing-
// excluded.json file) is read and actually changes the pick.

const ROOT = path.join(__dirname, '..');
const NEXT_RANKING = fs.readFileSync(
  path.join(ROOT, 'plugin', 'skills', 'dispatch', 'next-ranking.md'),
  'utf8',
);

function extractSnippet() {
  const m = NEXT_RANKING.match(/```bash\n([\s\S]*?)\n```/);
  assert.ok(m, 'next-ranking.md must have a fenced bash block -- extraction pattern is out of sync with the doc');
  return m[1];
}

const SNIPPET = extractSnippet();

function group(number, { priority = null, createdAt = '2026-01-01T00:00:00Z' } = {}) {
  return [{ number, facets: { priority }, createdAt }];
}

// Runs the real next-ranking.md snippet against a fresh session-scoped temp
// root (so concurrent test runs never collide), writing the given fixture
// inputs first. Returns the parsed dispatch-next-pick.json content.
//
// #1752: oversizedExcluded/firingExcluded are still this test's own fixture
// vocabulary (unchanged from before the unification) -- only how they reach
// the snippet changed, from two separate files to one dispatch-exclusions.json
// composed of {reason, records, detail} entries.
function runRanking({ groups, oversizedExcluded = [], firingExcluded, priorityFilter = '' }) {
  const sessionId = `dispatch-firing-excl-test-${crypto.randomBytes(6).toString('hex')}`;
  fs.writeFileSync(sessionTmpPath(sessionId, 'dispatch-groups.json'), JSON.stringify(groups));
  const entries = oversizedExcluded.map((o) => ({ reason: 'oversized', records: o.records, detail: { size: o.size, threshold: o.threshold } }));
  if (firingExcluded !== undefined) {
    entries.push(...firingExcluded.map((n) => ({ reason: 'firing', records: [n], detail: null })));
  }
  fs.writeFileSync(sessionTmpPath(sessionId, 'dispatch-exclusions.json'), JSON.stringify(entries));
  execFileSync('bash', ['-c', SNIPPET], {
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT || path.join(ROOT, 'plugin'),
      CLAUDE_CODE_SESSION_ID: sessionId,
      PRIORITY_FILTER: priorityFilter,
    },
    timeout: 30000,
  });
  const pickPath = sessionTmpPath(sessionId, 'dispatch-next-pick.json');
  return JSON.parse(fs.readFileSync(pickPath, 'utf8'));
}

test('no firing-reason exclusions present ranks normally -- backward compatible', () => {
  const pick = runRanking({
    groups: [group(100, { priority: 'high' }), group(300, { priority: 'low' })],
  });
  assert.ok(pick, 'expected a pick, got null');
  assert.strictEqual(pick[0].number, 100);
});

test('a group with a reason:\'firing\' exclusion entry is skipped in favor of the next-ranked candidate', () => {
  const pick = runRanking({
    groups: [
      group(100, { priority: 'high', createdAt: '2026-01-01T00:00:00Z' }),
      group(200, { priority: 'high', createdAt: '2026-01-02T00:00:00Z' }),
      group(300, { priority: 'low', createdAt: '2026-01-01T00:00:00Z' }),
    ],
    firingExcluded: [100],
  });
  assert.ok(pick, 'expected a pick, got null');
  assert.strictEqual(pick[0].number, 200, 'excluded #100 must not be re-picked; #200 is the next-highest-priority, oldest-eligible candidate');
});

test('every remaining candidate excluded this firing yields null, not a re-pick of an excluded group', () => {
  const pick = runRanking({
    groups: [group(100, { priority: 'high' }), group(200, { priority: 'medium' })],
    firingExcluded: [100, 200],
  });
  assert.strictEqual(pick, null);
});

test('exclusion matches by any member of a bundle group, not just a lone singleton', () => {
  const bundleGroup = [
    { number: 833, facets: { priority: 'high' }, createdAt: '2026-01-01T00:00:00Z' },
    { number: 834, facets: { priority: 'high' }, createdAt: '2026-01-01T00:00:00Z' },
  ];
  const pick = runRanking({
    groups: [bundleGroup, group(900, { priority: 'low' })],
    // Excluding only #834 (not #833) must still drop the whole bundle --
    // a group is claimed/released as a unit, never half-excluded.
    firingExcluded: [834],
  });
  assert.ok(pick, 'expected a pick, got null');
  assert.strictEqual(pick[0].number, 900, 'the bundle containing excluded #834 must be dropped entirely, not just its excluded member');
});

test('firing-exclusion and the oversized-group guard compose -- both filters apply together', () => {
  const pick = runRanking({
    groups: [
      group(100, { priority: 'high' }),
      group(200, { priority: 'high', createdAt: '2026-01-02T00:00:00Z' }),
      group(300, { priority: 'low' }),
    ],
    oversizedExcluded: [{ records: [100], size: 11, threshold: 10 }],
    firingExcluded: [200],
  });
  assert.ok(pick, 'expected a pick, got null');
  assert.strictEqual(pick[0].number, 300, '#100 excluded as oversized, #200 excluded as this-firing-excluded -- only #300 remains');
});
