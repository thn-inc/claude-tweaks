// tests/bin-lib/design-detect/cli.test.js — process-boundary wiring for
// bin/design-detect.js: argument parsing, --signals file/stdin handling,
// malformed-signals degradation, and exit codes (#885).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');
const { cleanGitEnv } = require('../../helpers/git-fixtures');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'design-detect.js');

function run(args, opts = {}) {
  return runCliSync(CLI, args, { env: opts.env || { ...process.env }, cwd: opts.cwd, stdin: opts.input, deps: opts.deps });
}

test('CLI: --mode required', () => {
  const r = run([]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--mode is required/);
});

test('CLI: unknown mode exits 1', () => {
  const r = run(['--mode', 'not-a-mode']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unknown mode/);
});

test('CLI: explicit --design-integration + --surface backend skips deterministically, no CLAUDE.md read', () => {
  const r = run(['--mode', 'review', '--design-integration', 'enabled', '--surface', 'backend']);
  assert.equal(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.decision, 'skip');
  assert.equal(parsed.reason, 'non-frontend spec (surface declared)');
});

test('CLI: --design-integration disabled always skips regardless of other args', () => {
  const r = run(['--mode', 'review', '--design-integration', 'disabled', '--surface', 'web', '--files', 'a.tsx']);
  const parsed = JSON.parse(r.stdout);
  assert.deepEqual(parsed, { decision: 'skip', reason: 'design integration disabled' });
});

test('CLI: --files comma-splits and matches against the trigger table', () => {
  const r = run(['--mode', 'review', '--design-integration', 'enabled', '--files', 'src/utils/cache.ts,src/components/Button.tsx']);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.decision, 'proceed');
  assert.equal(parsed.track, 'web');
});

