'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
  gatherPack, resolveInputs, PROBE_NAMES, resolveRecords, headerRecords, closingRecords, parseLedger,
} = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'wrap-up', 'pack.js'));

// A fixture run dir: run-state.json (pr + worktree), one materialized header, config.yml.
function fixtureRunDir({ withPr = true, records = [1535] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-'));
  const state = { worktree: '/w/tree', status: 'active', sessionId: 's' };
  if (withPr) state.pr = { number: 1901, url: 'https://x/pull/1901', branch: 'b' };
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(dir, 'config.yml'), 'ceremony-profile: standard\n');
  fs.mkdirSync(path.join(dir, 'work'));
  for (const n of records) fs.writeFileSync(path.join(dir, 'work', `${n}-spec.md`), `---\nrecord: ${n}\nsurface: backend\n---\n# ${n}\n`);
  return dir;
}

// A main-checkout run dir whose materialized headers live ONLY in the
// worktree's mirror of the same `.claude-tweaks/pipelines/{run}` path — the
// real pr-first shape, where the headers are committed on the feature branch.
function mirrorFixture({ records = [1930], runName = '2026-09-06T000000-record-1930', alsoInMain = false } = {}) {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-main-'));
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-tree-'));
  const rel = path.join('.claude-tweaks', 'pipelines', runName);
  const runDir = path.join(main, rel);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ worktree: tree, status: 'active', pr: { number: 1901 } }));
  const mirrorWork = path.join(tree, rel, 'work');
  fs.mkdirSync(mirrorWork, { recursive: true });
  for (const n of records) fs.writeFileSync(path.join(mirrorWork, `${n}-spec.md`), `---\nrecord: ${n}\n---\n`);
  if (alsoInMain) {
    fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'work', '4242-spec.md'), '---\nrecord: 4242\n---\n');
  }
  return { main, tree, runDir };
}

const DEFAULT_POLICY = { 'integration-branch': 'main', 'work-links': 'native' };
const policyFake = (map) => (keys) => Object.fromEntries(keys.map((k) => [k, map[k] || '']));

// work-backend is read from the worktree's CLAUDE.md, not policy.yml (#1930
// review E1). The fixture worktrees are synthetic paths, so the readFile fake
// answers CLAUDE.md itself and delegates everything else to the real fs.
// `null` stands for an absent CLAUDE.md.
function readFileFake(claudeMd) {
  return (p) => {
    if (path.basename(p) !== 'CLAUDE.md') return fs.readFileSync(p, 'utf8');
    if (claudeMd === null) { const e = new Error('ENOENT: no such file'); e.code = 'ENOENT'; throw e; }
    return claudeMd;
  };
}

// Fake deps: every probe succeeds; `git` answers merge-base; module probes
// return the real shapes their production counterparts return.
function okDeps(overrides = {}) {
  return {
    now: () => Date.now(),
    git: (args) => (args[0] === 'merge-base' ? 'abc123\n' : args[0] === 'rev-parse' ? 'refs/remotes/origin/main\n' : ''),
    resolvePolicy: policyFake(DEFAULT_POLICY),
    computeBlastRadius: () => ({ mergeBase: 'abc123', config: {}, summary: { files: 3 } }),
    readClaimBlob: () => ({ content: JSON.stringify({ runId: 'r', sessionId: 's' }), failure: null, absent: false, via: 'git' }),
    classifyClaimBlob: () => ({ state: 'live', reclaimable: false }),
    queryRecords: () => [],
    readRecord: () => ({ facets: { closed: true } }),
    execFile: async (cmd, args) => {
      if (cmd === 'node' && String(args[0]).endsWith('residue.js')) {
        assert.ok(args.includes('--no-suite'), 'the pack never re-runs the suite');
        return { stdout: JSON.stringify({ suite: { ran: false, reason: 'skipped via --no-suite', findings: [] } }), stderr: '' };
      }
      if (cmd === 'node' && String(args[0]).endsWith('wrap-up-state.js')) return { stdout: JSON.stringify({ state: { isRepo: true, branch: 'b' }, ops: [], since: 'abc123', sinceDate: '2026-09-05T00:00:00Z', rendered: 'Branch b\n' }), stderr: '' };
      if (cmd === 'node' && String(args[0]).endsWith('resolve-blockers.js')) return { stdout: JSON.stringify({ 1600: { blockedBy: [1535], openBlocker: false } }), stderr: '' };
      if (cmd === 'node' && String(args[0]).endsWith('pr-checks.js')) return { stdout: JSON.stringify({ state: 'green', failing: [], pending: [] }), stderr: '' };
      if (cmd === 'gh' && args[0] === 'pr') return { stdout: JSON.stringify({ state: 'OPEN', isDraft: false, mergeStateStatus: 'CLEAN', headRefOid: 'deadbee', statusCheckRollup: [], reviewDecision: null }), stderr: '' };
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'view') return { stdout: JSON.stringify({ labels: [{ name: 'ready' }, { name: 'auto:merge' }] }), stderr: '' };
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'list') return { stdout: JSON.stringify([{ number: 1600, title: 'Dependent', body: '' }]), stderr: '' };
      throw new Error(`unexpected execFile ${cmd} ${args.join(' ')}`);
    },
    readFile: readFileFake('# Fixture\n\nwork-backend: github-issues\nwork-types: labels\n'),
    readdir: (p) => (fs.existsSync(p) ? fs.readdirSync(p) : []),
    ...overrides,
  };
}

// Ledger ownership fake (#2887): `owned` are the docs/plans/ paths this
// branch's diff against the merge base touches; `untracked` are docs/plans/
// paths present only in the worktree. Every other git call answers like okDeps.
// The diff and ls-files argv are pinned: a call missing the merge-base, the
// flags or the pathspec throws, so a regression in pack.js fails loudly here
// instead of answering from the subcommand name alone.
function ownedGit(owned = [], untracked = []) {
  function requireArgs(args, expected) {
    if (!expected.every((a) => args.includes(a))) throw new Error('unexpected git argv: ' + args.join(' '));
  }
  return (args) => {
    if (args[0] === 'merge-base') return 'abc123\n';
    if (args[0] === 'rev-parse') return 'refs/remotes/origin/main\n';
    if (args[0] === 'diff') {
      requireArgs(args, ['abc123', '--relative', '-z', '--name-only', 'docs/plans/']);
      return owned.join('\0');
    }
    if (args[0] === 'ls-files') {
      requireArgs(args, ['--others', '--exclude-standard', '-z', 'docs/plans/']);
      return untracked.join('\0');
    }
    return '';
  };
}

const LEDGER_HEAD = '| # | Phase | Item | Status | Resolution |\n|---|---|---|---|---|\n';
const OPEN_REVIEW_LEDGER = `${LEDGER_HEAD}| 1 | review | a | open | — |`;

// A worktree whose docs/plans/ holds the given {name: text} ledgers, plus a
// run dir whose run-state.json points at that worktree.
function treeWithLedgers(files, { records = [1535] } = {}) {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-tree-'));
  fs.mkdirSync(path.join(tree, 'docs', 'plans'), { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(tree, 'docs', 'plans', name), text);
  const runDir = fixtureRunDir({ records });
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  state.worktree = tree;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  return { tree, runDir };
}

test('resolveInputs reads records from the headers, pr and worktree from run-state.json, the integration branch from policy, and the base from merge-base — with sources (#1930 AC1)', () => {
  const runDir = fixtureRunDir();
  const inputs = resolveInputs({ runDir, cwd: '/w/tree', deps: okDeps() });
  assert.deepStrictEqual(inputs.records, [1535]);
  assert.strictEqual(inputs.record, 1535);
  assert.strictEqual(inputs.pr, 1901);
  assert.strictEqual(inputs.base, 'abc123');
  assert.strictEqual(inputs.integrationBranch, 'main');
  assert.strictEqual(inputs.worktree, '/w/tree');
  assert.deepStrictEqual(inputs.policy, { integrationBranch: 'main', workBackend: 'github-issues', workLinks: 'native' });
  assert.deepStrictEqual(inputs.sources, { state: 'run-state.json', records: 'headers', pr: 'run-state.json', workBackend: 'claude-md', base: 'merge-base', integrationBranch: 'policy', worktree: 'run-state.json' });
});

test('resolveInputs marks a missing source unavailable and still resolves the rest (#1930 Gotchas)', () => {
  const runDir = fixtureRunDir({ withPr: false });
  const inputs = resolveInputs({ runDir, cwd: '/w/tree', deps: okDeps({ resolvePolicy: policyFake({}) }) });
  assert.strictEqual(inputs.pr, null);
  assert.strictEqual(inputs.sources.pr, 'unavailable');
  // No integration-branch policy key: okDeps' git fake answers the offline
  // origin/HEAD lookup, so this resolves via the git-default ladder rank
  // (#2385), not the bare 'main' literal the pre-fix code reported as 'default'.
  assert.strictEqual(inputs.integrationBranch, 'main');
  assert.strictEqual(inputs.sources.integrationBranch, 'git-default');
  assert.strictEqual(inputs.base, 'abc123');
});

test('resolveInputs resolves integrationBranch via the git-default ladder rank when no policy key is set, even when the real default branch is not "main" (#2385)', () => {
  const runDir = fixtureRunDir({ withPr: false });
  const deps = okDeps({
    resolvePolicy: policyFake({}),
    git: (args, opts) => {
      if (args[0] === 'rev-parse' && args[1] === '--symbolic-full-name') return 'refs/remotes/origin/master\n';
      if (args[0] === 'merge-base') return 'abc123\n';
      return '';
    },
  });
  const inputs = resolveInputs({ runDir, cwd: '/w/tree', deps });
  assert.strictEqual(inputs.integrationBranch, 'master');
  assert.strictEqual(inputs.sources.integrationBranch, 'git-default');
  // The residue/state/blastRadius probes' merge-base call succeeds against
  // the resolved non-"main" branch instead of failing on an unresolved base.
  assert.strictEqual(inputs.base, 'abc123');
});

test('resolveInputs falls back to gh repo view for the default branch when the offline git pointer is unavailable, no policy key set (#2385)', () => {
  const runDir = fixtureRunDir({ withPr: false });
  const deps = okDeps({
    resolvePolicy: policyFake({}),
    git: (args) => { if (args[0] === 'rev-parse') throw new Error('no such ref'); return args[0] === 'merge-base' ? 'abc123\n' : ''; },
    ghSync: (args) => (args[0] === 'repo' ? 'trunk\n' : ''),
  });
  const inputs = resolveInputs({ runDir, cwd: '/w/tree', deps });
  assert.strictEqual(inputs.integrationBranch, 'trunk');
  assert.strictEqual(inputs.sources.integrationBranch, 'gh-default');
});

test('resolveInputs falls back to the literal "main" only when neither policy, git, nor gh resolve anything (#2385)', () => {
  const runDir = fixtureRunDir({ withPr: false });
  const deps = okDeps({
    resolvePolicy: policyFake({}),
    git: (args) => { if (args[0] === 'rev-parse') throw new Error('no such ref'); return args[0] === 'merge-base' ? 'abc123\n' : ''; },
    ghSync: () => { throw new Error('gh: not found'); },
  });
  const inputs = resolveInputs({ runDir, cwd: '/w/tree', deps });
  assert.strictEqual(inputs.integrationBranch, 'main');
  assert.strictEqual(inputs.sources.integrationBranch, 'default');
});

test('resolveInputs: an explicit integration-branch policy value always wins outright, never consulting git or gh (#2385)', () => {
  const runDir = fixtureRunDir({ withPr: false });
  let gitCalledWithRevParse = false;
  const deps = okDeps({
    git: (args) => { if (args[0] === 'rev-parse') gitCalledWithRevParse = true; return args[0] === 'merge-base' ? 'abc123\n' : ''; },
  });
  const inputs = resolveInputs({ runDir, cwd: '/w/tree', deps });
  assert.strictEqual(inputs.integrationBranch, 'main');
  assert.strictEqual(inputs.sources.integrationBranch, 'policy');
  assert.strictEqual(gitCalledWithRevParse, false, 'policy short-circuits before the git rank is ever consulted');
});

test('resolveInputs resolves the policy levers ONCE, not once per probe (#1930 review I8)', async () => {
  const calls = [];
  const deps = okDeps({ resolvePolicy: (keys) => { calls.push(keys); return policyFake(DEFAULT_POLICY)(keys); } });
  await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', deps });
  assert.strictEqual(calls.length, 1, `resolvePolicy called ${calls.length} times: ${JSON.stringify(calls)}`);
  assert.deepStrictEqual(calls[0], ['integration-branch', 'work-links'], 'work-backend is not a policy key and must not be asked for');
});

test('resolveInputs reads work-backend from the worktree CLAUDE.md, and the forge probes actually run (#1930 review E1)', async () => {
  const inputs = resolveInputs({ runDir: fixtureRunDir(), cwd: '/w/tree', deps: okDeps() });
  assert.strictEqual(inputs.policy.workBackend, 'github-issues');
  assert.strictEqual(inputs.sources.workBackend, 'claude-md');
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['pr', 'recordLabels', 'unblocked'], deps: okDeps() });
  for (const n of ['pr', 'recordLabels', 'unblocked']) assert.strictEqual(pack[n].ok, true, `${n}: ${JSON.stringify(pack[n])}`);
});

