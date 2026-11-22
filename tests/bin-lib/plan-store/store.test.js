'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { originWithTwoClones, cleanGitEnv, committedRepo } = require('../../helpers/git-fixtures');
const { defaultGit, makeGit, localRef, absoluteGitDir } = require('../../../plugin/bin/lib/plan-store/git');
const { writePlan, readPlan } = require('../../../plugin/bin/lib/plan-store/store');

const PLAN = Buffer.from('# Plan\r\n- naïve step\r\n');
const PLAN_B = Buffer.from('# Plan B\n');
const BASENAME = '2026-11-22-plan-store-7.md';
const REF = 'refs/claude-tweaks/plans/7';

function setup(t, wrap) {
  const fx = originWithTwoClones('ct-plan-store-');
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const env = cleanGitEnv(fx.env);
  const calls = [];
  const git = (args, opts) => { calls.push(args); return (wrap ? wrap(fx, args, opts) : defaultGit(args, opts)); };
  const g = makeGit({ git, root: fx.work, env });
  const write = (over = {}) => writePlan({ g, push: true, record: 7, basename: BASENAME, planBytes: PLAN, base: 'HEAD', ...over });
  return { fx, env, g, calls, write };
}

function plantHook(fx) {
  const hook = path.join(fx.root, 'origin.git', 'hooks', 'pre-receive');
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
}

const remoteRef = (fx) => fx.run(fx.work, ['ls-remote', 'origin', REF]).trim();

test('AC1.1 write then read round-trips the plan bytes', (t) => {
  const { fx, env, write } = setup(t);
  const r = write();
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.ref, REF);
  assert.strictEqual(r.localRefUpdated, true);
  const go = makeGit({ root: fx.other, env });
  const got = readPlan({ g: go, fetch: true, record: 7, commit: r.commit });
  assert.strictEqual(got.ok, true, JSON.stringify(got));
  assert.ok(got.bytes.equals(PLAN));
  assert.strictEqual(got.basename, BASENAME);
});

test("AC2.1 plan commit's parent is the base and its tree adds only the plan file", (t) => {
  const { fx, write } = setup(t);
  const base = fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  const r = write();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(fx.run(fx.work, ['rev-parse', `${r.commit}^1`]).trim(), base);
  assert.strictEqual(fx.run(fx.work, ['rev-list', '--parents', '-n', '1', r.commit]).trim().split(' ').length, 2);
  const out = fx.run(fx.work, ['diff-tree', '-r', '-z', '--name-status', base, r.commit]);
  assert.deepStrictEqual(out.split('\0').filter(Boolean), ['A', `docs/superpowers/plans/${BASENAME}`]);
});

test('AC6.1 a second write replaces the ref with the newer plan', (t) => {
  const { fx, g, write } = setup(t);
  const a = write();
  fx.commit(fx.work, 'moved.txt');
  fx.run(fx.work, ['push', '-q', 'origin', 'main']);
  const b = write({ planBytes: PLAN_B });
  assert.strictEqual(a.ok && b.ok, true);
  assert.notStrictEqual(a.commit, b.commit);
  assert.strictEqual(remoteRef(fx).split('\t')[0], b.commit);
  assert.strictEqual(localRef(g, REF), b.commit);
});

test("AC6.2 the old commit is no longer the ref's target", (t) => {
  const { fx, g, write } = setup(t);
  const a = write();
  fx.commit(fx.work, 'moved.txt');
  fx.run(fx.work, ['push', '-q', 'origin', 'main']);
  const b = write({ planBytes: PLAN_B });
  assert.strictEqual(b.ok, true);
  assert.notStrictEqual(localRef(g, REF), a.commit);
  assert.notStrictEqual(remoteRef(fx).split('\t')[0], a.commit);
});

test('AC4.1 a rejected push is kind no-ref', (t) => {
  const { fx, write } = setup(t);
  plantHook(fx);
  const r = write();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.kind, 'no-ref');
  assert.ok(typeof r.reason === 'string' && r.reason.length > 0);
});

test('AC7.1 a failed push leaves the local ref at its prior value and the remote unchanged', (t) => {
  const { fx, g, write } = setup(t);
  // (b) no prior write
  plantHook(fx);
  const nb = write();
  assert.strictEqual(nb.ok, false);
  assert.strictEqual(localRef(g, REF), null);
  assert.strictEqual(remoteRef(fx), '');
  // (a) prior write present
  fs.rmSync(path.join(fx.root, 'origin.git', 'hooks', 'pre-receive'));
  const a = write();
  assert.strictEqual(a.ok, true);
  plantHook(fx);
  const b = write({ planBytes: PLAN_B });
  assert.strictEqual(b.ok, false);
  assert.strictEqual(localRef(g, REF), a.commit);
  assert.strictEqual(remoteRef(fx).split('\t')[0], a.commit);
});

