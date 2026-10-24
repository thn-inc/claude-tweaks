'use strict';
// tests/bin-lib/wrap-up/ledger-write.test.js — #2546: the write half of the
// pipeline ledger. resolveLedgerPath's run-dir-first/docs-plans-fallback
// resolution, and flipLedgerRow's in-place Status/Resolution cell rewrite.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const {
  TERMINAL_STATUSES, resolveLedgerPath, parseLedgerTable, flipLedgerRow,
  describeRunLedgers, formatLedgerReport,
} = require('../../../plugin/bin/lib/wrap-up/ledger-write');
const { splitLedgerRow, ledgerRowCells } = require('../../../plugin/bin/lib/wrap-up/ledger-cells');

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

// #3834: two rows share number 1 — parseLedgerTable keys rows by number, so one
// would collapse on parse and be dropped on write-back.
const DUPLICATE = [
  '# Open Items — Duplicate',
  '',
  '| # | Phase | Item | Status | Resolution |',
  '|---|-------|------|--------|------------|',
  '| 1 | build | First item | open | — |',
  '| 1 | test | Repeated number | open | — |',
  '| 2 | test | Second item | open | — |',
  '',
].join('\n');

// Ledger-ownership git fake (#3566): `owned` are the docs/plans/ paths the
// branch's diff against the merge base names, `untracked` those present only in
// the worktree — the same two git calls pack.js's ledger probe makes.
function ownedGit(owned = [], untracked = []) {
  return (args) => {
    if (args[0] === 'diff') return owned.join('\0');
    if (args[0] === 'ls-files') return untracked.join('\0');
    return '';
  };
}

function ownershipDeps(over = {}) {
  return { existsSync: () => false, resolveBase: () => 'abc123', ...over };
}

test('resolveLedgerPath prefers {run-dir}/ledger.md when it exists', () => {
  const deps = { existsSync: (p) => p === path.join('/run', 'ledger.md') };
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', deps });
  assert.deepStrictEqual(r, { ok: true, path: path.join('/run', 'ledger.md') });
});

test('resolveLedgerPath falls back to a single docs/plans/*-ledger.md candidate', () => {
  const deps = {
    existsSync: () => false,
    readdirSync: () => ['2026-01-01-foo-ledger.md', 'other.md'],
    git: ownedGit(['docs/plans/2026-01-01-foo-ledger.md']),
    resolveBase: () => 'abc123',
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
    git: ownedGit(['docs/plans/a-ledger.md', 'docs/plans/b-ledger.md']),
    resolveBase: () => 'abc123',
  };
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', deps });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'ambiguous');
  assert.strictEqual(r.candidates.length, 2);
});

test('resolveLedgerPath returns not-found when the only docs/plans ledger is inherited from the merge base', () => {
  const deps = ownershipDeps({ readdirSync: () => ['2026-01-01-old-ledger.md'], git: ownedGit() });
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', deps });
  assert.deepStrictEqual(r, { ok: false, reason: 'not-found', candidates: [] });
});

test('resolveLedgerPath returns the owned ledger beside inherited ones', () => {
  const deps = ownershipDeps({
    readdirSync: () => ['a-old-ledger.md', 'b-mine-ledger.md', 'c-old-ledger.md'],
    git: ownedGit(['docs/plans/b-mine-ledger.md']),
  });
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', deps });
  assert.deepStrictEqual(r, { ok: true, path: path.join('/wt', 'docs', 'plans', 'b-mine-ledger.md') });
});

test('resolveLedgerPath counts an untracked ledger as owned', () => {
  const deps = ownershipDeps({
    readdirSync: () => ['old-ledger.md', 'new-ledger.md'],
    git: ownedGit([], ['docs/plans/new-ledger.md']),
  });
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', deps });
  assert.deepStrictEqual(r, { ok: true, path: path.join('/wt', 'docs', 'plans', 'new-ledger.md') });
});

test('resolveLedgerPath reports ambiguous only among owned candidates', () => {
  const deps = ownershipDeps({
    readdirSync: () => ['a-old-ledger.md', 'b-mine-ledger.md', 'c-mine-ledger.md'],
    git: ownedGit(['docs/plans/b-mine-ledger.md', 'docs/plans/c-mine-ledger.md']),
  });
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', deps });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'ambiguous');
  assert.deepStrictEqual(r.candidates, [
    path.join('/wt', 'docs', 'plans', 'b-mine-ledger.md'),
    path.join('/wt', 'docs', 'plans', 'c-mine-ledger.md'),
  ]);
});

test('resolveLedgerPath fails closed as unattributable when no merge base resolves', () => {
  const deps = ownershipDeps({ readdirSync: () => ['a-ledger.md'], git: ownedGit(['docs/plans/a-ledger.md']), resolveBase: () => null });
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', deps });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'unattributable');
  assert.strictEqual(r.path, undefined);
  assert.deepStrictEqual(r.candidates, [path.join('/wt', 'docs', 'plans', 'a-ledger.md')]);
});

test('resolveLedgerPath fails closed as unattributable when git throws', () => {
  const deps = ownershipDeps({ readdirSync: () => ['a-ledger.md'], git: () => { throw new Error('boom'); } });
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', deps });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'unattributable');
  assert.match(r.detail, /boom/);
});

