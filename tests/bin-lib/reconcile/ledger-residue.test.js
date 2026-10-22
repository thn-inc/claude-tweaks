'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  LEDGER_RESIDUE_MARKER, QUIET_SKIP_REASONS, residueLedgerPaths, removalBranchName, ledgerFeatureSlug, runDirNamesNumber,
  attributedRunDir, classifyLedgerCandidate, partitionByRemovalPrs, decideLedgerResidue, defaultListRunDirs,
  defaultListRemovalPrs, defaultCreatePr, ledgerResidue,
} = require('../../../plugin/bin/lib/reconcile/ledger-residue');
const { reconcile, ALL_CHECKS } = require('../../../plugin/bin/lib/reconcile');
const { formatSummary } = require('../../../plugin/bin/lib/reconcile/format-summary');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// A ledger in _shared/ledger-format.md's shape: heading, table header, rows.
function ledgerText({ heading = '# Open Items — #9001: a feature', rows = [['1', 'build', 'thing', 'fixed', 'done']] } = {}) {
  return [heading, '', '| # | Phase | Item | Status | Resolution |', '|---|-------|------|--------|------------|',
    ...rows.map((r) => `| ${r.join(' | ')} |`), ''].join('\n');
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

test('runDirNamesNumber: whole dash-separated token after the timestamp, never a substring of the date', () => {
  assert.strictEqual(runDirNamesNumber('2026-10-21T233004-record-3812', 3812), true);
  assert.strictEqual(runDirNamesNumber('2026-10-21T233004-spec-3599-3602', '3602'), true);
  assert.strictEqual(runDirNamesNumber('2026-10-21T233004-record-3812', 21), false);
  assert.strictEqual(runDirNamesNumber('2026-10-21T233004-record-3812', 2026), false);
  assert.strictEqual(runDirNamesNumber('2026-10-21T233004-record-3812', 233004), false);
  assert.strictEqual(runDirNamesNumber('2026-10-21T233004-record-38120', 3812), false);
});

test('ledgerFeatureSlug: strips the date prefix and -ledger.md; an undated name keeps its stem', () => {
  assert.strictEqual(ledgerFeatureSlug('docs/plans/2026-10-20-qa-report-json-writer-ledger.md'), 'qa-report-json-writer');
  assert.strictEqual(ledgerFeatureSlug('docs/plans/odd-name-ledger.md'), 'odd-name');
});

test('attributedRunDir: #N tokens on the first line decide; the filename slug only when there are none', () => {
  const dirs = ['2026-10-21T233004-record-3812', '2026-10-20T101010-adhoc-qa-report-json-writer'];
  assert.strictEqual(attributedRunDir('docs/plans/2026-10-22-x-ledger.md', ledgerText({ heading: '# Open Items — #3812: x' }), dirs), dirs[0]);
  assert.strictEqual(attributedRunDir('docs/plans/2026-10-22-x-ledger.md', ledgerText({ heading: '# Open Items: #77, #3812' }), dirs), dirs[0]);
  assert.strictEqual(attributedRunDir('docs/plans/2026-10-22-x-ledger.md', ledgerText({ heading: '# Open Items — #21: x' }), dirs), null);
  // A #N token on the first line suppresses the slug fallback even when the slug would match.
  assert.strictEqual(attributedRunDir('docs/plans/2026-10-20-qa-report-json-writer-ledger.md', ledgerText({ heading: '# Open Items — #5' }), dirs), null);
  assert.strictEqual(attributedRunDir('docs/plans/2026-10-20-qa-report-json-writer-ledger.md', ledgerText({ heading: '# Open Items — qa' }), dirs), dirs[1]);
  assert.strictEqual(attributedRunDir('docs/plans/2026-10-20-other-ledger.md', ledgerText({ heading: '# Open Items — other' }), dirs), null);
});

test('classifyLedgerCandidate: signature, open rows, unrecognized status, run-dir scan, live run — in that order', () => {
  const p = 'docs/plans/2026-10-22-x-ledger.md';
  const c = (text, runDirNames = []) => classifyLedgerCandidate({ path: p, text, runDirNames });
  assert.strictEqual(c(null), 'ledger-read-failed');
  assert.strictEqual(c('# ledger\n'), 'not-a-ledger');
  assert.strictEqual(c('# Open Items — x\n\nno table here\n'), 'not-a-ledger');
  assert.strictEqual(c(ledgerText().replace('# Open Items', '# Notes')), 'not-a-ledger');
  assert.strictEqual(c(ledgerText({ rows: [['1', 'build', 'a', 'fixed', 'x'], ['2', 'review', 'b', 'open', '—']] })), 'ledger-has-open-rows');
  assert.strictEqual(c(ledgerText({ rows: [['1', 'build', 'a', 'pending', 'x']] })), 'ledger-status-unrecognized');
  assert.strictEqual(c(ledgerText(), null), 'run-dir-scan-failed');
  assert.strictEqual(c(ledgerText(), ['2026-10-22T000000-record-9001']), 'run-live');
  assert.strictEqual(c(ledgerText(), ['2026-10-22T000000-record-9002']), null);
  assert.strictEqual(c(ledgerText({ rows: [] })), null, 'a zero-row ledger has no open row');
  assert.strictEqual(c(ledgerText().replace(/\n/g, '\r\n')), null, 'CRLF blob still carries the signature');
});

test('defaultListRunDirs: a pipelines path that cannot be listed is a failed scan (null), never an empty one', () => {
  // ENOTDIR is not ENOENT: reading it as "no runs" would let a live run's ledger be proposed for removal.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-residue-runs-fail-'));
  fs.mkdirSync(path.join(root, '.claude-tweaks'));
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'pipelines'), 'not a directory');
  assert.strictEqual(defaultListRunDirs(root), null);
});

