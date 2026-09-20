'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SET_CONFIG = path.join(ROOT, 'plugin', 'bin', 'set-config.js');
const { CEILING_BYTES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'skill-audit', 'context-cost'));
const { shouldDerive, deriveCeremonyProfile } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'dispatch', 'ceremony-derive'));

// A test-only diff: one test file plus its materialized spec doc — the #1545 evidence shape.
const LOW_SURFACE = [
  { path: 'tests/x.test.js', additions: 75, deletions: 2 },
  { path: '.claude-tweaks/pipelines/r/work/7-spec.md', additions: 40, deletions: 0 },
];

function runDirWith(mode) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ceremony-gate-')));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't'); git('commit', '-q', '--allow-empty', '-m', 'init');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-09-06T000000-record-7');
  fs.mkdirSync(runDir, { recursive: true });
  if (mode !== null) fs.writeFileSync(path.join(runDir, 'config.yml'), `mode: ${mode}\nceremony-profile: standard\n`);
  return { root, runDir };
}

function readConfig(runDir) {
  try { return fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8'); } catch { return null; }
}

// The file's own procedure, mechanized: read mode + profile, gate, derive, write via the sanctioned writer.
function followDerivation({ root, runDir }, files) {
  const cfg = readConfig(runDir) || '';
  const mode = (/^mode:\s*(\S+)/m.exec(cfg) || [])[1];
  const ceremonyProfile = (/^ceremony-profile:\s*(\S+)/m.exec(cfg) || [])[1];
  if (!shouldDerive({ mode, ceremonyProfile })) return { wrote: false };
  const derived = deriveCeremonyProfile(files, ceremonyProfile);
  if (derived === ceremonyProfile) return { wrote: false };
  execFileSync('node', [SET_CONFIG, '--run', runDir, '--key', 'ceremony-profile', '--value', derived], { cwd: root, encoding: 'utf8' });
  return { wrote: true };
}

test('mode auto + standard + low-surface diff → ceremony-profile becomes fast-lane via set-config.js (#1932 AC1)', () => {
  const fx = runDirWith('auto');
  assert.deepStrictEqual(followDerivation(fx, LOW_SURFACE), { wrote: true });
  assert.match(readConfig(fx.runDir), /^ceremony-profile:\s*fast-lane$/m);
});

for (const mode of ['confirm', 'hybrid', 'interactive']) {
  test(`mode ${mode} writes nothing (#1932 AC1)`, () => {
    const fx = runDirWith(mode);
    const before = readConfig(fx.runDir);
    assert.deepStrictEqual(followDerivation(fx, LOW_SURFACE), { wrote: false });
    assert.strictEqual(readConfig(fx.runDir), before);
  });
}

test('no config.yml (standalone wrap-up) writes nothing (#1932 AC1)', () => {
  const fx = runDirWith(null);
  assert.deepStrictEqual(followDerivation(fx, LOW_SURFACE), { wrote: false });
  assert.strictEqual(readConfig(fx.runDir), null);
});

test('mode auto but a diff touching production code leaves config.yml untouched (#1932 AC1)', () => {
  const fx = runDirWith('auto');
  const before = readConfig(fx.runDir);
  const mixed = [...LOW_SURFACE, { path: 'plugin/bin/x.js', additions: 3, deletions: 1 }];
  assert.deepStrictEqual(followDerivation(fx, mixed), { wrote: false });
  assert.strictEqual(readConfig(fx.runDir), before);
});

test('ceremony-derivation.md states the auto-mode gate and carries no DISPATCH_HEADLESS literal (#1932 AC1)', () => {
  const text = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'ceremony-derivation.md'), 'utf8');
  assert.ok(!text.includes('DISPATCH_HEADLESS'));
  assert.match(text, /`mode` is `auto`/);
  assert.match(text, /`confirm`, `hybrid`, or `interactive`/);
  assert.match(text, /shouldDerive/);
  assert.ok(Buffer.byteLength(text, 'utf8') <= CEILING_BYTES);
});