test('resolveLedgerPath does not resolve a base when docs/plans holds no ledger', () => {
  const deps = ownershipDeps({
    readdirSync: () => [],
    resolveBase: () => { throw new Error('resolveBase must not be called'); },
  });
  const r = resolveLedgerPath({ runDir: '/run', worktree: '/wt', deps });
  assert.deepStrictEqual(r, { ok: false, reason: 'not-found', candidates: [] });
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

test('TERMINAL_STATUSES matches ledger-format.md\'s closed five-value enum', () => {
  assert.deepStrictEqual(TERMINAL_STATUSES, ['fixed', 'deferred', 'accepted', 'acknowledged', 'observation']);
});

// #3566: wrap-up's prose re-counts the ledger through the ledger probe, never a
// bare docs/plans glob that also matches ledgers inherited from the base branch.
test('wrap-up prose re-counts the ledger via the ledger probe, not a glob (#3566)', () => {
  const skill = fs.readFileSync(path.join(__dirname, '../../../plugin/skills/wrap-up/SKILL.md'), 'utf8');
  assert.match(skill, /re-count after the sweep by re-running the ledger probe/);
  assert.match(skill, /wrap-up-pack\.js" --run "\$PIPELINE_RUN_DIR" --print ledger --json/);
  const sweep = fs.readFileSync(path.join(__dirname, '../../../plugin/skills/wrap-up/residue-sweep.md'), 'utf8');
  assert.match(sweep, /pack\.ledger.{0,80}files/s);
  assert.match(sweep, /unattributedFiles/);
});

test('AC1.1: flipLedgerRow flips a row whose Item carries an escaped pipe, keeping the Item text intact', () => {
  const text = SAMPLE.replace('| 1 | build | First item |', String.raw`| 1 | build | Ruling: a\|b |`);
  const next = flipLedgerRow(text, { item: 1, status: 'accepted', resolution: 'ratified' });
  assert.match(next, /\| 1 \| build \| Ruling: a\\\|b \| accepted \| ratified \|/);
  const row = next.split('\n').find((l) => l.startsWith('| 1 |'));
  assert.deepStrictEqual(ledgerRowCells(row), ['1', 'build', 'Ruling: a|b', 'accepted', 'ratified']);
});

test('flipLedgerRow escapes a pipe in the resolution text it writes', () => {
  const next = flipLedgerRow(SAMPLE, { item: 2, status: 'accepted', resolution: 'ratified — x|y' });
  const row = next.split('\n').find((l) => l.startsWith('| 2 |'));
  assert.strictEqual(splitLedgerRow(row).length, 7);
  assert.strictEqual(ledgerRowCells(row)[4], 'ratified — x|y');
});

test('flipLedgerRow collapses a newline in the resolution — the row stays on one line and a later flip still succeeds', () => {
  const next = flipLedgerRow(SAMPLE, { item: 1, status: 'fixed', resolution: 'line1\nline2' });
  const lines = next.split('\n');
  const row = lines.find((l) => l.startsWith('| 1 |'));
  assert.strictEqual(splitLedgerRow(row).length, 7);
  assert.strictEqual(ledgerRowCells(row)[4], 'line1 line2');
  assert.ok(!lines.includes('line2 |'), 'no continuation line');
  const again = flipLedgerRow(next, { item: 2, status: 'accepted', resolution: 'ok' });
  assert.ok(again.split('\n').some((l) => l.startsWith('| 2 |') && l.includes('accepted')));
});

test('flipLedgerRow still refuses a legacy row with a raw (unescaped) pipe, naming the \\| rule', () => {
  const text = SAMPLE.replace('| 1 | build | First item |', '| 1 | build | First a|b item |');
  assert.throws(() => flipLedgerRow(text, { item: 1, status: 'fixed', resolution: 'x' }), /5-column shape[\s\S]*\\\|[\s\S]*ledger-format\.md/);
});

// #3897: describeRunLedgers / formatLedgerReport — the read side of resolveLedgerPath.
const plansPath = (name) => path.join('/wt', 'docs', 'plans', name);

test('AC1.1: describeRunLedgers returns {run-dir}/ledger.md as found, listing every docs/plans ledger as another run\'s', () => {
  const deps = {
    existsSync: (p) => p === path.join('/run', 'ledger.md'),
    readdirSync: () => ['a-ledger.md', 'x.md'],
    git: () => { throw new Error('ownership must not be consulted'); },
    resolveBase: () => { throw new Error('ownership must not be consulted'); },
  };
  assert.deepStrictEqual(describeRunLedgers({ runDir: '/run', worktree: '/wt', deps }), {
    report: 'found',
    ledgers: [path.join('/run', 'ledger.md')],
    others: [plansPath('a-ledger.md')],
    unattributed: [],
    detail: null,
  });
});

test('AC2.1: an inherited docs/plans ledger is never this run\'s: report none, listed as other-run', () => {
  const deps = ownershipDeps({ readdirSync: () => ['old-ledger.md'], git: ownedGit() });
  const v = describeRunLedgers({ runDir: '/run', worktree: '/wt', deps });
  assert.strictEqual(v.report, 'none');
  assert.deepStrictEqual(v.ledgers, []);
  assert.deepStrictEqual(v.others, [plansPath('old-ledger.md')]);
});

test('AC2.1: the owned ledger is found and the inherited ones are other-run', () => {
  const deps = ownershipDeps({
    readdirSync: () => ['a-old-ledger.md', 'b-mine-ledger.md'],
    git: ownedGit(['docs/plans/b-mine-ledger.md']),
  });
  const v = describeRunLedgers({ runDir: '/run', worktree: '/wt', deps });
  assert.strictEqual(v.report, 'found');
  assert.deepStrictEqual(v.ledgers, [plansPath('b-mine-ledger.md')]);
  assert.deepStrictEqual(v.others, [plansPath('a-old-ledger.md')]);
});

test('ambiguous names every owned candidate as this-run, the rest as other-run', () => {
  const deps = ownershipDeps({
    readdirSync: () => ['a-old-ledger.md', 'b-mine-ledger.md', 'c-mine-ledger.md'],
    git: ownedGit(['docs/plans/b-mine-ledger.md', 'docs/plans/c-mine-ledger.md']),
  });
  const v = describeRunLedgers({ runDir: '/run', worktree: '/wt', deps });
  assert.strictEqual(v.report, 'ambiguous');
  assert.deepStrictEqual(v.ledgers, [plansPath('b-mine-ledger.md'), plansPath('c-mine-ledger.md')]);
  assert.deepStrictEqual(v.others, [plansPath('a-old-ledger.md')]);
});

test('AC2.1: reports unattributable where resolveLedgerPath does, with no this-run or other-run entries', () => {
  const deps = ownershipDeps({ readdirSync: () => ['a-ledger.md'], resolveBase: () => null });
  const v = describeRunLedgers({ runDir: '/run', worktree: '/wt', deps });
  assert.strictEqual(v.report, 'unattributable');
  assert.deepStrictEqual(v.ledgers, []);
  assert.deepStrictEqual(v.others, []);
  assert.deepStrictEqual(v.unattributed, [plansPath('a-ledger.md')]);
  assert.match(v.detail, /merge base unavailable/);
});

test('no docs/plans directory: none with no other-run entries', () => {
  const deps = {
    existsSync: () => false,
    readdirSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
  };
  assert.deepStrictEqual(describeRunLedgers({ runDir: '/run', worktree: '/wt', deps }), {
    report: 'none', ledgers: [], others: [], unattributed: [], detail: null,
  });
});

test('formatLedgerReport renders the report line then this-run, other-run, unattributed lines', () => {
  assert.strictEqual(
    formatLedgerReport({ report: 'found', ledgers: ['/r/ledger.md'], others: ['/w/docs/plans/a-ledger.md'], unattributed: [], detail: null }),
    'claude-tweaks: resolve-ledger: found\nthis-run: /r/ledger.md\nother-run: /w/docs/plans/a-ledger.md\n',
  );
  const out = formatLedgerReport({ report: 'unattributable', ledgers: [], others: [], unattributed: ['/w/docs/plans/a-ledger.md'], detail: 'boom' });
  assert.strictEqual(out.split('\n')[0], 'claude-tweaks: resolve-ledger: unattributable (boom)');
  assert.ok(out.endsWith('unattributed: /w/docs/plans/a-ledger.md\n'));
});

test('formatLedgerReport collapses a multi-line detail so the report line never wraps', () => {
  const out = formatLedgerReport({ report: 'unattributable', ledgers: [], others: [], unattributed: [], detail: 'Command failed: git\nfatal: boom' });
  assert.strictEqual(out.split('\n')[0], 'claude-tweaks: resolve-ledger: unattributable (Command failed: git fatal: boom)');
});

test('parseLedgerTable reports each repeated item number once in duplicates, [] when none (#3834)', () => {
  assert.deepStrictEqual(parseLedgerTable(DUPLICATE).duplicates, ['1']);
  assert.deepStrictEqual(parseLedgerTable(SAMPLE).duplicates, []);
  // Three rows numbered 1 and two numbered 2, interleaved: each number once, in first-repeat order.
  const TRIPLE = [
    '| # | Phase | Item | Status | Resolution |',
    '|---|-------|------|--------|------------|',
    '| 1 | build | A | open | — |',
    '| 2 | test | B | open | — |',
    '| 1 | build | C | open | — |',
    '| 2 | test | D | open | — |',
    '| 1 | build | E | open | — |',
    '',
  ].join('\n');
  assert.deepStrictEqual(parseLedgerTable(TRIPLE).duplicates, ['1', '2']);
});

test('flipLedgerRow refuses a table with duplicate row numbers instead of dropping a row (#3834)', () => {
  assert.throws(() => flipLedgerRow(DUPLICATE, { item: 2, status: 'fixed', resolution: 'x' }), /duplicate row number\(s\) #1/);
  assert.throws(() => flipLedgerRow(DUPLICATE, { item: 1, status: 'fixed', resolution: 'x' }), /duplicate row number\(s\) #1/);
});