test('defaultListRunDirs: directories directly under pipelines/, archive excluded; absent pipelines dir is no runs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-residue-runs-'));
  assert.deepStrictEqual(defaultListRunDirs(root), []);
  const pipelines = path.join(root, '.claude-tweaks', 'pipelines');
  fs.mkdirSync(path.join(pipelines, 'archive', '2026-10-01T000000-record-1'), { recursive: true });
  fs.mkdirSync(path.join(pipelines, '2026-10-22T000000-record-2'));
  fs.writeFileSync(path.join(pipelines, 'stray-file'), '');
  assert.deepStrictEqual(defaultListRunDirs(root), ['2026-10-22T000000-record-2']);
});

const A = 'docs/plans/a-ledger.md';
const B = 'docs/plans/b-ledger.md';
const pr = (number, state, paths) => ({
  number, state, headRefName: `build/ledger-residue-${number}`, body: `${LEDGER_RESIDUE_MARKER}\n\n${paths.map((p) => `- \`${p}\``).join('\n')}`,
});

test('partitionByRemovalPrs: open governs every path; merged-named and closed-named are per path', () => {
  assert.deepStrictEqual(partitionByRemovalPrs([A, B], 'gh-absent'), {
    skips: [{ path: A, reason: 'gh-absent' }, { path: B, reason: 'gh-absent' }], removable: [],
  });
  assert.deepStrictEqual(partitionByRemovalPrs([A, B], [pr(4, 'CLOSED', [A]), pr(5, 'OPEN', [])]), {
    skips: [{ path: A, reason: 'removal-pr-open', prNumber: 5 }, { path: B, reason: 'removal-pr-open', prNumber: 5 }], removable: [],
  });
  assert.deepStrictEqual(partitionByRemovalPrs([A, B], [pr(4, 'CLOSED', [A])]), {
    skips: [{ path: A, reason: 'removal-pr-declined', prNumber: 4 }], removable: [B],
  });
  assert.deepStrictEqual(partitionByRemovalPrs([A, B], [pr(4, 'CLOSED', [A]), pr(6, 'MERGED', [A, B])]), {
    skips: [{ path: A, reason: 'removal-merged-but-present', prNumber: 6 }, { path: B, reason: 'removal-merged-but-present', prNumber: 6 }], removable: [],
  });
  assert.deepStrictEqual(partitionByRemovalPrs([A], [pr(4, 'CLOSED', [B])]), { skips: [], removable: [A] });
});

test('decideLedgerResidue: decision table over the removal-PR list', () => {
  const d = (paths, removalPrs, refExists, dryRun = false) => decideLedgerResidue({ paths, removalPrs, refExists, dryRun });
  assert.deepStrictEqual(d([], [], false), { skips: [], removable: [], branch: null, push: false, action: 'none', reason: null });
  assert.strictEqual(d([A], 'network-failure', null).action, 'none');
  assert.deepStrictEqual(d([A], 'network-failure', null).skips, [{ path: A, reason: 'network-failure' }]);
  assert.strictEqual(d([A], [pr(5, 'OPEN', [A])], true).skips[0].reason, 'removal-pr-open');
  assert.strictEqual(d([A], [], null).reason, 'ref-check-failed');
  assert.strictEqual(d([A], [], false, true).reason, 'dry-run');
  assert.deepStrictEqual(d([A], [], false), { skips: [], removable: [A], branch: removalBranchName([A]), push: true, action: 'open', reason: null });
  assert.strictEqual(d([A], [], true).push, false);
  // The branch hashes only the remaining set, so a declined path changes it.
  const declinedA = d([A, B], [pr(4, 'CLOSED', [A])], false);
  assert.deepStrictEqual(declinedA.removable, [B]);
  assert.strictEqual(declinedA.branch, removalBranchName([B]));
  assert.deepStrictEqual(declinedA.skips, [{ path: A, reason: 'removal-pr-declined', prNumber: 4 }]);
});

// A fake gh: matching-refs returns refsOut (one ref per line, as `--jq '.[].ref'` prints); each per-head pr list returns prsByHead[head].
function fakeGh({ refsOut, prsByHead }) {
  const calls = [];
  const exec = (bin, args, opts) => {
    calls.push({ bin, args, opts });
    if (args[0] === 'api') return refsOut;
    return JSON.stringify(prsByHead[args[args.indexOf('--head') + 1]] || []);
  };
  return { calls, exec };
}
const REFS_PATH = 'repos/{owner}/{repo}/git/matching-refs/heads/build/ledger-residue-';
const GH_TIMEOUT_MS = require('../../../plugin/bin/lib/shared-primitives').GH_TIMEOUT_MS;

test('defaultListRemovalPrs: enumerates heads by ref prefix, then one gh pr list per head; failures classified', () => {
  const { calls, exec } = fakeGh({
    refsOut: 'refs/heads/build/ledger-residue-abcd1234\nrefs/heads/build/ledger-residue-ffff0000\nrefs/heads/build/other\n',
    prsByHead: {
      'build/ledger-residue-abcd1234': [
        { number: 1, state: 'OPEN', headRefName: 'build/ledger-residue-abcd1234', body: 'x' },
        { number: 5, state: 'CLOSED', headRefName: 'fork/other-head', body: 'q' },
      ],
      'build/ledger-residue-ffff0000': [{ number: 2, state: 'CLOSED', headRefName: 'build/ledger-residue-ffff0000', body: 'y' }],
    },
  });
  assert.deepStrictEqual(defaultListRemovalPrs('/r', exec), [
    { number: 1, state: 'OPEN', headRefName: 'build/ledger-residue-abcd1234', body: 'x' },
    { number: 2, state: 'CLOSED', headRefName: 'build/ledger-residue-ffff0000', body: 'y' },
  ]);
  assert.strictEqual(calls.length, 3);
  assert.deepStrictEqual(calls[0].args, ['api', '--paginate', REFS_PATH, '--jq', '.[].ref']);
  assert.deepStrictEqual(calls[1].args, ['pr', 'list', '--head', 'build/ledger-residue-abcd1234', '--state', 'all', '--json', 'number,state,headRefName,body,isCrossRepository']);
  assert.deepStrictEqual(calls[2].args, ['pr', 'list', '--head', 'build/ledger-residue-ffff0000', '--state', 'all', '--json', 'number,state,headRefName,body,isCrossRepository']);
  for (const c of calls) {
    assert.strictEqual(c.bin, 'gh');
    assert.strictEqual(c.opts.cwd, '/r');
    assert.strictEqual(c.opts.timeout, GH_TIMEOUT_MS);
    assert.ok(!c.args.includes('--limit'), 'no recency window: no --limit on any call');
  }
  const enoent = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
  assert.strictEqual(defaultListRemovalPrs('/r', () => { throw enoent; }), 'gh-absent');
  assert.strictEqual(defaultListRemovalPrs('/r', () => { throw new Error('HTTP 502'); }), 'network-failure');
});

test('defaultListRemovalPrs: a fork PR reusing a removal branch name is dropped', () => {
  const head = 'build/ledger-residue-abcd1234';
  const ours = { number: 1, state: 'OPEN', headRefName: head, body: 'x', isCrossRepository: false };
  const fork = { number: 2, state: 'CLOSED', headRefName: head, body: '- `docs/plans/a-ledger.md`', isCrossRepository: true };
  const { exec } = fakeGh({ refsOut: `refs/heads/${head}\n`, prsByHead: { [head]: [ours, fork] } });
  assert.deepStrictEqual(defaultListRemovalPrs('/r', exec), [ours]);
});

test('defaultListRemovalPrs: ref lines are filtered to refs/heads/ + BRANCH_PREFIX and deduplicated; blank lines and CRLF are tolerated', () => {
  const heads = ['build/ledger-residue-aaaa0001', 'build/ledger-residue-aaaa0002'];
  const { calls, exec } = fakeGh({
    refsOut: `\nrefs/heads/${heads[0]}\r\nrefs/tags/build/ledger-residue-tag\n\nrefs/heads/${heads[1]}\nrefs/heads/${heads[0]}\n`,
    prsByHead: Object.fromEntries(heads.map((head, i) => [head, [{ number: i + 1, state: 'OPEN', headRefName: head, body: '' }]])),
  });
  assert.deepStrictEqual(defaultListRemovalPrs('/r', exec).map((p) => p.number), [1, 2]);
  assert.strictEqual(calls.length, 3);
});

test('defaultListRemovalPrs: no matching refs -> [] with no per-head call', () => {
  const { calls, exec } = fakeGh({ refsOut: '', prsByHead: {} });
  assert.deepStrictEqual(defaultListRemovalPrs('/r', exec), []);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].args[0], 'api');
});

test('defaultListRemovalPrs: any per-head failure fails the whole list (fail closed)', () => {
  const refsOut = 'refs/heads/build/ledger-residue-aaaa0001\nrefs/heads/build/ledger-residue-aaaa0002\n';
  const good = JSON.stringify([{ number: 1, state: 'OPEN', headRefName: 'build/ledger-residue-aaaa0001', body: '' }]);
  const exec = (failure) => (bin, args) => {
    if (args[0] === 'api') return refsOut;
    if (args.includes('build/ledger-residue-aaaa0002')) return typeof failure === 'function' ? failure() : failure;
    return good;
  };
  assert.strictEqual(defaultListRemovalPrs('/r', exec(() => { throw new Error('HTTP 502'); })), 'network-failure');
  assert.strictEqual(defaultListRemovalPrs('/r', exec(() => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }); })), 'gh-absent');
  assert.strictEqual(defaultListRemovalPrs('/r', exec('not json')), 'network-failure');
  assert.strictEqual(defaultListRemovalPrs('/r', exec('{"a":1}')), 'network-failure');
  assert.strictEqual(defaultListRemovalPrs('/r', exec('"a string is iterable but not a PR list"')), 'network-failure');
});

test('defaultListRemovalPrs: a removal PR older than any recency window is still returned', () => {
  // The old design asked for the 100 newest PRs; a head's PRs are now fetched by head, so age is irrelevant.
  const old = { number: 7, state: 'CLOSED', headRefName: 'build/ledger-residue-0ld00000', body: 'declined long ago', createdAt: '2020-01-01T00:00:00Z' };
  const { exec } = fakeGh({
    refsOut: 'refs/heads/build/ledger-residue-0ld00000\n',
    prsByHead: { 'build/ledger-residue-0ld00000': [old] },
  });
  assert.deepStrictEqual(defaultListRemovalPrs('/r', exec), [old]);
});

test('defaultCreatePr: parses the PR URL gh prints; bad output and failures are classified, never thrown', () => {
  const calls = [];
  const exec = (bin, args, opts) => { calls.push({ bin, args, opts }); return 'Creating pull request...\nhttps://github.com/o/r/pull/123\n'; };
  const arg = { root: '/r', base: 'main', head: 'build/ledger-residue-x', title: 'T', body: 'B' };
  assert.deepStrictEqual(defaultCreatePr(arg, exec), { number: 123, url: 'https://github.com/o/r/pull/123' });
  assert.deepStrictEqual(calls[0].args, ['pr', 'create', '--base', 'main', '--head', 'build/ledger-residue-x', '--title', 'T', '--body', 'B']);
  assert.strictEqual(calls[0].opts.timeout, require('../../../plugin/bin/lib/shared-primitives').GH_TIMEOUT_MS);
  assert.strictEqual(defaultCreatePr(arg, () => 'no url here\n'), 'network-failure');
  assert.strictEqual(defaultCreatePr(arg, () => ''), 'network-failure');
  const enoent = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
  assert.strictEqual(defaultCreatePr(arg, () => { throw enoent; }), 'gh-absent');
  assert.strictEqual(defaultCreatePr(arg, () => { throw new Error('HTTP 422'); }), 'network-failure');
});

test('QUIET_SKIP_REASONS: expected and transient reasons only — open PRs, unresolved ledgers and write failures surface', () => {
  for (const r of ['dry-run', 'run-live', 'not-a-ledger', 'removal-pr-declined', 'gh-absent', 'network-failure', 'ref-check-failed']) {
    assert.ok(QUIET_SKIP_REASONS.has(r), r);
  }
  for (const r of ['removal-pr-open', 'ledger-has-open-rows', 'ledger-status-unrecognized', 'removal-merged-but-present',
    'commit-failed', 'committer-identity-unset', 'push-failed', 'pr-create-failed', 'ledger-read-failed', 'run-dir-scan-failed']) {
    assert.ok(!QUIET_SKIP_REASONS.has(r), r);
  }
});

const LEDGER = 'docs/plans/2026-10-20-a b-ledger.md';

// A clone wired to a real bare origin, with ledgers and an unrelated plan file
// merged on main and pushed. `ledgers` maps a path under the clone to its text.
function makeRepo({ ledgers = { [LEDGER]: ledgerText() } } = {}) {
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-residue-origin-'));
  git(origin, 'init', '--bare', '-b', 'main');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-residue-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', 'keep.html'), '<p>keep</p>\n');
  for (const [p, text] of Object.entries(ledgers)) fs.writeFileSync(path.join(dir, p), text);
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
const noRuns = () => [];
const noPrs = () => [];

test('AC1.1: a resolved ledger merged onto origin/main is reported and a removal PR is opened', () => {
  const { dir, origin } = makeRepo();
  const headBefore = git(dir, 'rev-parse', 'HEAD').trim();
  const createPr = makeCreatePr();
  const r = ledgerResidue({ cwd: dir, integration: 'main', listRemovalPrs: noPrs, listRunDirs: noRuns, refExists: () => false, createPr });
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
  assert.ok(call.body.includes(`\`${LEDGER}\``));
  // The clone is untouched.
  assert.strictEqual(git(dir, 'status', '--porcelain'), '');
  assert.strictEqual(git(dir, 'rev-parse', 'HEAD').trim(), headBefore);
});