const UNCONFIGURED = 'work-backend unconfigured — no `work-backend:` line in CLAUDE.md';

test('resolveInputs: an absent CLAUDE.md is UNCONFIGURED, and every backend-gated probe refuses rather than reporting a clean empty (#1930 review E3)', async () => {
  const deps = okDeps({ readFile: readFileFake(null) });
  const inputs = resolveInputs({ runDir: fixtureRunDir(), cwd: '/w/tree', deps });
  assert.strictEqual(inputs.policy.workBackend, null);
  assert.strictEqual(inputs.sources.workBackend, 'unconfigured');
  const calls = [];
  const pack = await gatherPack({
    runDir: fixtureRunDir(),
    cwd: '/w/tree',
    deps: okDeps({ readFile: readFileFake(null), execFile: async (cmd, args) => { calls.push(cmd); return okDeps().execFile(cmd, args); } }),
  });
  for (const n of ['pr', 'recordLabels', 'unblocked']) {
    assert.strictEqual(pack[n].ok, false, n);
    assert.strictEqual(pack[n].error, UNCONFIGURED, n);
  }
  assert.ok(!calls.includes('gh'), `no gh call on an unconfigured backend: ${JSON.stringify(calls)}`);
  assert.strictEqual(pack.claim.ok, true, 'claim is backend-agnostic — the claims-registry read is unaffected');
  assert.strictEqual(pack.ledger.ok, true);
});

test('resolveInputs: a CLAUDE.md with no work-backend line is UNCONFIGURED too, never no-forge (#1930 review E3)', async () => {
  const deps = okDeps({ readFile: readFileFake('# Project\n\nwork-types: labels\n') });
  const inputs = resolveInputs({ runDir: fixtureRunDir(), cwd: '/w/tree', deps });
  assert.strictEqual(inputs.policy.workBackend, null);
  assert.strictEqual(inputs.sources.workBackend, 'unconfigured');
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['unblocked'], deps });
  assert.strictEqual(pack.unblocked.ok, false);
  assert.strictEqual(pack.unblocked.error, UNCONFIGURED);
  assert.notStrictEqual(pack.unblocked.error, 'no-forge');
});

test('resolveInputs (b): records come from the WORKTREE mirror of the run dir when the main-checkout run dir has no headers (#1930 review C1)', () => {
  const { tree, runDir } = mirrorFixture();
  const inputs = resolveInputs({ runDir, cwd: '/nowhere', deps: okDeps() });
  assert.deepStrictEqual(inputs.records, [1930]);
  assert.strictEqual(inputs.record, 1930);
  assert.strictEqual(inputs.worktree, tree);
  assert.strictEqual(inputs.sources.records, 'worktree-headers');
});

test('resolveInputs (a): the run dir\'s own headers win over the worktree mirror (#1930 review C1)', () => {
  const { runDir } = mirrorFixture({ alsoInMain: true });
  const inputs = resolveInputs({ runDir, cwd: '/nowhere', deps: okDeps() });
  assert.deepStrictEqual(inputs.records, [4242]);
  assert.strictEqual(inputs.sources.records, 'headers');
});

test('resolveInputs (c): a parent multi-spec run dir resolves records from manifest.yml plus spec-*/work headers, and record stays null (#1930 review C1)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-multi-'));
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree' }));
  fs.writeFileSync(path.join(dir, 'manifest.yml'), [
    'multispec:', '  parent: 1904', '  specs:',
    '    - id: 1930', '      status: complete', '      subdir: spec-1930',
    '    - id: 1931', '      status: pending', '      subdir: spec-1931',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(dir, 'spec-1932', 'work'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'spec-1932', 'work', '1932-spec.md'), '---\nrecord: 1932\n---\n');
  const inputs = resolveInputs({ runDir: dir, cwd: '/w/tree', deps: okDeps() });
  assert.deepStrictEqual(inputs.records, [1930, 1931, 1932]);
  assert.strictEqual(inputs.record, null, 'several records → no single record');
  assert.strictEqual(inputs.sources.records, 'manifest');
});

test('resolveRecords rung (c) worktree-mirrors spec-*/work headers when the main-checkout run dir has neither work/ nor spec-* entries (#2391)', () => {
  // The real /claude-tweaks:dispatch file-overlap group shape: materialize.md
  // commits each record's header to {run-dir}/spec-{n}/work/{n}-spec.md on the
  // feature branch, so it exists only inside the worktree's own working tree —
  // never in the main-checkout run dir --run anchors to. Observed live on
  // run 2026-09-14T000308-record-2283-2338 (#2391's Current State).
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-rungc-main-'));
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-rungc-tree-'));
  const rel = path.join('.claude-tweaks', 'pipelines', '2026-09-14T000308-record-2283-2338');
  const runDir = path.join(main, rel);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ worktree: tree, status: 'active', pr: { number: 1901 } }));
  const mirrorRunDir = path.join(tree, rel);
  fs.mkdirSync(path.join(mirrorRunDir, 'spec-2283', 'work'), { recursive: true });
  fs.mkdirSync(path.join(mirrorRunDir, 'spec-2338', 'work'), { recursive: true });
  fs.writeFileSync(path.join(mirrorRunDir, 'spec-2283', 'work', '2283-spec.md'), '---\nrecord: 2283\n---\n');
  fs.writeFileSync(path.join(mirrorRunDir, 'spec-2338', 'work', '2338-spec.md'), '---\nrecord: 2338\n---\n');
  const deps = { readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } } };
  const { records, source } = resolveRecords(deps, runDir, tree);
  assert.deepStrictEqual(records, [2283, 2338]);
  assert.strictEqual(source, 'worktree-manifest');

  // resolveInputs surfaces the same resolution end-to-end, and the four
  // probes that gate on `recordsOrThrow()` no longer see an empty list.
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'ceremony-profile: standard\n');
  const inputs = resolveInputs({ runDir, cwd: tree, deps: okDeps({ readdir: deps.readdir, readFile: (p) => (path.basename(p) === 'CLAUDE.md' ? '# Fixture\n\nwork-backend: github-issues\n' : deps.readFile(p)) }) });
  assert.deepStrictEqual(inputs.records, [2283, 2338]);
  assert.strictEqual(inputs.sources.records, 'worktree-manifest');
});

test('resolveRecords rung (c): the main-checkout run dir\'s own spec-*/work headers still win over the worktree mirror (#2391 — preserves the existing single-record/no-worktree case)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-rungc-own-'));
  fs.mkdirSync(path.join(dir, 'spec-1', 'work'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'spec-1', 'work', '1-spec.md'), '---\nrecord: 1\n---\n');
  const deps = { readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } } };
  const { records, source } = resolveRecords(deps, dir, null);
  assert.deepStrictEqual(records, [1]);
  assert.strictEqual(source, 'manifest', 'no worktree given — the direct runDir read wins, mirror never consulted');
});

test('pack.js exports resolveRecords (and headerRecords) so console/resolve.js can share the ladder instead of copying it (#2028)', () => {
  assert.strictEqual(typeof resolveRecords, 'function');
  assert.strictEqual(typeof headerRecords, 'function');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-export-'));
  fs.writeFileSync(path.join(dir, 'manifest.yml'), [
    'multispec:', '  parent: 1904', '  specs:',
    '    - id: 1930', '      status: complete', '      subdir: spec-1930',
    '    - id: 1931', '      status: pending', '      subdir: spec-1931',
    '',
  ].join('\n'));
  const deps = { readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } } };
  const { records, source } = resolveRecords(deps, dir, null);
  assert.deepStrictEqual(records, [1930, 1931]);
  assert.strictEqual(source, 'manifest');
});

test('resolveInputs: no headers anywhere and no manifest → records [] and sources.records unavailable (#1930 review C1)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-bare-'));
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree' }));
  const inputs = resolveInputs({ runDir: dir, cwd: '/w/tree', deps: okDeps() });
  assert.deepStrictEqual(inputs.records, []);
  assert.strictEqual(inputs.record, null);
  assert.strictEqual(inputs.sources.records, 'unavailable');
});

test('resolveInputs: a spec-* subdirectory whose own run-state.json lacks worktree/pr falls back to the parent run\'s (#1930 review C1)', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-parent-'));
  fs.writeFileSync(path.join(parent, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', pr: { number: 1901 } }));
  const child = path.join(parent, 'spec-1930');
  fs.mkdirSync(path.join(child, 'work'), { recursive: true });
  fs.writeFileSync(path.join(child, 'run-state.json'), JSON.stringify({ status: 'active' }));
  fs.writeFileSync(path.join(child, 'work', '1930-spec.md'), '---\nrecord: 1930\n---\n');
  const inputs = resolveInputs({ runDir: child, cwd: '/elsewhere', deps: okDeps() });
  assert.strictEqual(inputs.worktree, '/w/tree');
  assert.strictEqual(inputs.pr, 1901);
  assert.strictEqual(inputs.sources.state, 'parent');
  assert.deepStrictEqual(inputs.records, [1930]);
});

test('resolveInputs (#2858): a per-spec worktree wins over the parent\'s while a null per-spec pr is filled from it', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-precedence-'));
  fs.writeFileSync(path.join(parent, 'run-state.json'), JSON.stringify({ worktree: '/parent/tree', pr: { number: 1901 } }));
  const child = path.join(parent, 'spec-1930');
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(child, 'run-state.json'), JSON.stringify({ status: 'active', worktree: '/own/tree', pr: null }));
  const inputs = resolveInputs({ runDir: child, cwd: '/elsewhere', deps: okDeps() });
  assert.strictEqual(inputs.worktree, '/own/tree');
  assert.strictEqual(inputs.pr, 1901);
  assert.strictEqual(inputs.sources.state, 'parent');
});

test('resolveInputs (#2858): a non-spec run dir never borrows a parent directory\'s run-state.json, and a parent that contributes nothing is not the source', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-gate-'));
  fs.writeFileSync(path.join(parent, 'run-state.json'), JSON.stringify({ worktree: '/parent/tree', pr: { number: 1901 } }));
  const plain = path.join(parent, '2026-10-04T000000-record-1');
  fs.mkdirSync(plain, { recursive: true });
  fs.writeFileSync(path.join(plain, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const inputs = resolveInputs({ runDir: plain, cwd: '/elsewhere', deps: okDeps() });
  assert.strictEqual(inputs.worktree, '/elsewhere');
  assert.strictEqual(inputs.pr, null);
  assert.strictEqual(inputs.sources.state, 'run-state.json');

  const emptyParent = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-emptyparent-'));
  fs.writeFileSync(path.join(emptyParent, 'run-state.json'), JSON.stringify({ status: 'active' }));
  const child = path.join(emptyParent, 'spec-1930');
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(child, 'run-state.json'), JSON.stringify({ status: 'active' }));
  assert.strictEqual(resolveInputs({ runDir: child, cwd: '/elsewhere', deps: okDeps() }).sources.state, 'run-state.json');

  // No per-spec file at all: the only state there is came from the parent.
  const exemptParent = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-exemptparent-'));
  fs.writeFileSync(path.join(exemptParent, 'run-state.json'), JSON.stringify({ prExempt: 'initial-publish' }));
  const bare = path.join(exemptParent, 'spec-1930');
  fs.mkdirSync(bare, { recursive: true });
  assert.strictEqual(resolveInputs({ runDir: bare, cwd: '/elsewhere', deps: okDeps() }).sources.state, 'parent');
  const noParent = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-noparent-')), 'spec-1930');
  fs.mkdirSync(noParent, { recursive: true });
  assert.strictEqual(resolveInputs({ runDir: noParent, cwd: '/elsewhere', deps: okDeps() }).sources.state, 'unavailable');
});

