'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { sessionTmpPath } = require('../plugin/bin/lib/session-tmp');

// A bare-drain firing's own re-selection guard: a group whose attempt this
// firing did not end in a live-held or resolved disposition (claim-contest/
// in-flight pre-flight stop, or an ordinary build/test failure before the
// retry ceiling) keeps exactly the labels it had before the attempt --
// `settle-and-merge.md`'s Claim-contest special case adds neither `bot:*`
// label nor releases anything to release. Without an explicit exclusion,
// the very next iteration of the *same* firing re-ranks the identical group
// back to the top and reproduces the identical stop. This test runs the
// `next` ranking through the CLI the skill calls (`bin/queue-pull.js --rank`,
// #5230) against synthetic group data, proving a `reason: 'firing'` entry in
// the unified `dispatch-exclusions.json` (#1752; formerly its own
// dispatch-firing-excluded.json file) is read and actually changes the pick.

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'plugin', 'bin', 'queue-pull.js');

function group(number, { priority = null, createdAt = '2026-01-01T00:00:00Z' } = {}) {
  return [{ number, facets: { priority }, createdAt }];
}

// Runs `queue-pull.js --rank` under a fresh session id (so concurrent test
// runs never collide), writing the given fixture inputs to that session's
// files first. Returns the parsed dispatch-next-pick.json content.
//
// #1752: oversizedExcluded/firingExcluded are still this test's own fixture
// vocabulary (unchanged from before the unification) -- only how they reach
// the ranking changed, from two separate files to one dispatch-exclusions.json
// composed of {reason, records, detail} entries.
function runRanking(t, { groups, oversizedExcluded = [], firingExcluded, extraEntries = [] }) {
  const sessionId = `dispatch-firing-excl-test-${crypto.randomBytes(6).toString('hex')}`;
  const groupsFile = sessionTmpPath(sessionId, 'dispatch-groups.json');
  t.after(() => fs.rmSync(path.dirname(groupsFile), { recursive: true, force: true }));
  fs.writeFileSync(groupsFile, JSON.stringify(groups));
  const entries = oversizedExcluded.map((o) => ({ reason: 'oversized', records: o.records, detail: { size: o.size, threshold: o.threshold } }));
  if (firingExcluded !== undefined) {
    entries.push(...firingExcluded.map((n) => ({ reason: 'firing', records: [n], detail: null })));
  }
  entries.push(...extraEntries);
  fs.writeFileSync(sessionTmpPath(sessionId, 'dispatch-exclusions.json'), JSON.stringify(entries));
  const r = spawnSync(process.execPath, [CLI, '--rank'], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: sessionId },
    timeout: 30000,
    windowsHide: true,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '', '--rank prints nothing; the pick lives in the file');
  return JSON.parse(fs.readFileSync(sessionTmpPath(sessionId, 'dispatch-next-pick.json'), 'utf8'));
}

test('no firing-reason exclusions present ranks normally -- backward compatible', (t) => {
  const pick = runRanking(t, {
    groups: [group(100, { priority: 'high' }), group(300, { priority: 'low' })],
  });
  assert.ok(pick, 'expected a pick, got null');
  assert.strictEqual(pick[0].number, 100);
});

test('a group with a reason:\'firing\' exclusion entry is skipped in favor of the next-ranked candidate', (t) => {
  const pick = runRanking(t, {
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

test('every remaining candidate excluded this firing yields null, not a re-pick of an excluded group', (t) => {
  const pick = runRanking(t, {
    groups: [group(100, { priority: 'high' }), group(200, { priority: 'medium' })],
    firingExcluded: [100, 200],
  });
  assert.strictEqual(pick, null);
});

test('exclusion matches by any member of a bundle group, not just a lone singleton', (t) => {
  const bundleGroup = [
    { number: 833, facets: { priority: 'high' }, createdAt: '2026-01-01T00:00:00Z' },
    { number: 834, facets: { priority: 'high' }, createdAt: '2026-01-01T00:00:00Z' },
  ];
  const pick = runRanking(t, {
    groups: [bundleGroup, group(900, { priority: 'low' })],
    // Excluding only #834 (not #833) must still drop the whole bundle --
    // a group is claimed/released as a unit, never half-excluded.
    firingExcluded: [834],
  });
  assert.ok(pick, 'expected a pick, got null');
  assert.strictEqual(pick[0].number, 900, 'the bundle containing excluded #834 must be dropped entirely, not just its excluded member');
});

test('firing-exclusion and the oversized-group guard compose -- both filters apply together', (t) => {
  const pick = runRanking(t, {
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

test('AC5.1: bare-drain ranking never selects a group with a neighbour-in-flight member (#3278)', (t) => {
  const pick = runRanking(t, {
    groups: [group(100, { priority: 'high' }), group(300, { priority: 'low' })],
    extraEntries: [{ reason: 'neighbour-in-flight', records: [100], detail: { neighbours: [{ number: 9, files: ['a.js'] }] } }],
  });
  assert.ok(pick, 'expected a pick');
  assert.strictEqual(pick[0].number, 300);
});