test('CLI: --signals reads a Layer 0 JSON file and extracts setup.platform', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-'));
  const signalsPath = path.join(tmp, 'signals.json');
  fs.writeFileSync(signalsPath, JSON.stringify({ setup: { platform: 'ios' } }));
  try {
    const r = run(['--mode', 'review', '--design-integration', 'enabled', '--surface', 'mobile', '--signals', signalsPath]);
    const parsed = JSON.parse(r.stdout);
    assert.deepEqual(parsed, { decision: 'proceed', track: 'native', platform: 'ios' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: malformed --signals file degrades to no-signals (platform null) rather than failing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-'));
  const signalsPath = path.join(tmp, 'bad.json');
  fs.writeFileSync(signalsPath, 'not json');
  try {
    const r = run(['--mode', 'review', '--design-integration', 'enabled', '--surface', 'mobile', '--signals', signalsPath]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.deepEqual(parsed, { decision: 'proceed', track: 'native', platform: 'adaptive', inferred: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: --signals - reads Layer 0 JSON from stdin', () => {
  const r = run(['--mode', 'review', '--design-integration', 'enabled', '--surface', 'web', '--files', 'a.tsx', '--signals', '-'], { input: JSON.stringify({ setup: { platform: 'web' } }) });
  const parsed = JSON.parse(r.stdout);
  assert.deepEqual(parsed, { decision: 'proceed', track: 'web' });
});

test('CLI: --surface-lines classifies a control-flow-only diff as no surface', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-'));
  const diffPath = path.join(tmp, 'diff.patch');
  fs.writeFileSync(diffPath, [
    'diff --git a/src/components/Widget.tsx b/src/components/Widget.tsx',
    'index 1111111..2222222 100644',
    '--- a/src/components/Widget.tsx',
    '+++ b/src/components/Widget.tsx',
    '@@ -10,1 +10,1 @@',
    "-  const res = await fetch('/api/widget');",
    "+  const res = await fetch('/api/widget', { cache: 'no-store' });",
    '',
  ].join('\n'));
  try {
    const r = run(['--surface-lines', diffPath]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.surface, false);
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.files[0].kind, 'jsx');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: --surface-lines classifies a JSX attribute change as surface', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-'));
  const diffPath = path.join(tmp, 'diff.patch');
  fs.writeFileSync(diffPath, [
    'diff --git a/src/components/Widget.tsx b/src/components/Widget.tsx',
    'index 1111111..2222222 100644',
    '--- a/src/components/Widget.tsx',
    '+++ b/src/components/Widget.tsx',
    '@@ -30,1 +30,1 @@',
    '-  <div className="widget">',
    '+  <div className="widget widget--active">',
    '',
  ].join('\n'));
  try {
    const r = run(['--surface-lines', diffPath]);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.surface, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: --surface-lines reads from stdin with -', () => {
  const diff = [
    'diff --git a/a.css b/a.css',
    'index 1111111..2222222 100644',
    '--- a/a.css',
    '+++ b/a.css',
    '@@ -1,1 +1,1 @@',
    '-.a { color: red; }',
    '+.a { color: blue; }',
    '',
  ].join('\n');
  const r = run(['--surface-lines', '-'], { input: diff });
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.surface, true);
});

test('CLI: --surface-lines and --mode together is a malformed invocation', () => {
  const r = run(['--surface-lines', '-', '--mode', 'review']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /mutually exclusive/);
});

test('CLI: --surface-lines with an unreadable path fails loudly', () => {
  const r = run(['--surface-lines', '/nonexistent/path/to/diff.patch']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /could not read diff/);
});

test('CLI: --claude-md reads design-integration from an explicit file path', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-'));
  const claudeMdPath = path.join(tmp, 'CLAUDE.md');
  fs.writeFileSync(claudeMdPath, '## Design integration\n\ndesign-integration: enabled\n');
  try {
    const r = run(['--mode', 'review', '--claude-md', claudeMdPath, '--surface', 'web', '--files', 'a.tsx']);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.decision, 'proceed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Real-process pin of the script entry (#5381): the missing-mode refusal on an empty stdin is
// byte-identical before and after the in-process entry conversion.
test('AC5.1, AC7.1: design-detect.js with no arguments and an empty stdin exits 1 with --mode is required (real process)', () => {
  const r = spawnCli(CLI, [], { env: { ...process.env }, stdin: '' });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'design-detect: --mode is required\n');
});

// Same pin for the success path: the decision JSON on stdout, nothing on stderr.
test('AC7.1: design-detect.js --mode review … prints the decision JSON and exits 0 (real process)', () => {
  const r = spawnCli(CLI, ['--mode', 'review', '--design-integration', 'enabled', '--surface', 'backend'], { env: { ...process.env }, stdin: '' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '{"decision":"skip","reason":"non-frontend spec (surface declared)"}\n');
  assert.equal(r.stderr, '');
});

// --- in-process entry (#5381) ---

test('AC2.1: a valid --mode payload returns 0 when process.exitCode is already 1', () => {
  const prev = process.exitCode;
  process.exitCode = 1;
  try {
    // snapshot() records exitCode 1, so a run that returns 0 without touching it is leak-free.
    const r = run(['--mode', 'review', '--design-integration', 'enabled', '--surface', 'backend']);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.stdout).decision, 'skip');
  } finally {
    process.exitCode = prev;
  }
});

test('AC4.1: --signals - reads the payload from deps.stdin and matches the spawned output', () => {
  const args = ['--mode', 'review', '--design-integration', 'enabled', '--surface', 'mobile', '--signals', '-'];
  const env = { ...process.env };
  const stdin = JSON.stringify({ setup: { platform: 'android' } });
  const a = runCliSync(CLI, args, { env, stdin });
  // Real process: proves the script entry reads fd 0 to the same bytes.
  const b = spawnCli(CLI, args, { env, stdin });
  assert.equal(a.stdout, b.stdout);
  assert.equal(JSON.parse(a.stdout).platform, 'android');
});

test('AC4.1: --surface-lines - with an empty stdin matches the spawned output', () => {
  const env = { ...process.env };
  const a = runCliSync(CLI, ['--surface-lines', '-'], { env, stdin: '' });
  // Real process: the empty-stdin read of fd 0 yields the same bytes.
  const b = spawnCli(CLI, ['--surface-lines', '-'], { env, stdin: '' });
  assert.equal(a.code, b.code);
  assert.equal(a.stdout, b.stdout);
  assert.equal(a.stdout, '{"surface":false,"files":[]}\n');
});

function gitRepoWithFlag(value) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-repo-'));
  const real = fs.realpathSync(tmp);
  fs.writeFileSync(path.join(real, 'CLAUDE.md'), `## Design integration\n\ndesign-integration: ${value}\n`);
  execFileSync('git', ['init', '-q'], { cwd: real, env: cleanGitEnv(process.env), stdio: 'ignore' });
  return real;
}

test('AC8.1: with no --design-integration/--claude-md the decision follows the injected cwd repo', () => {
  // Both flag values, so the decision cannot come from this worktree's own CLAUDE.md.
  for (const [value, decision] of [['enabled', 'proceed'], ['disabled', 'skip']]) {
    const repo = gitRepoWithFlag(value);
    try {
      const r = run(['--mode', 'review', '--surface', 'web', '--files', 'a.tsx'], { cwd: repo, env: cleanGitEnv(process.env) });
      assert.equal(r.code, 0);
      assert.equal(JSON.parse(r.stdout).decision, decision, `flag ${value}`);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }
});

test('repoRoot falls back to deps.cwd() when cwd is not a git repo', () => {
  for (const [value, decision] of [['enabled', 'proceed'], ['disabled', 'skip']]) {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-nogit-')));
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), `## Design integration\n\ndesign-integration: ${value}\n`);
    try {
      // GIT_CEILING_DIRECTORIES keeps git from finding a repo above the temp dir.
      const env = { ...cleanGitEnv(process.env), GIT_CEILING_DIRECTORIES: path.dirname(tmp) };
      const r = run(['--mode', 'review', '--surface', 'web', '--files', 'a.tsx'], { cwd: tmp, env });
      assert.equal(r.code, 0);
      assert.equal(JSON.parse(r.stdout).decision, decision, `flag ${value}`); // a process.cwd() fallback would read this worktree instead
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

// A deleted working directory makes process.cwd() throw; the unconverted CLI never called it
// for an absolute operand, so neither may the in-process entry.
const throwingCwd = () => { throw new Error('uv_cwd'); };

function absOperandFixture() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-abs-')));
  const diff = path.join(tmp, 'd.patch');
  fs.writeFileSync(diff, 'diff --git a/a.css b/a.css\n--- a/a.css\n+++ b/a.css\n@@ -1 +1 @@\n-.a{}\n+.b{}\n');
  const claudeMd = path.join(tmp, 'CLAUDE.md');
  fs.writeFileSync(claudeMd, '## Design integration\n\ndesign-integration: enabled\n');
  const signals = path.join(tmp, 's.json');
  fs.writeFileSync(signals, JSON.stringify({ setup: { platform: 'ios' } }));
  return { tmp, diff, claudeMd, signals };
}

test('absolute --surface-lines, --claude-md and --signals never call cwd(): same result as a normal cwd', () => {
  const f = absOperandFixture();
  try {
    const cases = [
      ['--surface-lines', f.diff],
      ['--mode', 'review', '--claude-md', f.claudeMd, '--surface', 'web', '--files', 'a.tsx'],
      ['--mode', 'review', '--design-integration', 'enabled', '--surface', 'mobile', '--signals', f.signals],
    ];
    for (const args of cases) {
      const normal = run(args);
      const gone = run(args, { deps: { cwd: throwingCwd } });
      assert.equal(gone.code, normal.code, args[0]);
      assert.equal(gone.stdout, normal.stdout, args[0]);
      assert.equal(gone.stderr, normal.stderr, args[0]);
    }
    assert.equal(JSON.parse(run(cases[1], { deps: { cwd: throwingCwd } }).stdout).decision, 'proceed');
    assert.equal(JSON.parse(run(cases[2], { deps: { cwd: throwingCwd } }).stdout).platform, 'ios');
    assert.equal(JSON.parse(run(cases[0], { deps: { cwd: throwingCwd } }).stdout).surface, true);
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
  }
});

test('absolute --surface-lines, --claude-md and --signals call the injected cwd() zero times', () => {
  const f = absOperandFixture();
  try {
    const cases = [
      ['--surface-lines', f.diff],
      ['--mode', 'review', '--claude-md', f.claudeMd, '--surface', 'web', '--files', 'a.tsx'],
      ['--mode', 'review', '--design-integration', 'enabled', '--surface', 'mobile', '--signals', f.signals],
    ];
    for (const args of cases) {
      let calls = 0;
      const r = run(args, { deps: { cwd: () => { calls += 1; return f.tmp; } } });
      assert.equal(r.code, 0, args[0]);
      assert.equal(calls, 0, `${args[0]} read cwd() for an absolute operand`);
    }
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
  }
});

test('relative --surface-lines and --signals resolve against the injected cwd(), not the test process cwd', () => {
  const f = absOperandFixture();
  try {
    const deps = { cwd: () => f.tmp };
    const lines = run(['--surface-lines', 'd.patch'], { deps });
    assert.equal(lines.code, 0, lines.stderr);
    assert.equal(JSON.parse(lines.stdout).surface, true);
    const signals = run(['--mode', 'review', '--design-integration', 'enabled', '--surface', 'mobile', '--signals', 's.json'], { deps });
    assert.equal(signals.code, 0, signals.stderr);
    assert.equal(JSON.parse(signals.stdout).platform, 'ios');
  } finally {
    fs.rmSync(f.tmp, { recursive: true, force: true });
  }
});

test('relative --surface-lines with a throwing cwd() prints the could-not-read line with the caller spelling and exits 1', () => {
  const r = run(['--surface-lines', 'sub/missing.patch'], { deps: { cwd: throwingCwd } });
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  // The operand reaches fs as written, so the message is fs's own: the bare spelling on POSIX, and
  // on win32 the path fs resolved against the real working directory (as the unconverted CLI printed).
  const opened = process.platform === 'win32' ? path.resolve('sub/missing.patch') : 'sub/missing.patch';
  assert.equal(r.stderr, `design-detect: could not read diff at "sub/missing.patch": ENOENT: no such file or directory, open '${opened}'\n`);
});

test('--surface-lines with a relative unreadable path prints the caller spelling, not the joined path', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-rel-')));
  try {
    const env = { ...process.env };
    const args = ['--surface-lines', 'sub/missing.patch'];
    const a = runCliSync(CLI, args, { env, cwd: tmp });
    // Real process: its stderr is the byte-identical reference for the unreadable-diff line.
    const b = spawnCli(CLI, args, { env, cwd: tmp });
    const line = 'design-detect: could not read diff at "sub/missing.patch": ENOENT: no such file or directory, open \'sub/missing.patch\'\n';
    assert.equal(a.code, 1);
    assert.equal(a.stderr, line);
    assert.equal(b.stderr, line);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('repoRoot runs git with the injected env', () => {
  const repoB = gitRepoWithFlag('enabled');
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-plain-'));
  try {
    const env = { ...cleanGitEnv(process.env), GIT_DIR: path.join(repoB, '.git'), GIT_WORK_TREE: repoB };
    const r = runCliSync(CLI, ['--mode', 'review', '--surface', 'web', '--files', 'a.tsx'], { env, cwd: plain });
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.stdout).decision, 'proceed');
  } finally {
    fs.rmSync(repoB, { recursive: true, force: true });
    fs.rmSync(plain, { recursive: true, force: true });
  }
});
