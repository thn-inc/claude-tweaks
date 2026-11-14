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
const { execFileSync } = require('child_process');
const { runCliSync, spawnCli } = require('../../helpers/run-cli.js');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'check-artifact-overwrite.js');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'flow', 'artifact-overwrite-check.js');
const { ArtifactOverwriteCheckError } = require(LIB);

// The ambient env, minus the GIT_* variables the module-level cleanup below removes: real git needs PATH.
function runCheck(argv, deps = {}, cwd = process.cwd()) {
  const res = runCliSync(CLI, argv, { env: { ...process.env }, cwd, deps });
  return { code: res.code, out: () => res.stdout, err: () => res.stderr };
}

test('--help prints usage and exits 0', () => {
  const io = runCheck(['--help']);
  assert.strictEqual(io.code, 0);
  assert.match(io.out(), /usage: check-artifact-overwrite\.js/);
});

test('missing --base is a malformed invocation (exit 2)', () => {
  const io = runCheck([]);
  assert.strictEqual(io.code, 2);
  assert.match(io.err(), /--base is required/);
});

test('unknown flag is a malformed invocation (exit 2)', () => {
  const io = runCheck(['--base', 'HEAD~1', '--wat', 'x']);
  assert.strictEqual(io.code, 2);
  assert.match(io.err(), /unknown argument/);
});

test('a flag with no value is a malformed invocation (exit 2)', () => {
  const io = runCheck(['--base']);
  assert.strictEqual(io.code, 2);
  assert.match(io.err(), /requires a value/);
});

test('clean walk -> exit 0, JSON on stdout', () => {
  const io = runCheck(
    ['--base', 'a'],
    { check: () => ({ clean: true, overwrites: [] }) },
  );
  assert.strictEqual(io.code, 0);
  assert.deepStrictEqual(JSON.parse(io.out()), { clean: true, overwrites: [] });
});

test('overwrite detected -> exit 1, JSON on stdout names the offender', () => {
  const io = runCheck(
    ['--base', 'a', '--path', 'docs/journeys/'],
    { check: () => ({ clean: false, overwrites: [{ path: 'docs/journeys/x.md', commit: 'deadbeef', reason: 'r' }] }) },
  );
  assert.strictEqual(io.code, 1);
  assert.strictEqual(JSON.parse(io.out()).overwrites.length, 1);
});

test('a walk failure (unresolvable ref) -> exit 3, stderr names it, nothing on stdout', () => {
  const io = runCheck(
    ['--base', 'not-a-ref'],
    { check: () => { throw new ArtifactOverwriteCheckError('unknown revision or path not in the working tree'); } },
  );
  assert.strictEqual(io.code, 3);
  assert.match(io.err(), /unknown revision/);
  assert.strictEqual(io.out(), '');
});

