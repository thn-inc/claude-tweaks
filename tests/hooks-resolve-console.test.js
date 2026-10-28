// tests/hooks-resolve-console.test.js — #2568: hooks.js's `resolve-console`
// CLI dispatch (the --run-required discipline, USAGE/KNOWN_FLAGS wiring).
// The gh-calling happy path is covered directly against
// resolveConsoleExecution in tests/resolve-console.test.js with a fake
// runner — this file only exercises the CLI-level gates that fire before
// any gh call would ever be made.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

function runHook(args, { cwd } = {}) {
  try {
    const stdout = execFileSync('node', [HOOKS, ...args], {
      cwd: cwd || fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resolve-console-cli-')),
      encoding: 'utf8',
      env: { ...process.env, PIPELINE_RUN_DIR: '' },
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '' };
  }
}

test('resolve-console --help prints usage and exits 0, no --run required', () => {
  const result = runHook(['resolve-console', '--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /resolve-console --run <dir>/);
  assert.match(result.stdout, /\[--reverse-failed <id,id,\.\.\.>\]/);
  assert.match(result.stdout, /\[--filing-failed <id,id,\.\.\.>\]/);
});

test('resolve-console accepts --filing-failed as a declared flag', () => {
  const result = runHook(['resolve-console', '--run', '/definitely/not/a/real/path/xyz', '--filing-failed', 'f1']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--run path rejected/);
});

// #3949: --filing-failed names only a finding row (console.json's findingItem); the CLI renders the refusal.
test('resolve-console --filing-failed on a non-finding item is refused by the CLI with the not-finding-items message', { skip: process.platform === 'win32' }, () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resolve-console-ff-')));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-10-24T000000-ff');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\n');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    commentIds: ['IC_primary'], prNumber: 42, items: [{ id: '1', kind: 'batch', summary: 'fix A' }],
  }));
  const binDir = path.join(repo, 'stub-bin');
  fs.mkdirSync(binDir);
  const comment = { id: 'IC_primary', body: '<!-- console-item: resolve -->\n- [ ] **Resolve console**\n<!-- console-item: 1 -->\n- [ ] item 1' };
  fs.writeFileSync(path.join(binDir, 'gh'), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ comments: [comment], body: 'Fixes #42' }))});\n`, { mode: 0o755 });
  let result;
  try {
    const stdout = execFileSync('node', [HOOKS, 'resolve-console', '--run', runDir, '--filing-failed', '1'], {
      cwd: repo, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    });
    result = { code: 0, stdout };
  } catch (e) {
    result = { code: e.status, stdout: e.stdout || '' };
  }
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--filing-failed id\(s\) 1 are neither finding rows nor sdd-ruling rows \(no findingItem, no isRulingRow flag\)/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'console.json'), 'utf8')).executedAt, undefined, 'a refused call writes nothing');
});

// --reverse-failed is a declared flag: accepted rather than intercepted as unknown.
test('resolve-console accepts --reverse-failed as a declared flag', () => {
  const result = runHook(['resolve-console', '--run', '/definitely/not/a/real/path/xyz', '--reverse-failed', 'r1']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--run path rejected/);
});

// The CLI forwards --reverse-failed into resolveConsoleExecution and renders its
// not-ruling-items refusal. A stub `gh` first on PATH answers the single `pr view`
// read; the refusal returns before any write, so no other gh call is ever made.
// Skipped on win32: a bare executable stub is not a launchable `gh` there.
test('resolve-console --reverse-failed on an unflagged item is refused by the CLI with the not-ruling-items message', { skip: process.platform === 'win32' }, () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resolve-console-rf-')));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-10-20T000000-rf');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\n');
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({
    commentIds: ['IC_primary'], prNumber: 42, items: [{ id: '1', kind: 'batch', summary: 'fix A' }],
  }));
  const binDir = path.join(repo, 'stub-bin');
  fs.mkdirSync(binDir);
  const comment = { id: 'IC_primary', body: '<!-- console-item: resolve -->\n- [ ] **Resolve console**\n<!-- console-item: 1 -->\n- [ ] item 1' };
  fs.writeFileSync(path.join(binDir, 'gh'), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ comments: [comment], body: 'Fixes #42' }))});\n`, { mode: 0o755 });
  let result;
  try {
    const stdout = execFileSync('node', [HOOKS, 'resolve-console', '--run', runDir, '--reverse-failed', '1'], {
      cwd: repo, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
    });
    result = { code: 0, stdout };
  } catch (e) {
    result = { code: e.status, stdout: e.stdout || '' };
  }
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--reverse-failed id\(s\) 1 are not sdd-ruling items/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'console.json'), 'utf8')).executedAt, undefined, 'a refused call writes nothing');
});

test('resolve-console without --run exits non-zero with a usage message, performs zero writes', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-resolve-console-norun-'));
  const result = runHook(['resolve-console', '--approve', '1'], { cwd: runDir });
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--run is required/);
  assert.equal(fs.readdirSync(runDir).length, 0, 'nothing should be written when --run is omitted');
});

// Unknown-flag interception is verb-agnostic and, per this dispatcher's own
// "never break a session" cardinal invariant, always exits 0 — the usage
// line itself is the rejection signal, not the exit code (same convention
// every other KNOWN_FLAGS verb in this file already follows).
test('resolve-console with an unrecognized flag prints usage instead of silently proceeding', () => {
  const result = runHook(['resolve-console', '--run', '/tmp', '--bogus', 'x']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /usage: resolve-console --run <dir>/);
});

test('resolve-console with a --run path that is not a real directory is rejected', () => {
  const result = runHook(['resolve-console', '--run', '/definitely/not/a/real/path/xyz']);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /--run path rejected/);
});
