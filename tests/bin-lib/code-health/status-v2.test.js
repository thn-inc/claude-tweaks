'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { seedDurableState } = require('./seed-durable-state');
const { sweepCli } = require('../../helpers/health-sweep-cli');
const { chmodDenialSkip } = require('../../helpers/root');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'code-health.js');

// In-process (#5381), with the file-protocol-only git guard and a throwaway real cwd — see tests/helpers/health-sweep-cli.js.
const cli = (argv, opts) => sweepCli(CLI, argv, opts);

function tmp() { return scratchDir('codehealth-status-v2-'); }

function writeV2Cache(root, entries) {
  // entries: [{ fp, status, severity, risk }]
  const cache = {};
  for (const e of entries) cache[e.fp] = { status: e.status, severity: e.severity, risk: e.risk, issue: null };
  const p = path.join(root, '.claude-tweaks', 'code-health', 'cache.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

// 'remembered' entries no longer live in local cache.json (see
// bin/lib/code-health/cache.js / bin/code-health.js's cmdValidateFindings) —
// they live in the durable remembered.json on the health-state branch instead
// (cmdStatus derives its remembered count from readDurableState(root).remembered).
// readDurableState's read path is pure git plumbing (fetch + show), so it can
// be exercised for real without gh/network via the shared seedDurableState
// helper (tests/bin-lib/code-health/seed-durable-state.js) — the same
// technique tests/bin-lib/code-health/cli-nextslice.test.js uses for cursors
// and tests/bin-lib/code-health/churn-v2.test.js uses for runs.
function seedDurableRemembered(root, remembered) {
  seedDurableState(root, 'remembered.json', remembered);
}

test('status prints open and regressed counts from v2 cache', () => {
  const root = tmp();
  writeV2Cache(root, [
    { fp: 'codehealth-aaaabbbb', status: 'open', severity: 'medium' },
    { fp: 'codehealth-ccccdddd', status: 'regressed', severity: 'high' },
    { fp: 'codehealth-eeeeffff', status: 'closed', severity: 'low' },
  ]);
  const out = cli(['status', '--root', root]).stdout;
  assert.ok(out.includes('open:1'), `expected open:1 in: ${out}`);
  assert.ok(out.includes('regressed:1'), `expected regressed:1 in: ${out}`);
  assert.ok(out.includes('closed:1'), `expected closed:1 in: ${out}`);
});

test('status prints the remembered count from the durable remembered store', () => {
  const root = tmp();
  writeV2Cache(root, [
    { fp: 'codehealth-aaaabbbb', status: 'open', severity: 'medium' },
  ]);
  seedDurableRemembered(root, {
    'codehealth-ccccdddd': { status: 'remembered', issue: null, severity: 'medium', risk: null },
    'codehealth-eeeeffff': { status: 'remembered', issue: null, severity: 'low', risk: null },
  });
  const out = cli(['status', '--root', root]).stdout;
  assert.ok(out.includes('open:1'), `expected open:1 in: ${out}`);
  assert.ok(out.includes('remembered:2'), `expected remembered:2 in: ${out}`);
});

test('status --fail-on regressed exits 1 when regressed entries exist in v2 cache', () => {
  const root = tmp();
  writeV2Cache(root, [
    { fp: 'codehealth-aaaabbbb', status: 'open', severity: 'medium' },
    { fp: 'codehealth-ccccdddd', status: 'regressed', severity: 'high' },
  ]);
  const result = cli(['status', '--fail-on', 'regressed', '--root', root]);
  assert.strictEqual(result.status, 1);
  assert.ok(result.stdout.includes('FAIL'));
});

test('status --fail-on risk-high exits 1 when open risk-high entries exist in v2 cache', () => {
  const root = tmp();
  writeV2Cache(root, [
    { fp: 'codehealth-aaaabbbb', status: 'open', severity: 'high', risk: 'high' },
  ]);
  const result = cli(['status', '--fail-on', 'risk-high', '--root', root]);
  assert.strictEqual(result.status, 1);
  assert.ok(result.stdout.includes('FAIL'));
});

// REGRESSION: a risk-high finding that got reopened (status: 'regressed',
// e.g. it was fixed, closed, then reappeared) is just as live/unresolved as
// an 'open' one — --fail-on risk-high must not silently pass while it sits
// open in the tracker.
test('status --fail-on risk-high exits 1 when a REGRESSED (not just open) risk-high entry exists', () => {
  const root = tmp();
  writeV2Cache(root, [
    { fp: 'codehealth-aaaabbbb', status: 'regressed', severity: 'high', risk: 'high' },
  ]);
  const result = cli(['status', '--fail-on', 'risk-high', '--root', root]);
  assert.strictEqual(result.status, 1, `expected FAIL for a regressed risk-high finding: ${result.stdout}`);
  assert.ok(result.stdout.includes('FAIL'));
});

test('status --fail-on with an unrecognized value exits 2 (does not silently disable the gate)', () => {
  const root = tmp();
  writeV2Cache(root, [
    { fp: 'codehealth-aaaabbbb', status: 'regressed', severity: 'high', risk: 'high' },
  ]);
  const result = cli(['status', '--fail-on', 'Regressed', '--root', root]);
  assert.strictEqual(result.status, 2, `expected exit 2 for a typo'd --fail-on value, got ${result.status}: ${result.stdout}${result.stderr}`);
  assert.ok(result.stderr.includes('--fail-on'), `expected --fail-on mentioned in stderr: ${result.stderr}`);
});

test('status with a bare trailing --fail-on (no value) exits 2 instead of running as plain status', () => {
  const root = tmp();
  writeV2Cache(root, [
    { fp: 'codehealth-aaaabbbb', status: 'regressed', severity: 'high', risk: 'high' },
  ]);
  const result = cli(['status', '--root', root, '--fail-on']);
  assert.strictEqual(result.status, 2, `expected exit 2 for a bare --fail-on, got ${result.status}: ${result.stdout}${result.stderr}`);
  assert.strictEqual(result.stdout, '', `expected nothing on stdout: ${result.stdout}`);
  assert.ok(result.stderr.includes('--fail-on'), `expected --fail-on mentioned in stderr: ${result.stderr}`);
});

// REGRESSION: --fail-on used to unconditionally fetch the durable
// remembered store (a `git fetch origin health-state`, up to a 30s timeout
// when offline) purely to print an informational count neither gate branch
// reads. --fail-on mode must not surface a remembered count at all — a
// plain `status` invocation still does.
test('status --fail-on output omits the remembered count (the durable-state fetch is skipped in this mode)', () => {
  const root = tmp();
  writeV2Cache(root, [
    { fp: 'codehealth-aaaabbbb', status: 'open', severity: 'medium' },
  ]);
  const result = cli(['status', '--fail-on', 'regressed', '--root', root]);
  assert.strictEqual(result.status, 0);
  assert.ok(!result.stdout.includes('remembered:'), `--fail-on output must not include remembered: ${result.stdout}`);
});

test('status --fail-on regressed exits 0 when no regressed entries', () => {
  const root = tmp();
  writeV2Cache(root, [
    { fp: 'codehealth-aaaabbbb', status: 'open', severity: 'medium' },
  ]);
  const result = cli(['status', '--fail-on', 'regressed', '--root', root]);
  assert.strictEqual(result.status, 0);
});

// Regression: cmdStatus used to read args.root bare, without the
// `args.root || process.cwd()` fallback every other command here (and every
// sibling health CLI) uses. A malformed --root (e.g. a trailing flag with no
// value, which parseArgs turns into `undefined`) silently made status
// report empty state instead of falling back to cwd — defeating a
// --fail-on regressed CI/Routine gate even with a regressed finding sitting
// right in the invoking directory.
test('status falls back to process.cwd() when --root is a trailing flag with no value', () => {
  const root = tmp();
  writeV2Cache(root, [
    { fp: 'codehealth-aaaabbbb', status: 'regressed', severity: 'high' },
  ]);
  const result = cli(['status', '--fail-on', 'regressed', '--root'], { cwd: root });
  assert.strictEqual(result.status, 1, `expected the regressed finding at cwd to be found: ${result.stdout}`);
  assert.ok(result.stdout.includes('FAIL: 1 regressed'), `expected FAIL in: ${result.stdout}`);
});

// ── in-process entry (#5381) ────────────────────────────────────────────────

// No --root at all: the root is the injected cwd, the same outcome as the --root twin above.
test('AC8.1: status without --root reads the cache under the injected cwd', () => {
  const root = tmp();
  writeV2Cache(root, [
    { fp: 'codehealth-aaaabbbb', status: 'open', severity: 'medium' },
    { fp: 'codehealth-ccccdddd', status: 'regressed', severity: 'high' },
  ]);
  const result = cli(['status', '--fail-on', 'regressed'], { cwd: root });
  assert.strictEqual(result.status, 1, `expected the regressed finding at the injected cwd to be found: ${result.stdout}`);
  assert.ok(result.stdout.includes('FAIL: 1 regressed'), `expected FAIL in: ${result.stdout}`);
});

// env-only fixture: readDurableState's `git fetch origin health-state` runs under the injected
// env, so a GIT_DIR that only the injected env carries points it at repo B (whose origin holds the
// seeded remembered store) although --root itself is not a repo. sweepCli drops every other ambient
// git variable from the injected env.
test('status reads the durable remembered store through the injected env: GIT_DIR names the repo, root is not one', () => {
  const root = tmp(); // not a git repo
  const repo = tmp();
  seedDurableRemembered(repo, { 'codehealth-ccccdddd': { status: 'remembered', issue: null, severity: 'medium', risk: null } });

  // The control: no injected GIT_DIR, so the fetch fails on the non-repo root and the count is 0.
  const control = cli(['status', '--root', root]);
  assert.ok(control.stdout.includes('remembered:0'), `expected remembered:0 without the injected GIT_DIR, got: ${control.stdout}`);

  const result = cli(['status', '--root', root], { env: { GIT_DIR: path.join(repo, '.git') } });
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('remembered:1'), `expected remembered:1 from the injected repo, got: ${result.stdout}`);
});

// ── --fail-on refuses an untrusted cache (#5529) ────────────────────────────

function cacheFile(root) { return path.join(root, '.claude-tweaks', 'code-health', 'cache.json'); }

function writeRaw(root, text) {
  fs.mkdirSync(path.dirname(cacheFile(root)), { recursive: true });
  fs.writeFileSync(cacheFile(root), text, 'utf8');
}

function assertRefused(result, root) {
  assert.strictEqual(result.status, 2, `expected exit 2: ${result.stdout}${result.stderr}`);
  assert.strictEqual(result.stdout, '');
  const lines = result.stderr.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1, `expected one stderr line: ${result.stderr}`);
  assert.ok(lines[0].includes(cacheFile(root)), `expected cache path in: ${lines[0]}`);
}

