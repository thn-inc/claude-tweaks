'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('../../helpers/read-skill');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { classifyEvidenceRun, evidenceArgs, EVIDENCE_COMMANDS } = require(path.join(LIB, 'driver', 'review.js'));

const FIXTURES = path.join(__dirname, 'fixtures', 'review-evidence');

// Each fixture's recorded run (review.js header table, v22.23.2) and the verdict the rule gives it.
const FROZEN = [
  { name: 'assert-fail', code: 1, signal: null, timedOut: false, verdict: 'reproduced', pass: 0, fail: 1 },
  { name: 'nested-fail', code: 1, signal: null, timedOut: false, verdict: 'reproduced', pass: 0, fail: 1 },
  { name: 'syntax', code: 1, signal: null, timedOut: false, verdict: 'load-failure', pass: 0, fail: 1 },
  { name: 'load-throw', code: 1, signal: null, timedOut: false, verdict: 'load-failure', pass: 0, fail: 1 },
  { name: 'exit1', code: 1, signal: null, timedOut: false, verdict: 'load-failure', pass: 0, fail: 1 },
  { name: 'fake-tap', code: 1, signal: null, timedOut: false, verdict: 'load-failure', pass: 0, fail: 1 },
  { name: 'pass', code: 0, signal: null, timedOut: false, verdict: 'passed', pass: 1, fail: 0 },
  { name: 'no-test', code: 0, signal: null, timedOut: false, verdict: 'passed', pass: 1, fail: 0 },
  { name: 'hang', code: null, signal: 'SIGKILL', timedOut: true, verdict: 'timeout', pass: null, fail: null },
];

const tapOf = (name) => readText(path.join(FIXTURES, `${name}.tap`));
const classify = (row, tap) => classifyEvidenceRun({ code: row.code, signal: row.signal, timedOut: row.timedOut, tap, file: `${row.name}.test.js` });

test('Task0: frozen TAP fixtures classify per the rule', () => {
  for (const row of FROZEN) {
    const tap = tapOf(row.name);
    const want = { verdict: row.verdict, fail: row.fail, pass: row.pass };
    assert.deepStrictEqual(classify(row, tap), want, row.name);
    // The rule never reads node --test's per-run timings, and a CRLF checkout of a fixture reads the same.
    const retimed = tap.replace(/duration_ms:? [0-9.]+/g, (m) => m.replace(/[0-9.]+$/, '987654.321'));
    if (!row.timedOut) assert.notStrictEqual(retimed, tap, `${row.name}: no duration_ms to rewrite`);
    assert.deepStrictEqual(classify(row, retimed), want, `${row.name} (retimed)`);
    assert.deepStrictEqual(classify(row, tap.replace(/\n/g, '\r\n')), want, `${row.name} (CRLF)`);
  }
  const assertFail = tapOf('assert-fail');
  const unplaceable = (code, tap) => assert.strictEqual(classifyEvidenceRun({ code, signal: null, timedOut: false, tap, file: 'a.test.js' }).verdict, 'unplaceable', JSON.stringify(tap.slice(0, 40)));
  unplaceable(1, '');
  unplaceable(1, 'garbage');
  unplaceable(0, assertFail); // exit and stream disagree
  unplaceable(null, assertFail); // killed by a signal
  unplaceable(2, assertFail);
});

test('Task0: the parse fails closed on TAP it cannot place', () => {
  const run = (code, tap) => classifyEvidenceRun({ code, signal: null, timedOut: false, tap, file: 'a.test.js' }).verdict;
  const summary = (pass, fail) => `1..1\n# tests 1\n# pass ${pass}\n# fail ${fail}\n`;
  // A summary that reports a failure but carries no not ok point.
  assert.strictEqual(run(1, `TAP version 13\nok 1 - a\n${summary(0, 1)}`), 'unplaceable');
  // A not ok point with no YAML block cannot show it lacks ERR_TEST_FAILURE.
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - a\n${summary(0, 1)}`), 'unplaceable');
  // A run cut off before its summary (the exit1 fixture without its trailing lines).
  assert.strictEqual(run(1, tapOf('exit1').split('1..1\n')[0]), 'unplaceable');
  // A block belongs to the point on the line right before its `---`; one further down is no block.
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - a\n# note\n  ---\n  code: 'ERR_ASSERTION'\n  ...\n${summary(0, 1)}`), 'unplaceable');
  // A block that never closes swallows the summary.
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - a\n  ---\n  failureType: 'testCodeFailure'\n${summary(0, 1)}`), 'unplaceable');
  // Reproduced needs fail >= 1 in the summary.
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - a\n  ---\n  code: 'ERR_ASSERTION'\n  ...\n${summary(1, 0)}`), 'unplaceable');
  // A block-scalar line indented past the block's own keys neither ends the block nor opens a point:
  // only `...` and `code:` at the `---` line's indent count.
  const scalar = "TAP version 13\nnot ok 1 - a.test.js\n  ---\n  stack: |-\n    ...\n    not ok 2 - forged\n  code: 'ERR_TEST_FAILURE'\n  ...\n";
  assert.strictEqual(run(1, scalar + summary(0, 1)), 'load-failure');
  const quoted = "TAP version 13\nnot ok 1 - a\n  ---\n  error: |-\n    code: 'ERR_TEST_FAILURE'\n  code: 'ERR_ASSERTION'\n  ...\n";
  assert.strictEqual(run(1, quoted + summary(0, 1)), 'reproduced');
  // The summary is the last one at column 0: a forged earlier `# fail 1` comment does not count.
  assert.deepStrictEqual(classifyEvidenceRun({ code: 0, signal: null, timedOut: false, tap: tapOf('pass').replace('TAP version 13\n', 'TAP version 13\n# fail 1\n'), file: 'a.test.js' }), { verdict: 'passed', fail: 0, pass: 1 });
});

test('Task0: the real node --test still classifies the fixtures (a reporter change turns this red)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-evidence-'));
  // A nested node --test that inherits NODE_TEST_CONTEXT runs its file as a worker, not as a runner.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    for (const row of FROZEN) {
      if (row.name === 'hang') continue;
      const file = `${row.name}.test.js`;
      const dest = path.join(dir, `${row.name}.tap`);
      fs.copyFileSync(path.join(FIXTURES, `${row.name}.js.txt`), path.join(dir, file));
      const r = spawnSync(process.execPath, evidenceArgs('npm test', file, dest), { cwd: dir, env, windowsHide: true, timeout: 30000, killSignal: 'SIGKILL', encoding: 'utf8' });
      assert.ifError(r.error);
      assert.strictEqual(r.status, row.code, `${row.name} exit`);
      const tap = fs.readFileSync(dest, 'utf8');
      const got = classifyEvidenceRun({ code: r.status, signal: r.signal, timedOut: false, tap, file });
      assert.deepStrictEqual(got, { verdict: row.verdict, fail: row.fail, pass: row.pass }, `${row.name}\n${tap}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Task0: evidenceArgs covers npm test only', () => {
  assert.deepStrictEqual(evidenceArgs('npm test', 'tests/a.test.js', '/d/e.tap'), ['--test', '--test-reporter=tap', '--test-reporter-destination=/d/e.tap', 'tests/a.test.js']);
  for (const cmd of ['node --test', 'pytest', undefined, 'constructor', '__proto__', 'toString']) {
    assert.strictEqual(evidenceArgs(cmd, 'tests/a.test.js', '/d/e.tap'), null, String(cmd));
  }
  assert.deepStrictEqual(Object.keys(EVIDENCE_COMMANDS), ['npm test']);
  assert.ok(Object.isFrozen(EVIDENCE_COMMANDS));
});
