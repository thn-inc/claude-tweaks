'use strict';
// tests/bin-lib/flow/check-artifact-overwrite-cli.test.js — refs #2014
//
// Pins bin/check-artifact-overwrite.js's argv parsing and exit-code
// vocabulary (0 clean, 1 overwrite detected, 2 malformed invocation).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'check-artifact-overwrite.js');
const { run } = require(CLI);
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'flow', 'artifact-overwrite-check.js');
const { ArtifactOverwriteCheckError } = require(LIB);

function fakeIo() {
  let out = '';
  let err = '';
  return {
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
    out: () => out,
    err: () => err,
  };
}

test('--help prints usage and exits 0', () => {
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js', '--help'], io);
  assert.strictEqual(code, 0);
  assert.match(io.out(), /usage: check-artifact-overwrite\.js/);
});

test('missing --base is a malformed invocation (exit 2)', () => {
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js'], io);
  assert.strictEqual(code, 2);
  assert.match(io.err(), /--base is required/);
});

test('unknown flag is a malformed invocation (exit 2)', () => {
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js', '--base', 'HEAD~1', '--wat', 'x'], io);
  assert.strictEqual(code, 2);
  assert.match(io.err(), /unknown argument/);
});

test('a flag with no value is a malformed invocation (exit 2)', () => {
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js', '--base'], io);
  assert.strictEqual(code, 2);
  assert.match(io.err(), /requires a value/);
});

test('clean walk -> exit 0, JSON on stdout', () => {
  const io = fakeIo();
  const code = run(
    ['node', 'check-artifact-overwrite.js', '--base', 'a'],
    { ...io, check: () => ({ clean: true, overwrites: [] }) },
  );
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(JSON.parse(io.out()), { clean: true, overwrites: [] });
});

test('overwrite detected -> exit 1, JSON on stdout names the offender', () => {
  const io = fakeIo();
  const code = run(
    ['node', 'check-artifact-overwrite.js', '--base', 'a', '--path', 'docs/journeys/'],
    { ...io, check: () => ({ clean: false, overwrites: [{ path: 'docs/journeys/x.md', commit: 'deadbeef', reason: 'r' }] }) },
  );
  assert.strictEqual(code, 1);
  assert.strictEqual(JSON.parse(io.out()).overwrites.length, 1);
});

test('a walk failure (unresolvable ref) -> exit 3, stderr names it, nothing on stdout', () => {
  const io = fakeIo();
  const code = run(
    ['node', 'check-artifact-overwrite.js', '--base', 'not-a-ref'],
    { ...io, check: () => { throw new ArtifactOverwriteCheckError('unknown revision or path not in the working tree'); } },
  );
  assert.strictEqual(code, 3);
  assert.match(io.err(), /unknown revision/);
  assert.strictEqual(io.out(), '');
});

test('a bug in the check itself (not an ArtifactOverwriteCheckError) crashes loud, never reported as exit 3', () => {
  const io = fakeIo();
  assert.throws(
    () => run(
      ['node', 'check-artifact-overwrite.js', '--base', 'HEAD~1'],
      { ...io, check: () => { throw new TypeError("Cannot read properties of undefined (reading 'lineNo')"); } },
    ),
    TypeError,
  );
});

test('end-to-end against a real repo (no fake check) — clean walk exits 0', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-check-artifact-overwrite-cli-')));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', timeout: 30000 });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 'Test');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  fs.mkdirSync(path.join(dir, 'docs', 'journeys'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'journeys', 'demo.md'), '# Demo\nFirst.\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'Add demo journey (refs #10)');

  // checkArtifactOverwrite's own default reads process.cwd(); spawn the real
  // CLI (rather than calling run() in-process) so cwd is honored exactly the
  // way a caller invoking this binary would see it.
  const spawned = execFileSync('node', [CLI, '--base', base, '--path', 'docs/journeys/'], { cwd: dir, encoding: 'utf8' });
  assert.deepStrictEqual(JSON.parse(spawned), { clean: true, overwrites: [] });
});

// --- --run <dir>: manifest-window attribution (refs #4593) ---

const { manifestInit, transitionSpec } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'flow', 'manifest.js'));

