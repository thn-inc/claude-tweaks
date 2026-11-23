'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { originWithTwoClones, cleanGitEnv } = require('../../helpers/git-fixtures');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');
const { CHECK_ORDER } = require('../../../plugin/bin/lib/plan-store/check');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'plan-store.js');
const REF = 'refs/claude-tweaks/plans/7';
const BASENAME = '2026-11-22-plan-store-7.md';
// A column-0 Modify bullet naming a file committed on the base (an empty set reads failed: files).
const PLAN = ['# Plan', '', '### Task 1: x', '', '**Files:**', '- Modify: `base`', '', 'Body.', ''].join('\n');
const SPEC = [
  '# Spec', '', 'Surface: infra', 'Risk-flags: public-contract', '',
  '## Overview', 'The overview says one thing.', '',
  '## Non-Goals', 'Nothing else.', '',
  '## Planning Decisions', 'Option A.', '',
].join('\n');

function setup(t) {
  const fx = originWithTwoClones('ct-plan-store-');
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const env = cleanGitEnv(fx.env);
  for (const dir of [fx.work, fx.other]) {
    fs.mkdirSync(path.join(dir, 'p'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'p', BASENAME), PLAN);
    fs.writeFileSync(path.join(dir, 'spec.md'), SPEC);
  }
  const cli = (cwd, argv) => {
    return runCliSync(CLI, argv, { cwd, env });
  };
  const write = (extra = []) => cli(fx.work, ['write', '--record', '7', '--plan-file', `p/${BASENAME}`, '--base', 'HEAD', '--spec-file', 'spec.md', ...extra]);
  const written = () => {
    const w = write();
    assert.strictEqual(w.code, 0, w.stderr);
    return JSON.parse(w.stdout);
  };
  const remote = () => fx.run(fx.work, ['ls-remote', 'origin', REF]).trim();
  return { fx, env, cli, write, written, remote };
}

const verdict = (r) => JSON.parse(r.stdout);

test('the ref prefix and parser are re-exported from ref.js', () => {
  const mod = require(CLI);
  const ref = require('../../../plugin/bin/lib/plan-store/ref.js');
  assert.strictEqual(mod.PLAN_REF_PREFIX, ref.PLAN_REF_PREFIX);
  assert.strictEqual(mod.parsePlanRefName, ref.parsePlanRefName);
});