test('gatherPack: every probe ok → eight envelopes with ok:true, plus inputs/generatedAt/durationMs (#1930 AC2 shape)', async () => {
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', deps: okDeps() });
  assert.deepStrictEqual(Object.keys(pack).filter((k) => !['inputs', 'generatedAt', 'durationMs'].includes(k)).sort(), [...PROBE_NAMES].sort());
  for (const name of PROBE_NAMES) assert.strictEqual(pack[name].ok, true, `${name} should be ok: ${JSON.stringify(pack[name])}`);
  assert.ok(typeof pack.generatedAt === 'string' && typeof pack.durationMs === 'number');
  assert.deepStrictEqual(pack.blastRadius.value, { mergeBase: 'abc123', config: {}, summary: { files: 3 } });
  assert.deepStrictEqual(pack.recordLabels.value, { 1535: ['ready', 'auto:merge'] });
  assert.deepStrictEqual(pack.claim.value, { 1535: { state: 'live', reclaimable: false, via: 'git' } }, 'claim is keyed per record number');
  assert.deepStrictEqual(pack.unblocked.value, [{ number: 1600, title: 'Dependent' }]);
  assert.ok(Array.isArray(pack.state.value.ops), 'pack.state.value.ops should be an array');
  assert.strictEqual(typeof pack.state.value.rendered, 'string', 'pack.state.value.rendered carries the verbatim block');
  assert.ok(!('release' in pack), 'the release probe was removed (#1930 review I5)');
  assert.ok(!('mergeSize' in pack), 'the mergeSize probe was removed (#1930 fix round 4)');
});

// #2332: recordLabels' Promise.all fan-out is deliberately all-or-nothing —
// this probe is an audit-only snapshot (auto-merge-short-circuit.md /
// review-console.md never substitute it for a live label read, and both
// treat `ok:false` as "omit the snapshot line entirely"), so a mid-list `gh`
// failure degrading the WHOLE field rather than silently returning a partial
// label set is the intended, documented behavior — not a bug to paper over.
test('recordLabels: a mid-list gh failure fails the whole probe field, not just that record (#2332)', async () => {
  const records = [100, 200, 300, 400, 500];
  const seen = [];
  const deps = okDeps({
    execFile: async (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'view') {
        const n = Number(args[2]);
        seen.push(n);
        if (n === 300) throw new Error('gh issue view 300 failed: rate limited');
        return { stdout: JSON.stringify({ labels: [{ name: `label-${n}` }] }), stderr: '' };
      }
      return okDeps().execFile(cmd, args);
    },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir({ records }), cwd: '/w/tree', only: ['recordLabels'], deps });
  assert.strictEqual(pack.recordLabels.ok, false, 'a single failing record fails the whole field');
  assert.match(pack.recordLabels.error, /rate limited/, 'the underlying gh failure surfaces, not a swallowed/generic message');
  assert.ok(seen.includes(300), 'the failing record was actually attempted');
  // Every other record was still attempted (in-flight calls are not aborted
  // just because one rejected) — proves this is Promise.all-style
  // all-or-nothing propagation, not a swallow of the whole batch.
  for (const n of records) assert.ok(seen.includes(n), `record ${n} should still have been attempted`);
});

// #2332: an unbounded Promise.all fan-out fires every record's `gh issue
// view` simultaneously — a large multi-spec record list risks gh's own rate
// limiting. Assert peak concurrency is capped rather than unbounded.
test('recordLabels: gh issue view calls are concurrency-capped, not fired all at once (#2332)', async () => {
  const records = Array.from({ length: 12 }, (_, i) => 1000 + i);
  let inFlight = 0;
  let peak = 0;
  const deps = okDeps({
    execFile: async (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'view') {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return { stdout: JSON.stringify({ labels: [] }), stderr: '' };
      }
      return okDeps().execFile(cmd, args);
    },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir({ records }), cwd: '/w/tree', only: ['recordLabels'], deps });
  assert.strictEqual(pack.recordLabels.ok, true);
  assert.ok(peak < records.length, `peak concurrency (${peak}) should be bounded below the full record count (${records.length})`);
  assert.ok(peak > 0, 'sanity: calls actually happened');
});

test('#2425: unblocked (work-links: native) passes --repo, resolved from `origin`, to resolve-blockers.js — including on a GitHub Enterprise remote', async () => {
  const calls = [];
  const deps = okDeps({
    git: (args) => (args[0] === 'remote' ? 'git@ghe.example.com:acme/widgets.git\n' : okDeps().git(args)),
    execFile: async (cmd, args) => {
      if (cmd === 'node' && String(args[0]).endsWith('resolve-blockers.js')) {
        calls.push(args);
        return { stdout: JSON.stringify({ 1600: { blockedBy: [1535], openBlocker: false } }), stderr: '' };
      }
      return okDeps().execFile(cmd, args);
    },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['unblocked'], deps });
  assert.strictEqual(pack.unblocked.ok, true);
  assert.deepStrictEqual(pack.unblocked.value, [{ number: 1600, title: 'Dependent' }]);
  assert.strictEqual(calls.length, 1);
  const repoIdx = calls[0].indexOf('--repo');
  assert.notStrictEqual(repoIdx, -1, `resolve-blockers.js must be called with --repo: ${JSON.stringify(calls[0])}`);
  // Host-qualified, not bare owner/repo — a bare slug here silently drops
  // which GHE host to query, which is the whole point of this fix (see the
  // review finding this replaced: passing bare 'acme/widgets' for a GHE
  // remote made resolve-blockers.js/number-list-cli.js re-resolve against
  // github.com instead of the real host).
  assert.strictEqual(calls[0][repoIdx + 1], 'ghe.example.com/acme/widgets');
});

test('#2425 AC 2: on a plain github.com remote, --repo is still passed (additive) with the same owner/repo shape, and unblocked\'s value is unchanged', async () => {
  const calls = [];
  const deps = okDeps({
    git: (args) => (args[0] === 'remote' ? 'https://github.com/acme/widgets.git\n' : okDeps().git(args)),
    execFile: async (cmd, args) => {
      if (cmd === 'node' && String(args[0]).endsWith('resolve-blockers.js')) {
        calls.push(args);
        return { stdout: JSON.stringify({ 1600: { blockedBy: [1535], openBlocker: false } }), stderr: '' };
      }
      return okDeps().execFile(cmd, args);
    },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['unblocked'], deps });
  assert.deepStrictEqual(pack.unblocked.value, [{ number: 1600, title: 'Dependent' }]);
  const repoIdx = calls[0].indexOf('--repo');
  assert.strictEqual(calls[0][repoIdx + 1], 'acme/widgets');
});

// #2538: before this fix, ONLY the resolve-blockers.js child spawn got
// --repo — this probe's own two direct `gh issue list` calls (open-state,
// and body-text mode's second all-state pass) never did, so a GitHub
// Enterprise remote's issue-list fetch had no repo context threaded at all.
test('#2538: unblocked (work-links: native) also passes --repo to its own direct `gh issue list` call, not just the resolve-blockers.js spawn', async () => {
  const listCalls = [];
  const deps = okDeps({
    git: (args) => (args[0] === 'remote' ? 'git@ghe.example.com:acme/widgets.git\n' : okDeps().git(args)),
    execFile: async (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'list') {
        listCalls.push(args);
        return { stdout: JSON.stringify([{ number: 1600, title: 'Dependent', body: '' }]), stderr: '' };
      }
      if (cmd === 'node' && String(args[0]).endsWith('resolve-blockers.js')) {
        return { stdout: JSON.stringify({ 1600: { blockedBy: [1535], openBlocker: false } }), stderr: '' };
      }
      return okDeps().execFile(cmd, args);
    },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['unblocked'], deps });
  assert.strictEqual(pack.unblocked.ok, true);
  assert.strictEqual(listCalls.length, 1);
  const repoIdx = listCalls[0].indexOf('--repo');
  assert.notStrictEqual(repoIdx, -1, `gh issue list must be called with --repo on a GHE remote: ${JSON.stringify(listCalls[0])}`);
  assert.strictEqual(listCalls[0][repoIdx + 1], 'ghe.example.com/acme/widgets');
});

test('#2538: unblocked (work-links: body-text) passes --repo to BOTH of its direct `gh issue list` calls on a GitHub Enterprise remote', async () => {
  const listCalls = [];
  const deps = okDeps({
    git: (args) => (args[0] === 'remote' ? 'git@ghe.example.com:acme/widgets.git\n' : okDeps().git(args)),
    resolvePolicy: policyFake({ 'integration-branch': 'main', 'work-links': 'body-text' }),
    execFile: async (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'list' && args.includes('open')) {
        listCalls.push(args);
        return { stdout: JSON.stringify([{ number: 1600, title: 'Dependent', body: 'Blocked by #1535\n' }]), stderr: '' };
      }
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'list' && args.includes('all')) {
        listCalls.push(args);
        return { stdout: JSON.stringify([{ number: 1535, state: 'CLOSED' }]), stderr: '' };
      }
      return okDeps().execFile(cmd, args);
    },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['unblocked'], deps });
  assert.strictEqual(pack.unblocked.ok, true);
  assert.strictEqual(listCalls.length, 2, `expected both the open-state and all-state gh issue list calls: ${JSON.stringify(listCalls)}`);
  for (const call of listCalls) {
    const repoIdx = call.indexOf('--repo');
    assert.notStrictEqual(repoIdx, -1, `every gh issue list call must carry --repo on a GHE remote: ${JSON.stringify(call)}`);
    assert.strictEqual(call[repoIdx + 1], 'ghe.example.com/acme/widgets');
  }
});

test('#2425: no resolvable `origin` remote falls back to calling resolve-blockers.js without --repo (additive, never a hard failure)', async () => {
  const calls = [];
  const deps = okDeps({
    git: (args) => { if (args[0] === 'remote') throw new Error('fatal: No such remote \'origin\''); return okDeps().git(args); },
    execFile: async (cmd, args) => {
      if (cmd === 'node' && String(args[0]).endsWith('resolve-blockers.js')) {
        calls.push(args);
        return { stdout: JSON.stringify({ 1600: { blockedBy: [1535], openBlocker: false } }), stderr: '' };
      }
      return okDeps().execFile(cmd, args);
    },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['unblocked'], deps });
  assert.strictEqual(pack.unblocked.ok, true);
  assert.ok(!calls[0].includes('--repo'), `must not pass --repo when origin can't be resolved: ${JSON.stringify(calls[0])}`);
});

