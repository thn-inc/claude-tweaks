const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const { sweepCli } = require('../../helpers/health-sweep-cli');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'docs-health.js');

function tmp() { return scratchDir('docs-health-word-count-'); }

// Real-process pin of the script entry (#5381): the success envelope's code, stdout and stderr are
// byte-identical before and after the in-process entry conversion.
test('AC5.1, AC7.1: docs-health.js word-count <file> prints the result envelope and exits 0 (real process)', () => {
  const { spawnCli } = require('../../helpers/run-cli');
  const root = tmp();
  const docPath = path.join(root, 'doc.md');
  fs.writeFileSync(docPath, 'one two three four five');
  const r = spawnCli(CLI, ['word-count', docPath], { env: { ...process.env } });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '{\n  "result": 5\n}\n');
  assert.strictEqual(r.stderr, '');
});

test('word-count returns the depth-hint frontmatter value as-is', () => {
  const root = tmp();
  const docPath = path.join(root, 'doc.md');
  fs.writeFileSync(docPath, ['---', 'depth-hint: deep-dive', '---', 'one two three'].join('\n'));
  const output = JSON.parse(execFileSync('node', [CLI, 'word-count', docPath], { encoding: 'utf8' }));
  assert.strictEqual(output.result, 'deep-dive');
});

// In-process (#5381): a relative path resolves against the injected cwd, and an unreadable one is
// named as the caller spelled it. One in-process test, no extra process.
test('word-count resolves a relative path against the injected cwd and names a missing one as written', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'doc.md'), 'one two three four five');
  const ok = sweepCli(CLI, ['word-count', 'doc.md'], { cwd: root });
  assert.strictEqual(ok.status, 0, `stderr: ${ok.stderr}`);
  assert.strictEqual(ok.stdout, '{\n  "result": 5\n}\n');
  const missing = sweepCli(CLI, ['word-count', 'nope.md'], { cwd: root });
  assert.strictEqual(missing.status, 1);
  assert.strictEqual(missing.stderr, 'word-count: could not read file: nope.md\n');
});

test('word-count exits non-zero when the path arg is missing', () => {
  const result = spawnSync('node', [CLI, 'word-count'], { encoding: 'utf8' });
  assert.notStrictEqual(result.status, 0);
});

test('word-count exits non-zero when the file does not exist', () => {
  const result = spawnSync('node', [CLI, 'word-count', '/nonexistent/doc.md'], { encoding: 'utf8' });
  assert.notStrictEqual(result.status, 0);
});
