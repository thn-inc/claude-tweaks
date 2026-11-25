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
const { initRepo } = require('../../helpers/git-fixtures');

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
    () => { const p = path.join(fx.runDir, 'null.json'); fs.writeFileSync(p, 'null'); return [['--write', '--report', p], {}, 'report-unreadable']; },
    () => { const p = path.join(fx.runDir, 'array.json'); fs.writeFileSync(p, '[]'); return [['--write', '--report', p], {}, 'report-unreadable']; },
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

test('--write reports invalidateFailed when the stale same-HEAD stamp cannot be removed, instead of hiding it', () => {
  const fx = fixture();
  const stampPath = path.join(fx.gitDir, 'claude-tweaks-qa-pass.json');
  run(['--write', '--report', writeReport(fx, GREEN, CLEAN)], deps(fx).d);

  const FAIL = [{ id: 'login', source_file: 'app.yaml', status: 'FAIL' }];
  const eacces = () => { const e = new Error('EACCES: permission denied'); e.code = 'EACCES'; throw e; };
  const w2 = deps(fx, { unlink: eacces });
  run(['--write', '--report', writeReport(fx, FAIL, { ...CLEAN, passed: 0, failed: 1 })], w2.d);
  assert.deepEqual(JSON.parse(w2.out.join('')), { written: false, reason: 'story-not-passed: login FAIL', invalidateFailed: 'EACCES' });
  assert.equal(fs.existsSync(stampPath), true, 'the unlink failed, so the stamp is still on disk — which is why it must be reported');
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
  initRepo(root, { name: 'T', email: 'a@b.c', cwd: root, encoding: 'utf8' });
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
  for (const argv of [[], ['--write', '--check'], ['--write'], ['--check'], ['--check', '--stories', 'login'], ['--bogus'],
    ['--write', '--report', 'r.json', '--scope', 'x.json'], ['--check', '--stories', 'a=b', '--scope']]) {
    const x = deps(fx);
    assert.equal(run(argv, x.d), 2, JSON.stringify(argv));
    assert.match(x.err.join(''), /usage: qa-stamp\.js/);
  }
});

test('parseArgs splits --stories into id/file pairs', () => {
  assert.deepEqual(parseArgs(['--check', '--stories', 'a=x.yaml,b=y.yaml']).stories, [{ id: 'a', file: 'x.yaml' }, { id: 'b', file: 'y.yaml' }]);
});

const DECL_PATH = '.claude-tweaks/verify-scope.json';
function bookkeepingRepo(extraRules = [], extraFiles = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-qa-stamp-bk-'));
  created.push(root);
  const g = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  initRepo(root, { name: 'T', email: 'a@b.c', cwd: root, encoding: 'utf8' });
  fs.mkdirSync(path.join(root, 'stories'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '.claude-tweaks'));
  fs.writeFileSync(path.join(root, 'stories', 'app.yaml'), 'stories:\n  - id: login\n');
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'a\n');
  fs.writeFileSync(path.join(root, DECL_PATH), JSON.stringify({
    checks: { tests: 'node --test' },
    rules: [
      { match: 'docs/plans/*-ledger.md', suites: [], static: false },
      ...extraRules,
      { match: 'src/**', suites: '*', static: true },
    ],
  }));
  for (const [f, c] of Object.entries(extraFiles)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), c);
  }
  g(['add', '.']);
  g(['commit', '-q', '-m', 'init']);
  const S = g(['rev-parse', 'HEAD']).trim();
  const gitDirPath = path.resolve(root, g(['rev-parse', '--git-dir']).trim());
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-qa-stamp-bk-run-'));
  created.push(runDir);
  const rp = path.join(runDir, 'report.json');
  fs.writeFileSync(rp, JSON.stringify({ stories_dir: 'stories', summary: CLEAN, stories: GREEN }));
  const realDeps = (over = {}) => ({
    cwd: () => root,
    exec: (c, a, o) => execFileSync(c, a, { ...o, cwd: root }),
    gitInfo: () => ({ sha: g(['rev-parse', 'HEAD']).trim(), dirty: null }),
    gitDir: () => gitDirPath,
    dirty: () => computeDirty(execFileSync, root),
    now: () => '2026-10-16T00:00:00.000Z',
    stderr: () => {},
    ...over,
  });
  const w = [];
  run(['--write', '--report', rp], { ...realDeps(), stdout: (s) => w.push(s) });
  assert.equal(JSON.parse(w.join('')).written, true);
  const stampPath = path.join(gitDirPath, 'claude-tweaks-qa-pass.json');
  const commit = (files, msg = 'delta') => {
    for (const [f, c] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), c);
    }
    g(['add', '.']);
    g(['commit', '-q', '-m', msg]);
  };
  const check = (extra = [], over = {}) => {
    const out = [];
    const code = run(['--check', '--stories', 'login=app.yaml', ...extra], { ...realDeps(over), stdout: (s) => out.push(s) });
    return { code, res: JSON.parse(out.join('')) };
  };
  return { root, S, g, stampPath, realDeps, commit, check };
}
const LEDGER = { 'docs/plans/x-ledger.md': 'row\n' };