test("two racing writers: the loser exits no-ref and the winner's ref stands", (t) => {
  let raced = false;
  const pushes = [];
  const { fx, g, write } = setup(t, (fx2, args, opts) => {
    if (args.includes('push') && !raced) {
      raced = true;
      pushes.push(args);
      fx2.run(fx2.other, ['push', '-q', 'origin', `HEAD:${REF}`]);
    }
    return defaultGit(args, opts);
  });
  const r = write();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.kind, 'no-ref');
  assert.match(r.reason, /^push lost the lease on refs\/claude-tweaks\/plans\/7: /);
  assert.match(r.reason, /stale info|rejected/);
  assert.strictEqual(localRef(g, REF), null);
  const otherHead = fx.run(fx.other, ['rev-parse', 'HEAD']).trim();
  assert.strictEqual(remoteRef(fx).split('\t')[0], otherHead);
  assert.strictEqual(pushes.length, 1);
  const commit = pushes[0][pushes[0].indexOf('origin') + 1].split(':')[0];
  assert.deepStrictEqual(pushes[0], ['-C', fx.work, 'push', '--no-verify', '-q', 'origin', `${commit}:${REF}`, `--force-with-lease=${REF}:`]);
});

test('a local ref failure after a successful push still succeeds', (t) => {
  const { fx, g, write } = setup(t);
  const a = write();
  assert.strictEqual(a.ok, true);
  const lock = path.join(absoluteGitDir(g), REF + '.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, '');
  t.after(() => fs.rmSync(lock, { force: true }));
  const b = write({ planBytes: PLAN_B });
  assert.strictEqual(b.ok, true, JSON.stringify(b));
  assert.strictEqual(b.localRefUpdated, false);
  assert.ok(typeof b.localRefReason === 'string' && b.localRefReason.length > 0);
  assert.strictEqual(remoteRef(fx).split('\t')[0], b.commit);
  assert.strictEqual(localRef(g, REF), a.commit);
  const c = write({ planBytes: PLAN_B, push: false });
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.kind, 'no-ref');
});

test('push:false keeps the ref local', (t) => {
  const { fx, g, calls, write } = setup(t);
  const r = write({ push: false });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.localRefUpdated, true);
  assert.ok(!calls.some((a) => a.includes('ls-remote') || a.includes('push')));
  assert.strictEqual(localRef(g, REF), r.commit);
  assert.strictEqual(remoteRef(fx), '');
});

