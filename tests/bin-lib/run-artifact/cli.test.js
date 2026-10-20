'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { run } = require('../../../plugin/bin/write-run-artifact');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'write-run-artifact.js');
const NAME = 'sdd-dispatch-sample.txt';
const RUN_ID = '2026-10-18T090000-record-3044';

// Same anchoring fixture shape as tests/bin-lib/verify-expectations/cli.test.js:
// a fake main checkout (.git directory) holding the real run dir, plus a linked
// worktree (.git FILE) carrying a worktree-local shadow that must be refused.
// `worktree` doubles as the cwd of the simulated worktree-isolated session.
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runartcli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.join(root, 'main');
  const singleDir = path.join(main, '.claude-tweaks', 'pipelines', RUN_ID);
  const worktree = path.join(main, '.claude', 'worktrees', 'dispatch-record-3044');
  const shadow = path.join(worktree, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(singleDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: ../../../.git/worktrees/dispatch-record-3044\n');
  const src = path.join(root, 'src.txt');
  fs.writeFileSync(src, 'AC sample\nline two\n');
  return { root, main, singleDir, worktree, shadow, src };
}

function fakeDeps(cwd) {
  const out = []; const err = [];
  return {
    deps: { cwd: () => cwd, readFile: (p) => fs.readFileSync(p), stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
    out, err,
  };
}

test('AC1.1 a worktree-isolated session writes the sample into the anchored main-checkout run dir', (t) => {
  const { singleDir, worktree, shadow, src } = fixture(t);
  const { deps, out } = fakeDeps(worktree);
  assert.equal(run(['--run', singleDir, '--name', NAME, '--file', src], deps), 0);
  assert.equal(fs.readFileSync(path.join(singleDir, NAME), 'utf8'), 'AC sample\nline two\n');
  assert.ok(out.join('').includes(path.join(fs.realpathSync(singleDir), NAME)), 'the written path is echoed');
  assert.ok(!fs.existsSync(path.join(shadow, NAME)), 'nothing is written into the worktree-local shadow');
});

test('a worktree-local shadow run dir is refused (exit 3) and its existing sample is byte-unchanged', (t) => {
  const { worktree, shadow, src } = fixture(t);
  fs.writeFileSync(path.join(shadow, NAME), 'sentinel');
  const { deps, err } = fakeDeps(worktree);
  assert.equal(run(['--run', shadow, '--name', NAME, '--file', src], deps), 3);
  assert.match(err.join(''), /not anchored under the main checkout/);
  assert.equal(fs.readFileSync(path.join(shadow, NAME), 'utf8'), 'sentinel');
});

test('a missing run dir exits 3', (t) => {
  const { main, worktree, src } = fixture(t);
  const { deps, err } = fakeDeps(worktree);
  assert.equal(run(['--run', path.join(main, 'nope'), '--name', NAME, '--file', src], deps), 3);
  assert.match(err.join(''), /run dir does not exist/);
});

test('a non-allowlisted --name exits 2 and writes nothing', (t) => {
  for (const bad of ['decisions.md', `../${NAME}`]) {
    const { singleDir, worktree, src } = fixture(t);
    const before = fs.readdirSync(singleDir);
    const { deps, err } = fakeDeps(worktree);
    assert.equal(run(['--run', singleDir, '--name', bad, '--file', src], deps), 2, bad);
    assert.ok(err.join('').includes(NAME), 'the allowlist is named');
    assert.deepEqual(fs.readdirSync(singleDir), before, `no new file for ${bad}`);
    assert.ok(!fs.existsSync(path.join(path.dirname(singleDir), NAME)), 'no traversal write');
  }
});

test('--file and --delete are mutually exclusive, and one is required', (t) => {
  const { singleDir, worktree, src } = fixture(t);
  const a = fakeDeps(worktree);
  assert.equal(run(['--run', singleDir, '--name', NAME, '--file', src, '--delete'], a.deps), 2);
  const b = fakeDeps(worktree);
  assert.equal(run(['--run', singleDir, '--name', NAME], b.deps), 2);
  assert.ok(!fs.existsSync(path.join(singleDir, NAME)));
});

test('an unreadable --file exits 2', (t) => {
  const { singleDir, worktree, root } = fixture(t);
  const { deps, err } = fakeDeps(worktree);
  assert.equal(run(['--run', singleDir, '--name', NAME, '--file', path.join(root, 'absent.txt')], deps), 2);
  assert.match(err.join(''), /could not read --file/);
  assert.ok(!fs.existsSync(path.join(singleDir, NAME)));
});

test('AC2.2 --delete removes the sample and is idempotent', (t) => {
  const { singleDir, worktree, src } = fixture(t);
  assert.equal(run(['--run', singleDir, '--name', NAME, '--file', src], fakeDeps(worktree).deps), 0);
  assert.ok(fs.existsSync(path.join(singleDir, NAME)));
  const first = fakeDeps(worktree);
  assert.equal(run(['--run', singleDir, '--name', NAME, '--delete'], first.deps), 0);
  assert.ok(!fs.existsSync(path.join(singleDir, NAME)));
  assert.ok(!/already absent/.test(first.out.join('')));
  const second = fakeDeps(worktree);
  assert.equal(run(['--run', singleDir, '--name', NAME, '--delete'], second.deps), 0);
  assert.match(second.out.join(''), /already absent/);
});

test('a write or delete that throws exits 3 with a message (a directory squats on the target)', (t) => {
  const { singleDir, worktree, src } = fixture(t);
  fs.mkdirSync(path.join(singleDir, NAME));
  const w = fakeDeps(worktree);
  assert.equal(run(['--run', singleDir, '--name', NAME, '--file', src], w.deps), 3);
  assert.match(w.err.join(''), /could not write sdd-dispatch-sample\.txt/);
  const d = fakeDeps(worktree);
  assert.equal(run(['--run', singleDir, '--name', NAME, '--delete'], d.deps), 3);
  assert.match(d.err.join(''), /could not delete sdd-dispatch-sample\.txt/);
  assert.ok(fs.statSync(path.join(singleDir, NAME)).isDirectory(), 'the squatting directory is untouched');
});

test('missing --run or --name exits 2', (t) => {
  const { singleDir, worktree, src } = fixture(t);
  assert.equal(run(['--name', NAME, '--file', src], fakeDeps(worktree).deps), 2);
  assert.equal(run(['--run', singleDir, '--file', src], fakeDeps(worktree).deps), 2);
});

test('--help exits 0 and prints usage', () => {
  const { deps, out } = fakeDeps(process.cwd());
  assert.equal(run(['--help'], deps), 0);
  assert.match(out.join(''), /usage: write-run-artifact\.js/);
});

test('an unknown argument exits 2', () => {
  const { deps, err } = fakeDeps(process.cwd());
  assert.equal(run(['--bogus'], deps), 2);
  assert.match(err.join(''), /unknown argument: --bogus/);
});

test('the real binary runs end to end', (t) => {
  const { main, singleDir, src } = fixture(t);
  execFileSync(process.execPath, [CLI, '--run', singleDir, '--name', NAME, '--file', src], { cwd: main });
  assert.equal(fs.readFileSync(path.join(singleDir, NAME), 'utf8'), 'AC sample\nline two\n');
});

test('#3496: a worktree-isolated session writes sdd-final-review.md into the anchored run dir', (t) => {
  const { singleDir, worktree, shadow, src } = fixture(t);
  const { deps, out } = fakeDeps(worktree);
  assert.equal(run(['--run', singleDir, '--name', 'sdd-final-review.md', '--file', src], deps), 0);
  assert.equal(fs.readFileSync(path.join(singleDir, 'sdd-final-review.md'), 'utf8'), 'AC sample\nline two\n');
  assert.ok(out.join('').includes(path.join(fs.realpathSync(singleDir), 'sdd-final-review.md')), 'the written path is echoed');
  assert.ok(!fs.existsSync(path.join(shadow, 'sdd-final-review.md')), 'nothing is written into the worktree-local shadow');
});