function runDirWith(manifestText) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cao-run-')));
  if (manifestText !== undefined) fs.writeFileSync(path.join(dir, 'manifest.yml'), manifestText);
  return dir;
}

// Real writer: manifestInit + transitionSpec with a pinned clock.
function writtenManifestRun(transitions /* [[id, status, phase, iso], ...] */, ids = [10, 11]) {
  const runDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cao-manifest-')));
  manifestInit({ runDir, specs: ids, parent: 'p/' });
  for (const [specId, status, phase, iso] of transitions) transitionSpec({ runDir, specId, status, phase, now: new Date(iso) });
  return runDir;
}
const SEQUENTIAL_TRANSITIONS = [
  [10, 'running', 'build', '2026-01-01T10:00:00.000Z'],
  [10, 'complete', 'wrap-up', '2026-01-01T11:59:00.000Z'],
  [11, 'running', 'build', '2026-01-01T12:00:00.000Z'],
  [11, 'complete', 'wrap-up', '2026-01-01T14:00:00.000Z'],
];

function rewriteManifest(runDir, from, to) {
  const file = path.join(runDir, 'manifest.yml');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes(from), `manifest fixture lacks ${JSON.stringify(from)}:\n${text}`);
  fs.writeFileSync(file, text.replace(from, to));
}

// A repo whose commits carry pinned author AND committer dates and no refs trailer.
function storyRepo() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cao-repo-')));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 'Test');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  const commitAt = (message, iso, relPath, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, relPath)), { recursive: true });
    fs.writeFileSync(path.join(dir, relPath), content);
    git('add', '-A');
    execFileSync('git', ['commit', '-q', '-m', message], {
      cwd: dir, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
    });
  };
  return { dir, base, commitAt };
}
const STORY_PATH = 'stories/x-10.yaml';
const STORY_OLD = 'name: x\nsteps:\n  locator: old-a\n  other: keep\n';
const STORY_NEW = 'name: x\nsteps:\n  locator: new-a\n  other: keep\n';

function spawnCli(dir, args) {
  return spawnSync('node', [CLI, ...args], { cwd: dir, encoding: 'utf8', timeout: 30000 });
}

test('AC6.1: --run naming a dir with no manifest.yml exits 3 and stderr names the missing manifest', () => {
  const dir = runDirWith();
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js', '--base', 'a', '--run', dir],
    { ...io, check: () => { throw new Error('check must not run'); } });
  assert.strictEqual(code, 3);
  assert.ok(io.err().includes(path.join(dir, 'manifest.yml')), io.err());
  assert.strictEqual(io.out(), '');
});

test('--run naming a manifest.yml that does not parse exits 3 naming it', () => {
  const dir = runDirWith('not: a manifest\n');
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js', '--base', 'a', '--run', dir],
    { ...io, check: () => { throw new Error('check must not run'); } });
  assert.strictEqual(code, 3);
  assert.ok(io.err().includes(path.join(dir, 'manifest.yml')), io.err());
  assert.match(io.err(), /does not parse/);
  assert.strictEqual(io.out(), '');
});

test('--run reads the manifest through deps.readFile', () => {
  const seen = [];
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js', '--base', 'a', '--run', '/nowhere'], {
    ...io,
    readFile: (file, enc) => { seen.push([file, enc]); return 'multispec:\n  parent: p/\n  specs:\n    - id: 10\n      status: pending\n'; },
    check: (opts) => ({ clean: true, overwrites: [], ids: opts.manifest.multispec.specs.map((s) => s.id) }),
  });
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(seen, [[path.join('/nowhere', 'manifest.yml'), 'utf8']]);
  assert.deepStrictEqual(JSON.parse(io.out()).ids, [10]);
});

test('Q5: --run naming a manifest that parses but lists no specs exits 3 naming the field', () => {
  const dir = runDirWith('multispec:\n  parent: p/\n  specs:\n');
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js', '--base', 'a', '--run', dir], io);
  assert.strictEqual(code, 3);
  assert.match(io.err(), /manifest unusable: manifest names no specs/);
  assert.strictEqual(io.out(), '');
});

