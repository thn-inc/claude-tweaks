'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
  gatherPack, resolveInputs, PROBE_NAMES, resolveRecords, headerRecords,
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
  assert.strictEqual(inputs.integrationBranch, 'main');
  assert.strictEqual(inputs.sources.integrationBranch, 'default');
  assert.strictEqual(inputs.base, 'abc123');
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
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps() });
  assert.deepStrictEqual(pack.ledger.value, { open: 1, total: 3, byPhase: { review: { open: 1, total: 2 }, build: { open: 0, total: 1 } }, files: ['docs/plans/2026-09-05-spec-1535-ledger.md'] });
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
  const pack = await gatherPack({ runDir, cwd: tree, only: ['ledger'], deps: okDeps() });
  assert.deepStrictEqual(pack.ledger.value.files, ['docs/plans/2025-01-02-spec-26-ledger.md']);
  assert.strictEqual(pack.ledger.value.total, 1);
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

// The pre-merge merge-size step fetches `origin/{integration-branch}`
// immediately before measuring; the pack is gathered back in Phase 3, so a
// pack-fed value would be exactly the stale prediction that step forbids.
test('the mergeSize probe is gone — its consumer must measure after its own fetch (#1930 fix round 4)', () => {
  assert.ok(!PROBE_NAMES.includes('mergeSize'));
  // #2002 moved the pre-merge step (which runs this probe) from pr-early-run-lifecycle.md into
  // the new pr-checklist-refresh.md.
  const lifecycle = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'plugin', 'skills', '_shared', 'pr-checklist-refresh.md'), 'utf8');
  assert.ok(!lifecycle.includes('pack.mergeSize'), 'the pre-merge step no longer reads a pack-fed merge size');
  assert.ok(lifecycle.includes('bin/merge-size-probe.js'), 'it still runs the probe CLI itself');
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