// The two assertions above compare a probe's value against the fake's own
// return, so a fake that has drifted from the real module's output shape makes
// them green against a shape the pack never actually produces. Each fake's key
// set is therefore cross-checked against the real function's (#1930 fix round 4).
test('the blastRadius and claim fakes carry exactly the keys their real modules return (#1930 fix round 4)', () => {
  const { computeBlastRadius } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'blast-radius-cli.js'));
  const { classifyClaimBlob } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'issues', 'claims.js'));

  const realBlastRadius = computeBlastRadius({ base: 'abc123', integrationBranch: 'main' }, {
    git: (args) => (args[0] === 'diff' ? '1\t0\tREADME.md\n' : 'abc123\n'),
    readFile: () => null,
  });
  assert.deepStrictEqual(Object.keys(okDeps().computeBlastRadius()).sort(), Object.keys(realBlastRadius).sort());

  // The claim probe spreads classifyClaimBlob's result and adds `via`; the
  // sample is the live-claim blob `_shared/issue-claims.md` writes.
  const sampleBlob = JSON.stringify({ runId: 'r', sessionId: 's', claimedAt: new Date(0).toISOString(), ttlHours: 72, host: '' });
  const realClaimKeys = Object.keys({ ...classifyClaimBlob(sampleBlob, 0), via: 'git' }).sort();
  assert.deepStrictEqual(realClaimKeys, ['reclaimable', 'state', 'via']);
  assert.deepStrictEqual(Object.keys({ ...okDeps().classifyClaimBlob(), via: 'git' }).sort(), realClaimKeys);
});

test('gatherPack: one probe throwing degrades only its field, the pack still resolves (#1930 AC1)', async () => {
  const deps = okDeps({ execFile: async (cmd, args) => { if (String(args[0]).endsWith('residue.js')) throw new Error('residue exploded'); return okDeps().execFile(cmd, args); } });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', deps });
  assert.strictEqual(pack.residue.ok, false);
  assert.match(pack.residue.error, /residue exploded/);
  for (const name of PROBE_NAMES.filter((n) => n !== 'residue')) assert.strictEqual(pack[name].ok, true, name);
});

test('gatherPack: a residue subprocess killed by the exec timeout reports a timeout, not "Command failed" (#3479)', async () => {
  const deps = okDeps({ execFile: async (cmd, args) => {
    if (String(args[0]).endsWith('residue.js')) { const e = new Error(`Command failed: node ${args[0]}`); e.killed = true; e.signal = 'SIGTERM'; e.code = null; throw e; }
    return okDeps().execFile(cmd, args);
  } });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['residue'], deps });
  assert.strictEqual(pack.residue.ok, false);
  assert.match(pack.residue.error, /^timeout after 30000ms: node residue\.js \(killed by SIGTERM\)$/);
});

test('gatherPack: a residue subprocess killed with a null signal names the timeout, never "killed by null" (#3479)', async () => {
  const deps = okDeps({ execFile: async (cmd, args) => {
    if (String(args[0]).endsWith('residue.js')) { const e = new Error(`Command failed: node ${args[0]}`); e.killed = true; e.signal = null; e.code = null; throw e; }
    return okDeps().execFile(cmd, args);
  } });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['residue'], deps });
  assert.strictEqual(pack.residue.ok, false);
  assert.match(pack.residue.error, /^timeout after 30000ms: node residue\.js \(killed by timeout\)$/);
});

test('gatherPack: a residue subprocess that never settles reports a timeout (#3479)', async () => {
  const deps = okDeps({ probeTimeoutMs: 25, execFile: async (cmd, args) => (String(args[0]).endsWith('residue.js') ? new Promise(() => {}) : okDeps().execFile(cmd, args)) });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['residue'], deps });
  assert.strictEqual(pack.residue.ok, false);
  assert.match(pack.residue.error, /timeout after 25ms/);
});

test('gatherPack: a maxBuffer overflow is not relabeled as a timeout (#3479)', async () => {
  const deps = okDeps({ execFile: async (cmd, args) => {
    if (String(args[0]).endsWith('residue.js')) { const e = new Error('stdout maxBuffer length exceeded'); e.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'; throw e; }
    return okDeps().execFile(cmd, args);
  } });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['residue'], deps });
  assert.strictEqual(pack.residue.error, 'stdout maxBuffer length exceeded');
});

test('gatherPack: a gh call killed by the exec timeout names gh and the timeout (#3479)', async () => {
  const deps = okDeps({ execFile: async (cmd, args) => {
    if (cmd === 'gh') { const e = new Error('Command failed: gh pr view'); e.killed = true; e.signal = 'SIGTERM'; throw e; }
    return okDeps().execFile(cmd, args);
  } });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['pr'], deps });
  assert.match(pack.pr.error, /^timeout after 30000ms: gh pr \(killed by SIGTERM\)$/);
});

test('gatherPack: --only runs only the named probes and still carries inputs/generatedAt/durationMs (#1930 AC2)', async () => {
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['residue', 'pr'], deps: okDeps() });
  assert.deepStrictEqual(Object.keys(pack).sort(), ['durationMs', 'generatedAt', 'inputs', 'pr', 'residue']);
});

test('gatherPack runs the probes concurrently — eight 200 ms probes finish well under 2 s (#1930 AC4)', async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const slow = okDeps({
    execFile: async (cmd, args) => { await sleep(200); return okDeps().execFile(cmd, args); },
    computeBlastRadius: async () => { await sleep(200); return { summary: {} }; },
    readClaimBlob: async () => { await sleep(200); return { content: null, failure: null, absent: true }; },
  });
  const t0 = Date.now();
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', deps: slow });
  const wall = Date.now() - t0;
  assert.ok(wall < 600, `wall ${wall} ms`);
  assert.ok(pack.durationMs < 600, `pack.durationMs ${pack.durationMs}`);
});

test('gatherPack: a probe that never settles is bounded by deps.probeTimeoutMs rather than hanging the pack (#1930 review I3)', async () => {
  const deps = okDeps({ probeTimeoutMs: 25, computeBlastRadius: () => new Promise(() => {}) });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['blastRadius', 'ledger'], deps });
  assert.strictEqual(pack.blastRadius.ok, false);
  assert.strictEqual(pack.blastRadius.error, 'timeout after 25ms');
  assert.strictEqual(pack.ledger.ok, true, 'the bound is per probe, not per pack');
});

test('gatherPack: the ledger probe counts rows by status and phase from the worktree ledgers naming a record (#1930)', async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-tree-'));
  fs.mkdirSync(path.join(tree, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'docs', 'plans', '2026-09-05-spec-1535-ledger.md'), [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    '| 1 | review | a | open | — |', '| 2 | review | b | fixed | x |', '| 3 | build | c | observation | — |',
  ].join('\n'));
  const runDir = fixtureRunDir();
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  state.worktree = tree;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps({ git: ownedGit(['docs/plans/2026-09-05-spec-1535-ledger.md']) }) });
  assert.deepStrictEqual(pack.ledger.value, {
    open: 1,
    total: 3,
    byPhase: { review: { open: 1, total: 2, unrecognized: 0 }, build: { open: 0, total: 1, unrecognized: 0 } },
    files: ['docs/plans/2026-09-05-spec-1535-ledger.md'],
    unattributedFiles: [],
    unrecognized: 0,
    unrecognizedValues: [],
    deferredUnstaged: 0,
    deferredUnstagedItems: [],
    missingDeferReason: 0,
    missingDeferReasonItems: [],
  });
});

// #2080: an out-of-enum Status cell (a typo, a retired synonym like `staged`/
// `resolved`) must be counted as `unrecognized` — distinguishable from both
// `open` (blocking) and a legitimate terminal status — never silently folded
// into "terminal" the way it was before this fix.
test('gatherPack: the ledger probe counts an out-of-enum status as unrecognized, not silently terminal (#2080)', async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-tree-'));
  fs.mkdirSync(path.join(tree, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'docs', 'plans', '2026-09-05-spec-1535-ledger.md'), [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    '| 1 | review | a | open | — |',
    '| 2 | review | b | fixed | x |',
    '| 3 | build | c | staged | parent staged/x.md |',
    '| 4 | build | d | resolved | n/a |',
  ].join('\n'));
  const runDir = fixtureRunDir();
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  state.worktree = tree;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps({ git: ownedGit(['docs/plans/2026-09-05-spec-1535-ledger.md']) }) });
  assert.strictEqual(pack.ledger.value.unrecognized, 2);
  assert.deepStrictEqual(pack.ledger.value.unrecognizedValues.sort(), ['resolved', 'staged']);
  assert.strictEqual(pack.ledger.value.byPhase.build.unrecognized, 2);
  assert.strictEqual(pack.ledger.value.byPhase.review.unrecognized, 0);
  // Unrecognized rows were never `open` and must not become blocking now.
  assert.strictEqual(pack.ledger.value.open, 1);
  assert.strictEqual(pack.ledger.value.total, 4);
});

test('gatherPack: the ledger probe reports zero unrecognized rows when every status is in the closed enum (#2080)', async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-tree-'));
  fs.mkdirSync(path.join(tree, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'docs', 'plans', '2026-09-05-spec-1535-ledger.md'), [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    '| 1 | review | a | open | — |', '| 2 | review | b | fixed | x |',
  ].join('\n'));
  const runDir = fixtureRunDir();
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  state.worktree = tree;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps({ git: ownedGit(['docs/plans/2026-09-05-spec-1535-ledger.md']) }) });
  assert.strictEqual(pack.ledger.value.unrecognized, 0);
  assert.deepStrictEqual(pack.ledger.value.unrecognizedValues, []);
});

// Helper for the #3327 tests: a worktree whose docs/plans holds the
// given ledger files, wired into a fixture run dir, probed with only: ['ledger'].
async function probeLedgers(files, { records = [1535] } = {}) {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-tree-'));
  fs.mkdirSync(path.join(tree, 'docs', 'plans'), { recursive: true });
  for (const [name, rows] of Object.entries(files)) {
    fs.writeFileSync(path.join(tree, 'docs', 'plans', name), ['| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|', ...rows].join('\n'));
  }
  const runDir = fixtureRunDir({ records });
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  state.worktree = tree;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  const owned = Object.keys(files).map((name) => `docs/plans/${name}`);
  return { pack: await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps({ git: ownedGit(owned) }) }), runDir, tree };
}

// #3327: a `deferred` row must name where its work went — a `staged/…` proposal
// or a `#N` record reference. A triage-only Resolution is parked with no trace.
test('AC1.1: a deferred row with no staged/ path and no #N reference is reported as deferredUnstaged (#3327)', async () => {
  const { pack } = await probeLedgers({ '2026-09-05-spec-1535-ledger.md': [
    '| 1 | review | a | open | — |',
    '| 2 | review | b | deferred | Origin: SDD Task 1 review; files: a.md. Trigger: next edit |',
    '| 3 | build | c | deferred | — |',
    '| 4 | build | see #77 | Deferred | triage: leave |',
  ] });
  assert.strictEqual(pack.ledger.value.deferredUnstaged, 3);
  assert.deepStrictEqual(pack.ledger.value.deferredUnstagedItems, [
    'docs/plans/2026-09-05-spec-1535-ledger.md#2',
    'docs/plans/2026-09-05-spec-1535-ledger.md#3',
    'docs/plans/2026-09-05-spec-1535-ledger.md#4',
  ]);
  assert.strictEqual(pack.ledger.value.open, 1);          // flagged rows never become open
  assert.strictEqual(pack.ledger.value.unrecognized, 0);  // …nor unrecognized
});

test('AC2.1: a deferred row naming staged/… or #N stays terminal (#3327)', async () => {
  const { pack } = await probeLedgers({ '2026-09-05-spec-1535-ledger.md': [
    '| 1 | review | a | deferred | parked → `staged/ledger-record-foo.md` |',
    '| 2 | review | b | deferred | → backlog #123 |',
    '| 3 | build | c | deferred | reversed → thn-inc/claude-tweaks#456 |',
  ] });
  assert.strictEqual(pack.ledger.value.deferredUnstaged, 0);
  assert.deepStrictEqual(pack.ledger.value.deferredUnstagedItems, []);
});

test('AC2.1: a deferred row naming a record by issue/PR URL stays terminal (#3327)', async () => {
  const { pack } = await probeLedgers({ '2026-09-05-spec-1535-ledger.md': [
    '| 1 | review | a | deferred | → backlog https://github.com/o/r/issues/3349 (tangential) |',
    '| 2 | review | b | deferred | → https://github.com/o/r/pull/77 |',
  ] });
  assert.strictEqual(pack.ledger.value.deferredUnstaged, 0);
  assert.deepStrictEqual(pack.ledger.value.deferredUnstagedItems, []);
});

