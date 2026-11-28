'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  decideRedTip,
  dedupeNewestByName,
  parseCheckRunLines,
  redTipCheck,
} = require('../../../plugin/bin/lib/reconcile/red-tip');

// --- dedupeNewestByName: highest id per name wins ---

test('dedupeNewestByName: two runs same name, highest id wins', () => {
  const runs = [
    { id: 10, name: 'ci/tests', conclusion: 'failure' },
    { id: 12, name: 'ci/tests', conclusion: 'success' },
  ];
  const byName = dedupeNewestByName(runs);
  assert.strictEqual(byName.size, 1);
  assert.strictEqual(byName.get('ci/tests').conclusion, 'success');
});

test('dedupeNewestByName: distinct names both kept', () => {
  const runs = [
    { id: 1, name: 'ci/a', conclusion: 'success' },
    { id: 2, name: 'ci/b', conclusion: 'failure' },
  ];
  const byName = dedupeNewestByName(runs);
  assert.strictEqual(byName.size, 2);
});

test('dedupeNewestByName: empty/null-ish input never throws', () => {
  assert.strictEqual(dedupeNewestByName([]).size, 0);
  assert.strictEqual(dedupeNewestByName(undefined).size, 0);
  assert.strictEqual(dedupeNewestByName([null, { id: 1, name: 'x', conclusion: 'success' }]).size, 1);
});

// --- decideRedTip: AC1-AC3 ---

test('decideRedTip: AC1 single failure -> finding naming branch, short sha, check name', () => {
  const r = decideRedTip({
    branch: 'main',
    sha: '0123456789abcdef0123456789abcdef01234567',
    checkRuns: [{ id: 1, name: 'ci/tests', conclusion: 'failure' }],
  });
  assert.ok(r);
  assert.strictEqual(r.branch, 'main');
  assert.strictEqual(r.sha, '0123456789abcdef0123456789abcdef01234567');
  assert.deepStrictEqual(r.failing, ['ci/tests']);
  assert.match(r.message, /^CI is red on main tip at 0123456 — ci\/tests$/);
});

test('decideRedTip: AC1 multi-failure lists first 3 then "+N more"', () => {
  const checkRuns = ['ci/a', 'ci/b', 'ci/c', 'ci/d', 'ci/e'].map((name, i) => ({ id: i + 1, name, conclusion: 'failure' }));
  const r = decideRedTip({ branch: 'main', sha: 'deadbeef00000000000000000000000000000000', checkRuns });
  assert.strictEqual(r.failing.length, 5);
  assert.match(r.message, /ci\/a, ci\/b, ci\/c \+2 more$/);
});

test('decideRedTip: timed_out is also red', () => {
  const r = decideRedTip({ branch: 'main', sha: 'a'.repeat(40), checkRuns: [{ id: 1, name: 'ci/slow', conclusion: 'timed_out' }] });
  assert.ok(r);
});

test('decideRedTip: AC2 rerun dedup — failed then newer success on same name -> no finding', () => {
  const r = decideRedTip({
    branch: 'main',
    sha: 'b'.repeat(40),
    checkRuns: [
      { id: 5, name: 'ci/tests', conclusion: 'failure' },
      { id: 9, name: 'ci/tests', conclusion: 'success' },
    ],
  });
  assert.strictEqual(r, null);
});

test('decideRedTip: AC3 green -> no finding', () => {
  assert.strictEqual(decideRedTip({ branch: 'main', sha: 'c'.repeat(40), checkRuns: [{ id: 1, name: 'ci/tests', conclusion: 'success' }] }), null);
});

test('decideRedTip: AC3 pending-only (in_progress/queued conclusions are null) -> no finding', () => {
  assert.strictEqual(decideRedTip({ branch: 'main', sha: 'd'.repeat(40), checkRuns: [{ id: 1, name: 'ci/tests', conclusion: null }] }), null);
});

test('decideRedTip: AC3 empty (no CI) -> no finding', () => {
  assert.strictEqual(decideRedTip({ branch: 'main', sha: 'e'.repeat(40), checkRuns: [] }), null);
});

test('decideRedTip: excluded conclusions (cancelled, neutral, stale, action_required, skipped) are never red', () => {
  for (const conclusion of ['cancelled', 'neutral', 'stale', 'action_required', 'skipped']) {
    const r = decideRedTip({ branch: 'main', sha: 'f'.repeat(40), checkRuns: [{ id: 1, name: 'ci/x', conclusion }] });
    assert.strictEqual(r, null, `${conclusion} must not be red`);
  }
});

// --- parseCheckRunLines: pagination path (multiple lines = multiple pages'
// worth of gh api -q output concatenated) ---

test('parseCheckRunLines: multiple NDJSON lines (simulating >1 paginated page) all parse', () => {
  const stdout = [
    '{"id":1,"name":"ci/a","conclusion":"success"}',
    '{"id":2,"name":"ci/b","conclusion":"failure"}',
    '{"id":3,"name":"ci/c","conclusion":null}',
  ].join('\n') + '\n';
  const r = parseCheckRunLines(stdout);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.runs.length, 3);
  assert.strictEqual(r.runs[1].name, 'ci/b');
});

test('parseCheckRunLines: empty stdout -> ok, zero runs', () => {
  const r = parseCheckRunLines('');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.runs, []);
});

test('parseCheckRunLines: garbage line -> unparseable-response', () => {
  const r = parseCheckRunLines('not json\n');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'unparseable-response');
});

// --- redTipCheck: I/O wrapper, gh-independent degrade path only (no live-gh
// mocking convention exists in this suite — same scope
// tests/hooks-session-start.test.js's #413 console test accepts) ---

const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { initRepo } = require('../../helpers/git-fixtures');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('redTipCheck: no origin/{integration} ref reachable (git rev-parse fails) -> null, never throws', () => {
  const dir = scratchDir('red-tip-');
  initRepo(dir, { branch: 'main', name: 't', email: 't@t' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-q', '-m', 'init');
  // No 'origin' remote at all -> origin/main cannot resolve.
  assert.strictEqual(redTipCheck(dir, 'main'), null);
});
