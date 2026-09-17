'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseArgs } = require('../../../plugin/bin/check-pr-bookkeeping');

function makeCleanRunDir() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prbk-cli-'));
  const runDir = path.join(project, '.claude-tweaks', 'pipelines', '2026-09-17T000009-spec-1');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'clean' }));
  return runDir;
}

function makeDeps() {
  const out = []; const err = [];
  return {
    deps: { cwd: () => process.cwd(), stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
    out, err,
  };
}

test('parseArgs: --help sets help flag', () => {
  const o = parseArgs(['--help']);
  assert.strictEqual(o.help, true);
});

test('parseArgs: unknown flag returns an error', () => {
  const o = parseArgs(['--bogus']);
  assert.ok(o.error);
});

test('run: --help exits 0 and prints usage', () => {
  const { deps, out } = makeDeps();
  const code = run(['--help'], deps);
  assert.strictEqual(code, 0);
  assert.match(out.join(''), /usage: check-pr-bookkeeping\.js/);
});

test('run: missing --run exits 2', () => {
  const { deps, err } = makeDeps();
  const code = run([], deps);
  assert.strictEqual(code, 2);
  assert.match(err.join(''), /--run <run-dir> is required/);
});

test('run: unknown argument exits 2', () => {
  const { deps, err } = makeDeps();
  const code = run(['--bogus'], deps);
  assert.strictEqual(code, 2);
  assert.match(err.join(''), /unknown argument/);
});

test('run: nonexistent run dir exits 3', () => {
  const { deps, err } = makeDeps();
  const code = run(['--run', '/nonexistent/path/xyz'], deps);
  assert.strictEqual(code, 3);
  assert.match(err.join(''), /run dir does not exist/);
});

test('run: a clean run exits 0', () => {
  const { deps, out } = makeDeps();
  const runDir = makeCleanRunDir();
  const code = run(['--run', runDir], deps);
  assert.strictEqual(code, 0);
  assert.match(out.join(''), /ok \(clean\)/);
});
