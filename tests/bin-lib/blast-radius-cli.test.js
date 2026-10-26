'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { computeBlastRadius, gatherDiffFiles, BlastRadiusError } = require(
  path.join(__dirname, '..', '..', 'plugin', 'bin', 'lib', 'blast-radius-cli.js')
);

const SHA = 'a'.repeat(40);

// A fake git runner keyed by the subcommand (argv[0]). Records calls.
function fakeGit(handlers) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    const handler = handlers[args[0]];
    if (!handler) throw new Error(`unexpected git ${args.join(' ')}`);
    return handler(args);
  };
  git.calls = calls;
  return git;
}

test('happy path: derives merge base from integration branch, classifies, resolves config', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => '10\t2\tplugin/bin/foo.js\u00005\t0\ttests/foo.test.js\u0000',
    'rev-parse': () => '/repo\n',
  });
  const readFile = (p) => (p.endsWith('policy.yml')
    ? 'merge-sensitive-paths: plugin/bin/hooks.js\nauto-merge-max-lines: 50\n'
    : null);
  const out = computeBlastRadius({ integrationBranch: 'main' }, { git, readFile });
  assert.strictEqual(out.mergeBase, SHA);
  assert.strictEqual(out.summary.implLines, 12);
  assert.strictEqual(out.summary.implFiles, 1);
  assert.strictEqual(out.summary.testLines, 5);
  assert.strictEqual(out.summary.testFiles, 1);
  assert.deepStrictEqual(out.summary.sensitiveFilesTouched, []);
  assert.strictEqual(out.config.autoMergeMaxLines, 50);
  assert.strictEqual(out.config.autoMergeMaxFiles, 2); // schema default
  assert.deepStrictEqual(out.config.mergeSensitivePaths, ['plugin/bin/hooks.js']);
});

test('--base short-circuits merge-base derivation and is verified via rev-parse', () => {
  const git = fakeGit({
    'rev-parse': (args) => (args.includes('--show-toplevel') ? '/repo\n' : `${SHA}\n`),
    diff: () => '',
  });
  const out = computeBlastRadius({ base: 'abc123' }, { git, readFile: () => null });
  assert.strictEqual(out.mergeBase, SHA);
  assert.ok(!git.calls.some((c) => c[0] === 'merge-base'), 'merge-base must not run when base is given');
});

test('unresolvable merge base throws BlastRadiusError — never a zero summary', () => {
  const git = fakeGit({
    'merge-base': () => { throw new Error('fatal: Not a valid object name'); },
    'rev-parse': () => '/repo\n',
  });
  assert.throws(
    () => computeBlastRadius({ integrationBranch: 'main' }, { git, readFile: () => null }),
    BlastRadiusError
  );
});

test('git diff --numstat failure after a resolved merge base throws BlastRadiusError', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => { throw new Error('fatal: bad revision'); },
    'rev-parse': () => '/repo\n',
  });
  assert.throws(
    () => computeBlastRadius({ integrationBranch: 'main' }, { git, readFile: () => null }),
    (err) => err instanceof BlastRadiusError && /git diff --numstat failed/.test(err.message)
  );
});

test('unverifiable --base throws BlastRadiusError', () => {
  const git = fakeGit({
    'rev-parse': (args) => {
      if (args.includes('--show-toplevel')) return '/repo\n';
      throw new Error('fatal: Needed a single revision');
    },
  });
  assert.throws(
    () => computeBlastRadius({ base: 'nonsense' }, { git, readFile: () => null }),
    BlastRadiusError
  );
});

test('genuinely empty diff with a valid base yields zero summary WITH the mergeBase attached', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => '',
    'rev-parse': () => '/repo\n',
  });
  const out = computeBlastRadius({ integrationBranch: 'main' }, { git, readFile: () => null });
  assert.strictEqual(out.mergeBase, SHA);
  assert.strictEqual(out.summary.implFiles, 0);
  assert.strictEqual(out.summary.implLines, 0);
});

test('neither base nor integrationBranch throws BlastRadiusError', () => {
  assert.throws(
    () => computeBlastRadius({}, { git: fakeGit({}), readFile: () => null }),
    BlastRadiusError
  );
});

