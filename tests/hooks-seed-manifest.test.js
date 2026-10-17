// tests/hooks-seed-manifest.test.js — the `node bin/hooks.js seed-manifest`
// CLI (#3307 ledger row 2): multispec-run-dir-layout.md documented
// manifest.yml as "written exclusively through spec-status", but
// transitionSpec refuses with 'no-manifest' until the file already exists —
// nothing created it. This is the sanctioned first write, pinned the same
// way tests/hooks-spec-status.test.js pins spec-status's own CLI shape.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readManifest } = require('../plugin/bin/lib/flow/manifest');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

// #1130: never let an omitted cwd fall through to the spawned subprocess's
// own process.cwd() (see hooks-spec-status.test.js's identical note).
const HOOK_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-seedmanifest-sandbox-'));

function runHook(args, { input = '', cwd = HOOK_SANDBOX, env = {} } = {}) {
  try {
    const stdout = execFileSync('node', [HOOKS, ...args], {
      input, cwd, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', ...env },
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '' };
  }
}

// An initialized-but-manifest-less parent run dir — the exact state the
// Manifesto leaves a fresh multi-spec run in (config.yml + decisions.md
// written, manifest.yml not yet seeded) — see resolveRunArg's
// isInitializedRunDir bar in bin/hooks.js.
function freshParentRunDir() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-seedmanifest-'));
  execFileSync('git', ['-C', project, 'init', '-q']);
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-10-17T000000-spec-1-2');
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, 'decisions.md'), '');
  return run;
}

test('seed-manifest writes a fresh manifest.yml that spec-status then accepts', () => {
  const run = freshParentRunDir();
  const r = runHook(['seed-manifest', '--run', run, '--specs', '157,159', '--base-sha', 'deadbeef'], { cwd: run });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /manifest\.yml seeded for .* \(2 specs: 157, 159\)/);

  const manifest = readManifest(run);
  assert.equal(manifest.multispec.specs.length, 2);
  assert.equal(manifest.multispec.specs[0].id, 157);
  assert.equal(manifest.multispec.specs[0].status, 'pending');
  assert.equal(manifest.multispec.specs[0].subdir, 'spec-157/');
  assert.equal(manifest.multispec.specs[1].id, 159);
  assert.equal(manifest.multispec.baseSha, 'deadbeef');

  // The whole point of the seeding gap this closes: spec-status must now
  // succeed against the manifest seed-manifest just wrote, in the same run.
  const status = runHook(['spec-status', '--run', run, '--spec', '157', '--status', 'running', '--phase', 'build'], { cwd: run });
  assert.equal(status.code, 0);
  assert.equal(status.stdout, '## Flow: Running build (1/2) — spec #157\n');
  assert.equal(readManifest(run).multispec.specs[0].status, 'running');
});

test('seed-manifest omits baseSha when --base-sha is not given', () => {
  const run = freshParentRunDir();
  const r = runHook(['seed-manifest', '--run', run, '--specs', '42'], { cwd: run });
  assert.equal(r.code, 0);
  const manifest = readManifest(run);
  assert.equal(manifest.multispec.baseSha, undefined);
  assert.equal(manifest.multispec.specs.length, 1);
});

test('seed-manifest refuses to overwrite an existing manifest.yml', () => {
  const run = freshParentRunDir();
  const first = runHook(['seed-manifest', '--run', run, '--specs', '1,2'], { cwd: run });
  assert.equal(first.code, 0);
  const before = fs.readFileSync(path.join(run, 'manifest.yml'), 'utf8');

  const second = runHook(['seed-manifest', '--run', run, '--specs', '3,4'], { cwd: run });
  assert.notEqual(second.code, 0, 'a second seed-manifest call against an existing manifest must exit non-zero');
  assert.match(second.stdout, /manifest\.yml already exists.*refusing to overwrite/);
  assert.equal(fs.readFileSync(path.join(run, 'manifest.yml'), 'utf8'), before, 'the existing manifest must be left byte-unchanged');
});

test('seed-manifest rejects missing or malformed --specs', () => {
  const run = freshParentRunDir();

  const missing = runHook(['seed-manifest', '--run', run], { cwd: run });
  assert.notEqual(missing.code, 0);
  assert.match(missing.stdout, /usage: seed-manifest/);
  assert.equal(fs.existsSync(path.join(run, 'manifest.yml')), false, 'no manifest written on a missing --specs');

  const emptySegment = runHook(['seed-manifest', '--run', run, '--specs', '1,,2'], { cwd: run });
  assert.notEqual(emptySegment.code, 0);
  assert.match(emptySegment.stdout, /usage: seed-manifest/);
  assert.equal(fs.existsSync(path.join(run, 'manifest.yml')), false, 'no manifest written on a malformed --specs list');

  const blank = runHook(['seed-manifest', '--run', run, '--specs', '   '], { cwd: run });
  assert.notEqual(blank.code, 0);
  assert.equal(fs.existsSync(path.join(run, 'manifest.yml')), false);

  const nonNumeric = runHook(['seed-manifest', '--run', run, '--specs', '157,abc'], { cwd: run });
  assert.notEqual(nonNumeric.code, 0);
  assert.equal(fs.existsSync(path.join(run, 'manifest.yml')), false, 'a non-numeric record id is never seeded');

  const badSha = runHook(['seed-manifest', '--run', run, '--specs', '157', '--base-sha', 'not-a-sha'], { cwd: run });
  assert.notEqual(badSha.code, 0);
  assert.equal(fs.existsSync(path.join(run, 'manifest.yml')), false, 'a non-hex --base-sha is never seeded');
});

test('seed-manifest rejects a missing --run', () => {
  const run = freshParentRunDir();
  const result = runHook(['seed-manifest', '--specs', '1,2'], { cwd: run });
  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /--run is required/);
  assert.equal(fs.existsSync(path.join(run, 'manifest.yml')), false);
});

test('seed-manifest with a non-existent --run path fails loudly instead of falling back or claiming success', () => {
  const run = freshParentRunDir();
  const bogus = path.join(path.dirname(run), 'does-not-exist');
  const result = runHook(['seed-manifest', '--run', bogus, '--specs', '1'], { cwd: run });
  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /--run path rejected/);
});

test('seed-manifest --help prints usage and exits 0 with no write', () => {
  const run = freshParentRunDir();
  const result = runHook(['seed-manifest', '--help'], { cwd: run });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /usage: seed-manifest --run <parent-dir> --specs/);
  assert.equal(fs.existsSync(path.join(run, 'manifest.yml')), false);
});

test('seed-manifest with an unrecognized flag prints usage instead of silently proceeding', () => {
  const run = freshParentRunDir();
  const result = runHook(['seed-manifest', '--run', run, '--specs', '1', '--bogus', 'x'], { cwd: run });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /usage: seed-manifest/);
  assert.equal(fs.existsSync(path.join(run, 'manifest.yml')), false);
});
