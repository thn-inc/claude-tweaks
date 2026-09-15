const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { installWrapper, buildWrapperSource } = require('../plugin/bin/install-statusline-wrapper.js');

// Every spawn below runs a real `node` process. The budget used to be 5s, which
// is generous idle and far too tight under this repo's normal working mode:
// several parallel worktree sessions, any of which may be running the full suite.
// It was measured failing at 5005ms — the process had not misbehaved, it had not
// finished starting.
//
// The budget is only half the fix. `spawnSync` reports a timeout as
// `status: null`, and every assertion here reads `status` — so a timeout
// surfaced as `expected exit 0, got status=null`, which reads as "the wrapper
// crashed" and sent three separate investigations after a contract that was
// never broken. `runWrapper` fails on the timeout first, in its own words, so
// the two causes can never again be confused for each other.
const SPAWN_TIMEOUT_MS = 30_000;

// extraEnv lets a test opt into setting CLAUDE_CONFIG_DIR (or other vars) explicitly.
// The base env always deletes any ambient CLAUDE_CONFIG_DIR first — this repo's own
// dev sessions commonly run under a real CLAUDE_CONFIG_DIR (a synthetic account
// directory with its own real plugin cache), and letting that leak through here
// would make CLAUDE_CONFIG_DIR-oblivious tests resolve against that real cache
// instead of the fake tmpHome/.claude tree they set up.
function runWrapper(scriptPath, tmpHome, extraEnv = {}) {
  const env = { ...process.env, HOME: tmpHome };
  delete env.CLAUDE_CONFIG_DIR;
  Object.assign(env, extraEnv);
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env,
    timeout: SPAWN_TIMEOUT_MS,
  });
  assert.ok(
    !(result.error && result.error.code === 'ETIMEDOUT'),
    `node did not finish within ${SPAWN_TIMEOUT_MS}ms — machine load, not a wrapper defect. `
      + 'Re-run this file on its own before treating it as a failure.',
  );
  return result;
}