test('--help short-circuits and USAGE names every exit code', () => {
  const r = spawnCli(CLI, ['--help']);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.match(r.stdout, /\b3\b.*no-ref/i);
  assert.match(r.stdout, /\b2\b.*malformed/i);
  assert.match(r.stdout, /\b1\b/);
  assert.match(r.stdout, /refs\/claude-tweaks\/plans\//);
});

test('malformed invocations exit 2', (t) => {
  const { fx, cli } = setup(t);
  const W = ['--plan-file', `p/${BASENAME}`, '--base', 'HEAD', '--spec-file', 'spec.md'];
  const cases = [
    [],
    ['wipe'],
    ['write', ...W],
    ['write', '--record', '0', ...W],
    ['write', '--record', '7', '--record', '8', ...W],
    ['write', '--record', '--base', 'HEAD', '--plan-file', 'p', '--spec-file', 'spec.md'],
    ['write', '--record', '7', ...W, '--plan-file'],
    ['read', '--record', '7', '--commit', 'xyz', '--out', 'out'],
    ['read', '--record', '7', '--commit', 'a'.repeat(40)],
    ['write', '--record', '7', ...W, '--bogus', 'x'],
    ['write', '--record', '7', ...W, 'constructor', 'x'],
  ];
  for (const argv of cases) {
    const r = cli(fx.work, argv);
    assert.strictEqual(r.code, 2, `${JSON.stringify(argv)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /plan-store\.js:/, JSON.stringify(argv));
    assert.strictEqual(r.stdout, '', JSON.stringify(argv));
  }
});

test('AC1.1 write in one clone, read in another, byte-for-byte', (t) => {
  const { fx, cli, written } = setup(t);
  const w = written();
  const r = cli(fx.other, ['read', '--record', '7', '--commit', w.commit, '--out', 'out']);
  assert.strictEqual(r.code, 0, r.stderr);
  const out = path.join(fx.other, 'out', BASENAME);
  assert.deepStrictEqual(verdict(r), { path: out });
  assert.ok(fs.readFileSync(out).equals(Buffer.from(PLAN)));
});

test('read of a commit the ref does not name exits 1', (t) => {
  const { fx, cli, written } = setup(t);
  written();
  const r = cli(fx.other, ['read', '--record', '7', '--commit', 'b'.repeat(40), '--out', 'out']);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.stdout, '');
  assert.match(r.stderr, /plan-store\.js:/);
});

// One memoized push-failure write (a pre-receive hook rejects the push): AC4.1 and the public-contract
// test both read it, and each passes alone under --test-name-pattern.
let noRefMemo;
function noRefRun() {
  if (noRefMemo) return noRefMemo;
  const fx = originWithTwoClones('ct-plan-store-');
  try {
    const env = cleanGitEnv(fx.env);
    fs.mkdirSync(path.join(fx.work, 'p'), { recursive: true });
    fs.writeFileSync(path.join(fx.work, 'p', BASENAME), PLAN);
    fs.writeFileSync(path.join(fx.work, 'spec.md'), SPEC);
    const hook = path.join(fx.root, 'origin.git', 'hooks', 'pre-receive');
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const r = runCliSync(CLI, ['write', '--record', '7', '--plan-file', `p/${BASENAME}`, '--base', 'HEAD', '--spec-file', 'spec.md'], { cwd: fx.work, env });
    noRefMemo = { code: r.code, stdout: r.stdout, stderr: r.stderr };
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
  return noRefMemo;
}

test('AC4.1 a push failure exits EXIT_NO_REF and prints no Plan: line', () => {
  const r = noRefRun();
  assert.strictEqual(r.code, require(CLI).EXIT_NO_REF);
  assert.strictEqual(r.stdout, '');
  assert.ok(r.stderr.length > 0);
});

test('an unreadable working directory returns a code instead of throwing', (t) => {
  const { fx, env, written } = setup(t);
  const w = written();
  const dead = { cwd: () => { throw new Error('ENOENT'); } };
  const call = (argv) => runCliSync(CLI, argv, { cwd: fx.work, env, deps: dead });
  const abs = (p) => path.join(fx.work, p);
  const wr = call(['write', '--record', '7', '--plan-file', abs(`p/${BASENAME}`), '--base', 'HEAD', '--spec-file', abs('spec.md')]);
  assert.strictEqual(wr.code, 3);
  assert.strictEqual(wr.stdout, '');
  const rd = call(['read', '--record', '7', '--commit', w.commit, '--out', abs('out')]);
  assert.strictEqual(rd.code, 1);
  const ck = call(['check', '--line', w.line, '--spec-file', abs('spec.md'), '--base', 'HEAD']);
  assert.strictEqual(ck.code, 1);
  assert.deepStrictEqual(verdict(ck), { valid: false, failed: 'ref' });
  // An absolute --repo-root never reads the working directory: pinned by counting cwd() calls.
  let calls = 0;
  const counting = { cwd: () => { calls += 1; throw new Error('ENOENT'); } };
  const ok = runCliSync(CLI, ['check', '--line', w.line, '--spec-file', abs('spec.md'), '--base', 'HEAD', '--repo-root', fx.work], { cwd: fx.work, env, deps: counting });
  assert.strictEqual(ok.code, 0, ok.stderr);
  assert.deepStrictEqual(verdict(ok), { valid: true, failed: null });
  assert.strictEqual(calls, 0);
});

test('a local ref failure after a successful push exits 0 with a warning', (t) => {
  const { fx, write, written, remote } = setup(t);
  written();
  const lock = path.join(fx.work, '.git', REF + '.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  fs.writeFileSync(lock, '');
  t.after(() => fs.rmSync(lock, { force: true }));
  fs.writeFileSync(path.join(fx.work, 'p', BASENAME), `${PLAN}More.\n`);
  const r = write();
  assert.strictEqual(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(remote().split('\t')[0], out.commit);
  assert.ok(out.line.includes(out.commit));
  assert.match(r.stderr, /local ref .*not updated/i);
  assert.match(r.stderr, /lock/i); // the reason git gave for the failed update-ref
});

test('write refuses a spec with no Overview', (t) => {
  const { fx, write, remote } = setup(t);
  fs.writeFileSync(path.join(fx.work, 'spec.md'), '# Spec\n\n## Non-Goals\nx\n');
  const r = write();
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.stdout, '');
  assert.match(r.stderr, /Overview/);
  assert.strictEqual(remote(), '');
});

test('write with an unreadable plan file exits 1', (t) => {
  const { fx, cli } = setup(t);
  const r = cli(fx.work, ['write', '--record', '7', '--plan-file', 'p/missing.md', '--base', 'HEAD', '--spec-file', 'spec.md']);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.stdout, '');
});

test('write with an unresolvable base exits 1', (t) => {
  const { fx, cli } = setup(t);
  const r = cli(fx.work, ['write', '--record', '7', '--plan-file', `p/${BASENAME}`, '--base', 'deadbeef', '--spec-file', 'spec.md']);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.stdout, '');
});

test('write of a plan the base already holds exits 1 with no Plan: line and no ref on origin', (t) => {
  const { fx, write, remote } = setup(t);
  const file = path.join(fx.work, 'docs', 'superpowers', 'plans', BASENAME);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(fx.work, 'p', BASENAME), file);
  fx.run(fx.work, ['add', '--', `docs/superpowers/plans/${BASENAME}`]);
  fx.run(fx.work, ['commit', '-q', '-m', 'plan already on base']);
  const r = write();
  assert.strictEqual(r.code, 1, r.stderr);
  assert.strictEqual(r.stdout, '');
  assert.match(r.stderr, /byte-for-byte/);
  assert.strictEqual(remote(), '');
});

function checkArgv(line, over = {}) {
  const o = { base: 'HEAD', spec: 'spec.md', ...over };
  return ['check', '--line', line, '--spec-file', o.spec, '--base', o.base, ...(o.root ? ['--repo-root', o.root] : [])];
}

test('AC3.2 check exits 0 with {valid:true, failed:null}', (t) => {
  const { fx, cli, written } = setup(t);
  const w = written();
  // cwd is the clone's parent, so both the spec file and --repo-root resolve against deps.cwd().
  const r = cli(fx.root, checkArgv(w.line, { spec: 'other/spec.md', root: 'other' }));
  assert.strictEqual(r.code, 0, r.stderr);
  assert.deepStrictEqual(verdict(r), { valid: true, failed: null });
});

test('AC3.3 an Overview edit reads failed: hash', (t) => {
  const { fx, cli, written } = setup(t);
  const w = written();
  fs.writeFileSync(path.join(fx.other, 'spec.md'), SPEC.replace('one thing', 'another thing'));
  const r = cli(fx.other, checkArgv(w.line));
  assert.strictEqual(r.code, 1);
  assert.deepStrictEqual(verdict(r), { valid: false, failed: 'hash' });
});

test('AC3.4 Risk-flags and Related edits stay valid', (t) => {
  const { fx, cli, written } = setup(t);
  const w = written();
  fs.writeFileSync(path.join(fx.other, 'spec.md'),
    SPEC.replace('Risk-flags: public-contract', 'Risk-flags: other').replace('Option A.', 'Option A.\n**Related:** #12'));
  const r = cli(fx.other, checkArgv(w.line));
  assert.strictEqual(r.code, 0, r.stderr);
  assert.deepStrictEqual(verdict(r), { valid: true, failed: null });
});

test('AC8.1 check exits 1 with failed: base', (t) => {
  const { fx, cli, written } = setup(t);
  const w = written();
  const r = cli(fx.other, checkArgv(w.line, { base: 'deadbeef' }));
  assert.strictEqual(r.code, 1);
  assert.deepStrictEqual(verdict(r), { valid: false, failed: 'base' });
});

test('AC3.1 a malformed --line exits 2 with valid: false', (t) => {
  const { fx, cli, written } = setup(t);
  const w = written();
  const bad = cli(fx.other, checkArgv('Plan: nope'));
  assert.strictEqual(bad.code, 2);
  assert.deepStrictEqual(verdict(bad), { valid: false, failed: 'ref' });
  const unknown = cli(fx.other, [...checkArgv(w.line), '--bogus', 'x']);
  assert.strictEqual(unknown.code, 2);
  assert.deepStrictEqual(verdict(unknown), { valid: false, failed: 'ref' });
  const noBase = cli(fx.other, ['check', '--line', w.line, '--spec-file', 'spec.md', '--base']);
  assert.strictEqual(noBase.code, 2);
  assert.deepStrictEqual(verdict(noBase), { valid: false, failed: 'base' });
  const noSpec = cli(fx.other, ['check', '--line', w.line, '--base', 'HEAD']);
  assert.strictEqual(noSpec.code, 2);
  assert.deepStrictEqual(verdict(noSpec), { valid: false, failed: 'hash' });
  // Both a line and a base problem: the first check in CHECK_ORDER wins.
  const both = cli(fx.other, ['check', '--line', 'Plan: nope', '--spec-file', 'spec.md', '--base']);
  assert.strictEqual(both.code, 2);
  assert.deepStrictEqual(verdict(both), { valid: false, failed: CHECK_ORDER[0] });
});

test('--line-file reads the line from a file, and needs exactly one of --line and --line-file', (t) => {
  const { fx, cli, written } = setup(t);
  const w = written();
  fs.writeFileSync(path.join(fx.other, 'line.txt'), `${w.line}\n`);
  const fromFile = cli(fx.other, ['check', '--line-file', 'line.txt', '--spec-file', 'spec.md', '--base', 'HEAD']);
  assert.strictEqual(fromFile.code, 0, fromFile.stderr);
  assert.deepStrictEqual(verdict(fromFile), { valid: true, failed: null });
  fs.writeFileSync(path.join(fx.other, 'bad.txt'), 'Plan: $(touch pwned)\n');
  const bad = cli(fx.other, ['check', '--line-file', 'bad.txt', '--spec-file', 'spec.md', '--base', 'HEAD']);
  assert.strictEqual(bad.code, 2);
  assert.deepStrictEqual(verdict(bad), { valid: false, failed: 'ref' });
  const missing = cli(fx.other, ['check', '--line-file', 'absent.txt', '--spec-file', 'spec.md', '--base', 'HEAD']);
  assert.strictEqual(missing.code, 2);
  assert.match(missing.stderr, /could not read --line-file/);
  const both = cli(fx.other, ['check', '--line', w.line, '--line-file', 'line.txt', '--spec-file', 'spec.md', '--base', 'HEAD']);
  assert.strictEqual(both.code, 2);
  assert.match(both.stderr, /mutually exclusive/);
  const neither = cli(fx.other, ['check', '--spec-file', 'spec.md', '--base', 'HEAD']);
  assert.strictEqual(neither.code, 2);
  assert.deepStrictEqual(verdict(neither), { valid: false, failed: 'ref' });
});

test('local-files: write prints the line and keeps the ref local', (t) => {
  const { fx, cli, written, remote } = setup(t);
  for (const dir of [fx.work, fx.other]) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '## Work records\n\nwork-backend: local-files\n');
  const w = written();
  assert.match(w.line, /^Plan: refs\/claude-tweaks\/plans\/7 /);
  assert.strictEqual(remote(), '');
  const r = cli(fx.other, checkArgv(w.line));
  assert.strictEqual(r.code, 1);
  assert.deepStrictEqual(verdict(r), { valid: false, failed: 'ref' });
});

test('public contract: Plan: line grammar, exit codes and verdict shape', (t) => {
  const { fx, cli, written } = setup(t);
  const out = written();
  assert.deepStrictEqual(Object.keys(out), ['ref', 'commit', 'specHash', 'line']);
  assert.match(out.line, /^Plan: refs\/claude-tweaks\/plans\/7 [0-9a-f]{40} spec-sha256:[0-9a-f]{64}$/);
  const verdicts = [
    cli(fx.other, checkArgv(out.line)),
    cli(fx.other, checkArgv(out.line, { base: 'deadbeef' })),
    cli(fx.other, checkArgv('Plan: nope')),
  ];
  assert.deepStrictEqual(verdicts.map((v) => v.code), [0, 1, 2]);
  for (const v of verdicts) assert.deepStrictEqual(Object.keys(verdict(v)), ['valid', 'failed']);
  assert.strictEqual(require(CLI).EXIT_NO_REF, 3);
  assert.match(require(CLI).USAGE, /\b3\b.*no-ref/i);
  // The code set from this test's own calls plus the memoized push-failure write.
  const codes = new Set([...verdicts.map((v) => v.code), noRefRun().code]);
  assert.deepStrictEqual([...codes].sort(), [0, 1, 2, 3]);
});