test('AC2.1: an in-flight draft PR branch carrying its ledger is not flagged', () => {
  const { dir } = makeRepo({ ledgers: {} });
  git(dir, 'checkout', '-b', 'worktree-record-9');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-10-22-y-ledger.md'), ledgerText());
  git(dir, 'add', '-A');
  git(dir, 'commit', '-m', 'wip ledger');
  git(dir, 'push', 'origin', 'worktree-record-9');
  const r = ledgerResidue({
    cwd: dir, integration: 'main', listRunDirs: noRuns,
    listRemovalPrs: mustNotCall('listRemovalPrs'), refExists: mustNotCall('refExists'), createPr: mustNotCall('createPr'),
  });
  assert.deepStrictEqual(r.entries, []);
  assert.strictEqual(r.failure, null);
});

test('tidy alignment: an open-row ledger, an unrecognized-status ledger, a live run and a non-ledger are kept, never pushed', () => {
  const OPEN = 'docs/plans/2026-10-20-open-ledger.md';
  const ODD = 'docs/plans/2026-10-20-odd-ledger.md';
  const LIVE = 'docs/plans/2026-10-20-live-ledger.md';
  const FAKE = 'docs/plans/2026-10-20-fake-ledger.md';
  const { dir, origin } = makeRepo({
    ledgers: {
      [OPEN]: ledgerText({ heading: '# Open Items — #11', rows: [['1', 'review', 'x', 'open', '—']] }),
      [ODD]: ledgerText({ heading: '# Open Items — #12', rows: [['1', 'review', 'x', 'pending', '—']] }),
      [LIVE]: ledgerText({ heading: '# Open Items — #13' }),
      [FAKE]: '# Not a ledger\n',
    },
  });
  const r = ledgerResidue({
    cwd: dir, integration: 'main', listRunDirs: () => ['2026-10-20T000000-record-13'],
    listRemovalPrs: mustNotCall('listRemovalPrs'), refExists: mustNotCall('refExists'), createPr: mustNotCall('createPr'),
  });
  assert.strictEqual(r.failure, null);
  assert.deepStrictEqual(r.entries, [
    { path: FAKE, kind: 'ledger', action: 'skip', reason: 'not-a-ledger' },
    { path: LIVE, kind: 'ledger', action: 'skip', reason: 'run-live' },
    { path: ODD, kind: 'ledger', action: 'skip', reason: 'ledger-status-unrecognized' },
    { path: OPEN, kind: 'ledger', action: 'skip', reason: 'ledger-has-open-rows' },
  ]);
  assert.deepStrictEqual(originRefs(origin), ['refs/heads/main']);
});