test('installWrapper writes the wrapper script under the injected homedir, not the real home', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-sl-'));

  const targetPath = installWrapper(tmpHome);

  const expectedPath = path.join(tmpHome, '.claude-tweaks', 'bin', 'statusline.js');
  assert.strictEqual(targetPath, expectedPath);
  assert.ok(fs.existsSync(expectedPath), 'wrapper file should exist under the temp homedir');

  const contents = fs.readFileSync(expectedPath, 'utf8');
  assert.strictEqual(contents, buildWrapperSource());
  assert.match(contents, /^#!\/usr\/bin\/env node/);
  assert.match(contents, /claude-tweaks statusline wrapper/);

  const stat = fs.statSync(expectedPath);
  assert.strictEqual(stat.mode & 0o777, 0o755);

  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// Regression: this test file's only assertion used to be
// `assert.strictEqual(contents, buildWrapperSource())` — a tautological
// self-comparison that always passes regardless of whether the generated
// script is syntactically valid, runnable JS. `node --check` parses the
// written file for real, so a broken regex/syntax in the wrapper source
// (bin/lib/statusline-wrapper-source.js) fails this test instead of only
// surfacing as a silently blank statusline after a plugin upgrade.
test('the written wrapper script is syntactically valid JS (node --check)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-sl-check-'));
  const targetPath = installWrapper(tmpHome);

  assert.doesNotThrow(
    () => execFileSync(process.execPath, ['--check', targetPath], { stdio: 'pipe' }),
    'installed wrapper script must be valid JS',
  );

  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// Regression (same root cause as above): actually run the installed wrapper
// and confirm it behaves like the documented "no cache dir found -> exit 0,
// no crash" contract instead of only checking syntax. HOME is pointed at a
// tmp dir with no `.claude/plugins/cache/...` tree, so pickLatest() finds no
// version and the script must exit 0 without throwing.
test('the written wrapper script actually runs and exits 0 when no cached version is installed', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-sl-run-'));
  const targetPath = installWrapper(tmpHome);

  const result = runWrapper(targetPath, tmpHome);

  assert.strictEqual(result.status, 0, `expected exit 0, got status=${result.status} stderr=${result.stderr}`);
  assert.strictEqual(result.signal, null, 'wrapper must not crash/be killed by a signal');

  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// Regression: fs.writeFileSync's `mode` option is only honored by the
// underlying open() syscall's O_CREAT path — it's silently ignored when the
// target file already exists. Re-running the installer (the documented,
// expected path on every plugin upgrade) over a wrapper that was ever
// written non-executable must still restore 0o755, not leave the stale mode.
test('installWrapper restores 0o755 when re-run over an existing, non-executable wrapper file', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-sl-rechmod-'));

  const targetPath = installWrapper(tmpHome);
  fs.chmodSync(targetPath, 0o644); // root-safe: asserts mode bits directly via stat, not access-denial behavior
  assert.strictEqual(fs.statSync(targetPath).mode & 0o777, 0o644, 'precondition: file is non-executable before re-install');

  installWrapper(tmpHome);

  const stat = fs.statSync(targetPath);
  assert.strictEqual(stat.mode & 0o777, 0o755, 'expected mode restored to 0o755 after re-running installWrapper over an existing file');

  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// Regression: the wrapper used to unconditionally `spawn('node', [target])`
// to run the real statusline logic, doubling Node startup latency on every
// render. It must now `require(target)` and call the exported `main()`
// in-process instead — proven here by having the fake cached target write
// `process.pid` to stdout: if the wrapper truly runs it in-process, that PID
// must equal the wrapper's own process (the PID spawnSync reports as the
// child it launched), not a second, different PID from a grandchild spawn.
// configRoot is the directory that directly contains `plugins/cache/...` —
// i.e. what the wrapper's CACHE constant resolves to (either `<home>/.claude`
// or a CLAUDE_CONFIG_DIR value).
function fakeCacheAt(configRoot, version, targetContents) {
  const targetDir = path.join(
    configRoot,
    'plugins',
    'cache',
    'claude-tweaks-marketplace',
    'claude-tweaks',
    version,
    'bin',
  );
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'claude-tweaks-statusline.js'), targetContents);
}

function fakeCacheWithTarget(tmpHome, version, targetContents) {
  fakeCacheAt(path.join(tmpHome, '.claude'), version, targetContents);
}

test('the wrapper runs the cached statusline in-process (no second Node spawn) when the target exports main()', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-sl-inprocess-'));
  const wrapperPath = installWrapper(tmpHome);

  fakeCacheWithTarget(
    tmpHome,
    '9.9.9',
    [
      "module.exports = { main: async () => { process.stdout.write(String(process.pid)); } };",
      '',
    ].join('\n'),
  );

  const result = runWrapper(wrapperPath, tmpHome);

  assert.strictEqual(result.status, 0, `expected exit 0, got status=${result.status} stderr=${result.stderr}`);
  assert.strictEqual(
    result.stdout.trim(),
    String(result.pid),
    'expected the target module\'s main() to run in the wrapper\'s own process (same PID), not a spawned child',
  );

  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('the wrapper falls back to spawning a child process for a cached version that does not export main() (pre-upgrade compatibility)', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-sl-legacy-'));
  const wrapperPath = installWrapper(tmpHome);

  fakeCacheWithTarget(
    tmpHome,
    '9.9.9',
    [
      "if (require.main === module) { process.stdout.write(String(process.pid)); }",
      '',
    ].join('\n'),
  );

  const result = runWrapper(wrapperPath, tmpHome);

  assert.strictEqual(result.status, 0, `expected exit 0, got status=${result.status} stderr=${result.stderr}`);
  assert.notStrictEqual(
    result.stdout.trim(),
    String(result.pid),
    'expected the legacy (no main() export) target to run as a spawned child with a different PID',
  );
  assert.match(result.stdout.trim(), /^\d+$/, 'expected the spawned child to still print a PID');

  fs.rmSync(tmpHome, { recursive: true, force: true });
});

test('installWrapper creates the target directory recursively when it does not exist', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-sl-'));
  const binDir = path.join(tmpHome, '.claude-tweaks', 'bin');

  assert.ok(!fs.existsSync(binDir), 'bin dir should not exist before install');

  installWrapper(tmpHome);

  assert.ok(fs.existsSync(binDir));
  assert.ok(fs.statSync(binDir).isDirectory());

  fs.rmSync(tmpHome, { recursive: true, force: true });
});