test("AC1.1: a deferred row whose only #N is the run's own record, or a ledger-item cross-reference, is flagged (#3327)", async () => {
  const { pack } = await probeLedgers({ '2026-09-05-spec-1535-ledger.md': [
    '| 1 | review | a | deferred | Origin: SDD Task 1 review of #1535; trigger: next edit |',
    '| 2 | review | b | deferred | same as ledger item #1 — leave |',
    '| 3 | review | c | deferred | see item #4 |',
    '| 4 | review | d | deferred | origin #1535, carried by #2000 |',
  ] });
  assert.strictEqual(pack.ledger.value.deferredUnstaged, 3);
  assert.deepStrictEqual(pack.ledger.value.deferredUnstagedItems, [
    'docs/plans/2026-09-05-spec-1535-ledger.md#1',
    'docs/plans/2026-09-05-spec-1535-ledger.md#2',
    'docs/plans/2026-09-05-spec-1535-ledger.md#3',
  ]);
});

test('AC1.1: a deferred row with a truly empty Resolution cell is flagged (#3327)', async () => {
  const { pack } = await probeLedgers({ '2026-09-05-spec-1535-ledger.md': ['| 2 | build | x | deferred |  |'] });
  assert.strictEqual(pack.ledger.value.deferredUnstaged, 1);
  assert.deepStrictEqual(pack.ledger.value.deferredUnstagedItems, ['docs/plans/2026-09-05-spec-1535-ledger.md#2']);
});

test('AC1.1: parseLedger defaults excludeRecords to [] — a one-arg call counts the run-own #N as a reference (#3327)', () => {
  const text = '| 1 | build | a | deferred | origin #1535 |';
  assert.strictEqual(parseLedger(text).deferredUnstaged, 0);
  assert.strictEqual(parseLedger(text, { excludeRecords: [1535] }).deferredUnstaged, 1);
  assert.deepStrictEqual(parseLedger(text, { excludeRecords: [1535] }).deferredUnstagedItems, ['1']);
});

test("AC1.1: a pipe inside a deferred row's Resolution stays in the Resolution cell (#3327)", () => {
  const text = [
    '| 1 | build | a | deferred | triage a | b → staged/ledger-record-foo.md |',
    '| 2 | build | b | deferred | triage a | b |',
  ].join('\n');
  const one = parseLedger(text);
  assert.strictEqual(one.deferredUnstaged, 1);
  assert.deepStrictEqual(one.deferredUnstagedItems, ['2']);
});

test('AC1.1: parseLedger reads a row whose Item carries an escaped pipe as 5 columns (status recognized, Defer-reason found)', () => {
  const text = [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    String.raw`| 1 | build | Ruling: a\|b\|c | deferred | Defer-reason: genuinely-larger |`,
    String.raw`| 2 | review | quote x\|y | fixed | done |`,
    String.raw`| 3 | test | open item p\|q | open | — |`,
  ].join('\n');
  const r = parseLedger(text);
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.unrecognized, 0);
  assert.strictEqual(r.open, 1);
  assert.deepStrictEqual(r.byPhase.build, { open: 0, total: 1, unrecognized: 0 });
  assert.strictEqual(r.missingDeferReason, 0);
});

test('parseLedger reads an escaped pipe in the Resolution cell without losing the Defer-reason', () => {
  const text = [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    String.raw`| 1 | build | split work | deferred | Defer-reason: genuinely-larger; see a\|b |`,
  ].join('\n');
  const r = parseLedger(text);
  assert.strictEqual(r.total, 1);
  assert.strictEqual(r.missingDeferReason, 0);
  assert.strictEqual(r.unrecognized, 0);
});

test('AC1.1: deferredUnstagedItems are qualified by the counted file across multiple ledgers (#3327)', async () => {
  const { pack } = await probeLedgers({
    '2026-09-05-a-ledger.md': ['| 2 | build | a | deferred | — |', '| 3 | build | b | deferred | → #900 |'],
    '2026-09-05-b-ledger.md': ['| 2 | build | c | deferred | triage: leave |', '| 5 | build | d | deferred | — |'],
  });
  assert.strictEqual(pack.ledger.value.deferredUnstaged, 3);
  assert.deepStrictEqual(pack.ledger.value.deferredUnstagedItems.sort(), [
    'docs/plans/2026-09-05-a-ledger.md#2',
    'docs/plans/2026-09-05-b-ledger.md#2',
    'docs/plans/2026-09-05-b-ledger.md#5',
  ]);
});

test('AC1.1: the run-dir ledger.md branch reports deferredUnstaged with ledger.md#N ids and excludes the run record (#3327)', async () => {
  const { runDir, tree } = await probeLedgers({});
  fs.writeFileSync(path.join(runDir, 'ledger.md'), [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    '| 1 | build | a | open | — |',
    '| 2 | build | b | deferred | origin #1535 |',
    '| 3 | build | c | deferred | → backlog #2000 |',
    '| 4 | build | d | deferred | — |',
  ].join('\n'));
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps() });
  assert.deepStrictEqual(pack.ledger.value.files, ['ledger.md']);
  assert.strictEqual(pack.ledger.value.deferredUnstaged, 2);
  assert.deepStrictEqual(pack.ledger.value.deferredUnstagedItems, ['ledger.md#2', 'ledger.md#4']);
  assert.strictEqual(pack.ledger.value.open, 1);
});

// #3004: /build must not park a review minor without a valid Defer-reason:. The
// backstop flags build-phase deferred/open rows whose Resolution carries no
// single in-vocabulary reason, and exempts rows whose reason lives elsewhere.
test('AC2.1 AC2.2: parseLedger reports exactly the build rows lacking a valid Defer-reason (#3004)', () => {
  const text = [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    '| 1 | build | a | deferred | Defer-reason: tangential — origin SDD Task 2 review; files: x.js; revisit when x.js next changes |',
    '| 2 | build | b | deferred | SDD minor (deferred), triaged fine-to-defer by the whole-branch review. |',
    '| 3 | build | c | open | — |',
  ].join('\n');
  const r = parseLedger(text);
  assert.strictEqual(r.missingDeferReason, 2);
  assert.deepStrictEqual(r.missingDeferReasonItems, ['2', '3']);
});

test('#3004 review focus: blocked reason ok, bad/duplicate reason flagged, other phases and staged rulings exempt', () => {
  const text = [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    '| 1 | build | blocked on API | open | Defer-reason: blocked-dependency — unblocks when the API ships |',
    '| 2 | build | d | deferred | Defer-reason: minor |',
    '| 3 | build | e | Deferred | Defer-reason: tangential; Defer-reason: genuinely-larger |',
    '| 4 | build | SDD ruling — x: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |',
    '| 5 | build/skill | f | open | — |',
    '| 6 | build/docs | g | open | — |',
    '| 7 | review | h | open | — |',
    '| 8 | build | i | fixed | abc1234 |',
    '| 9 | build | j | deferred | filed as #77 |',
    '| 10 | build | SDD ruling — chose X over Y: ratify or reverse at the Review Console | open | — |',
    '| 11 | build | k | deferred | Defer-reason: tangential2 |',
  ].join('\n');
  const r = parseLedger(text);
  assert.deepStrictEqual(r.missingDeferReasonItems, ['2', '3', '11']);
  assert.strictEqual(r.missingDeferReason, 3);
  // A record reference carries the reason in that record's own Defer-reason:, except
  // the run's own record, which is not a carrying reference.
  assert.deepStrictEqual(parseLedger(text, { excludeRecords: [77] }).missingDeferReasonItems, ['2', '3', '9', '11']);
});

test('AC2.1: gatherPack reports missingDeferReasonItems qualified by file, without changing open (#3004)', async () => {
  const { pack } = await probeLedgers({ '2026-09-05-spec-1535-ledger.md': [
    '| 1 | build | a | deferred | Defer-reason: tangential |',
    '| 2 | build | b | open | — |',
  ] });
  assert.deepStrictEqual(pack.ledger.value.missingDeferReasonItems, ['docs/plans/2026-09-05-spec-1535-ledger.md#2']);
  assert.strictEqual(pack.ledger.value.missingDeferReason, 1);
  assert.strictEqual(pack.ledger.value.open, 1);
});

test('AC2.1: missingDeferReasonItems keeps both file-qualified ids when two ledgers flag the same row id (#3004)', async () => {
  const { pack } = await probeLedgers({
    '2026-09-05-a-ledger.md': ['| 2 | build | a | open | — |'],
    '2026-09-05-b-ledger.md': ['| 2 | build | b | deferred | Defer-reason: tangential2 |'],
  });
  assert.strictEqual(pack.ledger.value.missingDeferReason, 2);
  assert.deepStrictEqual(pack.ledger.value.missingDeferReasonItems.sort(), [
    'docs/plans/2026-09-05-a-ledger.md#2',
    'docs/plans/2026-09-05-b-ledger.md#2',
  ]);
});

test('AC2.1: the run-dir ledger.md branch reports missingDeferReasonItems with ledger.md#N ids (#3004)', async () => {
  const { runDir, tree } = await probeLedgers({});
  fs.writeFileSync(path.join(runDir, 'ledger.md'), [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    '| 1 | build | a | deferred | Defer-reason: genuinely-larger |',
    '| 2 | build | b | deferred | triaged fine |',
  ].join('\n'));
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps() });
  assert.deepStrictEqual(pack.ledger.value.missingDeferReasonItems, ['ledger.md#2']);
  assert.strictEqual(pack.ledger.value.missingDeferReason, 1);
});

test('gatherPack: a ledger whose DATE prefix contains the record number is not this record\'s ledger (#1930 review M5)', async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-tree-'));
  fs.mkdirSync(path.join(tree, 'docs', 'plans'), { recursive: true });
  // Record 26 must NOT match the '2026-' date prefix of a stranger's ledger…
  fs.writeFileSync(path.join(tree, 'docs', 'plans', '2026-09-05-spec-99-ledger.md'), '| # | Phase | Item | Status | Resolution |\n| 1 | review | a | open | — |');
  // …but must still match its own, named at a real boundary.
  fs.writeFileSync(path.join(tree, 'docs', 'plans', '2025-01-02-spec-26-ledger.md'), '| # | Phase | Item | Status | Resolution |\n| 1 | build | b | fixed | x |');
  const runDir = fixtureRunDir({ records: [26] });
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  state.worktree = tree;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps({ git: ownedGit(['docs/plans/2026-09-05-spec-99-ledger.md', 'docs/plans/2025-01-02-spec-26-ledger.md']) }) });
  assert.deepStrictEqual(pack.ledger.value.files, ['docs/plans/2025-01-02-spec-26-ledger.md']);
  assert.strictEqual(pack.ledger.value.total, 1);
  assert.deepStrictEqual(pack.ledger.value.unattributedFiles, ['docs/plans/2026-09-05-spec-99-ledger.md']);
});

// #2563: _shared/ledger-format.md's Location section defines the canonical
// filename as embedding the plan/spec TOPIC slug, not the record number —
// `namesRecord` never matches this shape at all, so a bare record-number
// filter silently excluded it and reported 0 items even though the file held
// genuinely open rows.
test('gatherPack: the ledger probe locates a topic-slug-named ledger with no record number in the filename (#2563 AC1)', async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-tree-'));
  fs.mkdirSync(path.join(tree, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'docs', 'plans', '2026-09-05-ledger-probe-slug-fix-ledger.md'), [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    '| 1 | review | a | open | — |', '| 2 | build | b | open | — |', '| 3 | build | c | fixed | x |',
  ].join('\n'));
  const runDir = fixtureRunDir({ records: [1535] });
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  state.worktree = tree;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps({ git: ownedGit(['docs/plans/2026-09-05-ledger-probe-slug-fix-ledger.md']) }) });
  assert.deepStrictEqual(pack.ledger.value.files, ['docs/plans/2026-09-05-ledger-probe-slug-fix-ledger.md']);
  assert.strictEqual(pack.ledger.value.open, 2);
  assert.strictEqual(pack.ledger.value.total, 3);
});