test('tidy alignment: only the removable ledger goes into the PR, and the branch hashes it alone', () => {
  const OPEN = 'docs/plans/2026-10-20-open-ledger.md';
  const { dir, origin } = makeRepo({
    ledgers: { [LEDGER]: ledgerText(), [OPEN]: ledgerText({ heading: '# Open Items — #11', rows: [['1', 'review', 'x', 'open', '—']] }) },
  });
  const createPr = makeCreatePr();
  const r = ledgerResidue({ cwd: dir, integration: 'main', listRemovalPrs: noPrs, listRunDirs: noRuns, refExists: () => false, createPr });
  const branch = removalBranchName([LEDGER]);
  assert.deepStrictEqual(r.entries.map((e) => [e.path, e.reason]), [[LEDGER, 'removal-pr-opened'], [OPEN, 'ledger-has-open-rows']]);
  assert.strictEqual(createPr.calls[0].head, branch);
  assert.ok(!createPr.calls[0].body.includes(OPEN));
  const files = git(origin, 'ls-tree', '-r', '--name-only', branch).split('\n');
  assert.ok(!files.includes(LEDGER));
  assert.ok(files.includes(OPEN), 'an open-row ledger is never deleted');
});

test('an open removal PR skips every path without pushing, carrying its number', () => {
  const { dir, origin } = makeRepo();
  const createPr = makeCreatePr();
  const r = ledgerResidue({
    cwd: dir, integration: 'main', listRunDirs: noRuns, listRemovalPrs: () => [pr(5, 'OPEN', ['docs/plans/other-ledger.md'])],
    refExists: mustNotCall('refExists'), createPr,
  });
  assert.strictEqual(r.failure, null);
  assert.deepStrictEqual(r.entries, [{ path: LEDGER, kind: 'ledger', action: 'skip', reason: 'removal-pr-open', prNumber: 5 }]);
  assert.deepStrictEqual(originRefs(origin).filter((n) => n.startsWith('refs/heads/build/')), []);
  assert.strictEqual(createPr.calls.length, 0);
});