// Regression (#633): the wrapper used to hardcode its cache root via
// os.homedir() + '.claude', ignoring CLAUDE_CONFIG_DIR entirely — so a
// session running under a non-default account still ran whatever version
// was cached under the real $HOME, not that account's own cache. Two
// distinct fake caches (one under HOME/.claude, one under a separate
// CLAUDE_CONFIG_DIR) prove which one the wrapper actually resolves.
test('the wrapper resolves the cache root from CLAUDE_CONFIG_DIR when set, ignoring HOME/.claude', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-sl-cfgdir-home-'));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-sl-cfgdir-acct-'));
  const wrapperPath = installWrapper(tmpHome);

  fakeCacheAt(path.join(tmpHome, '.claude'), '1.0.0', [
    "module.exports = { main: async () => { process.stdout.write('DEFAULT'); } };",
    '',
  ].join('\n'));
  fakeCacheAt(configDir, '2.0.0', [
    "module.exports = { main: async () => { process.stdout.write('CONFIG_DIR'); } };",
    '',
  ].join('\n'));

  const result = runWrapper(wrapperPath, tmpHome, { CLAUDE_CONFIG_DIR: configDir });

  assert.strictEqual(result.status, 0, `expected exit 0, got status=${result.status} stderr=${result.stderr}`);
  assert.strictEqual(
    result.stdout.trim(),
    'CONFIG_DIR',
    'expected the wrapper to run the version cached under CLAUDE_CONFIG_DIR, not HOME/.claude',
  );

  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(configDir, { recursive: true, force: true });
});

test('a CLAUDE_CONFIG_DIR value with a trailing slash resolves the same cache root as the same value without one', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-sl-cfgdir-trail-'));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-sl-cfgdir-trailacct-'));
  const wrapperPath = installWrapper(tmpHome);

  fakeCacheAt(configDir, '3.0.0', [
    "module.exports = { main: async () => { process.stdout.write('TRAILING_SLASH_OK'); } };",
    '',
  ].join('\n'));

  const result = runWrapper(wrapperPath, tmpHome, { CLAUDE_CONFIG_DIR: `${configDir}/` });

  assert.strictEqual(result.status, 0, `expected exit 0, got status=${result.status} stderr=${result.stderr}`);
  assert.strictEqual(
    result.stdout.trim(),
    'TRAILING_SLASH_OK',
    'expected a trailing-slash CLAUDE_CONFIG_DIR to resolve identically to the non-trailing-slash form',
  );

  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(configDir, { recursive: true, force: true });
});

// Negative control (per the issue's own Gotchas note): confirm the fallback
// path still resolves HOME/.claude, rather than assuming the ambient shell
// happens to have CLAUDE_CONFIG_DIR unset — runWrapper explicitly deletes it,
// and empty / whitespace-only values must also fall through to the default.
test('CLAUDE_CONFIG_DIR unset, empty, or whitespace-only falls back to HOME/.claude unchanged', () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-install-sl-cfgdir-blank-'));
  const wrapperPath = installWrapper(tmpHome);

  fakeCacheWithTarget(tmpHome, '4.0.0', [
    "module.exports = { main: async () => { process.stdout.write('HOME_DEFAULT'); } };",
    '',
  ].join('\n'));

  for (const extraEnv of [{}, { CLAUDE_CONFIG_DIR: '' }, { CLAUDE_CONFIG_DIR: '   ' }]) {
    const result = runWrapper(wrapperPath, tmpHome, extraEnv);
    assert.strictEqual(
      result.status,
      0,
      `expected exit 0 for CLAUDE_CONFIG_DIR=${JSON.stringify(extraEnv.CLAUDE_CONFIG_DIR)}, got status=${result.status} stderr=${result.stderr}`,
    );
    assert.strictEqual(
      result.stdout.trim(),
      'HOME_DEFAULT',
      `expected fallback to HOME/.claude for CLAUDE_CONFIG_DIR=${JSON.stringify(extraEnv.CLAUDE_CONFIG_DIR)}`,
    );
  }

  fs.rmSync(tmpHome, { recursive: true, force: true });
});