// #2545 wrap-up finding: a stray, fully-resolved ledger inherited from an
// already-merged run sits beside this run's own topic-slug ledger, and neither
// names the record at a boundary. Name matching cannot tell them apart, so
// ownership by branch diff decides: only the ledger this branch added counts.
test('AC2.1: one ledger added on the branch plus inherited ledgers counts only the added ledger\'s items', async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-tree-'));
  fs.mkdirSync(path.join(tree, 'docs', 'plans'), { recursive: true });
  // A fully-resolved stray ledger from an unrelated, already-merged run.
  fs.writeFileSync(path.join(tree, 'docs', 'plans', '2026-09-30-flow-spec-2704-2709-ledger.md'), [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    '| 1 | review | a | accepted | reason |',
  ].join('\n'));
  // This run's own topic-slug ledger, with genuinely open items.
  fs.writeFileSync(path.join(tree, 'docs', 'plans', '2026-10-02-harness-health-validate-findings-local-only-ledger.md'), [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    '| 1 | review | b | open | — |', '| 2 | wrap-up | c | open | — |',
  ].join('\n'));
  const runDir = fixtureRunDir({ records: [2545] });
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  state.worktree = tree;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  const owned = 'docs/plans/2026-10-02-harness-health-validate-findings-local-only-ledger.md';
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps({ git: ownedGit([owned]) }) });
  assert.strictEqual(pack.ledger.value.open, 2);
  assert.strictEqual(pack.ledger.value.total, 2);
  assert.deepStrictEqual(pack.ledger.value.files, [owned]);
  assert.deepStrictEqual(pack.ledger.value.unattributedFiles, ['docs/plans/2026-09-30-flow-spec-2704-2709-ledger.md']);
});

test('AC1.1: a worktree holding one ledger inherited from the merge base reports open 0, total 0 and lists it as unattributed', async () => {
  const name = '2026-10-03-record-2853-ledger.md';
  const { runDir, tree } = treeWithLedgers({ [name]: OPEN_REVIEW_LEDGER });
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps({ git: ownedGit([]) }) });
  assert.strictEqual(pack.ledger.value.open, 0);
  assert.strictEqual(pack.ledger.value.total, 0);
  assert.deepStrictEqual(pack.ledger.value.files, []);
  assert.deepStrictEqual(pack.ledger.value.unattributedFiles, [`docs/plans/${name}`]);
  assert.deepStrictEqual(pack.ledger.value.byPhase, {});
});

test('AC1.1: several inherited ledgers with none owned report zero and list every one as unattributed', async () => {
  const a = '2026-10-03-record-2853-ledger.md';
  const b = '2026-10-04-topic-slug-ledger.md';
  const open = `${LEDGER_HEAD}| 1 | build | a | open | — |`;
  const { runDir, tree } = treeWithLedgers({ [a]: open, [b]: open });
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps({ git: ownedGit([]) }) });
  assert.strictEqual(pack.ledger.value.open, 0);
  assert.strictEqual(pack.ledger.value.total, 0);
  assert.deepStrictEqual(pack.ledger.value.files, []);
  assert.deepStrictEqual(pack.ledger.value.unattributedFiles.sort(), [`docs/plans/${a}`, `docs/plans/${b}`].sort());
});

test('an untracked ledger in the worktree counts as owned', async () => {
  const name = 'x-ledger.md';
  const { runDir, tree } = treeWithLedgers({ [name]: OPEN_REVIEW_LEDGER });
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps({ git: ownedGit([], [`docs/plans/${name}`]) }) });
  assert.strictEqual(pack.ledger.value.open, 1);
  assert.deepStrictEqual(pack.ledger.value.files, [`docs/plans/${name}`]);
  assert.deepStrictEqual(pack.ledger.value.unattributedFiles, []);
});

test('two owned ledgers tie-break on namesRecord', async () => {
  const named = '2025-01-02-spec-26-ledger.md';
  const stray = '2026-09-05-spec-99-ledger.md';
  const { runDir, tree } = treeWithLedgers({
    [named]: `${LEDGER_HEAD}| 1 | build | b | fixed | x |`,
    [stray]: OPEN_REVIEW_LEDGER,
  }, { records: [26] });
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps({ git: ownedGit([`docs/plans/${named}`, `docs/plans/${stray}`]) }) });
  assert.deepStrictEqual(pack.ledger.value.files, [`docs/plans/${named}`]);
  assert.strictEqual(pack.ledger.value.total, 1);
  assert.deepStrictEqual(pack.ledger.value.unattributedFiles, [`docs/plans/${stray}`]);
});

test('ownership unknowable without a merge base fails the probe', async () => {
  const { runDir, tree } = treeWithLedgers({ 'x-ledger.md': OPEN_REVIEW_LEDGER });
  const base = ownedGit([]);
  const deps = okDeps({ git: (args, opts) => { if (args[0] === 'merge-base') throw new Error('fatal: no merge base'); return base(args, opts); } });
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps });
  assert.strictEqual(pack.ledger.ok, false);
  assert.match(pack.ledger.error, /merge base/);
});

test('a failing ownership git call fails the probe', async () => {
  const { runDir, tree } = treeWithLedgers({ 'x-ledger.md': OPEN_REVIEW_LEDGER });
  const base = ownedGit([]);
  const deps = okDeps({ git: (args, opts) => { if (args[0] === 'diff') throw new Error('git down'); return base(args, opts); } });
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps });
  assert.strictEqual(pack.ledger.ok, false);
  assert.match(pack.ledger.error, /git down/);
});

test('no docs/plans ledgers reports zeros without consulting git', async () => {
  const { runDir, tree } = treeWithLedgers({});
  const gitCalls = [];
  const base = ownedGit([]);
  const deps = okDeps({ git: (args, opts) => { gitCalls.push(args); return base(args, opts); } });
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps });
  assert.deepStrictEqual(pack.ledger.value, { open: 0, total: 0, byPhase: {}, files: [], unattributedFiles: [], unrecognized: 0, unrecognizedValues: [], deferredUnstaged: 0, deferredUnstagedItems: [], missingDeferReason: 0, missingDeferReasonItems: [] });
  assert.ok(!gitCalls.some((a) => a[0] === 'diff' || a[0] === 'ls-files'), `no ownership git call: ${JSON.stringify(gitCalls)}`);
});

// #2563 AC4: _shared/ledger-format.md's resolution rule — when {run-dir}/
// ledger.md exists (the gated no-worktree case), that file is authoritative
// and the docs/plans/ glob is never consulted, even when a stray docs/plans
// ledger is also present.
test('gatherPack: {run-dir}/ledger.md is authoritative over the docs/plans/ glob when it exists (#2563 AC4)', async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-tree-'));
  fs.mkdirSync(path.join(tree, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'docs', 'plans', '2026-09-05-spec-1535-ledger.md'), '| # | Phase | Item | Status | Resolution |\n| 1 | review | a | open | — |');
  const runDir = fixtureRunDir({ records: [1535] });
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  state.worktree = tree;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(runDir, 'ledger.md'), [
    '| # | Phase | Item | Status | Resolution |', '|---|---|---|---|---|',
    '| 1 | build | a | open | — |', '| 2 | build | b | open | — |', '| 3 | build | c | open | — |',
  ].join('\n'));
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps() });
  assert.deepStrictEqual(pack.ledger.value.files, ['ledger.md']);
  assert.strictEqual(pack.ledger.value.open, 3);
  assert.strictEqual(pack.ledger.value.total, 3);
  assert.ok(!Object.prototype.hasOwnProperty.call(pack.ledger.value, 'unattributedFiles'), 'the run-dir branch keeps its pre-#2887 shape');
});

test('gatherPack: a missing gh binary degrades pr/recordLabels/unblocked to error gh-absent, nothing else (#1930 Gotchas)', async () => {
  const deps = okDeps({ execFile: async (cmd, args) => { if (cmd === 'gh') { const e = new Error('spawn gh ENOENT'); e.code = 'ENOENT'; throw e; } return okDeps().execFile(cmd, args); } });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', deps });
  for (const n of ['pr', 'recordLabels', 'unblocked']) { assert.strictEqual(pack[n].ok, false, n); assert.strictEqual(pack[n].error, 'gh-absent', n); }
  assert.strictEqual(pack.residue.ok, true);
  assert.strictEqual(pack.claim.ok, true);
});

test('gatherPack: a non-forge project reports pr/recordLabels as no-forge (#1930 Gotchas)', async () => {
  const deps = okDeps({ readFile: readFileFake('work-backend: local-files\n'), resolvePolicy: policyFake({ 'work-links': 'body-text', 'integration-branch': 'main' }) });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', deps });
  for (const n of ['pr', 'recordLabels']) { assert.strictEqual(pack[n].ok, false, n); assert.strictEqual(pack[n].error, 'no-forge', n); }
});

test('gatherPack: a work-backend that is neither github-issues nor local-files makes unblocked no-forge (#1930 review I2)', async () => {
  const deps = okDeps({ readFile: readFileFake('work-backend: gitlab-issues\n'), resolvePolicy: policyFake({ 'integration-branch': 'main' }) });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['unblocked'], deps });
  assert.strictEqual(pack.unblocked.ok, false);
  assert.strictEqual(pack.unblocked.error, 'no-forge');
});

test('gatherPack: work-backend local-files reads the local store, keeping only records whose every other blocker is closed (#1930 review I2)', async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-local-'));
  fs.mkdirSync(path.join(tree, 'specs'), { recursive: true });
  for (const f of ['1600-dependent.md', '1601-still-held.md', '9-open-blocker.md', '8-closed-blocker.md']) {
    fs.writeFileSync(path.join(tree, 'specs', f), '# x\n');
  }
  const store = {
    1600: { id: 1600, title: 'Dependent', facets: { blockedBy: [1535, 8], closed: false } },
    1601: { id: 1601, title: 'Still held', facets: { blockedBy: [1535, 9], closed: false } },
    8: { id: 8, title: 'Closed blocker', facets: { blockedBy: [], closed: true } },
    9: { id: 9, title: 'Open blocker', facets: { blockedBy: [], closed: false } },
  };
  const deps = okDeps({
    readFile: readFileFake('work-backend: local-files\n'),
    resolvePolicy: policyFake({ 'integration-branch': 'main' }),
    queryRecords: () => [store[1600], store[1601]],
    readRecord: (p) => store[Number(path.basename(p).split('-')[0])],
    execFile: async () => { throw new Error('local-files must not shell out to gh'); },
  });
  const runDir = fixtureRunDir();
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  state.worktree = tree;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  const pack = await gatherPack({ runDir, cwd: tree, only: ['unblocked'], deps });
  assert.deepStrictEqual(pack.unblocked.value, [{ number: 1600, title: 'Dependent' }]);
});

test('gatherPack: local-files — a dependent\'s blocker file pruned between readdir and read counts as already gone, not a probe failure (#1930 review lens 3c)', async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-local-race-'));
  fs.mkdirSync(path.join(tree, 'specs'), { recursive: true });
  for (const f of ['1600-dependent.md', '8-vanishing-blocker.md']) fs.writeFileSync(path.join(tree, 'specs', f), '# x\n');
  const store = { 1600: { id: 1600, title: 'Dependent', facets: { blockedBy: [1535, 8], closed: false } } };
  const deps = okDeps({
    readFile: readFileFake('work-backend: local-files\n'),
    resolvePolicy: policyFake({ 'integration-branch': 'main' }),
    queryRecords: () => [store[1600]],
    readRecord: (p) => {
      const id = Number(path.basename(p).split('-')[0]);
      if (id === 8) { const e = new Error('ENOENT: pruned by a sibling session'); e.code = 'ENOENT'; throw e; }
      return store[id];
    },
    execFile: async () => { throw new Error('local-files must not shell out to gh'); },
  });
  const runDir = fixtureRunDir();
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  state.worktree = tree;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  const pack = await gatherPack({ runDir, cwd: tree, only: ['unblocked'], deps });
  assert.strictEqual(pack.unblocked.ok, true, 'a vanished blocker is the "already gone" outcome');
  assert.deepStrictEqual(pack.unblocked.value, [{ number: 1600, title: 'Dependent' }]);
});