test('AC1.1: a real repo change to docs/café.md surfaces as the raw path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-radius-z-'));
  try {
    const git = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '-q']);
    git(['config', 'user.email', 't@example.com']);
    git(['config', 'user.name', 'T']);
    git(['config', 'core.quotepath', 'true']);
    git(['config', 'commit.gpgsign', 'false']);
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs', 'café.md'), 'one\n');
    git(['add', '.']);
    git(['commit', '-q', '-m', 'add']);
    const baseSha = git(['rev-parse', 'HEAD']).trim();
    fs.writeFileSync(path.join(dir, 'docs', 'café.md'), 'one\ntwo\n');
    git(['commit', '-q', '-am', 'edit']);
    const readFile = (p) => (p.endsWith('policy.yml') ? 'merge-sensitive-paths: docs/café.md\n' : null);
    const out = computeBlastRadius({ base: baseSha }, { git, readFile });
    assert.deepStrictEqual(out.summary.sensitiveFilesTouched, ['docs/café.md']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the diff call passes -z and --end-of-options before the range', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => '',
    'rev-parse': () => '/repo\n',
  });
  computeBlastRadius({ integrationBranch: 'main' }, { git, readFile: () => null });
  const diffCall = git.calls.find((a) => a[0] === 'diff');
  assert.deepStrictEqual(diffCall, ['diff', '--no-renames', '--numstat', '-z', '--end-of-options', `${SHA}..HEAD`]);
});

test('binary-file numstat dashes in -z output count the file with zero lines', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => '-\t-\tassets/logo.png\u00003\t1\tplugin/bin/foo.js\u0000',
    'rev-parse': () => '/repo\n',
  });
  const out = computeBlastRadius({ integrationBranch: 'main' }, { git, readFile: () => null });
  assert.strictEqual(out.summary.implFiles, 2);
  assert.strictEqual(out.summary.implLines, 4);
});

test('sensitive-path hit from resolved policy lands in sensitiveFilesTouched', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => '2\t0\tplugin/bin/hooks.js\u0000',
    'rev-parse': () => '/repo\n',
  });
  const readFile = (p) => (p.endsWith('policy.yml') ? 'merge-sensitive-paths: plugin/bin/hooks.js\n' : null);
  const out = computeBlastRadius({ integrationBranch: 'main' }, { git, readFile });
  assert.deepStrictEqual(out.summary.sensitiveFilesTouched, ['plugin/bin/hooks.js']);
});

// I-1 (#888 follow-up): --no-renames must be requested so a rename never
// collapses into a composite "old => new" numstat path that evades the
// sensitive-path floor. This test proves classification on already-split
// (--no-renames-shaped) input — the old path fully deleted, the new path
// fully added, as git reports a rename when rename detection is off.
test('a plain rename (--no-renames-shaped numstat) still trips the sensitive-path floor on the old path', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => '0\t4\tplugin/bin/hooks.js\u00004\t0\tplugin/bin/hooks2.js\u0000',
    'rev-parse': () => '/repo\n',
  });
  const readFile = (p) => (p.endsWith('policy.yml') ? 'merge-sensitive-paths: plugin/bin/hooks.js\n' : null);
  const out = computeBlastRadius({ integrationBranch: 'main' }, { git, readFile });
  assert.deepStrictEqual(out.summary.sensitiveFilesTouched, ['plugin/bin/hooks.js']);
  const diffCall = git.calls.find((c) => c[0] === 'diff');
  assert.ok(
    diffCall && diffCall.includes('--no-renames'),
    '--no-renames must actually reach the git diff argv, not just the classification result'
  );
});

// I-3 (#888 follow-up): merge-base resolution can succeed (no thrown error)
// yet return an empty/whitespace-only string — the exact original #888
// hazard shape. The guard must still hard-fail rather than let an empty
// base silently proceed to a 0-file diff. The fixture's `diff` handler
// deliberately succeeds (rather than being absent) so that removing the
// guard would let the call through to a wrong success instead of
// coincidentally throwing for an unrelated "unexpected git diff" reason.
test('merge-base resolving successfully to an empty string throws BlastRadiusError', () => {
  const git = fakeGit({
    'merge-base': () => '\n',
    'rev-parse': () => '/repo\n',
    diff: () => '',
  });
  assert.throws(
    () => computeBlastRadius({ integrationBranch: 'main' }, { git, readFile: () => null }),
    BlastRadiusError
  );
});

// A policy-file read failure that ISN'T "the file doesn't exist" (permission
// denied, is-a-directory, IO error) must fail loud rather than silently
// degrade mergeSensitivePaths to [] — the same silent-approval hazard #888
// exists to eliminate, one layer down in the policy read instead of the
// merge-base resolution.
test('a policy-file read error (not mere absence) fails loud as BlastRadiusError', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => '',
    'rev-parse': () => '/repo\n',
  });
  const readFile = () => { throw new Error('EACCES: permission denied'); };
  assert.throws(
    () => computeBlastRadius({ integrationBranch: 'main' }, { git, readFile }),
    BlastRadiusError
  );
});

