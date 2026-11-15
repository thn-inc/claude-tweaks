'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { deriveTestVerdict } = require('../../../plugin/bin/lib/dispatch/artifact-verdict');

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-artifact-verdict-'));
  const file = path.join(dir, 'raw-output.log');
  fs.writeFileSync(file, content);
  return file;
}

test('derives a failing verdict from the raw artifact, ignoring a planted false claim elsewhere', (t) => {
  // Simulates the #296 threat model: a fixture decisions.md (never read by this
  // function) falsely claims "all tests pass", while the actual raw test-output
  // artifact shows real failures. The function must never even open the decisions.md
  // file -- it only reads what it's given.
  const fixtureDecisionsMd = tmpFile('AUTO 12:00:00 -- Step 5: all tests pass, 0 failures.\n');
  const rawOutput = tmpFile([
    'TAP version 13',
    '# Subtest: some real test',
    'not ok 1 - some real test',
    '1..1',
    '# tests 1',
    '# pass 0',
    '# fail 1',
    '',
  ].join('\n'));

  // Spy on the ONLY door into the filesystem this module has. An existsSync check on
  // the fixture would pass identically on a broken implementation that opened and
  // trusted it -- the file is there either way. Recording the reads is what actually
  // proves the negative. Installed after both fixtures are written so the spy sees
  // only the call under test; it calls through to the real implementation.
  t.mock.method(fs, 'readFileSync');

  const verdict = deriveTestVerdict({ rawTestOutputPath: rawOutput });

  assert.strictEqual(verdict.passed, false, 'must derive FAILED from the raw artifact, not the planted claim');
  assert.strictEqual(verdict.failCount, 1);
  assert.strictEqual(verdict.source, 'raw-artifact');

  // The real proof the fixture was never opened -- if this function ever grows a
  // decisions.md/ledger fallback path, these are the assertions that fail.
  const reads = fs.readFileSync.mock.calls;
  assert.strictEqual(reads.length, 1, `deriveTestVerdict must read exactly one file; it read ${reads.length}`);
  assert.strictEqual(
    reads[0].arguments[0],
    rawOutput,
    'the one file read must be rawTestOutputPath — never the planted decisions.md',
  );
  assert.ok(
    !reads.some((c) => c.arguments[0] === fixtureDecisionsMd),
    'deriveTestVerdict opened the planted decisions.md fixture',
  );
});

test('derives a passing verdict from a clean raw artifact', () => {
  const rawOutput = tmpFile([
    'TAP version 13',
    '# Subtest: some real test',
    'ok 1 - some real test',
    '1..1',
    '# tests 1',
    '# pass 1',
    '# fail 0',
    '',
  ].join('\n'));

  const verdict = deriveTestVerdict({ rawTestOutputPath: rawOutput });

  assert.strictEqual(verdict.passed, true);
  assert.strictEqual(verdict.failCount, 0);
  assert.strictEqual(verdict.source, 'raw-artifact');
});

test('throws on a missing raw artifact rather than silently defaulting to passed', () => {
  assert.throws(() => deriveTestVerdict({ rawTestOutputPath: '/nonexistent/path.log' }));
});

// #4347: the runner-written pass stamp is the other raw artifact — a CI-sourced
// one (`source: "ci"`) reads exactly as a local one does, from one file read.
const SHA = '0123456789abcdef0123456789abcdef01234567';
for (const [label, extra, stampSource] of [
  ['a local pass stamp', {}, 'local'],
  ['a CI-sourced pass stamp', { source: 'ci', ci: { tests: { runId: 41, runUrl: 'https://example.test/runs/41' } } }, 'ci'],
]) {
  test(`derives a passing verdict from ${label}, reading only that file (#4347)`, (t) => {
    const stampPath = tmpFile(JSON.stringify({ sha: SHA, dirty: false, scope: 'full', fullSha: SHA, ...extra }));
    t.mock.method(fs, 'readFileSync');
    const verdict = deriveTestVerdict({ stampPath });
    assert.deepStrictEqual(verdict, { passed: true, failCount: 0, source: 'pass-stamp', stampSource, sha: SHA, scope: 'full' });
    assert.strictEqual(fs.readFileSync.mock.calls.length, 1);
    assert.strictEqual(fs.readFileSync.mock.calls[0].arguments[0], stampPath);
  });
}

for (const [label, body] of [
  ['an unparseable stamp', '{'],
  ['a stamp with no 40-hex sha', JSON.stringify({ sha: 'abc', scope: 'full' })],
  ['a stamp with no scope', JSON.stringify({ sha: SHA })],
  ['a stamp naming a source the runner never writes', JSON.stringify({ sha: SHA, scope: 'full', source: 'agent' })],
  ['a ci stamp without its ci record', JSON.stringify({ sha: SHA, scope: 'full', source: 'ci' })],
]) {
  test(`throws on ${label} rather than deriving a pass (#4347)`, () => {
    assert.throws(() => deriveTestVerdict({ stampPath: tmpFile(body) }), /deriveTestVerdict: /);
  });
}

test('names exactly one artifact — both or neither is a usage error (#4347)', () => {
  assert.throws(() => deriveTestVerdict({}), /exactly one of/);
  assert.throws(() => deriveTestVerdict({ rawTestOutputPath: 'a', stampPath: 'b' }), /exactly one of/);
});

// The cheapest way to fool a module built to resist being fooled is to hand it an
// artifact with no summary line at all -- empty, truncated mid-run, or not TAP.
// A `failMatch ? ... : 0` default turned exactly that into passed: true.
for (const [label, body] of [
  ['an empty artifact', ''],
  ['a truncated run with no summary line', 'TAP version 13\n# Subtest: a test that never finished\n'],
  ['non-TAP output', 'All good! Everything passed.\n'],
  ['a summary line that is not the fail count', 'TAP version 13\n# tests 3\n# pass 3\n'],
]) {
  test(`throws on ${label} rather than silently defaulting to passed`, () => {
    const rawOutput = tmpFile(body);
    assert.throws(
      () => deriveTestVerdict({ rawTestOutputPath: rawOutput }),
      /no "# fail N" summary line/,
      `${label} must not derive a passing verdict`,
    );
  });
}