test('gatherPack: a ledger file archived between readdir and read is skipped, not a whole-probe failure (#1930 review lens 3c)', async () => {
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-ledger-race-'));
  fs.mkdirSync(path.join(tree, 'docs', 'plans'), { recursive: true });
  const kept = '2026-09-05-spec-1535-ledger.md';
  const gone = '2026-09-04-spec-1535-old-ledger.md';
  fs.writeFileSync(path.join(tree, 'docs', 'plans', kept), '| # | Phase | Item | Status |\n|---|---|---|---|\n| 1 | review | a | open |\n');
  fs.writeFileSync(path.join(tree, 'docs', 'plans', gone), '| # | Phase | Item | Status |\n|---|---|---|---|\n| 1 | build | b | open |\n');
  const base = okDeps();
  const deps = okDeps({
    git: ownedGit([`docs/plans/${kept}`, `docs/plans/${gone}`]),
    readFile: (p) => {
      if (p.endsWith(gone)) { const e = new Error('ENOENT: archived by a sibling session'); e.code = 'ENOENT'; throw e; }
      return base.readFile(p);
    },
  });
  const runDir = fixtureRunDir();
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8'));
  state.worktree = tree;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps });
  assert.strictEqual(pack.ledger.ok, true, 'one vanished file does not fail the probe');
  assert.strictEqual(pack.ledger.value.total, 1, 'only the readable ledger is counted');
});

test('gatherPack: the record-scoped probes refuse an unresolved record set instead of returning a clean empty (#1930 review C2)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-norecords-'));
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree', pr: { number: 1901 } }));
  const execCalls = [];
  const gitCalls = [];
  const claimCalls = [];
  const deps = okDeps({
    execFile: async (cmd, args) => { execCalls.push([cmd, ...args]); return okDeps().execFile(cmd, args); },
    git: (args) => { gitCalls.push(args); return okDeps().git(args); },
    readClaimBlob: () => { claimCalls.push(1); return { content: null, failure: null, absent: true }; },
  });
  const pack = await gatherPack({ runDir: dir, cwd: '/w/tree', only: ['ledger', 'recordLabels', 'claim', 'unblocked'], deps });
  for (const n of ['ledger', 'recordLabels', 'claim', 'unblocked']) {
    assert.strictEqual(pack[n].ok, false, n);
    assert.strictEqual(pack[n].error, 'records unresolved — no materialized header or manifest found', n);
  }
  assert.deepStrictEqual(execCalls, [], 'no gh/node subprocess for a record-scoped probe with no records');
  assert.deepStrictEqual(claimCalls, [], 'no claim blob read either');
  assert.ok(gitCalls.every((a) => a[0] === 'merge-base'), `only resolveInputs' merge-base ran: ${JSON.stringify(gitCalls)}`);
});

test('gatherPack: unblocked refuses a multi-record run dir with "record unresolved" (#1930 review C2)', async () => {
  const pack = await gatherPack({ runDir: fixtureRunDir({ records: [1535, 1536] }), cwd: '/w/tree', only: ['unblocked'], deps: okDeps() });
  assert.strictEqual(pack.unblocked.ok, false);
  assert.strictEqual(pack.unblocked.error, 'record unresolved');
});

test('the release probe is gone — pre-merge it is a constant and its consumer runs post-merge (#1930 review I5)', () => {
  assert.ok(!PROBE_NAMES.includes('release'));
  assert.strictEqual(PROBE_NAMES.length, 8);
});

// #3310 removed the pre-merge merge-size step itself: nothing consumes a
// merge-size prediction, from the pack or from the CLI.
test('no merge-size probe anywhere in the pre-merge refresh (#1930 fix round 4, #3310)', () => {
  assert.ok(!PROBE_NAMES.includes('mergeSize'));
  const refresh = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'plugin', 'skills', '_shared', 'pr-checklist-refresh.md'), 'utf8');
  assert.ok(!refresh.includes('pack.mergeSize'), 'the pre-merge step reads no pack-fed merge size');
  assert.doesNotMatch(refresh, /merge-size-probe/, 'the pre-merge step no longer runs the probe CLI');
  const section = refresh.slice(refresh.indexOf('## Pre-merge title/description refresh'), refresh.indexOf('## Merge-time gh-absent degrade'));
  const numbers = [...section.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
  assert.deepStrictEqual(numbers, numbers.map((_, i) => i + 1), 'items are numbered contiguously from 1');
});

test('gatherPack: claim probe surfaces a clean error when readClaimBlob falls through to the gh API fallback the pack has none for (#1930 fix)', async () => {
  const deps = okDeps({
    readClaimBlob: (d) => { d.ghApi(); return { content: null, failure: null, absent: true }; },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['claim'], deps });
  assert.strictEqual(pack.claim.ok, false);
  assert.match(pack.claim.error, /claim: git transport to the claims branch failed and the pack has no gh API fallback/);
});

test('gatherPack: claim reads the claims branch from the run\'s worktree, not the pack\'s cwd (#1930 review M6)', async () => {
  const seen = [];
  const deps = okDeps({
    gitRunner: (args, opts) => { seen.push(opts && opts.cwd); return ''; },
    readClaimBlob: (d) => { d.gitRunner(['rev-parse', 'HEAD']); return { content: null, failure: null, absent: true, via: 'git' }; },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/somewhere/else', only: ['claim'], deps });
  assert.strictEqual(pack.claim.ok, true);
  assert.deepStrictEqual(seen, ['/w/tree']);
});

test('gatherPack: body-text work-links keeps a dependent only when EVERY other blocker is closed too (#1930 review I1)', async () => {
  const deps = okDeps({
    resolvePolicy: policyFake({ 'work-links': 'body-text', 'integration-branch': 'main' }),
    execFile: async (cmd, args) => {
      if (String(args[0]).endsWith('resolve-blockers.js')) throw new Error('must not be called under body-text');
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'list' && args.includes('open')) {
        return {
          stdout: JSON.stringify([
            { number: 1600, title: 'Dependent', body: 'Blocked by #1535\nBlocked by #8\n' },
            { number: 1601, title: 'Still held', body: 'Blocked by #1535\nBlocked by #9\n' },
            { number: 1602, title: 'Other', body: 'Blocked by #7\n' },
          ]),
          stderr: '',
        };
      }
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'list' && args.includes('all')) {
        return { stdout: JSON.stringify([{ number: 8, state: 'CLOSED' }, { number: 9, state: 'OPEN' }, { number: 1535, state: 'CLOSED' }]), stderr: '' };
      }
      return okDeps().execFile(cmd, args);
    },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['unblocked'], deps });
  assert.deepStrictEqual(pack.unblocked.value, [{ number: 1600, title: 'Dependent' }]);
});

test('gatherPack: body-text work-links skips the second state query entirely when nothing depends on the closed record (#1930 review I1)', async () => {
  const listed = [];
  const deps = okDeps({
    resolvePolicy: policyFake({ 'work-links': 'body-text', 'integration-branch': 'main' }),
    execFile: async (cmd, args) => {
      if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'list') { listed.push(args); return { stdout: JSON.stringify([{ number: 1602, title: 'Other', body: 'Blocked by #7\n' }]), stderr: '' }; }
      return okDeps().execFile(cmd, args);
    },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['unblocked'], deps });
  assert.deepStrictEqual(pack.unblocked.value, []);
  assert.strictEqual(listed.length, 1);
});

test('gatherPack: every subprocess call is bounded by maxBuffer and a timeout (#1930 review I3)', async () => {
  const opts = [];
  const deps = okDeps({ execFile: async (cmd, args, o) => { opts.push(o); return okDeps().execFile(cmd, args); } });
  await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', deps });
  assert.ok(opts.length > 0);
  for (const o of opts) {
    assert.strictEqual(o.maxBuffer, 32 * 1024 * 1024, JSON.stringify(o));
    assert.strictEqual(o.timeout, 30000, JSON.stringify(o));
    assert.strictEqual(o.cwd, '/w/tree', JSON.stringify(o));
  }
});

test('gatherPack: residue probe refuses to run with an unresolved merge-base rather than passing the literal "null" (#1930 fix)', async () => {
  const calls = [];
  const deps = okDeps({
    git: (args) => { if (args[0] === 'merge-base') throw new Error('no merge base'); return okDeps().git(args); },
    execFile: async (cmd, args) => { if (String(args[0]).endsWith('residue.js')) { calls.push(args); } return okDeps().execFile(cmd, args); },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['residue'], deps });
  assert.strictEqual(pack.residue.ok, false);
  assert.match(pack.residue.error, /base unresolved/);
  assert.strictEqual(calls.length, 0);
});

// #1781: the residue probe passes --own-pr {inputs.pr} only when run-state.json
// carries a pr.number — a local-merge run (no recorded pr) invokes residue.js
// with the same argv as before this change.
test('gatherPack: residue probe appends --own-pr when run-state.json carries a pr.number (#1781)', async () => {
  const calls = [];
  const deps = okDeps({
    execFile: async (cmd, args) => { if (String(args[0]).endsWith('residue.js')) { calls.push(args); } return okDeps().execFile(cmd, args); },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir({ withPr: true }), cwd: '/w/tree', only: ['residue'], deps });
  assert.strictEqual(pack.residue.ok, true);
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].includes('--own-pr'), JSON.stringify(calls[0]));
  assert.strictEqual(calls[0][calls[0].indexOf('--own-pr') + 1], '1901');
});

test('gatherPack: residue probe omits --own-pr when run-state.json carries no pr (local-merge, #1781)', async () => {
  const calls = [];
  const deps = okDeps({
    execFile: async (cmd, args) => { if (String(args[0]).endsWith('residue.js')) { calls.push(args); } return okDeps().execFile(cmd, args); },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir({ withPr: false }), cwd: '/w/tree', only: ['residue'], deps });
  assert.strictEqual(pack.residue.ok, true);
  assert.strictEqual(calls.length, 1);
  assert.ok(!calls[0].includes('--own-pr'), JSON.stringify(calls[0]));
});

test('gatherPack: state probe refuses to run with an unresolved merge-base rather than passing the literal "null" (#1930 fix)', async () => {
  const calls = [];
  const deps = okDeps({
    git: (args) => { if (args[0] === 'merge-base') throw new Error('no merge base'); return okDeps().git(args); },
    execFile: async (cmd, args) => { if (String(args[0]).endsWith('wrap-up-state.js')) { calls.push(args); } return okDeps().execFile(cmd, args); },
  });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['state'], deps });
  assert.strictEqual(pack.state.ok, false);
  assert.match(pack.state.error, /base unresolved/);
  assert.strictEqual(calls.length, 0);
});

// ---- #3399: closingRecords + parkedAtShaping ---------------------------------

// A worktree-mirror run dir (the real pr-first shape) whose 1930 header text is
// caller-supplied, so a frontmatter flag can be placed in or out of the block.
function mirrorWithHeader(headerText) {
  const { tree, runDir } = mirrorFixture();
  fs.writeFileSync(path.join(tree, '.claude-tweaks', 'pipelines', '2026-09-06T000000-record-1930', 'work', '1930-spec.md'), headerText);
  return runDir;
}

test('AC1.1: a pack built from a manifest-only parent run dir has inputs.records non-empty and inputs.closingRecords empty', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-closing-manifest-'));
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ worktree: '/w/tree' }));
  fs.writeFileSync(path.join(dir, 'manifest.yml'), [
    'multispec:', '  parent: 1904', '  specs:',
    '    - id: 1930', '      status: complete', '      subdir: spec-1930',
    '    - id: 1931', '      status: pending', '      subdir: spec-1931',
    '',
  ].join('\n'));
  fs.mkdirSync(path.join(dir, 'spec-1932', 'work'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'spec-1932', 'work', '1932-spec.md'), '---\nrecord: 1932\n---\n');
  const inputs = resolveInputs({ runDir: dir, cwd: '/w/tree', deps: okDeps() });
  assert.deepStrictEqual(inputs.records, [1930, 1931, 1932]);
  assert.strictEqual(inputs.sources.records, 'manifest');
  assert.deepStrictEqual(inputs.closingRecords, []);
  assert.deepStrictEqual(inputs.parkedAtShaping, {});
});

