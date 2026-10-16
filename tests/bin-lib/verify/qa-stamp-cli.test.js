'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { run, parseArgs } = require('../../../plugin/bin/qa-stamp');

const HEAD = 'c'.repeat(40);
const created = [];
test.after(() => { for (const d of created) fs.rmSync(d, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-qa-stamp-cli-'));
  created.push(root);
  const gitDir = path.join(root, '.git');
  fs.mkdirSync(gitDir);
  fs.mkdirSync(path.join(root, 'stories'));
  fs.writeFileSync(path.join(root, 'stories', 'app.yaml'), 'stories:\n  - id: login\n');
  const runDir = path.join(root, 'qa-run');
  fs.mkdirSync(runDir);
  return { root, gitDir, runDir };
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function deps(fx, over = {}) {
  const out = []; const err = [];
  return {
    out, err,
    d: {
      cwd: () => fx.root,
      gitInfo: () => ({ sha: HEAD, dirty: false }),
      gitDir: () => fx.gitDir,
      now: () => '2026-10-16T00:00:00.000Z',
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      ...over,
    },
  };
}
function writeReport(fx, stories, summary) {
  const p = path.join(fx.runDir, 'report.json');
  fs.writeFileSync(p, JSON.stringify({ stories_dir: 'stories', summary, stories }));
  return p;
}
const GREEN = [{ id: 'login', source_file: 'app.yaml', status: 'PASS' }];
const CLEAN = { total: 1, passed: 1, pass_with_caveats: 0, failed: 0, skipped: 0 };

test('--write on an all-green report at a clean HEAD writes the stamp; --check then skips', () => {
  const fx = fixture();
  const rp = writeReport(fx, GREEN, CLEAN);
  const w = deps(fx);
  assert.equal(run(['--write', '--report', rp], w.d), 0);
  const res = JSON.parse(w.out.join(''));
  assert.deepEqual(res, { written: true, path: path.join(fx.gitDir, 'claude-tweaks-qa-pass.json'), sha: HEAD, stories: 1 });
  const stamp = JSON.parse(fs.readFileSync(res.path, 'utf8'));
  assert.equal(stamp.stories[0].sha256, sha(path.join(fx.root, 'stories', 'app.yaml')));
  const c = deps(fx);
  assert.equal(run(['--check', '--stories', 'login=app.yaml'], c.d), 0);
  assert.deepEqual(JSON.parse(c.out.join('')), { skip: true, reason: 'covered', sha: HEAD });
});

test('--check runs QA when the story file changed after the stamp', () => {
  const fx = fixture();
  const rp = writeReport(fx, GREEN, CLEAN);
  run(['--write', '--report', rp], deps(fx).d);
  fs.writeFileSync(path.join(fx.root, 'stories', 'app.yaml'), 'stories:\n  - id: login\n    edited: true\n');
  const c = deps(fx);
  run(['--check', '--stories', 'login=app.yaml'], c.d);
  assert.deepEqual(JSON.parse(c.out.join('')), { skip: false, reason: 'story-changed: login', sha: HEAD });
});

test('--check runs QA when HEAD moved or the tree is dirty, and reports no stamp as no-stamp', () => {
  const fx = fixture();
  const c0 = deps(fx);
  run(['--check', '--stories', 'login=app.yaml'], c0.d);
  assert.deepEqual(JSON.parse(c0.out.join('')), { skip: false, reason: 'no-stamp', sha: null });
  run(['--write', '--report', writeReport(fx, GREEN, CLEAN)], deps(fx).d);
  const moved = deps(fx, { gitInfo: () => ({ sha: 'd'.repeat(40), dirty: false }) });
  run(['--check', '--stories', 'login=app.yaml'], moved.d);
  assert.equal(JSON.parse(moved.out.join('')).reason, 'sha-mismatch');
  const dirty = deps(fx, { gitInfo: () => ({ sha: HEAD, dirty: true }) });
  run(['--check', '--stories', 'login=app.yaml'], dirty.d);
  assert.equal(JSON.parse(dirty.out.join('')).reason, 'dirty-tree');
});

test('--write refuses a failed run, a missing report, a dirty tree, and no git dir — and writes nothing', () => {
  const fx = fixture();
  const stampPath = path.join(fx.gitDir, 'claude-tweaks-qa-pass.json');
  const cases = [
    () => [['--write', '--report', writeReport(fx, [{ id: 'login', source_file: 'app.yaml', status: 'FAIL' }], { ...CLEAN, passed: 0, failed: 1 })], {}, 'story-not-passed: login FAIL'],
    () => [['--write', '--report', path.join(fx.runDir, 'missing.json')], {}, 'report-unreadable'],
    () => [['--write', '--report', writeReport(fx, GREEN, CLEAN)], { gitInfo: () => ({ sha: HEAD, dirty: true }) }, 'dirty-tree'],
    () => [['--write', '--report', writeReport(fx, GREEN, CLEAN)], { gitDir: () => null }, 'no-git-dir'],
  ];
  for (const mkCase of cases) {
    const [argv, over, reason] = mkCase();
    const w = deps(fx, over);
    assert.equal(run(argv, w.d), 0);
    assert.deepEqual(JSON.parse(w.out.join('')), { written: false, reason });
    assert.equal(fs.existsSync(stampPath), false, `no stamp for ${reason}`);
  }
});

test('malformed invocations exit 2 with usage on stderr', () => {
  const fx = fixture();
  for (const argv of [[], ['--write', '--check'], ['--write'], ['--check'], ['--check', '--stories', 'login'], ['--bogus']]) {
    const x = deps(fx);
    assert.equal(run(argv, x.d), 2, JSON.stringify(argv));
    assert.match(x.err.join(''), /usage: qa-stamp\.js/);
  }
});

test('parseArgs splits --stories into id/file pairs', () => {
  assert.deepEqual(parseArgs(['--check', '--stories', 'a=x.yaml,b=y.yaml']).stories, [{ id: 'a', file: 'x.yaml' }, { id: 'b', file: 'y.yaml' }]);
});