test('a declined path stays declined after the residue set changes; the new path gets its own branch', () => {
  const NEW = 'docs/plans/2026-10-21-new-ledger.md';
  const { dir } = makeRepo({ ledgers: { [LEDGER]: ledgerText(), [NEW]: ledgerText({ heading: '# Open Items — #14' }) } });
  const createPr = makeCreatePr();
  const r = ledgerResidue({
    cwd: dir, integration: 'main', listRunDirs: noRuns, listRemovalPrs: () => [pr(4, 'CLOSED', [LEDGER])], refExists: () => false, createPr,
  });
  assert.deepStrictEqual(r.entries.map((e) => [e.path, e.reason, e.prNumber]), [
    [LEDGER, 'removal-pr-declined', 4], [NEW, 'removal-pr-opened', 77],
  ]);
  assert.strictEqual(createPr.calls[0].head, removalBranchName([NEW]));
  assert.ok(!createPr.calls[0].body.includes(LEDGER));
});

test('a path a merged removal PR named but still present is reported, never re-proposed', () => {
  const { dir, origin } = makeRepo();
  const r = ledgerResidue({
    cwd: dir, integration: 'main', listRunDirs: noRuns, listRemovalPrs: () => [pr(6, 'MERGED', [LEDGER])],
    refExists: mustNotCall('refExists'), createPr: mustNotCall('createPr'),
  });
  assert.deepStrictEqual(r.entries, [{ path: LEDGER, kind: 'ledger', action: 'skip', reason: 'removal-merged-but-present', prNumber: 6 }]);
  assert.deepStrictEqual(originRefs(origin), ['refs/heads/main']);
});

