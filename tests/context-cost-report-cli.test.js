// tests/context-cost-report-cli.test.js — bin/context-cost-report.js, the
// thin CLI over composedBytesReport() (#1990) that harness-health's
// composed-bytes-per-step check (#1909) shells out to. Exercised via the
// injectable run(argv, deps) seam (gh-api-module-pattern's convention for a
// CLI with no external process to fake) rather than spawning a subprocess.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const { run } = require('../plugin/bin/context-cost-report');
const { composedBytesReport } = require('../plugin/bin/lib/skill-audit/context-cost');

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
  assert.match(out.stdout, /^usage: context-cost-report\.js/);
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

test('a repo-root path (no skills/ beneath it) surfaces composedBytesReport\'s own rejection on stderr, exit 2', () => {
  const { out, deps } = capture();
  const code = run(['--plugin-root', path.join(__dirname, '..')], deps);
  assert.strictEqual(code, 2);
  assert.match(out.stderr, /not a plugin root: no skills\/ directory beneath it/);
});

test('--plugin-root <plugin/> emits one JSON line matching composedBytesReport() row-for-row', () => {
  const { out, deps } = capture();
  const code = run(['--plugin-root', PLUGIN_ROOT], deps);
  assert.strictEqual(code, 0);
  assert.strictEqual(out.stderr, '');
  const lines = out.stdout.split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1, 'stdout must be exactly one JSON line');
  const rows = JSON.parse(lines[0]);
  const expected = composedBytesReport(PLUGIN_ROOT);
  assert.strictEqual(rows.length, expected.length);
  assert.ok(rows.length > 0, 'the real corpus has at least one compose call site to report');
  for (const [i, row] of rows.entries()) {
    const exp = expected[i];
    assert.strictEqual(row.step, exp.step);
    assert.strictEqual(row.file, exp.file);
    assert.strictEqual(row.line, exp.line);
    if (exp.error) {
      assert.strictEqual(row.error, exp.error);
      assert.ok(!('bytes' in row), 'an error row must not also carry a bytes field');
    } else {
      assert.strictEqual(row.bytes.max, exp.max);
      assert.strictEqual(row.bytes.byCombination.length, exp.combinations.length);
      for (const [j, combo] of row.bytes.byCombination.entries()) {
        assert.deepStrictEqual(combo.conditions, exp.combinations[j].conditions);
        assert.strictEqual(combo.bytes, exp.combinations[j].bytes);
      }
    }
  }
});