test('AC1.1/AC1.2: a ledger-only commit past S with --scope skips as covered-bookkeeping-delta, and the stamp is byte-identical', () => {
  const fx = bookkeepingRepo();
  const before = fs.readFileSync(fx.stampPath);
  fx.commit(LEDGER);
  const { code, res } = fx.check(['--scope', DECL_PATH]);
  assert.equal(code, 0);
  assert.deepEqual(res, { skip: true, reason: 'covered-bookkeeping-delta', sha: fx.S });
  assert.deepEqual(fs.readFileSync(fx.stampPath), before);
});

test('AC2.1: a delta that also touches a suite-mapped path stays sha-mismatch', () => {
  const fx = bookkeepingRepo();
  fx.commit({ ...LEDGER, 'src/a.js': 'b\n' });
  assert.deepEqual(fx.check(['--scope', DECL_PATH]).res, { skip: false, reason: 'sha-mismatch', sha: fx.S });
});

test('AC3.1: the same ledger-only delta without --scope stays sha-mismatch', () => {
  const fx = bookkeepingRepo();
  fx.commit(LEDGER);
  assert.deepEqual(fx.check().res, { skip: false, reason: 'sha-mismatch', sha: fx.S });
});

test('AC4.1: a selected story file changed since the stamp reports story-changed', () => {
  const fx = bookkeepingRepo([{ match: 'stories/**', suites: [], static: false }]);
  fx.commit({ ...LEDGER, 'stories/app.yaml': 'stories:\n  - id: login\n    edited: true\n' });
  assert.deepEqual(fx.check(['--scope', DECL_PATH]).res, { skip: false, reason: 'story-changed: login', sha: fx.S });
});

test('AC5.1: a stamp sha that is not an ancestor of HEAD stays sha-mismatch', () => {
  const fx = bookkeepingRepo();
  fx.g(['checkout', '-q', '--orphan', 'other']);
  fx.commit(LEDGER, 'unrelated');
  const { code, res } = fx.check(['--scope', DECL_PATH]);
  assert.equal(code, 0);
  assert.deepEqual(res, { skip: false, reason: 'sha-mismatch', sha: fx.S });
});

test('AC5.2: a missing or unparseable --scope path stays sha-mismatch, exit 0', () => {
  const fx = bookkeepingRepo();
  fx.commit(LEDGER);
  fs.mkdirSync(path.join(fx.root, '.claude-tweaks', 'artifacts'), { recursive: true });
  const bad = path.join(fx.root, '.claude-tweaks', 'artifacts', 'bad.json');
  fs.writeFileSync(bad, '{');
  for (const scope of ['nope.json', '.claude-tweaks/artifacts/bad.json']) {
    const { code, res } = fx.check(['--scope', scope]);
    assert.equal(code, 0);
    assert.deepEqual(res, { skip: false, reason: 'sha-mismatch', sha: fx.S });
  }
});

test('AC6.1: a dirty tree with a bookkeeping-only delta reports dirty-tree', () => {
  const fx = bookkeepingRepo();
  fx.commit(LEDGER);
  fs.writeFileSync(path.join(fx.root, 'stray.txt'), 'x');
  assert.deepEqual(fx.check(['--scope', DECL_PATH]).res, { skip: false, reason: 'dirty-tree', sha: fx.S });
});

test('--scope with no stamp reports no-stamp', () => {
  const fx = bookkeepingRepo();
  fs.rmSync(fx.stampPath);
  assert.deepEqual(fx.check(['--scope', DECL_PATH]).res, { skip: false, reason: 'no-stamp', sha: null });
});

test('untracked QA artifacts under .claude-tweaks/artifacts/ do not defeat the bookkeeping-delta skip', () => {
  const fx = bookkeepingRepo();
  fx.commit(LEDGER);
  fs.mkdirSync(path.join(fx.root, '.claude-tweaks', 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(fx.root, '.claude-tweaks', 'artifacts', 'x.png'), 'x');
  assert.deepEqual(fx.check(['--scope', DECL_PATH]).res, { skip: true, reason: 'covered-bookkeeping-delta', sha: fx.S });
});

test('every git call --check makes carries the cwd dep', () => {
  const fx = bookkeepingRepo();
  fx.commit(LEDGER);
  const calls = [];
  const exec = (c, a, o) => { calls.push(o && o.cwd); return execFileSync(c, a, { ...o, cwd: fx.root }); };
  assert.equal(fx.check(['--scope', DECL_PATH], { exec }).res.reason, 'covered-bookkeeping-delta');
  assert.ok(calls.length > 0);
  assert.ok(calls.every((c) => c === fx.root), JSON.stringify(calls));
});

test('--scope declaration whose generated glob covers its own path is refused, as verify.js refuses it (plan-review clarification)', () => {
  const rules = [{ match: 'docs/plans/*-ledger.md', suites: [], static: false }, { match: 'src/**', suites: '*', static: true }];
  const decl = JSON.stringify({ checks: { tests: 'node --test' }, rules, generated: ['config/**'] });
  const fx = bookkeepingRepo([], { 'config/qa-scope.json': decl });
  fx.commit(LEDGER);
  assert.deepEqual(fx.check(['--scope', DECL_PATH]).res, { skip: true, reason: 'covered-bookkeeping-delta', sha: fx.S });
  const { code, res } = fx.check(['--scope', 'config/qa-scope.json']);
  assert.equal(code, 0);
  assert.deepEqual(res, { skip: false, reason: 'sha-mismatch', sha: fx.S });
});
