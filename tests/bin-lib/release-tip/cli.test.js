'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { run } = require('../../../plugin/bin/release-tip-check.js');
const { originWithTwoClones } = require('../../helpers/git-fixtures.js');

const BRANCH = 'main';
const STEP5_ADVANCE_RE = /^- AUTO \d{2}:\d{2}:\d{2} — Step 5: origin\/main advanced /;

const step3Line = (tip) => `- AUTO 10:00:00 — Step 3: whole-branch review starting, base v1.0.0..main at reviewed tip ${tip}; ## /review marker: 0 existing lines. Reversibility: n/a (marker).`;
const deltaMarker = (n, of) => `- AUTO 10:10:00 — Step 5: origin/main moved aaaaaaa → bbbbbbb (1 commits) before the merge — move ${n} of ${of}; delta review starting, base ${'c'.repeat(40)}..main; ## /review marker: 3 existing lines. Reversibility: n/a (marker). [lever: release-tip-moves=${of} (default)]`;
const deltaVerdict = (tip, base) => `- AUTO 10:20:00 — Step 5: delta review base ${base}..main: review: clean. Findings staged at none; at reviewed tip ${tip}. Reversibility: n/a (gate evaluation).`;
const decisions = (lines) => ['# Decisions', '', '## /release', ...lines, ''].join('\n');

function withFixture(fn) {
  const fx = originWithTwoClones('release-tip-cli-');
  try {
    fx.runDir = path.join(fx.work, '.claude-tweaks', 'pipelines', '2026-10-25T000000-release');
    fs.mkdirSync(fx.runDir, { recursive: true });
    return fn(fx);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

const originTip = (fx) => spawnSync('git', ['rev-parse', `origin/${BRANCH}`], { cwd: fx.work, env: fx.env, encoding: 'utf8', windowsHide: true }).stdout.trim();

function pushRunDirUpstream(fx) {
  const dir = path.join(fx.other, '.claude-tweaks', 'pipelines', 'archive', 'r2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'y.md'), 'upstream archive\n');
  fx.run(fx.other, ['add', '.claude-tweaks/pipelines']);
  fx.run(fx.other, ['commit', '-q', '-m', '[reconcile] archive run r2']);
  fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
}

function cli(argv, { cwd = process.cwd(), mainRoot, spawn } = {}) {
  let out = '';
  let err = '';
  const code = run(argv, {
    stdout: (s) => { out += s; },
    stderr: (s) => { err += s; },
    now: () => new Date(2026, 9, 25, 11, 0, 0).getTime(),
    cwd: () => cwd,
    mainRoot,
    spawn,
  });
  return { code, out, err };
}

const argsFor = (fx, extra = []) => ['--run', fx.runDir, '--root', fx.work, '--branch', BRANCH, ...extra];

test('missing --branch → 2', () => {
  const r = cli(['--run', '/tmp/x', '--root', '/tmp/y']);
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /--branch/);
  assert.match(r.err, /usage: release-tip-check\.js/);
  assert.strictEqual(r.out, '');
});

test('unknown flag → 2', () => {
  const r = cli(['--run', '/tmp/x', '--root', '/tmp/y', '--branch', 'main', '--bogus']);
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /unknown flag: --bogus/);
});

test('a value flag with no value → 2', () => {
  for (const argv of [['--root', '/tmp/y', '--branch', 'main', '--run'], ['--run', '--root', '/tmp/y', '--branch', 'main'], ['--run', '', '--root', '/tmp/y', '--branch', 'main']]) {
    const r = cli(argv);
    assert.strictEqual(r.code, 2, argv.join(' '));
    assert.match(r.err, /--run requires a value/, argv.join(' '));
  }
});

test('--help prints the usage line and exits 0 without touching anything', () => {
  const r = cli(['--help']);
  assert.strictEqual(r.code, 0);
  assert.match(r.out, /^usage: release-tip-check\.js --run <run-dir> --root <checkout> --branch <name> \[--as\]\n$/);
  assert.strictEqual(r.err, '');
});

test('run dir missing → 3', () => {
  withFixture((fx) => {
    const r = cli(['--run', path.join(fx.work, 'no-such-run'), '--root', fx.work, '--branch', BRANCH], { mainRoot: fx.work });
    assert.strictEqual(r.code, 3);
    assert.match(r.err, /missing/);
    assert.strictEqual(r.out, '');
  });
});

test('end to end on a fixture prints a merge verdict and exits 0', () => {
  withFixture((fx) => {
    const tip = originTip(fx);
    fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), decisions([step3Line(tip)]));
    const r = cli(argsFor(fx), { mainRoot: fx.work });
    assert.strictEqual(r.code, 0, r.err);
    assert.ok(r.out.endsWith('}\n'), 'one JSON line plus a newline');
    const v = JSON.parse(r.out);
    assert.strictEqual(v.verdict, 'merge');
    assert.strictEqual(v.branch, BRANCH);
    assert.strictEqual(v.tipSha, tip);
    assert.strictEqual(v.reviewedTip, tip);
  });
});

