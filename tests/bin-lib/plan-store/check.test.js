'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { originWithTwoClones, cleanGitEnv } = require('../../helpers/git-fixtures');
const { defaultGit, makeGit } = require('../../../plugin/bin/lib/plan-store/git');
const { writePlan } = require('../../../plugin/bin/lib/plan-store/store');
const { checkPlan, namedPaths, CHECK_ORDER } = require('../../../plugin/bin/lib/plan-store/check');

const H = 'a'.repeat(64);
const BASENAME = '2026-11-22-plan-store-7.md';
// Every Files bullet starts at column 0: extractFileEntries matches untrimmed lines only.
const planText = (lines) => ['# Plan', '', '### Task 1: x', '', '**Files:**', ...lines, '', 'Body.', ''].join('\n');
const PLAN = planText(['- Modify: `src/a.js`', '- Test: `tests/a.test.js`', '- Create: `src/new.js`', '- Delete: `src/gone.js`']);

function put(dir, rel, body) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}

function setup(t, { text = PLAN, wrap } = {}) {
  const fx = originWithTwoClones('ct-plan-store-');
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const env = cleanGitEnv(fx.env);
  for (const f of ['src/a.js', 'src/c.js', 'tests/a.test.js']) put(fx.work, f, `// ${f}\n`);
  fx.run(fx.work, ['add', '.']);
  fx.run(fx.work, ['commit', '-q', '-m', 'files']);
  fx.run(fx.work, ['push', '-q', 'origin', 'main']);
  const base = fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  const git = (args, opts) => (wrap ? wrap(args, opts) : defaultGit(args, opts));
  const g = makeGit({ git, root: fx.work, env });
  const plan = writePlan({ g, push: true, record: 7, basename: BASENAME, planBytes: Buffer.from(text), base });
  assert.strictEqual(plan.ok, true, JSON.stringify(plan));
  const line = { record: 7, ref: plan.ref, commit: plan.commit, specHash: H };
  const check = (over = {}) => checkPlan({ g, fetch: true, line, currentSpecHash: H, base, ...over });
  // Move main with one commit and return its sha.
  const move = (mutate) => {
    mutate();
    fx.run(fx.work, ['add', '-A']);
    fx.run(fx.work, ['commit', '-q', '-m', 'move']);
    return fx.run(fx.work, ['rev-parse', 'HEAD']).trim();
  };
  return { fx, env, g, base, line, plan, check, move };
}

test('CHECK_ORDER is ref, hash, base, files', () => {
  assert.deepStrictEqual(CHECK_ORDER, ['ref', 'hash', 'base', 'files']);
});

test('namedPaths keeps Modify and Test, drops Create and Delete', () => {
  assert.deepStrictEqual(namedPaths(PLAN), ['src/a.js', 'tests/a.test.js']);
});

test('namedPaths de-duplicates in first-seen order', () => {
  const text = planText(['- Test: `t.js`', '- Modify: `a.js`', '- Modify: `t.js`']);
  assert.deepStrictEqual(namedPaths(text), ['t.js', 'a.js']);
});

test('AC3.2 an unchanged pair is valid', (t) => {
  const { check } = setup(t);
  assert.deepStrictEqual(check(), { valid: true, failed: null });
});

test('a fetch error reads failed: ref even when the local ref still names the commit', (t) => {
  const { check } = setup(t);
  // The local ref matches the line (writePlan moved it), so only the failed fetch can make this invalid.
  assert.deepStrictEqual(check({ fetch: false, remote: 'no-such-remote' }), { valid: true, failed: null });
  assert.deepStrictEqual(check({ remote: 'no-such-remote' }), { valid: false, failed: 'ref' });
});

test('AC3.2 a base moved only by an unrelated edit or a Create path stays valid', (t) => {
  const { check, move, fx } = setup(t);
  const b1 = move(() => put(fx.work, 'src/c.js', '// changed\n'));
  assert.deepStrictEqual(check({ base: b1 }), { valid: true, failed: null });
  const b2 = move(() => put(fx.work, 'src/new.js', '// new\n'));
  assert.deepStrictEqual(check({ base: b2 }), { valid: true, failed: null });
});

test('AC3.1 an empty named-path set reads failed: files', (t) => {
  const { check } = setup(t, { text: planText(['- Create: `src/new.js`']) });
  assert.deepStrictEqual(check(), { valid: false, failed: 'files' });
});

test('AC3.5 the base modifying, deleting or renaming a named file reads failed: files', (t) => {
  const { check, move, fx } = setup(t);
  const edit = move(() => put(fx.work, 'src/a.js', '// edited\n'));
  assert.deepStrictEqual(check({ base: edit }), { valid: false, failed: 'files' });
  const del = move(() => fx.run(fx.work, ['rm', '-q', 'tests/a.test.js']));
  assert.deepStrictEqual(check({ base: del }), { valid: false, failed: 'files' });
  const ren = move(() => fx.run(fx.work, ['mv', 'src/a.js', 'src/b.js']));
  assert.deepStrictEqual(check({ base: ren }), { valid: false, failed: 'files' });
});

test('a changed-path read failure counts as files', (t) => {
  const wrap = (args, opts) => {
    if (args.includes('diff') && args.includes('--name-status') && !args.includes('diff-tree')) throw new Error('boom');
    return defaultGit(args, opts);
  };
  const { check } = setup(t, { wrap });
  assert.deepStrictEqual(check(), { valid: false, failed: 'files' });
});

