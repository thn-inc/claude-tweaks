'use strict';
// tests/bin-lib/wrap-up/ledger-write.test.js — #2546: the write half of the
// pipeline ledger. resolveLedgerPath's run-dir-first/docs-plans-fallback
// resolution, and flipLedgerRow's in-place Status/Resolution cell rewrite.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  TERMINAL_STATUSES, resolveLedgerPath, parseLedgerTable, flipLedgerRow,
} = require('../../../plugin/bin/lib/wrap-up/ledger-write');

const SAMPLE = [
  '# Open Items — Sample',
  '',
  '| # | Phase | Item | Status | Resolution |',
  '|---|-------|------|--------|------------|',
  '| 1 | build | First item | open | — |',
  '| 2 | test | Second item | open | — |',
  '| 3 | review | Third item | fixed | Already fixed — abc1234 |',
  '',
].join('\n');

test('resolveLedgerPath prefers {run-dir}/ledger.md when it exists', () => {
  const deps = { existsSync: (p) => p === path.join('/run', 'ledger.md') };
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', deps });
  assert.deepStrictEqual(r, { ok: true, path: path.join('/run', 'ledger.md') });
});

test('resolveLedgerPath falls back to a single docs/plans/*-ledger.md candidate', () => {
  const deps = {
    existsSync: () => false,
    readdirSync: () => ['2026-01-01-foo-ledger.md', 'other.md'],
  };
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', deps });
  assert.strictEqual(r.ok, true);
  assert.match(r.path, /2026-01-01-foo-ledger\.md$/);
});

test('resolveLedgerPath reports not-found when neither location has a ledger', () => {
  const deps = { existsSync: () => false, readdirSync: () => [] };
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', deps });
  assert.deepStrictEqual(r, { ok: false, reason: 'not-found', candidates: [] });
});

test('resolveLedgerPath reports ambiguous with every candidate when 2+ exist, never guesses', () => {
  const deps = {
    existsSync: () => false,
    readdirSync: () => ['a-ledger.md', 'b-ledger.md'],
  };
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', deps });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'ambiguous');
  assert.strictEqual(r.candidates.length, 2);
});

test('resolveLedgerPath honors an explicit ledger path inside the worktree', () => {
  const deps = { existsSync: (p) => p === '/wt/docs/plans/x-ledger.md', realpathSync: (p) => path.resolve(p) };
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', explicit: '/wt/docs/plans/x-ledger.md', deps });
  assert.deepStrictEqual(r, { ok: true, path: '/wt/docs/plans/x-ledger.md' });
});

test('resolveLedgerPath rejects an explicit path outside the run dir and worktree', () => {
  const deps = { existsSync: () => true, realpathSync: (p) => path.resolve(p) };
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', explicit: '/elsewhere/ledger.md', deps });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'rejected');
});

test('resolveLedgerPath rejects an explicit path whose symlink resolves outside the run dir and worktree', () => {
  const deps = { existsSync: () => true, realpathSync: (p) => path.resolve(p === '/wt/ledger.md' ? '/etc/ledger.md' : p) };
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', explicit: '/wt/ledger.md', deps });
  assert.strictEqual(r.reason, 'rejected');
});

test('resolveLedgerPath rejects an explicit path not named like a ledger', () => {
  const deps = { existsSync: () => true, realpathSync: (p) => p };
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', explicit: '/wt/package.json', deps });
  assert.strictEqual(r.reason, 'rejected');
});

test('resolveLedgerPath with an explicit path that does not exist reports not-found naming it', () => {
  const deps = { existsSync: () => false };
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', explicit: '/wt/nope-ledger.md', deps });
  assert.deepStrictEqual(r, { ok: false, reason: 'not-found', candidates: ['/wt/nope-ledger.md'] });
});

test('parseLedgerTable throws when no header row is present', () => {
  assert.throws(() => parseLedgerTable('just some prose, no table'), /no ledger table header row/);
});

test('flipLedgerRow rewrites only the Status/Resolution cells for the named item', () => {
  const next = flipLedgerRow(SAMPLE, { item: 1, status: 'fixed', resolution: 'Fixed in abc9999' });
  assert.match(next, /\| 1 \| build \| First item \| fixed \| Fixed in abc9999 \|/);
  // Every other row untouched.
  assert.match(next, /\| 2 \| test \| Second item \| open \| — \|/);
  assert.match(next, /\| 3 \| review \| Third item \| fixed \| Already fixed — abc1234 \|/);
});

test('flipLedgerRow preserves the preamble heading and surrounding blank lines', () => {
  const next = flipLedgerRow(SAMPLE, { item: 2, status: 'accepted', resolution: 'Accepted — low risk' });
  assert.match(next, /^# Open Items — Sample/);
  assert.match(next, /\| # \| Phase \| Item \| Status \| Resolution \|/);
});

test('flipLedgerRow throws for an unknown item number', () => {
  assert.throws(() => flipLedgerRow(SAMPLE, { item: 99, status: 'fixed', resolution: 'x' }), /no ledger row for item #99/);
});

test('flipLedgerRow throws for a non-terminal status (e.g. "open" — never reopens a row)', () => {
  assert.throws(() => flipLedgerRow(SAMPLE, { item: 1, status: 'open', resolution: 'x' }), /invalid status 'open'/);
});

test('flipLedgerRow throws when resolution text is missing for a non-observation status', () => {
  assert.throws(() => flipLedgerRow(SAMPLE, { item: 1, status: 'fixed', resolution: '' }), /resolution text is required/);
});

test('flipLedgerRow allows an empty resolution for status "observation"', () => {
  const next = flipLedgerRow(SAMPLE, { item: 1, status: 'observation', resolution: '' });
  assert.match(next, /\| 1 \| build \| First item \| observation \| — \|/);
});

test('flipLedgerRow resolves a row whose Item holds an escaped pipe, touching only Status/Resolution (#3353)', () => {
  const lines = SAMPLE.split('\n');
  lines[4] = '| 1 | build | Surface: web\\|mobile\\|desktop | open | — |';
  const input = lines.join('\n');
  const next = flipLedgerRow(input, { item: 1, status: 'fixed', resolution: 'Fixed — abc1234' });
  const inLines = input.split('\n');
  const outLines = next.split('\n');
  assert.strictEqual(outLines.length, inLines.length);
  assert.strictEqual(outLines[4], '| 1 | build | Surface: web\\|mobile\\|desktop | fixed | Fixed — abc1234 |');
  for (let i = 0; i < inLines.length; i += 1) {
    if (i !== 4) assert.strictEqual(outLines[i], inLines[i]);
  }
});

test('TERMINAL_STATUSES matches ledger-format.md\'s closed five-value enum', () => {
  assert.deepStrictEqual(TERMINAL_STATUSES, ['fixed', 'deferred', 'accepted', 'acknowledged', 'observation']);
});