test('a bug in the check itself (not an ArtifactOverwriteCheckError) crashes loud, never reported as exit 3', () => {
  assert.throws(
    () => runCheck(
      ['--base', 'HEAD~1'],
      { check: () => { throw new TypeError("Cannot read properties of undefined (reading 'lineNo')"); } },
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

  // real process: proves the script entry (argv slice, realDeps wiring) and exit 0 with the default cwd.
  const spawned = spawnCli(CLI, ['--base', base, '--path', 'docs/journeys/'], { cwd: dir });
  assert.strictEqual(spawned.code, 0, spawned.stderr);
  assert.deepStrictEqual(JSON.parse(spawned.stdout), { clean: true, overwrites: [] });
});

// --- --run <dir>: manifest-window attribution (refs #4593) ---

// An inherited GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE outranks the fixture's cwd, which would aim
// the fixture commits at the checkout running this suite (tests/stash-guard.test.js does the same).
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete process.env[name];

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
  for (const [specId, status, phase, iso] of transitions) {
    const res = transitionSpec({ runDir, specId, status, phase, now: new Date(iso) });
    assert.ok(res.ok, `fixture transition rejected: ${JSON.stringify([specId, status, phase, res.reason])}`);
  }
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

test('AC6.1: --run naming a dir with no manifest.yml exits 3 and stderr names the missing manifest', () => {
  const dir = runDirWith();
  const io = runCheck(['--base', 'a', '--run', dir],
    { check: () => { throw new Error('check must not run'); } });
  assert.strictEqual(io.code, 3);
  assert.ok(io.err().includes(path.join(dir, 'manifest.yml')), io.err());
  assert.strictEqual(io.out(), '');
});

test('--run naming a manifest.yml that does not parse exits 3 naming it', () => {
  const dir = runDirWith('not: a manifest\n');
  const io = runCheck(['--base', 'a', '--run', dir],
    { check: () => { throw new Error('check must not run'); } });
  assert.strictEqual(io.code, 3);
  assert.ok(io.err().includes(path.join(dir, 'manifest.yml')), io.err());
  assert.match(io.err(), /does not parse/);
  assert.strictEqual(io.out(), '');
});

test('--run reads the manifest through deps.readFile', () => {
  const seen = [];
  const io = runCheck(['--base', 'a', '--run', '/nowhere'], {
    readFile: (file, enc) => { seen.push([file, enc]); return 'multispec:\n  parent: p/\n  specs:\n    - id: 10\n      status: pending\n'; },
    check: (opts) => ({ clean: true, overwrites: [], ids: opts.manifest.multispec.specs.map((s) => s.id) }),
  });
  assert.strictEqual(io.code, 0);
  assert.deepStrictEqual(seen, [[path.join('/nowhere', 'manifest.yml'), 'utf8']]);
  assert.deepStrictEqual(JSON.parse(io.out()).ids, [10]);
});

test('Q5: --run naming a manifest that parses but lists no specs exits 3 naming the field', () => {
  const dir = runDirWith('multispec:\n  parent: p/\n  specs:\n');
  const io = runCheck(['--base', 'a', '--run', dir]);
  assert.strictEqual(io.code, 3);
  assert.match(io.err(), /manifest unusable: manifest names no specs/);
  assert.strictEqual(io.out(), '');
});

test('Q9: --run naming a manifest with an unparseable phases[].at exits 3 naming the field', () => {
  const dir = writtenManifestRun([[10, 'running', 'build', '2026-01-01T10:00:00.000Z']], [10]);
  rewriteManifest(dir, '          at: 2026-01-01T10:00:00.000Z', '          at: garbage');
  const io = runCheck(['--base', 'a', '--run', dir]);
  assert.strictEqual(io.code, 3);
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
  assert.notEqual(fx.dir, process.cwd());
  const spawned = runCheck(['--base', fx.base, '--path', 'stories/', '--run', runDir], {}, fx.dir);
  assert.strictEqual(spawned.code, 1, spawned.err());
  const result = JSON.parse(spawned.out());
  assert.strictEqual(result.overwrites.length, 1);
  assert.ok(result.overwrites[0].reason.includes('manifest windows off: spec #11 has no recorded transition'), result.overwrites[0].reason);
});

test('--run with an empty value, a trailing bare --run, or a flag as its value is malformed (exit 2)', () => {
  for (const [argv, pattern] of [
    [['--base', 'a', '--run', ''], /--run requires a directory/],
    [['--base', 'a', '--run'], /requires a value/],
    [['--base', 'a', '--run', '--path'], /--run requires a directory/],
  ]) {
    const io = runCheck(argv,
      { check: () => { throw new Error('check must not run'); } });
    assert.strictEqual(io.code, 2, `argv ${JSON.stringify(argv)}`);
    assert.match(io.err(), pattern);
    assert.strictEqual(io.out(), '');
  }
});

test('--run forwards the parsed manifest into the check', () => {
  const dir = writtenManifestRun(SEQUENTIAL_TRANSITIONS);
  let seen;
  const io = runCheck(['--base', 'a', '--run', dir],
    { check: (opts) => { seen = opts; return { clean: true, overwrites: [] }; } });
  assert.strictEqual(io.code, 0);
  assert.deepStrictEqual(seen.manifest.multispec.specs.map((s) => s.id), [10, 11]);
  assert.ok(!('run' in seen), 'opts must not carry the raw --run value into the check');
});

test('AC6.1: end-to-end: an untrailered self-edit exits 0 with --run and 1 without it', () => {
  const fx = storyRepo();
  fx.commitAt('Add story', '2026-01-01T10:30:00Z', STORY_PATH, STORY_OLD);
  fx.commitAt('Review fix: locator', '2026-01-01T11:30:00Z', STORY_PATH, STORY_NEW);
  const runDir = writtenManifestRun(SEQUENTIAL_TRANSITIONS);

  // The real check runs in-process against fx.dir: the injected cwd, not process.cwd(), picks the repo.
  assert.notEqual(fx.dir, process.cwd());
  const withRun = runCheck(['--base', fx.base, '--path', 'stories/', '--run', runDir], {}, fx.dir);
  assert.strictEqual(withRun.code, 0, withRun.err());
  assert.deepStrictEqual(JSON.parse(withRun.out()), { clean: true, overwrites: [] });

  const withoutRun = runCheck(['--base', fx.base, '--path', 'stories/'], {}, fx.dir);
  assert.strictEqual(withoutRun.code, 1, withoutRun.err());
  assert.match(JSON.parse(withoutRun.out()).overwrites[0].reason, /unattributable/);
});

// --- --integration-ref <ref>: integration-branch history leaves the walk (refs #4845) ---

test('--integration-ref is forwarded to the check as integrationRef', () => {
  let seen;
  const io = runCheck(['--base', 'a', '--integration-ref', 'origin/main'],
    { check: (o) => { seen = o; return { clean: true, overwrites: [] }; } });
  assert.strictEqual(io.code, 0);
  assert.strictEqual(seen.integrationRef, 'origin/main');
});

test('--integration-ref rejects an empty, a whitespace-only and a dash-leading value (exit 2)', () => {
  for (const value of ['', '  ', '-x', '--upload-pack=evil']) {
      const io = runCheck(['--base', 'a', '--integration-ref', value],
      { check: () => { throw new Error('check must not run'); } });
    assert.strictEqual(io.code, 2, `value ${JSON.stringify(value)}`);
    assert.match(io.err(), /--integration-ref requires a ref/);
    assert.strictEqual(io.out(), '');
  }
});

test('a trailing bare --integration-ref is a malformed invocation (exit 2)', () => {
  const io = runCheck(['--base', 'a', '--integration-ref'],
    { check: () => { throw new Error('check must not run'); } });
  assert.strictEqual(io.code, 2);
  assert.match(io.err(), /requires a value/);
  assert.strictEqual(io.out(), '');
});

test('end-to-end: a catch-up merge of upstream\'s journey exits 0 with --integration-ref and 1 without', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-cao-upstream-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  const commit = (message) => { git('add', '-A'); git('commit', '-q', '-m', message); };
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 'Test');
  git('commit', '-q', '--allow-empty', '-m', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  git('branch', 'up');
  git('checkout', '-q', '-b', 'run');
  write('docs/journeys/a.md', '# A\n\n## Step 1\nFirst content.\n');
  commit('Add journey a (refs #1)');
  git('checkout', '-q', 'up');
  write('docs/journeys/up.md', '# Up\nline 1\nline 2\n');
  commit('Upstream adds up.md (refs #999)');
  git('checkout', '-q', 'run');
  git('merge', '-q', '--no-ff', '--no-edit', 'up');
  write('docs/journeys/up.md', '# Up\nline 1 changed\nline 2\n');
  commit('Spec B edits the upstream journey (refs #2)');

  const withRef = runCheck(['--base', base, '--path', 'docs/journeys/', '--integration-ref', 'up'], {}, dir);
  assert.strictEqual(withRef.code, 0, withRef.err());
  assert.strictEqual(withRef.out().trim(), '{"clean":true,"overwrites":[]}');

  const without = runCheck(['--base', base, '--path', 'docs/journeys/'], {}, dir);
  assert.strictEqual(without.code, 1, without.err());

  // real process: proves the script entry's exit 3 and stderr on a refusal (unresolvable ref), nothing on stdout.
  const unresolvable = spawnCli(CLI, ['--base', base, '--path', 'docs/journeys/', '--integration-ref', 'no-such-ref'], { cwd: dir });
  assert.strictEqual(unresolvable.code, 3, unresolvable.stderr);
  assert.match(unresolvable.stderr, /check-artifact-overwrite:/);
  assert.strictEqual(unresolvable.stdout, '');
});