test('a git that never spawned fails with the spawn error as detail, not null', () => {
  withFixture((fx) => {
    fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), decisions([step3Line(originTip(fx))]));
    const spawn = () => ({ status: null, stdout: null, stderr: null, error: new Error('spawn git ENOENT') });
    const r = cli(argsFor(fx), { mainRoot: fx.work, spawn });
    assert.strictEqual(r.code, 0, r.err);
    const v = JSON.parse(r.out);
    assert.strictEqual(v.verdict, 'failed');
    assert.strictEqual(v.reason, 'fetch failed');
    assert.strictEqual(v.detail, 'spawn git ENOENT');
  });
});

test('a decisions.md that exists but cannot be read is an undecided crash, not an empty log', () => {
  withFixture((fx) => {
    fs.mkdirSync(path.join(fx.runDir, 'decisions.md'));
    assert.throws(() => cli(argsFor(fx), { mainRoot: fx.work }), (err) => err.code === 'EISDIR');
  });
});

test('run-dir-only advance writes its line under ## /release in decisions.md', () => {
  withFixture((fx) => {
    const tip = originTip(fx);
    const file = path.join(fx.runDir, 'decisions.md');
    const before = `${decisions([step3Line(tip)])}\n## /review\n- AUTO 10:05:00 — Step 2: other section. Reversibility: n/a.\n`;
    fs.writeFileSync(file, before);
    pushRunDirUpstream(fx);
    const r = cli(argsFor(fx), { mainRoot: fx.work });
    assert.strictEqual(r.code, 0, r.err);
    const v = JSON.parse(r.out);
    assert.strictEqual(v.verdict, 'merge');
    assert.strictEqual(v.advanced.length, 1);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const added = lines.filter((l) => STEP5_ADVANCE_RE.test(l));
    assert.strictEqual(added.length, 1, lines.join('\n'));
    assert.match(added[0], new RegExp(`at reviewed tip ${v.reviewedTip}\\. Reversibility: n/a \\(gate evaluation\\)\\.$`));
    const at = lines.indexOf(added[0]);
    assert.ok(at > lines.indexOf('## /release') && at < lines.indexOf('## /review'), 'the line lands inside the ## /release block');
  });
});

test('a code move reads the bound through the real resolve-policy.js spawn → delta', () => {
  withFixture((fx) => {
    const tip = originTip(fx);
    fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), decisions([step3Line(tip)]));
    fs.writeFileSync(path.join(fx.other, 'fix.txt'), 'fix: y');
    fx.run(fx.other, ['add', 'fix.txt']);
    fx.run(fx.other, ['commit', '-q', '-m', 'fix: y']);
    fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
    const r = cli(argsFor(fx), { mainRoot: fx.work });
    assert.strictEqual(r.code, 0, r.err);
    const v = JSON.parse(r.out);
    assert.strictEqual(v.verdict, 'delta', JSON.stringify(v));
    assert.strictEqual(v.move, 1);
    assert.strictEqual(v.bound, 2);
    assert.strictEqual(v.source, 'default');
    assert.strictEqual(v.commits, 1);
  });
});

test('preMajor read from release-preflight.json', () => {
  withFixture((fx) => {
    const base = originTip(fx);
    fs.writeFileSync(path.join(fx.other, 'arrived.txt'), 'feat!: y');
    fx.run(fx.other, ['add', 'arrived.txt']);
    fx.run(fx.other, ['commit', '-q', '-m', 'feat!: y']);
    fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
    fx.run(fx.work, ['fetch', '-q', 'origin']);
    const arrivedTip = originTip(fx);
    assert.notStrictEqual(arrivedTip, base);
    fs.writeFileSync(path.join(fx.runDir, 'decisions.md'), decisions([step3Line(base), deltaMarker(1, 2), deltaVerdict(arrivedTip, base)]));

    const without = JSON.parse(cli(argsFor(fx), { mainRoot: fx.work }).out);
    assert.strictEqual(without.arrived.part, 'major', 'no preflight file → preMajor false');

    fs.writeFileSync(path.join(fx.runDir, 'release-preflight.json'), 'not json');
    assert.strictEqual(JSON.parse(cli(argsFor(fx), { mainRoot: fx.work }).out).arrived.part, 'major', 'unparseable → preMajor false');

    fs.writeFileSync(path.join(fx.runDir, 'release-preflight.json'), JSON.stringify({ proposedVersion: { ok: true, value: { preMajor: true } } }));
    const r = cli(argsFor(fx), { mainRoot: fx.work });
    assert.strictEqual(r.code, 0, r.err);
    const withPre = JSON.parse(r.out);
    assert.strictEqual(withPre.verdict, 'merge');
    assert.strictEqual(withPre.arrived.part, 'minor');
  });
});