test('--base resolution passes --end-of-options before the ref (a ref starting with "-" cannot be read as a flag)', () => {
  const git = fakeGit({
    'rev-parse': (args) => (args.includes('--show-toplevel') ? '/repo\n' : `${SHA}\n`),
    diff: () => '',
  });
  computeBlastRadius({ base: '-evil' }, { git, readFile: () => null });
  const verifyCall = git.calls.find((c) => c[0] === 'rev-parse' && c.includes('--verify'));
  assert.deepStrictEqual(verifyCall, ['rev-parse', '--verify', '--end-of-options', '-evil^{commit}']);
});

test('--integration-branch resolution passes --end-of-options before the branch name', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => '',
    // No origin/-evil remote-tracking ref in this fixture: --verify must fail
    // so the bare name is used, isolating this test to the --end-of-options
    // concern rather than the origin-preference concern covered below.
    'rev-parse': (args) => {
      if (args.includes('--verify')) throw new Error('fatal: not a valid ref');
      return '/repo\n';
    },
  });
  computeBlastRadius({ integrationBranch: '-evil' }, { git, readFile: () => null });
  const mergeBaseCall = git.calls.find((c) => c[0] === 'merge-base');
  assert.deepStrictEqual(mergeBaseCall, ['merge-base', '--end-of-options', '-evil', 'HEAD']);
});

// #1592: a stale local integration-branch ref must not silently drive the
// merge base when a same-named origin/{name} remote-tracking ref exists —
// the origin ref is preferred.
test('#1592: prefers origin/{name} over a bare integration branch when the remote-tracking ref exists', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => '',
    'rev-parse': (args) => {
      if (args.includes('--verify') && args.includes('refs/remotes/origin/main')) return `${SHA}\n`;
      if (args.includes('--show-toplevel')) return '/repo\n';
      throw new Error('fatal: not a valid ref');
    },
  });
  computeBlastRadius({ integrationBranch: 'main' }, { git, readFile: () => null });
  const mergeBaseCall = git.calls.find((c) => c[0] === 'merge-base');
  assert.deepStrictEqual(mergeBaseCall, ['merge-base', '--end-of-options', 'origin/main', 'HEAD']);
});

// #1592: no such remote-tracking ref (e.g. no origin remote, or a branch name
// unique to this checkout) falls back to the bare local ref exactly as before.
test('#1592: falls back to the bare integration branch when no origin/{name} ref exists', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => '',
    'rev-parse': (args) => {
      if (args.includes('--show-toplevel')) return '/repo\n';
      throw new Error('fatal: not a valid ref');
    },
  });
  computeBlastRadius({ integrationBranch: 'main' }, { git, readFile: () => null });
  const mergeBaseCall = git.calls.find((c) => c[0] === 'merge-base');
  assert.deepStrictEqual(mergeBaseCall, ['merge-base', '--end-of-options', 'main', 'HEAD']);
});

// #1592: an already-qualified origin/{name} passed straight through must not
// be re-prefixed into origin/origin/{name}.
test('#1592: an already-qualified origin/{name} integration branch is used as-is', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => '',
    'rev-parse': (args) => {
      if (args.includes('--show-toplevel')) return '/repo\n';
      throw new Error('unexpected rev-parse --verify call for an already-qualified ref');
    },
  });
  computeBlastRadius({ integrationBranch: 'origin/main' }, { git, readFile: () => null });
  const mergeBaseCall = git.calls.find((c) => c[0] === 'merge-base');
  assert.deepStrictEqual(mergeBaseCall, ['merge-base', '--end-of-options', 'origin/main', 'HEAD']);
});

test('gatherDiffFiles: returns the merge base and parsed numstat files without reading policy config', () => {
  const git = fakeGit({
    'merge-base': () => `${SHA}\n`,
    diff: () => '10\t2\tplugin/bin/foo.js\u00005\t0\ttests/foo.test.js\u0000',
  });
  const out = gatherDiffFiles({ integrationBranch: 'main' }, { git });
  assert.strictEqual(out.mergeBase, SHA);
  assert.deepStrictEqual(out.files, [
    { path: 'plugin/bin/foo.js', additions: 10, deletions: 2 },
    { path: 'tests/foo.test.js', additions: 5, deletions: 0 },
  ]);
});
