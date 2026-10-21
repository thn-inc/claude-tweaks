'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  LEDGER_RESIDUE_MARKER, residueLedgerPaths, removalBranchName, decideLedgerResidue, ledgerResidue,
} = require('../../../plugin/bin/lib/reconcile/ledger-residue');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

test('residueLedgerPaths: keeps only direct docs/plans/*-ledger.md entries, sorted', () => {
  const z = ['docs/plans/b-ledger.md', 'docs/plans/2689-visual-plan-flowchart.html', 'docs/plans/sub/x-ledger.md',
    'docs/plans/ledger.md', 'docs/plans/a b-ledger.md', ''].join('\0');
  assert.deepStrictEqual(residueLedgerPaths(z), ['docs/plans/a b-ledger.md', 'docs/plans/b-ledger.md']);
});

test('removalBranchName: deterministic, order-independent, build/ namespace', () => {
  const a = removalBranchName(['docs/plans/a-ledger.md', 'docs/plans/b-ledger.md']);
  assert.strictEqual(a, removalBranchName(['docs/plans/b-ledger.md', 'docs/plans/a-ledger.md']));
  assert.match(a, /^build\/ledger-residue-[0-9a-f]{8}$/);
  assert.notStrictEqual(a, removalBranchName(['docs/plans/a-ledger.md']));
});

test('decideLedgerResidue: decision table', () => {
  const p = ['docs/plans/a-ledger.md'];
  assert.deepStrictEqual(decideLedgerResidue({ paths: [], prState: null, refExists: false, dryRun: false }), { action: 'none', reason: null, push: false });
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: 'gh-absent', refExists: false, dryRun: false }).reason, 'gh-absent');
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: 'network-failure', refExists: false, dryRun: false }).reason, 'network-failure');
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: { number: 5, state: 'OPEN' }, refExists: true, dryRun: false }).reason, 'removal-pr-open');
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: { number: 5, state: 'CLOSED' }, refExists: true, dryRun: false }).reason, 'removal-pr-declined');
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: { number: 5, state: 'MERGED' }, refExists: true, dryRun: false }).reason, 'removal-pr-merged');
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: null, refExists: null, dryRun: false }).reason, 'ref-check-failed');
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: null, refExists: false, dryRun: true }).reason, 'dry-run');
  assert.deepStrictEqual(decideLedgerResidue({ paths: p, prState: null, refExists: false, dryRun: false }), { action: 'open', reason: null, push: true });
  assert.deepStrictEqual(decideLedgerResidue({ paths: p, prState: null, refExists: true, dryRun: false }), { action: 'open', reason: null, push: false });
});

const LEDGER = 'docs/plans/2026-10-20-a b-ledger.md';

