'use strict';
// plugin/bin/review-lens-select.js (#6001): the per-run lens selection CLI, in-process against a real git fixture.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { committedRepo } = require('./helpers/git-fixtures');
const { SCHEMA_VERSION } = require('../plugin/bin/lib/timing/step-yield');
const { appendLensDispatch } = require('../plugin/bin/lib/review-lens/dispatch-record');
const { writeLensSelection } = require('../plugin/bin/lib/review-lens/selection-record');
const { TIER_LENSES } = require('../plugin/bin/lib/review-lens/select');
const { run } = require('../plugin/bin/review-lens-select');

// A main checkout (a real git repo) with a pipelines dir, a run dir inside it, and `base` = the seed commit.
function world({ policy } = {}) {
  const repo = committedRepo({ prefix: 'ct-lens-cli-' });
  const pipelines = path.join(repo.dir, '.claude-tweaks', 'pipelines');
  const runDir = path.join(pipelines, '2026-11-22T120000-record-1');
  fs.mkdirSync(runDir, { recursive: true });
  if (policy !== undefined) fs.writeFileSync(path.join(repo.dir, '.claude-tweaks', 'policy.yml'), policy);
  return { ...repo, pipelines, runDir, base: repo.head };
}
const commitFile = (w, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(w.dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(w.dir, rel), content);
  w.git('add', rel);
  w.git('commit', '-q', '-m', `add ${rel}`);
};
// n closed qualifying runs that dispatched `lens` with two reviewers and confirmed nothing.
function seedHistory(w, lens, n = 20) {
  for (let i = 1; i <= n; i++) {
    const dir = path.join(w.pipelines, `2026-10-${String(i).padStart(2, '0')}T090000-record-${100 + i}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'clean' }));
    appendLensDispatch({ runDir: dir, entry: { lens, reviewers: 2, path: 'task', round: 1, status: 'completed' } });
    fs.writeFileSync(path.join(dir, 'step-yield.json'), JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      steps: [{ phase: 'review', findings: { byLens: {} } }],
      unattributed: { findings: null },
      unparsed: { count: 0, samples: [] },
    }));
  }
}
function call(w, args) {
  const out = [];
  const err = [];
  const code = run(args, { cwd: () => w.dir, env: {}, stdout: (s) => out.push(s), stderr: (s) => err.push(s), now: () => Date.UTC(2026, 10, 22, 12, 0, 0) });
  return { code, stdout: out.join(''), stderr: err.join('') };
}
const argsFor = (w, tier, extra = []) => ['--run', w.runDir, '--tier', tier, '--base', w.base, ...extra];
const decisions = (w) => fs.readFileSync(path.join(w.runDir, 'decisions.md'), 'utf8');
const lensesOf = (tier) => TIER_LENSES[tier];

test('AC6.1 / shape: prints exactly {tier, selected, skipped, fallback} and writes the same to lens-selection.json', () => {
  const w = world();
  commitFile(w, 'docs/a.md', 'prose only\n');
  const r = call(w, argsFor(w, 'high'));
  assert.strictEqual(r.code, 0, r.stderr);
  const printed = JSON.parse(r.stdout);
  assert.deepStrictEqual(Object.keys(printed), ['tier', 'selected', 'skipped', 'fallback']);
  assert.strictEqual(r.stdout.endsWith('\n') && r.stdout.trim().split('\n').length, 1);
  const written = JSON.parse(fs.readFileSync(path.join(w.runDir, 'lens-selection.json'), 'utf8'));
  assert.deepStrictEqual(written, { v: 1, ...printed });
});

test('AC2.1 end to end: docs-only diff, 3d history below floor -> one SKIP line naming 3d in decisions.md', () => {
  const w = world();
  seedHistory(w, '3d');
  commitFile(w, 'docs/a.md', 'prose only\n');
  const r = call(w, argsFor(w, 'high'));
  assert.strictEqual(r.code, 0, r.stderr);
  const printed = JSON.parse(r.stdout);
  assert.strictEqual(printed.fallback, null);
  assert.deepStrictEqual(printed.skipped.map((s) => s.lens), ['3d']);
  assert.deepStrictEqual(printed.selected, lensesOf('high').filter((l) => l !== '3d'));
  const lines = decisions(w).split('\n').filter((l) => l.startsWith('- '));
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /^- SKIP \d\d:\d\d:\d\d — Step 3 lens selection: condition: 3d: .*→ fallback: lens not dispatched\./);
  assert.ok(decisions(w).includes('## /review'));
});

test('AC5.1: an unresolvable --base selects the full tier set and logs one AUTO line naming why', () => {
  const w = world();
  seedHistory(w, '3d');
  const r = call(w, ['--run', w.runDir, '--tier', 'high', '--base', 'no-such-ref-xyz']);
  assert.strictEqual(r.code, 0, r.stderr);
  const printed = JSON.parse(r.stdout);
  assert.deepStrictEqual(printed.selected, lensesOf('high'));
  assert.deepStrictEqual(printed.skipped, []);
  assert.ok(printed.fallback && printed.fallback.includes('no-such-ref-xyz'), printed.fallback);
  const lines = decisions(w).split('\n').filter((l) => l.startsWith('- '));
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /^- AUTO .*Step 3 lens selection: .*no-such-ref-xyz/);
});

test('AC8.2: an unreadable history root or archive selects the full tier set and logs why', (tc) => {
  if (process.platform === 'win32' || (process.getuid && process.getuid() === 0)) return tc.skip('needs a permission-denied directory');
  const w = world();
  seedHistory(w, '3d');
  commitFile(w, 'docs/a.md', 'prose only\n');
  const archive = path.join(w.pipelines, 'archive');
  fs.mkdirSync(archive);
  fs.chmodSync(archive, 0o000);
  try {
    const r = call(w, argsFor(w, 'high'));
    assert.strictEqual(r.code, 0, r.stderr);
    const printed = JSON.parse(r.stdout);
    assert.deepStrictEqual(printed.selected, lensesOf('high'));
    assert.deepStrictEqual(printed.skipped, []);
    assert.ok(printed.fallback && /unreadable archive/.test(printed.fallback), printed.fallback);
    const lines = decisions(w).split('\n').filter((l) => l.startsWith('- '));
    assert.strictEqual(lines.length, 1);
    assert.match(lines[0], /^- AUTO .*unreadable archive/);
  } finally {
    fs.chmodSync(archive, 0o755);
  }
});

test('Review Focus 4: --base equal to HEAD is an empty diff -> computable, rules as written', () => {
  const w = world();
  seedHistory(w, '3d');
  const r = call(w, argsFor(w, 'high'));
  assert.strictEqual(r.code, 0, r.stderr);
  const printed = JSON.parse(r.stdout);
  assert.strictEqual(printed.fallback, null);
  assert.deepStrictEqual(printed.skipped.map((s) => s.lens), ['3d']);
});

test('streaks unreadable: logs the streak reason as one AUTO line, selection has no fallback', () => {
  const w = world();
  seedHistory(w, '3d');
  commitFile(w, 'docs/a.md', 'prose only\n');
  // A malformed lens-selection.json inside the counted window makes readSkipStreaks ok:false.
  const prior = path.join(w.pipelines, '2026-11-21T100000-record-9');
  fs.mkdirSync(prior);
  fs.writeFileSync(path.join(prior, 'lens-selection.json'), '{not json');
  const r = call(w, argsFor(w, 'high'));
  assert.strictEqual(r.code, 0, r.stderr);
  const printed = JSON.parse(r.stdout);
  assert.strictEqual(printed.fallback, null);
  assert.ok(printed.selected.includes('3d'), 'a below-floor lens is forced');
  const lines = decisions(w).split('\n').filter((l) => l.startsWith('- '));
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /^- AUTO .*Step 3 lens selection: skip streaks unreadable.*2026-11-21T100000-record-9/);
});

test('a skip streak from earlier runs forces the lens (the run itself is excluded)', () => {
  const w = world();
  seedHistory(w, '3d');
  commitFile(w, 'docs/a.md', 'prose only\n');
  for (let i = 1; i <= 4; i++) {
    const dir = path.join(w.pipelines, `2026-11-2${i}T100000-record-${i}`);
    fs.mkdirSync(dir, { recursive: true });
    writeLensSelection(dir, { tier: 'high', selected: lensesOf('high').filter((l) => l !== '3d'), skipped: [{ lens: '3d', reason: '3d: below floor' }], fallback: null });
  }
  const r = call(w, argsFor(w, 'high'));
  assert.strictEqual(r.code, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).selected.includes('3d'), 'four skipped reviews in a row force the fifth');
});

test('--risk-flags public-contract calls for 3b', () => {
  const w = world();
  seedHistory(w, '3b');
  commitFile(w, 'docs/a.md', 'prose only\n');
  const without = JSON.parse(call(w, argsFor(w, 'low')).stdout);
  assert.deepStrictEqual(without.skipped.map((s) => s.lens), ['3b']);
  const flagged = JSON.parse(call(w, argsFor(w, 'low', ['--risk-flags', 'public-contract'])).stdout);
  assert.deepStrictEqual(flagged.skipped, []);
  assert.deepStrictEqual(flagged.selected, lensesOf('low'));
});

const AUTH_POLICY = 'risk-path-globs:\n  auth: [src/auth/**]\n';
function authWorld(policy) {
  const w = world({ policy });
  seedHistory(w, '3b');
  // A config file under the glob: a source file would call for 3b by itself (CALLED_FOR, #6001 build replay), so only
  // the risk-path fact can select 3b here.
  commitFile(w, 'src/auth/a.json', '{"x": 1}\n');
  return w;
}

test('Reading A: risk-path-globs is ignored with control mode off', () => {
  const w = authWorld(AUTH_POLICY);
  const printed = JSON.parse(call(w, argsFor(w, 'low')).stdout);
  assert.deepStrictEqual(printed.skipped.map((s) => s.lens), ['3b']);
});

test('Reading A: the same globs with control-mode on select 3b', () => {
  const w = authWorld(`control-mode: on\n${AUTH_POLICY}`);
  const printed = JSON.parse(call(w, argsFor(w, 'low')).stdout);
  assert.deepStrictEqual(printed.skipped, []);
  assert.strictEqual(printed.fallback, null);
});

test('Reading A: control-mode on with an invalid risk-path-globs block -> full tier set and one AUTO naming riskPathTouched', () => {
  const w = authWorld('control-mode: on\nrisk-path-globs:\n  auth: not-a-list\n');
  const r = call(w, argsFor(w, 'low'));
  assert.strictEqual(r.code, 0, r.stderr);
  const printed = JSON.parse(r.stdout);
  assert.deepStrictEqual(printed.selected, lensesOf('low'));
  assert.ok(printed.fallback && printed.fallback.includes('riskPathTouched'), printed.fallback);
  const lines = decisions(w).split('\n').filter((l) => l.startsWith('- '));
  assert.strictEqual(lines.length, 1);
  assert.match(lines[0], /^- AUTO .*riskPathTouched/);
});

test('exit 2 on a bad --tier, a missing --base, an unknown flag, a missing run dir; nothing written', () => {
  const w = world();
  for (const args of [
    ['--run', w.runDir, '--tier', 'huge', '--base', w.base],
    ['--run', w.runDir, '--tier', 'high'],
    ['--run', w.runDir, '--tier', 'high', '--base', w.base, '--bogus', 'x'],
    ['--tier', 'high', '--base', w.base],
    ['--run', path.join(w.pipelines, 'no-such-run'), '--tier', 'high', '--base', w.base],
  ]) {
    const r = call(w, args);
    assert.strictEqual(r.code, 2, args.join(' '));
    assert.strictEqual(r.stdout, '');
  }
  assert.ok(!fs.existsSync(path.join(w.runDir, 'lens-selection.json')));
});

test('exit 2: a --run outside the main checkout pipelines is refused by the anchoring guard', () => {
  const w = world();
  const outside = path.join(w.dir, 'elsewhere');
  fs.mkdirSync(outside);
  const r = call(w, ['--run', outside, '--tier', 'high', '--base', w.base]);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.stdout, '');
  assert.ok(!fs.existsSync(path.join(outside, 'lens-selection.json')));
});

test('exit 1 and no stdout when the log write fails', () => {
  const w = world();
  seedHistory(w, '3d');
  commitFile(w, 'docs/a.md', 'prose only\n');
  fs.mkdirSync(path.join(w.runDir, 'decisions.md'));
  const r = call(w, argsFor(w, 'high'));
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.stdout, '');
  assert.ok(!fs.existsSync(path.join(w.runDir, 'lens-selection.json')));
});