test('AC1.2: a header-resolved pack has inputs.closingRecords equal to inputs.records (rung a and rung b)', () => {
  const own = resolveInputs({ runDir: fixtureRunDir(), cwd: '/w/tree', deps: okDeps() });
  assert.strictEqual(own.sources.records, 'headers');
  assert.deepStrictEqual(own.closingRecords, own.records);
  assert.deepStrictEqual(own.closingRecords, [1535]);
  const { runDir } = mirrorFixture();
  const mirrored = resolveInputs({ runDir, cwd: '/nowhere', deps: okDeps() });
  assert.strictEqual(mirrored.sources.records, 'worktree-headers');
  assert.deepStrictEqual(mirrored.closingRecords, [1930]);
});

test('closingRecords keeps records only for the two header rungs (Ruling R1, decided once)', () => {
  for (const source of ['headers', 'worktree-headers']) assert.deepStrictEqual(closingRecords({ records: [7, 8], source }), [7, 8]);
  for (const source of ['manifest', 'worktree-manifest', 'unavailable']) assert.deepStrictEqual(closingRecords({ records: [7, 8], source }), []);
});

test('#3399: a worktree-manifest rung yields an empty closing set', () => {
  // The #2391 fixture shape: spec-2283/spec-2338 headers exist only in the worktree mirror.
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-closing-wm-main-'));
  const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-closing-wm-tree-'));
  const rel = path.join('.claude-tweaks', 'pipelines', '2026-09-14T000308-record-2283-2338');
  const runDir = path.join(main, rel);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ worktree: tree, status: 'active', pr: { number: 1901 } }));
  for (const n of [2283, 2338]) {
    fs.mkdirSync(path.join(tree, rel, `spec-${n}`, 'work'), { recursive: true });
    fs.writeFileSync(path.join(tree, rel, `spec-${n}`, 'work', `${n}-spec.md`), `---\nrecord: ${n}\n---\n`);
  }
  const inputs = resolveInputs({ runDir, cwd: tree, deps: okDeps() });
  assert.deepStrictEqual(inputs.records, [2283, 2338]);
  assert.strictEqual(inputs.sources.records, 'worktree-manifest');
  assert.deepStrictEqual(inputs.closingRecords, []);
  assert.deepStrictEqual(inputs.parkedAtShaping, {});
});

test('#3399: parkedAtShaping reads each closing record\'s frontmatter flag, keyed by record number through JSON', () => {
  const runDir = mirrorWithHeader('---\nrecord: 1930\nparked-at-shaping: true\n---\n# 1930\n');
  const round = JSON.parse(JSON.stringify(resolveInputs({ runDir, cwd: '/nowhere', deps: okDeps() })));
  assert.strictEqual(round.parkedAtShaping['1930'], true);
  const plain = resolveInputs({ runDir: fixtureRunDir(), cwd: '/w/tree', deps: okDeps() });
  assert.deepStrictEqual(plain.parkedAtShaping, { 1535: false });
});

test('#3399: a parked-at-shaping line in the record body below the frontmatter does not count', () => {
  const runDir = mirrorWithHeader('---\nrecord: 1930\n---\n# 1930\n\nparked-at-shaping: true\n');
  const inputs = resolveInputs({ runDir, cwd: '/nowhere', deps: okDeps() });
  assert.strictEqual(inputs.parkedAtShaping[1930], false);
});

test('#3399: parkedAtShaping is true for a record when any of its header files carries the flag, one entry per record', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-closing-dup-'));
  fs.mkdirSync(path.join(dir, 'work'));
  // The flagged file sorts first (CRLF frontmatter), so a last-file-wins read would lose it; the `record:` line wins over the filename, so 6-spec.md is record 5 too.
  fs.writeFileSync(path.join(dir, 'work', '5-spec.md'), '---\r\nrecord: 5\r\nparked-at-shaping: true\r\n---\r\n');
  fs.writeFileSync(path.join(dir, 'work', '6-spec.md'), '---\nrecord: 5\n---\n');
  const deps = { readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p).sort(); } catch { return []; } } };
  const res = resolveRecords(deps, dir, null);
  assert.deepStrictEqual(res.records, [5]);
  assert.deepStrictEqual(res.parkedAtShaping, { 5: true });
});

// okDeps with pr-checks.js answered by `onPrChecks(args)`; every other command takes the okDeps default.
function depsWithPrChecks(onPrChecks) {
  return okDeps({
    execFile: async (cmd, args) => {
      if (cmd === 'node' && String(args[0]).endsWith('pr-checks.js')) return onPrChecks(args);
      return okDeps().execFile(cmd, args);
    },
  });
}

test('pr probe attaches the pr-checks.js --pr verdict as ci (#3469)', async () => {
  const runDir = fixtureRunDir();
  const seen = [];
  const deps = depsWithPrChecks((args) => {
    seen.push(args);
    return { stdout: '{"state":"pending","pending":["test"],"failing":[]}\n', stderr: '' };
  });
  const pack = await gatherPack({ runDir, cwd: '/w/tree', only: ['pr'], deps });
  assert.strictEqual(pack.pr.ok, true, JSON.stringify(pack.pr));
  assert.strictEqual(seen.length, 1);
  assert.deepStrictEqual(seen[0], [path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'pr-checks.js'), '--pr', '1901']);
  assert.strictEqual(pack.pr.value.ci.state, 'pending');
  assert.strictEqual(pack.pr.value.state, 'OPEN');
});

test('pr probe: a failed pr-checks.js spawn is ci read-failed, pr still ok (#3469)', async () => {
  const deps = depsWithPrChecks(() => { throw new Error('spawn node ENOENT'); });
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['pr'], deps });
  assert.strictEqual(pack.pr.ok, true, JSON.stringify(pack.pr));
  assert.strictEqual(pack.pr.value.ci.state, 'read-failed');
  assert.ok(typeof pack.pr.value.ci.reason === 'string' && pack.pr.value.ci.reason.length > 0);
  assert.strictEqual(pack.pr.value.state, 'OPEN');
});

test('pr probe: unparseable pr-checks.js output is ci read-failed (#3469)', async () => {
  const deps = depsWithPrChecks(() => ({ stdout: 'not json\n', stderr: '' }));
  const pack = await gatherPack({ runDir: fixtureRunDir(), cwd: '/w/tree', only: ['pr'], deps });
  assert.strictEqual(pack.pr.ok, true);
  assert.strictEqual(pack.pr.value.ci.state, 'read-failed');
});

// ---- #3974: header readers see archived run dirs ---------------------------

const RUN_3974 = '2026-10-22T000000-record-3974';

// A checkout root with the live run dir created, and a `put` helper that drops
// a header into any run-dir-relative location (live or archived).
function runHeaderFixture(runId = RUN_3974) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-3974-'));
  const pipelines = path.join(root, '.claude-tweaks', 'pipelines');
  const runDir = path.join(pipelines, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const put = (base, rel, n, text = `---\nrecord: ${n}\n---\n`) => {
    const dir = path.join(base, ...rel);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${n}-spec.md`), text);
  };
  return { root, runDir, archivedRunDir: path.join(pipelines, 'archive', runId), put };
}

const fsDeps = () => ({ readFile: (p) => fs.readFileSync(p, 'utf8'), readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } } });

test('characterization (#3974): an unreadable header file is skipped, the readable one still resolves', () => {
  const { runDir, put } = runHeaderFixture();
  put(runDir, ['work'], 11);
  put(runDir, ['work'], 12);
  const deps = fsDeps();
  const readFile = (p) => { if (path.basename(p) === '11-spec.md') throw new Error('EACCES'); return deps.readFile(p); };
  const res = resolveRecords({ ...deps, readFile }, runDir, null);
  assert.deepStrictEqual(res.records, [12]);
  assert.strictEqual(res.source, 'headers');
  assert.strictEqual(resolveRecords({ ...deps, readFile: () => { throw new Error('EACCES'); } }, runDir, null).source, 'unavailable');
});

test('resolveRecords (#3974): a header only at archive/{run-id}/work/ resolves on rung (a), and closingRecords carries it like the live fixture', () => {
  const live = runHeaderFixture();
  live.put(live.runDir, ['work'], 3974);
  const archived = runHeaderFixture();
  archived.put(archived.archivedRunDir, ['work'], 3974);
  const liveRes = resolveRecords(fsDeps(), live.runDir, null);
  const archivedRes = resolveRecords(fsDeps(), archived.runDir, null);
  assert.deepStrictEqual(archivedRes, liveRes);
  assert.deepStrictEqual(archivedRes.records, [3974]);
  assert.strictEqual(archivedRes.source, 'headers');
  assert.deepStrictEqual(closingRecords(archivedRes), closingRecords(liveRes));
  assert.deepStrictEqual(closingRecords(archivedRes), [3974]);
});

test('resolveRecords (#3974): a live and an archived copy of the same record merge first-seen-wins (live flag kept)', () => {
  const { runDir, archivedRunDir, put } = runHeaderFixture();
  put(runDir, ['work'], 20, '---\nrecord: 20\nparked-at-shaping: true\n---\n');
  put(archivedRunDir, ['work'], 20, '---\nrecord: 20\n---\n');
  put(archivedRunDir, ['work'], 21);
  const res = resolveRecords(fsDeps(), runDir, null);
  assert.deepStrictEqual(res.records, [20, 21]);
  assert.deepStrictEqual(res.parkedAtShaping, { 20: true, 21: false });
  assert.strictEqual(res.source, 'headers');
});

test('resolveRecords (#3974): a header only in the worktree mirror\'s archive resolves as worktree-headers', () => {
  const main = runHeaderFixture();
  const tree = runHeaderFixture();
  tree.put(tree.archivedRunDir, ['work'], 3974);
  const res = resolveRecords(fsDeps(), main.runDir, tree.root);
  assert.deepStrictEqual(res.records, [3974]);
  assert.strictEqual(res.source, 'worktree-headers');
  assert.deepStrictEqual(closingRecords(res), [3974]);
});

test('resolveRecords (#3974): a per-spec run dir reads only its own archived spec-{N}/work/ header', () => {
  const { runDir, archivedRunDir, put } = runHeaderFixture();
  const specDir = path.join(runDir, 'spec-5');
  fs.mkdirSync(specDir, { recursive: true });
  put(archivedRunDir, ['spec-5', 'work'], 5);
  put(archivedRunDir, ['spec-6', 'work'], 6);
  const res = resolveRecords(fsDeps(), specDir, null);
  assert.deepStrictEqual(res.records, [5]);
  assert.strictEqual(res.source, 'headers');
});

test('resolveRecords (#3974): a multi-spec parent with headers only at archive/{run-id}/spec-{N}/work/ resolves on the manifest rung with no closing set', () => {
  const { runDir, archivedRunDir, put } = runHeaderFixture();
  put(archivedRunDir, ['spec-30', 'work'], 30);
  put(archivedRunDir, ['spec-31', 'work'], 31);
  const res = resolveRecords(fsDeps(), runDir, null);
  assert.deepStrictEqual(res.records, [30, 31]);
  assert.strictEqual(res.source, 'manifest');
  assert.deepStrictEqual(closingRecords(res), []);
});

test('resolveRecords (#3974): archived spec-{N}/work/ headers in the worktree resolve as worktree-manifest', () => {
  const main = runHeaderFixture();
  const tree = runHeaderFixture();
  tree.put(tree.archivedRunDir, ['spec-40', 'work'], 40);
  const res = resolveRecords(fsDeps(), main.runDir, tree.root);
  assert.deepStrictEqual(res.records, [40]);
  assert.strictEqual(res.source, 'worktree-manifest');
});
