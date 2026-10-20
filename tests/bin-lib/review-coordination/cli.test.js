const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const c = require('../../../plugin/bin/lib/coordination');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'review-coordination.js');

function runCli(args, opts = {}) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status, stdout: err.stdout, stderr: err.stderr };
  }
}

function writeFixture(name, value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-coord-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(value));
  return p;
}

const FINDINGS_A = [
  { path: 'src/auth.ts', line: 42, severity: 'high', finding: 'missing expiry check' },
  { path: 'src/api.ts', line: 180, severity: 'medium', finding: 'unhandled rejection' },
];
const FINDINGS_B = [
  { path: 'src/auth.ts', line: 43, severity: 'critical', finding: 'missing expiry check' },
];

test('categorise-reproduction matches the library result exactly', () => {
  const a = writeFixture('a.json', FINDINGS_A);
  const b = writeFixture('b.json', FINDINGS_B);
  const { code, stdout } = runCli(['categorise-reproduction', a, b]);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(JSON.parse(stdout), c.categoriseReproduction(FINDINGS_A, FINDINGS_B));
});

test('detect-overlap matches the library result exactly', () => {
  const byLens = { security: FINDINGS_A, architecture: FINDINGS_B };
  const p = writeFixture('by-lens.json', byLens);
  const { code, stdout } = runCli(['detect-overlap', p]);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(JSON.parse(stdout), c.detectCrossLensOverlap(byLens));
});

test('corroborate-cross-lens matches the library result exactly', () => {
  const byLens = {
    '3b': [{ path: 'x.js', line: 10, severity: 'low', text: 'superseded failed run marks real PR failure inherited' }],
    '3c': [{ path: 'x.js', line: 12, severity: 'low', text: 'superseded failed run at base marks PR failure as inherited' }],
    '3d': [{ path: 'y.js', line: 1, severity: 'high', text: 'unrelated defect elsewhere entirely' }],
  };
  const p = writeFixture('unconfirmed-by-lens.json', byLens);
  const { code, stdout } = runCli(['corroborate-cross-lens', p]);
  assert.strictEqual(code, 0);
  const expected = c.corroborateCrossLens(byLens);
  assert.strictEqual(expected.corroborated.length, 1);
  assert.deepStrictEqual(JSON.parse(stdout), JSON.parse(JSON.stringify(expected)));
});

test('resolve-debate prints the bare resolution for every verdict combination', () => {
  assert.strictEqual(runCli(['resolve-debate', 'agree', 'agree']).stdout.trim(), 'confirmed');
  assert.strictEqual(runCli(['resolve-debate', 'disagree', 'disagree']).stdout.trim(), 'unconfirmed');
  assert.strictEqual(runCli(['resolve-debate', 'agree', 'partial']).stdout.trim(), 'contested');
});

test('resolve-refutation: only the exact literal not-refuted keeps a finding confirmed', () => {
  assert.strictEqual(runCli(['resolve-refutation', 'not-refuted']).stdout.trim(), 'confirmed');
  assert.strictEqual(runCli(['resolve-refutation', 'refuted']).stdout.trim(), 'unconfirmed');
  assert.strictEqual(runCli(['resolve-refutation', 'garbled']).stdout.trim(), 'unconfirmed');
});

test('malformed invocations exit 2: unknown command, wrong arity, missing file, invalid JSON, wrong shape', () => {
  assert.strictEqual(runCli([]).code, 2);
  assert.strictEqual(runCli(['frobnicate']).code, 2);
  assert.strictEqual(runCli(['categorise-reproduction', 'only-one.json']).code, 2);
  assert.strictEqual(runCli(['resolve-debate', 'agree']).code, 2);
  assert.strictEqual(runCli(['categorise-reproduction', '/nonexistent/a.json', '/nonexistent/b.json']).code, 2);

  const badJson = writeFixture('bad.json', null);
  fs.writeFileSync(badJson, '{not json');
  assert.strictEqual(runCli(['detect-overlap', badJson]).code, 2);

  const wrongShape = writeFixture('wrong.json', { notAnArray: true });
  const b = writeFixture('b.json', FINDINGS_B);
  assert.strictEqual(runCli(['categorise-reproduction', wrongShape, b]).code, 2);
  const arrayNotObject = writeFixture('arr.json', FINDINGS_A);
  assert.strictEqual(runCli(['detect-overlap', arrayNotObject]).code, 2);

  // corroborate-cross-lens: arity, non-object input, non-array lens value.
  assert.strictEqual(runCli(['corroborate-cross-lens']).code, 2);
  assert.strictEqual(runCli(['corroborate-cross-lens', 'a.json', 'b.json']).code, 2);
  assert.strictEqual(runCli(['corroborate-cross-lens', arrayNotObject]).code, 2);
  const lensNotArray = writeFixture('lens-not-array.json', { '3b': 'not-an-array' });
  assert.strictEqual(runCli(['corroborate-cross-lens', lensNotArray]).code, 2);
  assert.strictEqual(runCli(['corroborate-cross-lens', badJson]).code, 2);
});