test('a removal-PR list failure is a per-path skip, never a throw', () => {
  const { dir } = makeRepo();
  const r = ledgerResidue({
    cwd: dir, integration: 'main', listRunDirs: noRuns, listRemovalPrs: () => 'gh-absent', refExists: mustNotCall('refExists'), createPr: mustNotCall('createPr'),
  });
  assert.deepStrictEqual(r.entries, [{ path: LEDGER, kind: 'ledger', action: 'skip', reason: 'gh-absent' }]);
});

test('refExists is asked about the remaining set\'s branch', () => {
  const { dir } = makeRepo();
  const seen = [];
  ledgerResidue({
    cwd: dir, integration: 'main', listRunDirs: noRuns, listRemovalPrs: noPrs, createPr: makeCreatePr(), dryRun: true,
    refExists: (root, branch) => { seen.push(branch); return false; },
  });
  assert.deepStrictEqual(seen, [removalBranchName([LEDGER])]);
});

test('branch already on origin without a PR: no re-push, PR still created', () => {
  const { dir, origin } = makeRepo();
  const createPr = makeCreatePr();
  const before = originRefs(origin);
  const r = ledgerResidue({ cwd: dir, integration: 'main', listRunDirs: noRuns, listRemovalPrs: noPrs, refExists: () => true, createPr });
  assert.strictEqual(createPr.calls.length, 1);
  assert.strictEqual(r.entries[0].action, 'pr-opened');
  assert.deepStrictEqual(originRefs(origin), before);
});