test('a non-default remote name is honoured', (t) => {
  const { fx, write } = setup(t);
  fx.run(fx.work, ['remote', 'rename', 'origin', 'upstream']);
  const r = write({ remote: 'upstream' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.match(fx.run(fx.root, ['--git-dir', path.join(fx.root, 'origin.git'), 'for-each-ref', REF]), /refs\/claude-tweaks\/plans\/7/);
});

test('an inherited GIT_DIR never redirects the write', (t) => {
  const fx = originWithTwoClones('ct-plan-store-');
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const decoy = committedRepo();
  t.after(() => fs.rmSync(decoy.dir, { recursive: true, force: true }));
  const snap = () => ({
    head: fs.readFileSync(path.join(decoy.dir, '.git', 'HEAD'), 'utf8'),
    refs: decoy.git('for-each-ref'),
    index: fs.readFileSync(path.join(decoy.dir, '.git', 'index')),
  });
  const before = snap();
  const env = {
    ...cleanGitEnv(fx.env),
    GIT_DIR: path.join(decoy.dir, '.git'), GIT_WORK_TREE: decoy.dir, GIT_INDEX_FILE: path.join(decoy.dir, '.git', 'index'),
  };
  const g = makeGit({ root: fx.work, env });
  const r = writePlan({ g, push: true, record: 7, basename: BASENAME, planBytes: PLAN, base: 'HEAD' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(fx.run(fx.work, ['rev-parse', REF]).trim(), r.commit);
  const after = snap();
  assert.strictEqual(after.head, before.head);
  assert.strictEqual(after.refs, before.refs);
  assert.ok(after.index.equals(before.index));
});

test('an unresolvable base is kind invalid', (t) => {
  const { g, write } = setup(t);
  for (const base of ['deadbeef', '-x']) {
    const r = write({ base });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.kind, 'invalid');
  }
  assert.strictEqual(localRef(g, REF), null);
});

test('the scratch index is removed on success and failure', (t) => {
  const { fx, g, write } = setup(t);
  const leftovers = () => fs.readdirSync(absoluteGitDir(g)).filter((e) => e.startsWith('plan-store-index-'));
  assert.strictEqual(write().ok, true);
  assert.deepStrictEqual(leftovers(), []);
  plantHook(fx);
  assert.strictEqual(write({ planBytes: PLAN_B }).ok, false);
  assert.deepStrictEqual(leftovers(), []);
});

test('a build failure removes the scratch index too', (t) => {
  const { g, write } = setup(t, (fx2, args, opts) => {
    if (args.includes('write-tree')) throw new Error('boom write-tree');
    return defaultGit(args, opts);
  });
  const r = write();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.kind, 'no-ref');
  assert.match(r.reason, /boom write-tree/);
  assert.deepStrictEqual(fs.readdirSync(absoluteGitDir(g)).filter((e) => e.startsWith('plan-store-index-')), []);
  assert.strictEqual(localRef(g, REF), null);
});

test('invalid record, basename and planBytes are kind invalid and create no ref', (t) => {
  const { fx, g, write } = setup(t);
  for (const over of [{ record: 0 }, { basename: 'a/b.md' }, { basename: '-x.md' }, { planBytes: 'text' }]) {
    const r = write(over);
    assert.strictEqual(r.ok, false, JSON.stringify(over));
    assert.strictEqual(r.kind, 'invalid', JSON.stringify(over));
  }
  assert.strictEqual(localRef(g, REF), null);
  assert.strictEqual(remoteRef(fx), '');
});

for (const push of [false, true]) {
  test(`a local writer moving the ref between the prior read and update-ref loses cleanly (push:${push})`, (t) => {
    let interloper = null;
    const { fx, g, write } = setup(t, (fx2, args, opts) => {
      if (args.includes('update-ref') && !interloper) {
        interloper = fx2.run(fx2.work, ['rev-parse', 'HEAD']).trim();
        fx2.run(fx2.work, ['update-ref', REF, interloper]);
      }
      return defaultGit(args, opts);
    });
    const r = write({ push });
    assert.ok(interloper, 'interloper ran');
    assert.strictEqual(localRef(g, REF), interloper, `push:${push}`);
    if (push) {
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      assert.strictEqual(r.localRefUpdated, false);
      assert.strictEqual(remoteRef(fx).split('\t')[0], r.commit);
    } else {
      assert.strictEqual(r.ok, false, JSON.stringify(r));
      assert.strictEqual(r.kind, 'no-ref');
    }
  });
}

test('readPlan refuses a ref that names another commit, and a missing ref', (t) => {
  const { g, write } = setup(t);
  const r = write();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(readPlan({ g, record: 7, commit: 'f'.repeat(40) }).ok, false);
  assert.strictEqual(readPlan({ g, fetch: true, record: 99, commit: r.commit }).ok, false);
  assert.strictEqual(readPlan({ g, record: 99, commit: r.commit }).ok, false);
  assert.strictEqual(readPlan({ g, record: 7, commit: r.commit }).ok, true);
});

test('write refuses a plan the base already holds byte-for-byte (the commit would change 0 files)', (t) => {
  const { fx, write } = setup(t);
  const file = path.join(fx.work, 'docs', 'superpowers', 'plans', BASENAME);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PLAN);
  fx.run(fx.work, ['add', '--', `docs/superpowers/plans/${BASENAME}`]);
  fx.run(fx.work, ['commit', '-q', '-m', 'plan already on base']);
  const r = write();
  assert.strictEqual(r.ok, false, JSON.stringify(r));
  assert.strictEqual(r.kind, 'invalid');
  assert.match(r.reason, /byte-for-byte/);
  assert.strictEqual(remoteRef(fx), '');
  assert.strictEqual(fx.run(fx.work, ['for-each-ref', REF]).trim(), '');
});

test('write turns ".", ".." and backslash basenames into invalid results, not git failures', (t) => {
  const { write } = setup(t);
  for (const basename of ['.', '..', 'a\\b.md']) {
    const r = write({ basename });
    assert.strictEqual(r.ok, false, basename);
    assert.strictEqual(r.kind, 'invalid', basename);
  }
});
