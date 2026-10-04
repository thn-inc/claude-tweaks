// tests/harness-cost-report-cli.test.js — bin/harness-cost-report.js, the thin
// CLI over estimateHarnessCost()/flagHighToolCount() (#2741) that
// harness-health's harness cost-efficiency check shells out to, mirroring
// tests/context-cost-report-cli.test.js's shape for its sibling CLI.
// Exercised via the injectable run(argv, deps) seam (gh-api-module-pattern's
// convention for a CLI with no external process to fake) rather than
// spawning a subprocess.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { run } = require('../plugin/bin/harness-cost-report');
const { estimateHarnessCost, flagHighToolCount } = require('../plugin/bin/lib/skill-audit/harness-cost');
const { listSkillDirs } = require('../plugin/bin/lib/skill-audit/skill-catalog');

const PLUGIN_ROOT = path.join(__dirname, '..', 'plugin');

function capture() {
  const out = { stdout: '', stderr: '' };
  const deps = {
    stdout: (s) => { out.stdout += s; },
    stderr: (s) => { out.stderr += s; },
  };
  return { out, deps };
}

test('--help prints usage and exits 0, without touching the plugin corpus', () => {
  const { out, deps } = capture();
  const code = run(['--help'], deps);
  assert.strictEqual(code, 0);
  assert.match(out.stdout, /^usage: harness-cost-report\.js/);
  assert.strictEqual(out.stderr, '');
});

test('an unknown flag is rejected with exit 2 and no stdout', () => {
  const { out, deps } = capture();
  const code = run(['--bogus'], deps);
  assert.strictEqual(code, 2);
  assert.strictEqual(out.stdout, '');
  assert.match(out.stderr, /unknown argument: --bogus/);
});

test('missing --plugin-root is rejected with exit 2', () => {
  const { out, deps } = capture();
  const code = run([], deps);
  assert.strictEqual(code, 2);
  assert.match(out.stderr, /--plugin-root <dir> is required/);
});

test('a non-numeric --ratio-threshold is rejected with exit 2', () => {
  const { out, deps } = capture();
  const code = run(['--plugin-root', PLUGIN_ROOT, '--ratio-threshold', 'nope'], deps);
  assert.strictEqual(code, 2);
  assert.match(out.stderr, /--ratio-threshold must be a number/);
});

test('a repo-root path (no skills/ beneath it) surfaces an error on stderr, exit 2', () => {
  const { out, deps } = capture();
  const code = run(['--plugin-root', path.join(__dirname, '..')], deps);
  assert.strictEqual(code, 2);
  assert.ok(out.stderr.startsWith('harness-cost-report.js: '), `expected a prefixed error, got: ${out.stderr}`);
});

test('--plugin-root <plugin/> emits one JSON line matching estimateHarnessCost() row-for-row', () => {
  const { out, deps } = capture();
  const code = run(['--plugin-root', PLUGIN_ROOT], deps);
  assert.strictEqual(code, 0);
  assert.strictEqual(out.stderr, '');
  const lines = out.stdout.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1, 'stdout must be exactly one JSON line');
  const report = JSON.parse(lines[0]);
  const expected = estimateHarnessCost(PLUGIN_ROOT);

  assert.strictEqual(report.totalSkills, listSkillDirs(PLUGIN_ROOT).length);
  assert.strictEqual(report.totalSkills, expected.totalSkills);
  assert.strictEqual(report.unscopedCount, expected.unscopedCount);
  assert.deepStrictEqual(report.entries, expected.entries);
  assert.deepStrictEqual(report.flagged, flagHighToolCount(expected.entries));
});

test('--ratio-threshold 0 flags every skill with a declared (non-null) tool count', () => {
  const { out, deps } = capture();
  const code = run(['--plugin-root', PLUGIN_ROOT, '--ratio-threshold', '0'], deps);
  assert.strictEqual(code, 0);
  const report = JSON.parse(out.stdout.trim());
  const scopedCount = report.entries.filter((e) => e.toolCount !== null).length;
  assert.strictEqual(report.flagged.length, scopedCount);
});