test('dry-run reports without writing', () => {
  const { dir, origin } = makeRepo();
  const createPr = makeCreatePr();
  let listCalls = 0;
  const r = ledgerResidue({
    cwd: dir, integration: 'main', dryRun: true, listRunDirs: noRuns, refExists: () => false, createPr, listRemovalPrs: () => { listCalls += 1; return []; },
  });
  assert.deepStrictEqual(r.entries, [{ path: LEDGER, kind: 'ledger', action: 'skip', reason: 'dry-run', branch: removalBranchName([LEDGER]) }]);
  assert.deepStrictEqual(originRefs(origin), ['refs/heads/main']);
  assert.strictEqual(createPr.calls.length, 0);
  assert.strictEqual(listCalls, 1);
});

test('pr create failure is a reported skip', () => {
  const { dir } = makeRepo();
  const r = ledgerResidue({ cwd: dir, integration: 'main', listRunDirs: noRuns, listRemovalPrs: noPrs, refExists: () => false, createPr: () => 'network-failure' });
  assert.strictEqual(r.entries.length, 1);
  assert.strictEqual(r.entries[0].action, 'skip');
  assert.strictEqual(r.entries[0].reason, 'pr-create-failed');
});

// Wraps the real git runner, failing the one subcommand named.
function gitFailing(dir, subcommand, error) {
  return (args, opts = {}) => {
    if (args[0] === subcommand) throw error;
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
  };
}