test('Q9: --run naming a manifest with an unparseable phases[].at exits 3 naming the field', () => {
  const dir = writtenManifestRun([[10, 'running', 'build', '2026-01-01T10:00:00.000Z']], [10]);
  rewriteManifest(dir, '          at: 2026-01-01T10:00:00.000Z', '          at: garbage');
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js', '--base', 'a', '--run', dir], io);
  assert.strictEqual(code, 3);
  assert.match(io.err(), /spec #10 phases\[0\]\.at is not a valid date \(garbage\)/);
  assert.strictEqual(io.out(), '');
});

test('Q8: --run naming a manifest whose spec has no recorded transition is a verdict (exit 1), not exit 3', () => {
  const fx = storyRepo();
  fx.commitAt('Add story', '2026-01-01T10:30:00Z', STORY_PATH, STORY_OLD);
  fx.commitAt('Review fix: locator', '2026-01-01T11:30:00Z', STORY_PATH, STORY_NEW);
  const runDir = writtenManifestRun([
    [10, 'running', 'build', '2026-01-01T10:00:00.000Z'],
    [10, 'complete', 'wrap-up', '2026-01-01T11:59:00.000Z'],
  ]);
  // Spec 11 reads `complete` with no startedAt and no phases (a `pending` spec would take the status-off branch first).
  rewriteManifest(runDir, '      status: pending', '      status: complete');
  const spawned = spawnCli(fx.dir, ['--base', fx.base, '--path', 'stories/', '--run', runDir]);
  assert.strictEqual(spawned.status, 1, spawned.stderr);
  const result = JSON.parse(spawned.stdout);
  assert.strictEqual(result.overwrites.length, 1);
  assert.ok(result.overwrites[0].reason.includes('manifest windows off: spec #11 has no recorded transition'), result.overwrites[0].reason);
});

test('--run with an empty value, a trailing bare --run, or a flag as its value is malformed (exit 2)', () => {
  for (const [argv, pattern] of [
    [['--base', 'a', '--run', ''], /--run requires a directory/],
    [['--base', 'a', '--run'], /requires a value/],
    [['--base', 'a', '--run', '--path'], /--run requires a directory/],
  ]) {
    const io = fakeIo();
    const code = run(['node', 'check-artifact-overwrite.js', ...argv],
      { ...io, check: () => { throw new Error('check must not run'); } });
    assert.strictEqual(code, 2, `argv ${JSON.stringify(argv)}`);
    assert.match(io.err(), pattern);
    assert.strictEqual(io.out(), '');
  }
});

test('--run forwards the parsed manifest into the check', () => {
  const dir = writtenManifestRun(SEQUENTIAL_TRANSITIONS);
  let seen;
  const io = fakeIo();
  const code = run(['node', 'check-artifact-overwrite.js', '--base', 'a', '--run', dir],
    { ...io, check: (opts) => { seen = opts; return { clean: true, overwrites: [] }; } });
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(seen.manifest.multispec.specs.map((s) => s.id), [10, 11]);
  assert.ok(!('run' in seen), 'opts must not carry the raw --run value into the check');
});

test('end-to-end: an untrailered self-edit exits 0 with --run and 1 without it', () => {
  const fx = storyRepo();
  fx.commitAt('Add story', '2026-01-01T10:30:00Z', STORY_PATH, STORY_OLD);
  fx.commitAt('Review fix: locator', '2026-01-01T11:30:00Z', STORY_PATH, STORY_NEW);
  const runDir = writtenManifestRun(SEQUENTIAL_TRANSITIONS);

  const withRun = spawnCli(fx.dir, ['--base', fx.base, '--path', 'stories/', '--run', runDir]);
  assert.strictEqual(withRun.status, 0, withRun.stderr);
  assert.deepStrictEqual(JSON.parse(withRun.stdout), { clean: true, overwrites: [] });

  const withoutRun = spawnCli(fx.dir, ['--base', fx.base, '--path', 'stories/']);
  assert.strictEqual(withoutRun.status, 1, withoutRun.stderr);
  assert.match(JSON.parse(withoutRun.stdout).overwrites[0].reason, /unattributable/);
});