test('AC1: status --fail-on regressed and risk-high exit 2 when no cache file exists', () => {
  for (const value of ['regressed', 'risk-high']) {
    const root = tmp();
    assertRefused(cli(['status', '--fail-on', value, '--root', root]), root);
  }
});

test('AC2: status --fail-on regressed and risk-high exit 0 on an empty {} cache', () => {
  for (const value of ['regressed', 'risk-high']) {
    const root = tmp();
    writeRaw(root, '{}');
    const result = cli(['status', '--fail-on', value, '--root', root]);
    assert.strictEqual(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.ok(result.stdout.includes('open:0 regressed:0 closed:0 wontfix:0'), `got: ${result.stdout}`);
  }
});

test('AC3: plain status with no cache file exits 0 and prints the counts line', () => {
  const root = tmp();
  const result = cli(['status', '--root', root]);
  assert.strictEqual(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.ok(result.stdout.includes('open:0 regressed:0'), `got: ${result.stdout}`);
});

test('AC6: refuses a dangling symlink at the cache path', () => {
  const root = tmp();
  fs.mkdirSync(path.dirname(cacheFile(root)), { recursive: true });
  fs.symlinkSync(path.join(root, 'nowhere.json'), cacheFile(root));
  assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
});

test('AC6: refuses a symlink to a JSON file outside the root holding a regressed entry', () => {
  const root = tmp();
  const outside = tmp();
  const target = path.join(outside, 'cache.json');
  fs.writeFileSync(target, '{"x":{"status":"regressed"}}', 'utf8');
  fs.mkdirSync(path.dirname(cacheFile(root)), { recursive: true });
  fs.symlinkSync(target, cacheFile(root));
  assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
});

test('AC6: refuses a symlink to a regular JSON file inside the root', () => {
  const root = tmp();
  const target = path.join(root, 'real.json');
  fs.writeFileSync(target, '{}', 'utf8');
  fs.mkdirSync(path.dirname(cacheFile(root)), { recursive: true });
  fs.symlinkSync(target, cacheFile(root));
  assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
});

test('AC6: refuses when .claude-tweaks/code-health is a symlink to an outside directory holding cache.json', () => {
  const root = tmp();
  const outsideDir = tmp();
  fs.writeFileSync(path.join(outsideDir, 'cache.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.symlinkSync(outsideDir, path.join(root, '.claude-tweaks', 'code-health'), 'dir');
  assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
});

test('AC6: refuses a directory at the cache path', () => {
  const root = tmp();
  fs.mkdirSync(cacheFile(root), { recursive: true });
  assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
});

test('AC6: refuses a cache file containing "not json"', () => {
  const root = tmp();
  writeRaw(root, 'not json');
  assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
});

test('AC6: refuses a cache file containing []', () => {
  const root = tmp();
  writeRaw(root, '[]');
  assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
});

test('AC6: refuses a cache file containing {"a":null}', () => {
  const root = tmp();
  writeRaw(root, '{"a":null}');
  assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
});

test('refuses an empty 0-byte cache file', () => {
  const root = tmp();
  writeRaw(root, '');
  assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
});

test('refuses a cache entry that is an array ({"a":[]})', () => {
  const root = tmp();
  writeRaw(root, '{"a":[]}');
  assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
});

test('refuses a cache entry that is a string ({"a":"open"})', () => {
  const root = tmp();
  writeRaw(root, '{"a":"open"}');
  assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
});

const cannotChmod = chmodDenialSkip('root bypasses permission bits, so the EACCES cannot be simulated');

test('refuses when the cache\'s parent directory is unreadable (lstat EACCES)', cannotChmod, () => {
  const root = tmp();
  writeRaw(root, '{}');
  const dir = path.dirname(cacheFile(root));
  fs.chmodSync(dir, 0o000);
  try {
    assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
  } finally {
    fs.chmodSync(dir, 0o755);
  }
});

test('refuses when the cache file itself is unreadable (read EACCES)', cannotChmod, () => {
  const root = tmp();
  writeRaw(root, '{}');
  fs.chmodSync(cacheFile(root), 0o000);
  try {
    assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
  } finally {
    fs.chmodSync(cacheFile(root), 0o644);
  }
});

test('refuses when .claude-tweaks is a regular file', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, '.claude-tweaks'), 'x', 'utf8');
  assertRefused(cli(['status', '--fail-on', 'regressed', '--root', root]), root);
});
