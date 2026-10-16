'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const {
  run, parseArgs, computeDirty,
} = require('../../../plugin/bin/qa-stamp');

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
      dirty: () => false,
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
  const dirty = deps(fx, { dirty: () => true });
  run(['--check', '--stories', 'login=app.yaml'], dirty.d);
  assert.equal(JSON.parse(dirty.out.join('')).reason, 'dirty-tree');
});

test('--write refuses a failed run, a missing report, a dirty tree, and no git dir — and writes nothing', () => {
  const fx = fixture();
  const stampPath = path.join(fx.gitDir, 'claude-tweaks-qa-pass.json');
  const cases = [
    () => [['--write', '--report', writeReport(fx, [{ id: 'login', source_file: 'app.yaml', status: 'FAIL' }], { ...CLEAN, passed: 0, failed: 1 })], {}, 'story-not-passed: login FAIL'],
    () => [['--write', '--report', path.join(fx.runDir, 'missing.json')], {}, 'report-unreadable'],
    () => [['--write', '--report', writeReport(fx, GREEN, CLEAN)], { dirty: () => true }, 'dirty-tree'],
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

test('--write invalidates a same-HEAD stamp when a later run at that HEAD fails (Important 2)', () => {
  const fx = fixture();
  const stampPath = path.join(fx.gitDir, 'claude-tweaks-qa-pass.json');
  run(['--write', '--report', writeReport(fx, GREEN, CLEAN)], deps(fx).d);
  assert.equal(fs.existsSync(stampPath), true);

  const FAIL = [{ id: 'login', source_file: 'app.yaml', status: 'FAIL' }];
  const w2 = deps(fx);
  run(['--write', '--report', writeReport(fx, FAIL, { ...CLEAN, passed: 0, failed: 1 })], w2.d);
  assert.deepEqual(JSON.parse(w2.out.join('')), { written: false, reason: 'story-not-passed: login FAIL', invalidated: true });
  assert.equal(fs.existsSync(stampPath), false, 'the stale same-HEAD stamp must be removed');

  const c = deps(fx);
  run(['--check', '--stories', 'login=app.yaml'], c.d);
  assert.deepEqual(JSON.parse(c.out.join('')), { skip: false, reason: 'no-stamp', sha: null });
});

test('--write does not invalidate the stamp on an environmental refusal (dirty tree) at the same HEAD', () => {
  const fx = fixture();
  const stampPath = path.join(fx.gitDir, 'claude-tweaks-qa-pass.json');
  run(['--write', '--report', writeReport(fx, GREEN, CLEAN)], deps(fx).d);
  assert.equal(fs.existsSync(stampPath), true);

  const w2 = deps(fx, { dirty: () => true });
  run(['--write', '--report', writeReport(fx, GREEN, CLEAN)], w2.d);
  assert.deepEqual(JSON.parse(w2.out.join('')), { written: false, reason: 'dirty-tree' });
  assert.equal(fs.existsSync(stampPath), true, 'an environmental refusal must not remove an existing stamp');
});

test('--write never crashes on a malformed (non-object) story entry, and writes no stamp (Minor 5)', () => {
  const fx = fixture();
  const stampPath = path.join(fx.gitDir, 'claude-tweaks-qa-pass.json');
  const p = path.join(fx.runDir, 'report.json');
  fs.writeFileSync(p, JSON.stringify({ stories_dir: 'stories', summary: CLEAN, stories: [null] }));
  const w = deps(fx);
  assert.doesNotThrow(() => run(['--write', '--report', p], w.d));
  assert.deepEqual(JSON.parse(w.out.join('')), { written: false, reason: 'malformed-story-entry' });
  assert.equal(fs.existsSync(stampPath), false);
});

test('storiesDir is normalized before comparing, so "./stories/" and "stories" agree (Minor 4)', () => {
  const fx = fixture();
  const p = path.join(fx.runDir, 'report.json');
  fs.writeFileSync(p, JSON.stringify({ stories_dir: './stories/', summary: CLEAN, stories: GREEN }));
  run(['--write', '--report', p], deps(fx).d);
  const c = deps(fx);
  run(['--check', '--stories', 'login=app.yaml', '--stories-dir', 'stories'], c.d);
  assert.deepEqual(JSON.parse(c.out.join('')), { skip: true, reason: 'covered', sha: HEAD });
});

test('a story file literally named "__proto__" hashes correctly instead of silently reading an inherited value (Deferred minor 1)', () => {
  const fx = fixture();
  const storyPath = path.join(fx.root, 'stories', '__proto__');
  fs.writeFileSync(storyPath, 'proto-content\n');
  const EVIL = [{ id: 'evil', source_file: '__proto__', status: 'PASS' }];
  const p = path.join(fx.runDir, 'report.json');
  fs.writeFileSync(p, JSON.stringify({
    stories_dir: 'stories',
    summary: { total: 1, passed: 1, pass_with_caveats: 0, failed: 0, skipped: 0 },
    stories: EVIL,
  }));
  const w = deps(fx);
  assert.doesNotThrow(() => run(['--write', '--report', p], w.d));
  const res = JSON.parse(w.out.join(''));
  // A plain `{}` keyed by source_file silently swallows `obj['__proto__'] = <string hash>`
  // (the accessor ignores a non-object assignment), so the entry reads back as the
  // inherited Object.prototype instead of the hash — composeQaStamp's typeof guard then
  // treats that as unreadable. A prototype-less map avoids the accessor entirely.
  assert.deepEqual(res, { written: true, path: path.join(fx.gitDir, 'claude-tweaks-qa-pass.json'), sha: HEAD, stories: 1 });
  const stamp = JSON.parse(fs.readFileSync(res.path, 'utf8'));
  assert.equal(stamp.stories[0].sha256, sha(storyPath));
});

test('real git: --write is not blocked by an untracked file under .claude-tweaks/artifacts/, but is blocked by one elsewhere (Important 3)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-qa-stamp-realgit-'));
  created.push(root);
  const g = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  g(['init', '-q']);
  g(['config', 'user.email', 'a@b.c']);
  g(['config', 'user.name', 'T']);
  fs.mkdirSync(path.join(root, 'stories'));
  fs.writeFileSync(path.join(root, 'stories', 'app.yaml'), 'stories:\n  - id: login\n');
  g(['add', '.']);
  g(['commit', '-q', '-m', 'init']);
  const head = g(['rev-parse', 'HEAD']).trim();
  const gitDirPath = path.resolve(root, g(['rev-parse', '--git-dir']).trim());
  // report.json lives outside the repo tree entirely — a pipeline run dir can
  // sit anywhere, and this test must not conflate "report.json's own location
  // is untracked" with the thing it's actually proving (artifacts/ exclusion).
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-qa-stamp-realgit-run-'));
  created.push(runDir);
  const rp = path.join(runDir, 'report.json');
  fs.writeFileSync(rp, JSON.stringify({ stories_dir: 'stories', summary: CLEAN, stories: GREEN }));
  const stampPath = path.join(gitDirPath, 'claude-tweaks-qa-pass.json');

  const realDeps = () => ({
    cwd: () => root,
    gitInfo: () => ({ sha: head, dirty: null }),
    gitDir: () => gitDirPath,
    dirty: () => computeDirty(execFileSync, root),
    now: () => '2026-10-16T00:00:00.000Z',
  });

  fs.mkdirSync(path.join(root, '.claude-tweaks', 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'artifacts', 'shot.png'), 'x');
  const out1 = [];
  run(['--write', '--report', rp], { ...realDeps(), stdout: (s) => out1.push(s), stderr: () => {} });
  assert.deepEqual(JSON.parse(out1.join('')), { written: true, path: stampPath, sha: head, stories: 1 });
  fs.rmSync(stampPath);

  fs.writeFileSync(path.join(root, 'stray.txt'), 'x');
  const out2 = [];
  run(['--write', '--report', rp], { ...realDeps(), stdout: (s) => out2.push(s), stderr: () => {} });
  assert.deepEqual(JSON.parse(out2.join('')), { written: false, reason: 'dirty-tree' });
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