test('a throw reads as the check that was running', (t) => {
  const { check, line } = setup(t);
  const boom = () => { throw new Error('boom'); };
  assert.deepStrictEqual(check({ line: Object.defineProperty({ ...line }, 'commit', { get: boom }) }), { valid: false, failed: 'ref' });
  assert.deepStrictEqual(check({ line: Object.defineProperty({ ...line }, 'specHash', { get: boom }) }), { valid: false, failed: 'hash' });
});

test('hash mismatch and a null current hash read failed: hash', (t) => {
  const { check } = setup(t);
  assert.deepStrictEqual(check({ currentSpecHash: 'c'.repeat(64) }), { valid: false, failed: 'hash' });
  assert.deepStrictEqual(check({ currentSpecHash: null }), { valid: false, failed: 'hash' });
});

test('AC8.1 an unresolvable base reads failed: base', (t) => {
  const { check } = setup(t);
  assert.deepStrictEqual(check({ base: 'deadbeef' }), { valid: false, failed: 'base' });
});

test('AC3.6 a missing ref reads failed: ref, and ref wins over later failures', (t) => {
  const { check, line } = setup(t);
  const missing = { ...line, record: 99, ref: 'refs/claude-tweaks/plans/99' };
  assert.deepStrictEqual(check({ line: missing }), { valid: false, failed: 'ref' });
  assert.deepStrictEqual(check({ line: missing, base: 'deadbeef', currentSpecHash: null }), { valid: false, failed: 'ref' });
});

test('order: hash wins over base and files; base wins over files', (t) => {
  const { check } = setup(t, { text: planText(['- Create: `src/new.js`']) });
  assert.deepStrictEqual(check({ currentSpecHash: null, base: 'deadbeef' }), { valid: false, failed: 'hash' });
  assert.deepStrictEqual(check({ base: 'deadbeef' }), { valid: false, failed: 'base' });
});

test('AC3.6 a ref naming another commit reads failed: ref', (t) => {
  const { check, line, base } = setup(t);
  assert.deepStrictEqual(check({ line: { ...line, commit: base } }), { valid: false, failed: 'ref' });
});

test('AC3.6 a newer plan on the remote makes an old line read failed: ref', (t) => {
  const { fx, env, check } = setup(t);
  fx.run(fx.other, ['pull', '-q', 'origin', 'main']);
  put(fx.other, 'src/z.js', '// z\n');
  fx.run(fx.other, ['add', '-A']);
  fx.run(fx.other, ['commit', '-q', '-m', 'later']);
  fx.run(fx.other, ['push', '-q', 'origin', 'main']);
  const go = makeGit({ root: fx.other, env });
  const b = writePlan({ g: go, push: true, record: 7, basename: BASENAME, planBytes: Buffer.from(PLAN + '\nB\n'), base: 'HEAD' });
  assert.strictEqual(b.ok, true, JSON.stringify(b));
  assert.deepStrictEqual(check({ fetch: false }), { valid: true, failed: null });
  assert.deepStrictEqual(check({ fetch: true }), { valid: false, failed: 'ref' });
});

test('the result holds exactly the two keys', (t) => {
  const { check } = setup(t);
  assert.deepStrictEqual(Object.keys(check()).sort(), ['failed', 'valid']);
  assert.deepStrictEqual(Object.keys(check({ base: 'deadbeef' })).sort(), ['failed', 'valid']);
});

test('checkPlan never throws on a missing or null argument', () => {
  assert.deepStrictEqual(checkPlan(), { valid: false, failed: 'ref' });
  assert.deepStrictEqual(checkPlan(null), { valid: false, failed: 'ref' });
});

test('an undefined current hash against a line with no specHash reads failed: hash', (t) => {
  const { check, line } = setup(t);
  const { specHash, ...noHash } = line;
  assert.deepStrictEqual(check({ line: noHash, currentSpecHash: undefined }), { valid: false, failed: 'hash' });
});

// check.js copies the git functions at load time, so a stub must be in place before it loads.
function loadWithGit(t, overrides) {
  const gitPath = require.resolve('../../../plugin/bin/lib/plan-store/git');
  const checkPath = require.resolve('../../../plugin/bin/lib/plan-store/check');
  const savedGit = require.cache[gitPath];
  const savedCheck = require.cache[checkPath];
  t.after(() => {
    require.cache[gitPath] = savedGit;
    require.cache[checkPath] = savedCheck;
  });
  delete require.cache[checkPath];
  require.cache[gitPath] = { ...savedGit, exports: { ...savedGit.exports, ...overrides } };
  return require(checkPath);
}

test('a throw in the base check reads failed: base', (t) => {
  const { line, g } = setup(t);
  const stubbed = loadWithGit(t, { resolveCommit: () => { throw new Error('boom'); } });
  assert.deepStrictEqual(stubbed.checkPlan({ g, fetch: false, line, currentSpecHash: H, base: 'HEAD' }), { valid: false, failed: 'base' });
});

test('a throw in the files check reads failed: files', (t) => {
  const { line, g, base } = setup(t);
  const stubbed = loadWithGit(t, { changedPaths: () => { throw new Error('boom'); } });
  assert.deepStrictEqual(stubbed.checkPlan({ g, fetch: false, line, currentSpecHash: H, base }), { valid: false, failed: 'files' });
});

test('AC3.6 a ref naming a commit that is not a one-file plan commit reads failed: ref', (t) => {
  const { fx, check, line, base } = setup(t);
  fx.run(fx.work, ['update-ref', line.ref, base]);
  assert.deepStrictEqual(check({ fetch: false, line: { ...line, commit: base } }), { valid: false, failed: 'ref' });
});