// A clone wired to a real bare origin, with a ledger and an unrelated plan file
// merged on main and pushed.
function makeRepo({ withLedger = true } = {}) {
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-residue-origin-'));
  git(origin, 'init', '--bare', '-b', 'main');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-residue-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', 'keep.html'), '<p>keep</p>\n');
  if (withLedger) fs.writeFileSync(path.join(dir, LEDGER), '# ledger\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'init');
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-u', 'origin', 'main');
  return { dir, origin };
}

function originRefs(origin) {
  return git(origin, 'for-each-ref', '--format=%(refname)', 'refs/heads/').split('\n').filter(Boolean);
}

function makeCreatePr(result = { number: 77, url: 'https://github.com/o/r/pull/77' }) {
  const calls = [];
  const fn = (arg) => { calls.push(arg); return result; };
  fn.calls = calls;
  return fn;
}

const mustNotCall = (name) => () => { throw new Error(`${name} must not be called`); };

test('AC1.1: a ledger merged onto origin/main is reported and a removal PR is opened', () => {
  const { dir, origin } = makeRepo();
  const headBefore = git(dir, 'rev-parse', 'HEAD').trim();
  const createPr = makeCreatePr();
  const r = ledgerResidue({ cwd: dir, integration: 'main', resolvePr: () => null, refExists: () => false, createPr });
  const branch = removalBranchName([LEDGER]);
  assert.strictEqual(r.failure, null);
  assert.deepStrictEqual(r.entries, [{
    path: LEDGER, kind: 'ledger', action: 'pr-opened', reason: 'removal-pr-opened', branch, prNumber: 77, prUrl: 'https://github.com/o/r/pull/77',
  }]);
  // The removal commit landed on origin, one commit on top of origin/main's tip.
  const tip = git(origin, 'rev-parse', 'refs/heads/main').trim();
  const pushed = git(origin, 'rev-parse', `refs/heads/${branch}`).trim();
  assert.strictEqual(git(origin, 'rev-list', '--parents', '-n', '1', pushed).trim(), `${pushed} ${tip}`);
  const files = git(origin, 'ls-tree', '-r', '--name-only', branch).split('\n');
  assert.ok(!files.includes(LEDGER));
  assert.ok(files.includes('docs/plans/keep.html'));
  // createPr got the base/head and a body carrying the marker and the path.
  assert.strictEqual(createPr.calls.length, 1);
  const call = createPr.calls[0];
  assert.strictEqual(call.base, 'main');
  assert.strictEqual(call.head, branch);
  assert.strictEqual(typeof call.title, 'string');
  assert.ok(call.body.includes(LEDGER_RESIDUE_MARKER));
  assert.ok(call.body.includes(LEDGER));
  // The clone is untouched.
  assert.strictEqual(git(dir, 'status', '--porcelain'), '');
  assert.strictEqual(git(dir, 'rev-parse', 'HEAD').trim(), headBefore);
});

test('AC2.1: an in-flight draft PR branch carrying its ledger is not flagged', () => {
  const { dir } = makeRepo({ withLedger: false });
  git(dir, 'checkout', '-b', 'worktree-record-9');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-10-22-y-ledger.md'), '# y\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'wip ledger');
  git(dir, 'push', 'origin', 'worktree-record-9');
  const r = ledgerResidue({
    cwd: dir, integration: 'main', resolvePr: mustNotCall('resolvePr'), refExists: mustNotCall('refExists'), createPr: mustNotCall('createPr'),
  });
  assert.deepStrictEqual(r.entries, []);
  assert.strictEqual(r.failure, null);
});

test('an open removal PR for the same set skips without pushing', () => {
  const { dir, origin } = makeRepo();
  const createPr = makeCreatePr();
  const r = ledgerResidue({ cwd: dir, integration: 'main', resolvePr: () => ({ number: 5, state: 'OPEN' }), refExists: () => true, createPr });
  assert.strictEqual(r.failure, null);
  assert.deepStrictEqual(r.entries, [{
    path: LEDGER, kind: 'ledger', action: 'skip', reason: 'removal-pr-open', branch: removalBranchName([LEDGER]), prNumber: 5,
  }]);
  assert.deepStrictEqual(originRefs(origin).filter((n) => n.startsWith('refs/heads/build/')), []);
  assert.strictEqual(createPr.calls.length, 0);
});

test('resolvePr is asked about the derived branch with preferOpen', () => {
  const { dir } = makeRepo();
  const seen = [];
  ledgerResidue({
    cwd: dir, integration: 'main', refExists: () => false, createPr: makeCreatePr(), dryRun: true,
    resolvePr: (root, branch, opts) => { seen.push({ root, branch, opts }); return null; },
  });
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].branch, removalBranchName([LEDGER]));
  assert.strictEqual(seen[0].opts.preferOpen, true);
});

test('branch already on origin without a PR: no re-push, PR still created', () => {
  const { dir, origin } = makeRepo();
  const createPr = makeCreatePr();
  const before = originRefs(origin);
  const r = ledgerResidue({ cwd: dir, integration: 'main', resolvePr: () => null, refExists: () => true, createPr });
  assert.strictEqual(createPr.calls.length, 1);
  assert.strictEqual(r.entries[0].action, 'pr-opened');
  assert.deepStrictEqual(originRefs(origin), before);
});

test('dry-run reports without writing', () => {
  const { dir, origin } = makeRepo();
  const createPr = makeCreatePr();
  let resolveCalls = 0;
  const r = ledgerResidue({
    cwd: dir, integration: 'main', dryRun: true, refExists: () => false, createPr, resolvePr: () => { resolveCalls += 1; return null; },
  });
  assert.strictEqual(r.entries.length, 1);
  assert.strictEqual(r.entries[0].action, 'skip');
  assert.strictEqual(r.entries[0].reason, 'dry-run');
  assert.deepStrictEqual(originRefs(origin), ['refs/heads/main']);
  assert.strictEqual(createPr.calls.length, 0);
  assert.strictEqual(resolveCalls, 1);
});