test('commit-tree failures: identity unset is its own reason, anything else is commit-failed; nothing is pushed', () => {
  for (const [stderr, reason] of [
    ['Author identity unknown\n\n*** Please tell me who you are.', 'committer-identity-unset'],
    ['Committer identity unknown\n\n*** Please tell me who you are.', 'committer-identity-unset'],
    ['fatal: not a valid object name', 'commit-failed'],
  ]) {
    const { dir, origin } = makeRepo();
    const err = Object.assign(new Error('Command failed: git commit-tree'), { stderr });
    const r = ledgerResidue({
      cwd: dir, integration: 'main', git: gitFailing(dir, 'commit-tree', err), listRunDirs: noRuns, listRemovalPrs: noPrs,
      refExists: () => false, createPr: mustNotCall('createPr'),
    });
    assert.deepStrictEqual(r.entries, [{ path: LEDGER, kind: 'ledger', action: 'skip', reason, branch: removalBranchName([LEDGER]) }], stderr);
    assert.deepStrictEqual(originRefs(origin), ['refs/heads/main']);
  }
});

test('push failure is a reported skip and no PR is created', () => {
  const { dir } = makeRepo();
  const r = ledgerResidue({
    cwd: dir, integration: 'main', git: gitFailing(dir, 'push', new Error('rejected')), listRunDirs: noRuns, listRemovalPrs: noPrs,
    refExists: () => false, createPr: mustNotCall('createPr'),
  });
  assert.deepStrictEqual(r.entries, [{ path: LEDGER, kind: 'ledger', action: 'skip', reason: 'push-failed', branch: removalBranchName([LEDGER]) }]);
});

test('an unreadable blob is a per-path skip', () => {
  const { dir } = makeRepo();
  const r = ledgerResidue({
    cwd: dir, integration: 'main', git: gitFailing(dir, 'cat-file', new Error('boom')), listRunDirs: noRuns,
    listRemovalPrs: mustNotCall('listRemovalPrs'), refExists: mustNotCall('refExists'), createPr: mustNotCall('createPr'),
  });
  assert.deepStrictEqual(r.entries, [{ path: LEDGER, kind: 'ledger', action: 'skip', reason: 'ledger-read-failed' }]);
});

test('missing origin/{integration} is a git-failure, not a throw', () => {
  const { dir } = makeRepo();
  const r = ledgerResidue({
    cwd: dir, integration: 'no-such-branch', skipFetch: true, listRunDirs: noRuns,
    listRemovalPrs: mustNotCall('listRemovalPrs'), refExists: mustNotCall('refExists'), createPr: mustNotCall('createPr'),
  });
  assert.deepStrictEqual(r, { entries: [], failure: 'git-failure' });
});

test('fetch failure fails the whole check closed', () => {
  const { dir } = makeRepo();
  git(dir, 'remote', 'set-url', 'origin', '/no/such/path');
  const r = ledgerResidue({
    cwd: dir, integration: 'main', listRunDirs: noRuns,
    listRemovalPrs: mustNotCall('listRemovalPrs'), refExists: mustNotCall('refExists'), createPr: mustNotCall('createPr'),
  });
  assert.strictEqual(r.failure, 'fetch-failed');
  assert.deepStrictEqual(r.entries, []);
});

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
  const { dir } = makeRepo({ ledgers: {} });
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