test('pr create failure is a reported skip', () => {
  const { dir } = makeRepo();
  const r = ledgerResidue({ cwd: dir, integration: 'main', resolvePr: () => null, refExists: () => false, createPr: () => 'network-failure' });
  assert.strictEqual(r.entries.length, 1);
  assert.strictEqual(r.entries[0].action, 'skip');
  assert.strictEqual(r.entries[0].reason, 'pr-create-failed');
});

test('missing origin/{integration} is a git-failure, not a throw', () => {
  const { dir } = makeRepo();
  const r = ledgerResidue({
    cwd: dir, integration: 'no-such-branch', skipFetch: true, resolvePr: mustNotCall('resolvePr'), refExists: mustNotCall('refExists'), createPr: mustNotCall('createPr'),
  });
  assert.deepStrictEqual(r, { entries: [], failure: 'git-failure' });
});

test('fetch failure fails the whole check closed', () => {
  const { dir } = makeRepo();
  git(dir, 'remote', 'set-url', 'origin', '/no/such/path');
  const r = ledgerResidue({
    cwd: dir, integration: 'main', resolvePr: mustNotCall('resolvePr'), refExists: mustNotCall('refExists'), createPr: mustNotCall('createPr'),
  });
  assert.strictEqual(r.failure, 'fetch-failed');
  assert.deepStrictEqual(r.entries, []);
});

const { reconcile, ALL_CHECKS } = require('../../../plugin/bin/lib/reconcile');
const { formatSummary } = require('../../../plugin/bin/lib/reconcile/format-summary');

test("index: ALL_CHECKS and BACKGROUND_CHECKS include 'ledger-residue'; dispatch sits between remote-prune and reap", () => {
  assert.ok(ALL_CHECKS.includes('ledger-residue'));
  assert.ok(require('../../../plugin/bin/hooks.js').BACKGROUND_CHECKS.includes('ledger-residue'));
  const src = fs.readFileSync(path.join(__dirname, '../../../plugin/bin/lib/reconcile/index.js'), 'utf8');
  const iBranches = src.indexOf("checks.includes('archive-branches')");
  const iRemote = src.indexOf("checks.includes('remote-prune')", iBranches);
  const iLedger = src.indexOf("checks.includes('ledger-residue')", iBranches);
  const iReap = src.indexOf("checks.includes('reap')", iBranches);
  assert.ok(iRemote > iBranches && iLedger > iRemote && iReap > iLedger, 'dispatch order: remote-prune < ledger-residue < reap');
});

test('index: requesting ledger-residue under pr-first sets result.ledgerResidue to an array; not requesting it leaves null', async () => {
  // Same shape as prune-remote.test.js's "actually reaches the remote-prune
  // dispatch": a real working origin, pr-first forced by policy, the
  // `gh api rate_limit` preflight stubbed. No ledger on main, so the check
  // reaches its dispatch and returns an empty array without any `gh` call.
  const { dir } = makeRepo({ withLedger: false });
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\nintegration-branch: main\n');
  const preflight = require('../../../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });
  try {
    const withDispatch = await reconcile({ cwd: dir, checks: ['ledger-residue'] });
    assert.ok(Array.isArray(withDispatch.ledgerResidue), 'ledger-residue requested under pr-first must set ledgerResidue to an array, not stay null');
    const withoutDispatch = await reconcile({ cwd: dir, checks: ['mirror'] });
    assert.strictEqual(withoutDispatch.ledgerResidue, null, 'ledger-residue not requested must leave ledgerResidue null');
  } finally {
    preflight.ghHealthCheck = originalHealth;
  }
});

test('formatSummary renders ledger-residue taken and skipped lines', () => {
  const out = formatSummary({
    mirror: null, redTip: null, worktrees: null, claims: null, runs: null, branches: null, remoteBranches: null, console: null, skipped: null,
    ledgerResidue: [
      { kind: 'ledger', action: 'pr-opened', reason: 'removal-pr-opened' },
      { kind: 'ledger', action: 'pr-opened', reason: 'removal-pr-opened' },
      { kind: 'ledger', action: 'skip', reason: 'removal-pr-open' },
    ],
  });
  assert.ok(out.includes('removal PR opened: 2 residue ledgers'), out);
  assert.ok(out.includes('skipped: 1 residue ledger (removal-pr-open 1)'), out);
});
