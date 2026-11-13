'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('../../helpers/read-skill');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const {
  classifyEvidenceRun, evidenceArgs, EVIDENCE_COMMANDS, reviewRequired, findingShapeViolation, evidenceShapeViolation,
  pathRuleViolation, contentViolation, PATH_RULES, MAX_FINDINGS, EVIDENCE_PATH_MAX_CHARS, EVIDENCE_CONTENT_MAX_BYTES,
  EVIDENCE_RUN_TIMEOUT_MS, EVENT_TEXT_MAX_CHARS,
} = require(path.join(LIB, 'driver', 'review.js'));
const { EXPRESS_MAX_KEY_FILES } = require(path.join(LIB, 'express', 'eligibility.js'));
const { POLICY_KEYS } = require(path.join(LIB, 'policy-schema.js'));
const { REVIEW_RESULT_SCHEMA, ROLES, composeArgs } = require(path.join(LIB, 'driver', 'roles.js'));
const { conformsTo, superviseChild } = require(path.join(LIB, 'driver', 'worker.js'));

const FIXTURES = path.join(__dirname, 'fixtures', 'review-evidence');

// Each fixture's recorded run (review.js header table, v22.23.2) and the verdict the rule gives it.
const FROZEN = [
  { name: 'assert-fail', code: 1, signal: null, timedOut: false, verdict: 'reproduced', pass: 0, fail: 1 },
  { name: 'nested-fail', code: 1, signal: null, timedOut: false, verdict: 'reproduced', pass: 0, fail: 1 },
  { name: 'throw-in-test', code: 1, signal: null, timedOut: false, verdict: 'reproduced', pass: 0, fail: 1 },
  { name: 'nested-throw', code: 1, signal: null, timedOut: false, verdict: 'reproduced', pass: 0, fail: 1 },
  { name: 'hook-require', code: 1, signal: null, timedOut: false, verdict: 'unplaceable', pass: 0, fail: 1 },
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
  // fake-tap's printed point and YAML block reach the TAP only as `# ` comments.
  assertForgedLinesFolded(tapOf('fake-tap'));
});

function assertForgedLinesFolded(tap) {
  assert.match(tap, /^# not ok 1 - fake$/m);
  assert.match(tap, /^# {3}failureType: 'testCodeFailure'$/m);
  assert.doesNotMatch(tap, /^\s*not ok 1 - fake$/m);
}

// Synthetic blocks in the captured shapes: a failed test case's, and the file-level point's.
const CASE_BLOCK = "  ---\n  type: 'test'\n  failureType: 'testCodeFailure'\n  code: 'ERR_TEST_FAILURE'\n  ...\n";
const FILE_BLOCK = "  ---\n  failureType: 'testCodeFailure'\n  exitCode: 1\n  signal: ~\n  code: 'ERR_TEST_FAILURE'\n  ...\n";

test('Task0: the parse fails closed on TAP it cannot place', () => {
  const run = (code, tap) => classifyEvidenceRun({ code, signal: null, timedOut: false, tap, file: 'a.test.js' }).verdict;
  const summary = (pass, fail) => `1..1\n# tests 1\n# pass ${pass}\n# fail ${fail}\n`;
  // A summary that reports a failure but carries no not ok point.
  assert.strictEqual(run(1, `TAP version 13\nok 1 - a\n${summary(0, 1)}`), 'unplaceable');
  // The two synthetic blocks place as the captured shapes do.
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - a\n${CASE_BLOCK}${summary(0, 1)}`), 'reproduced');
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - a.test.js\n${FILE_BLOCK}${summary(0, 1)}`), 'load-failure');
  // A not ok point with no YAML block shows neither marker.
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - a\n${summary(0, 1)}`), 'unplaceable');
  // A run cut off before its summary (the exit1 fixture without its trailing lines).
  assert.strictEqual(run(1, tapOf('exit1').split('1..1\n')[0]), 'unplaceable');
  // A block belongs to the point on the line right before its `---`; one further down is no block.
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - a\n# note\n${CASE_BLOCK}${summary(0, 1)}`), 'unplaceable');
  // A block that never closes swallows the summary.
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - a\n${CASE_BLOCK.replace('  ...\n', '')}${summary(0, 1)}`), 'unplaceable');
  // Reproduced needs fail >= 1 in the summary.
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - a\n${CASE_BLOCK}${summary(1, 0)}`), 'unplaceable');
  // A block-scalar line indented past the block's own keys neither ends the block nor opens a point:
  // only `...` and keys at the `---` line's indent count.
  const scalar = "TAP version 13\nnot ok 1 - a.test.js\n  ---\n  failureType: 'testCodeFailure'\n  stack: |-\n    ...\n    not ok 2 - forged\n  exitCode: 1\n  ...\n";
  assert.strictEqual(run(1, scalar + summary(0, 1)), 'load-failure');
  const quoted = "TAP version 13\nnot ok 1 - a\n  ---\n  failureType: 'testCodeFailure'\n  error: |-\n    exitCode: 1\n    type: 'suite'\n  ...\n";
  assert.strictEqual(run(1, quoted + summary(0, 1)), 'reproduced');
  // A failure other than the test's own code (a hook, a cancel) is not a failed test case.
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - a\n${CASE_BLOCK.replace('testCodeFailure', 'hookFailed')}${summary(0, 1)}`), 'unplaceable');
  // A TODO point is no failure: beside a file-level point the run is a load failure. A test named
  // `a # TODO` is escaped by Node (`a \# TODO`) and stays a test case.
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - a # TODO\n${CASE_BLOCK}not ok 2 - a.test.js\n${FILE_BLOCK}${summary(0, 1)}`), 'load-failure');
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - a \\# TODO\n${CASE_BLOCK}${summary(0, 1)}`), 'reproduced');
  // A suite whose own body threw (the captured `describe` throw shape) is not a test case.
  const suiteBlock = CASE_BLOCK.replace("type: 'test'", "type: 'suite'");
  assert.strictEqual(run(1, `TAP version 13\nnot ok 1 - widget\n${suiteBlock}not ok 2 - a.test.js\n${FILE_BLOCK}${summary(0, 1)}`), 'unplaceable');
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
      if (row.name === 'fake-tap') assertForgedLinesFolded(tap);
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

test('AC1: the reviewer launch has --restricted, no Bash, no bypass flag and no settings file', () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const args = composeArgs({ role: 'reviewer', schema: REVIEW_RESULT_SCHEMA, platform });
    assert.ok(args.includes('--restricted'), platform);
    assert.ok(!args[args.indexOf('--tools') + 1].split(',').includes('Bash'), platform);
    assert.ok(!args.some((a) => /dangerously-skip-permissions|bypassPermissions/.test(a)), platform);
    assert.ok(!args.includes('--settings'), platform);
  }
  assert.strictEqual(ROLES.reviewer.settings, false);
});

test('Task1: the reviewer result schema and the exported superviseChild', () => {
  assert.strictEqual(conformsTo(REVIEW_RESULT_SCHEMA, { findings: [] }), true);
  assert.strictEqual(conformsTo(REVIEW_RESULT_SCHEMA, {}), false);
  assert.strictEqual(conformsTo(REVIEW_RESULT_SCHEMA, { findings: {} }), false);
  assert.strictEqual(conformsTo(REVIEW_RESULT_SCHEMA, { findings: [], extra: 1 }), false);
  assert.ok(Object.isFrozen(REVIEW_RESULT_SCHEMA) && Object.isFrozen(REVIEW_RESULT_SCHEMA.properties));
  assert.strictEqual(typeof superviseChild, 'function');
});

const isReason = (r) => typeof r === 'string' && r.trim() !== '';

test('AC13: reviewRequired', () => {
  const issue = (...names) => ({ labels: names.map((name) => ({ name })) });
  const keys = (n) => Array.from({ length: n }, (_, i) => `src/f${i}.js`);
  const within = keys(EXPRESS_MAX_KEY_FILES);
  const expect = (args, on) => {
    const r = reviewRequired(args);
    assert.strictEqual(r.on, on, JSON.stringify(args));
    assert.ok(isReason(r.reason), JSON.stringify(r));
  };
  for (const policyValue of ['beyond-express', undefined, 'junk']) {
    expect({ issue: issue('size:low'), keyFiles: within, policyValue }, false);
    expect({ issue: issue('size:medium'), keyFiles: within, policyValue }, true);
    expect({ issue: issue(), keyFiles: within, policyValue }, true);
    expect({ issue: issue('size:low'), keyFiles: keys(EXPRESS_MAX_KEY_FILES + 1), policyValue }, true);
    // keyFiles that are not an array count as beyond the bounds.
    expect({ issue: issue('size:low'), keyFiles: undefined, policyValue }, true);
    expect({ issue: issue('size:low'), keyFiles: 'src/a.js', policyValue }, true);
  }
  expect({ issue: issue('size:medium'), keyFiles: keys(EXPRESS_MAX_KEY_FILES + 1), policyValue: 'off' }, false);
  expect({ issue: issue('size:low'), keyFiles: within, policyValue: 'on' }, true);
});

const VALID_EVIDENCE = Object.freeze({ path: 'tests/a.test.js', content: "require('node:test')('x', () => { throw new Error('x'); });\n" });

test('AC2: finding shape', () => {
  const valid = { path: 'src/a.js', line: 3, claim: 'Adds the wrong total.', evidence: { ...VALID_EVIDENCE } };
  assert.strictEqual(findingShapeViolation(valid), null);
  const { line: _line, ...missingLine } = valid;
  class Finding {}
  const bad = {
    'missing key': missingLine,
    'extra key': { ...valid, extra: 1 },
    'line 0': { ...valid, line: 0 },
    'line 1.5': { ...valid, line: 1.5 },
    "line '3'": { ...valid, line: '3' },
    'line past safe integers': { ...valid, line: Number.MAX_SAFE_INTEGER + 1 },
    'path not a string': { ...valid, path: 5 },
    'empty claim': { ...valid, claim: '' },
    'blank claim': { ...valid, claim: '   ' },
    'claim with \\n': { ...valid, claim: 'Adds.\nAlso subtracts.' },
    'claim with \\r': { ...valid, claim: 'Adds.\rAlso subtracts.' },
    'claim not a string': { ...valid, claim: ['x'] },
    'evidence a string': { ...valid, evidence: 'tests/a.test.js' },
    'evidence null': { ...valid, evidence: null },
    'evidence an array': { ...valid, evidence: [] },
    'finding null': null,
    "finding 'x'": 'x',
    'finding []': [],
    'finding a class instance': Object.assign(new Finding(), valid),
  };
  for (const [name, f] of Object.entries(bad)) assert.ok(isReason(findingShapeViolation(f)), name);
});

test('AC3: evidence shape', () => {
  const { path: p, content } = VALID_EVIDENCE;
  assert.strictEqual(evidenceShapeViolation({ path: p, content }), null);
  const bad = [
    { command: 'touch marker' }, { cmd: 'x', path: p, content }, 'tests/a.test.js', { path: p },
    { path: p, content, run: 'x' }, { path: 5, content }, { path: p, content: 5 }, null, [], { content },
  ];
  for (const e of bad) assert.ok(isReason(evidenceShapeViolation(e)), JSON.stringify(e));
});

// Path rules run against a fake file system: `types` maps a worktree-relative path to its lstatType
// answer (the worktree itself is a directory; anything unlisted is missing), and `real` overrides
// canonicalRealpath (an existing path otherwise resolves to itself, a missing one to null).
const WT = path.resolve('/wt');
const at = (rel) => path.join(WT, ...rel.split('/'));
function pathOpts({ types = {}, real = {}, sensitivePaths = [] } = {}) {
  const typeOf = new Map([[WT, 'directory'], ...Object.entries(types).map(([rel, t]) => [at(rel), t])]);
  const realOf = new Map(Object.entries(real).map(([rel, r]) => [rel === '' ? WT : at(rel), r]));
  return {
    wt: WT,
    sensitivePaths,
    deps: {
      lstatType: (p) => ({ type: typeOf.get(p) || 'missing', code: null }),
      canonicalRealpath: (p) => (realOf.has(p) ? realOf.get(p) : (typeOf.has(p) ? p : null)),
    },
  };
}

const testPathOfLength = (n) => `tests/${'a'.repeat(n - 'tests/'.length - '.test.js'.length)}.test.js`;

// One row per PATH_RULES entry; each input trips that rule and no other, so dropping the rule
// turns its row (and only its row) red. The one declared exception: the length guards inside
// not-test-path and the parent walk (they keep each rule linear when called directly) refuse every
// over-length path too.
const PATH_RULE_ROWS = [
  { rule: 'empty-or-too-long', input: testPathOfLength(EVIDENCE_PATH_MAX_CHARS + 1), alsoTrips: ['not-test-path', 'parent-escapes'] },
  { rule: 'absolute-or-scheme', input: '/abs/a.test.js' },
  { rule: 'backslash', input: 'tests\\a.test.js' },
  { rule: 'percent-encoded', input: 'tests/%2e%2e/a.test.js' },
  { rule: 'dot-segment-or-not-normal', input: 'tests/../a.test.js' },
  { rule: 'trailing-slash', input: 'tests/' },
  { rule: 'flag-shaped', input: '-a.test.js' },
  { rule: 'git-segment', input: '.git/info/a.test.js' },
  { rule: 'win32-alias', input: 'tests/a.test.js:x.test.js' },
  { rule: 'reserved-char', input: 'tests/a\x1b[31m.test.js' },
  { rule: 'node-modules-segment', input: 'tests/node_modules/a.test.js' },
  { rule: 'not-test-path', input: 'src/contest.js' },
  // A case variant of a protected name that does not exist yet.
  { rule: 'protected-or-sensitive', input: '.GITHUB/test/a.test.js' },
  { rule: 'exists', input: 'tests/a.test.js', fs: { types: { tests: 'directory', 'tests/a.test.js': 'file' } } },
  { rule: 'parent-escapes', input: 'tests/link/a.test.js', fs: { types: { tests: 'directory', 'tests/link': 'symlink' } } },
  // In-tree symlinks: tests/g -> ../.git and tests/link -> ../hooks, each with an existing subdirectory.
  { rule: 'canonical-reserved-segment', input: 'tests/g/info/a.test.js', fs: { types: { tests: 'directory', 'tests/g': 'symlink', 'tests/g/info': 'directory' }, real: { 'tests/g/info': at('.git/info') } } },
  { rule: 'canonical-protected-or-sensitive', input: 'tests/link/sub/a.test.js', fs: { types: { tests: 'directory', 'tests/link': 'symlink', 'tests/link/sub': 'directory' }, real: { 'tests/link/sub': at('hooks/sub') } } },
];

test('AC4: each path rule refuses its own case', async (t) => {
  for (const row of PATH_RULE_ROWS) {
    await t.test(row.rule, () => {
      const opts = pathOpts(row.fs);
      const tripped = PATH_RULES.filter((r) => r.test(row.input, opts)).map((r) => r.name);
      // Its own rule trips, and no rule outside the row's declared exceptions does.
      assert.ok(tripped.includes(row.rule), `${JSON.stringify(row.input)} trips ${tripped}`);
      const allowed = [row.rule, ...(row.alsoTrips || [])];
      assert.deepStrictEqual(tripped.filter((n) => !allowed.includes(n)), [], JSON.stringify(row.input));
      assert.strictEqual(pathRuleViolation(row.input, opts), row.rule);
    });
  }
  assert.strictEqual(pathRuleViolation('tests/new/a.test.js', pathOpts()), null);
  assert.strictEqual(pathRuleViolation(testPathOfLength(EVIDENCE_PATH_MAX_CHARS), pathOpts()), null);
});

test('AC4: PATH_RULES is frozen, ordered, and names each rule once', () => {
  assert.ok(Object.isFrozen(PATH_RULES) && PATH_RULES.every(Object.isFrozen));
  assert.deepStrictEqual(PATH_RULES.map((r) => r.name), PATH_RULE_ROWS.map((r) => r.rule));
});

test('AC4: every listed shape is refused by the first rule it trips', () => {
  const rows = [
    ['', 'empty-or-too-long'],
    [5, 'empty-or-too-long'],
    ['C:/a.test.js', 'absolute-or-scheme'],
    ['c:\\a.test.js', 'absolute-or-scheme'],
    ['file:///a.test.js', 'absolute-or-scheme'],
    ['FILE:a.test.js', 'absolute-or-scheme'],
    ['https://x/a.test.js', 'absolute-or-scheme'],
    ['tests%2Fa.test.js', 'percent-encoded'],
    ['tests/%2E%2E/a.test.js', 'percent-encoded'],
    ['tests%5ca.test.js', 'percent-encoded'],
    ['tests/./a.test.js', 'dot-segment-or-not-normal'],
    ['./tests/a.test.js', 'dot-segment-or-not-normal'],
    ['tests//a.test.js', 'dot-segment-or-not-normal'],
    ['tests/a/..', 'dot-segment-or-not-normal'],
    ['src/latest/widget.js', 'not-test-path'],
    ['skills/test/a.md', 'not-test-path'],
    ['x/.GIT/a.test.js', 'git-segment'],
    // Windows aliases and devices (git's core.protectNTFS shapes).
    ['tests/a.test.js::$DATA', 'win32-alias'],
    ['git~1/test/a.test.js', 'win32-alias'],
    ['GITHUB~1/test/a.test.js', 'win32-alias'],
    ['.git./info/test/a.test.js', 'win32-alias'],
    ['.git /x.test.js', 'win32-alias'],
    ['tests/a.test.js ', 'win32-alias'],
    ['tests/a.test.js.', 'win32-alias'],
    ['tests/con.test.js', 'win32-alias'],
    ['tests/nul', 'win32-alias'],
    ['tests/LPT¹.test.js', 'win32-alias'],
    ['tests/COM9', 'win32-alias'],
    // Control characters, DEL and the characters Windows forbids in a name.
    ...['\n', '\r', '\t', '\x00', '\x7f', '<', '>', '"', '|', '?', '*'].map((c) => [`tests/a${c}b.test.js`, 'reserved-char']),
    ['tests/Node_Modules/a.test.js', 'node-modules-segment'],
    // Protected names, in any letter case.
    ['hooks/a.test.js', 'protected-or-sensitive'],
    ['.github/x.test.js', 'protected-or-sensitive'],
    ['.claude/HOOKS/test/a.test.js', 'protected-or-sensitive'],
    ['tests/Package.json', 'protected-or-sensitive'],
    ['tests/CodeOwners', 'protected-or-sensitive'],
  ];
  for (const [input, rule] of rows) assert.strictEqual(pathRuleViolation(input, pathOpts()), rule, JSON.stringify(input));
  // Names that only look reserved.
  for (const input of ['tests/console.test.js', 'tests/a~b.test.js', 'tests/nullable.test.js', 'tests/.gitkeep.test.js']) {
    assert.strictEqual(pathRuleViolation(input, pathOpts()), null, input);
  }
  // A configured merge-sensitive glob in any letter case, and a sensitive-path setting that is not a
  // list of strings (fails closed).
  assert.strictEqual(pathRuleViolation('secure/a.test.js', pathOpts({ sensitivePaths: ['secure/**'] })), 'protected-or-sensitive');
  assert.strictEqual(pathRuleViolation('SECURE/a.test.js', pathOpts({ sensitivePaths: ['secure/**'] })), 'protected-or-sensitive');
  assert.strictEqual(pathRuleViolation('secure/a.test.js', pathOpts({ sensitivePaths: ['Secure/**'] })), 'protected-or-sensitive');
  assert.strictEqual(pathRuleViolation('secure/a.test.js', pathOpts()), null);
  assert.strictEqual(pathRuleViolation('tests/a.test.js', { ...pathOpts(), sensitivePaths: 'secure/**' }), 'protected-or-sensitive');
  assert.strictEqual(pathRuleViolation('tests/a.test.js', { ...pathOpts(), sensitivePaths: [5] }), 'protected-or-sensitive');
  // An existing leaf of any kind (a dangling symlink lstats as a symlink).
  for (const type of ['file', 'directory', 'symlink', 'unreadable', 'other']) {
    const opts = pathOpts({ types: { tests: 'directory', 'tests/a.test.js': type } });
    assert.strictEqual(pathRuleViolation('tests/a.test.js', opts), 'exists', type);
  }
});

test('AC4: the resolved parent must stay inside the worktree', () => {
  const file = 'tests/sub/a.test.js';
  const verdict = (fs, p = file) => pathRuleViolation(p, pathOpts(fs));
  // The parent is a symlink.
  assert.strictEqual(verdict({ types: { tests: 'directory', 'tests/sub': 'symlink' } }), 'parent-escapes');
  // The parent is a directory that resolves outside the worktree.
  assert.strictEqual(verdict({ types: { tests: 'directory', 'tests/sub': 'directory' }, real: { 'tests/sub': path.resolve('/elsewhere/sub') } }), 'parent-escapes');
  // The parent, or the worktree itself, does not resolve.
  assert.strictEqual(verdict({ types: { tests: 'directory', 'tests/sub': 'directory' }, real: { 'tests/sub': null } }), 'parent-escapes');
  assert.strictEqual(verdict({ types: { tests: 'directory', 'tests/sub': 'directory' }, real: { '': null } }), 'parent-escapes');
  // The nearest existing ancestor is not a directory.
  assert.strictEqual(verdict({ types: { tests: 'file' } }), 'parent-escapes');
  assert.strictEqual(verdict({ types: { tests: 'unreadable' } }), 'parent-escapes');
  // Containment compares canonical forms: a worktree whose real path differs.
  const realWt = path.resolve('/private/wt');
  assert.strictEqual(verdict({ types: { tests: 'directory', 'tests/sub': 'directory' }, real: { '': realWt, 'tests/sub': path.join(realWt, 'tests', 'sub') } }), null);
  assert.strictEqual(verdict({ types: { tests: 'directory', 'tests/sub': 'directory' }, real: { '': realWt } }), 'parent-escapes');
  // A missing parent whose nearest existing ancestor is inside, and a file at the worktree root.
  assert.strictEqual(verdict({ types: { tests: 'directory' } }, 'tests/new/deeper/a.test.js'), null);
  assert.strictEqual(verdict({}, 'tests/new/a.test.js'), null);
  assert.strictEqual(verdict({}, 'a.test.js'), null);
  // A symlinked worktree root: the walk compares against the canonical worktree, not the link.
  const linkedRoot = { types: { '': 'symlink', tests: 'directory' }, real: { '': realWt, tests: path.join(realWt, 'tests') } };
  assert.strictEqual(verdict(linkedRoot, 'tests/a.test.js'), null);
  assert.strictEqual(verdict(linkedRoot, 'tests/new/a.test.js'), null);
  assert.strictEqual(verdict(linkedRoot, 'a.test.js'), null);
  assert.strictEqual(verdict({ ...linkedRoot, real: { '': realWt } }, 'tests/a.test.js'), 'parent-escapes');
});

const ruleNamed = (name) => PATH_RULES.find((r) => r.name === name);

test('AC4: the canonical form is judged again', () => {
  const canonicalProtected = ruleNamed('canonical-protected-or-sensitive');
  const canonicalReserved = ruleNamed('canonical-reserved-segment');
  // An 8.3 alias of an existing directory: refused lexically, and its expanded form is protected.
  const shortName = pathOpts({ types: { 'GITHUB~1': 'directory', 'GITHUB~1/test': 'directory' }, real: { 'GITHUB~1/test': at('.github/test') } });
  assert.strictEqual(pathRuleViolation('GITHUB~1/test/a.test.js', shortName), 'win32-alias');
  assert.strictEqual(canonicalProtected.test('GITHUB~1/test/a.test.js', shortName), true);
  // A case variant of an existing directory: refused lexically, and its on-disk form is protected.
  const caseVariant = pathOpts({ types: { '.GitHub': 'directory', '.GitHub/test': 'directory' }, real: { '.GitHub/test': at('.github/test') } });
  assert.strictEqual(pathRuleViolation('.GitHub/test/a.test.js', caseVariant), 'protected-or-sensitive');
  assert.strictEqual(canonicalProtected.test('.GitHub/test/a.test.js', caseVariant), true);
  // In-tree symlinks into node_modules and into a configured merge-sensitive directory.
  const intoModules = pathOpts({ types: { tests: 'directory', 'tests/nm': 'symlink', 'tests/nm/pkg': 'directory' }, real: { 'tests/nm/pkg': at('node_modules/pkg') } });
  assert.strictEqual(pathRuleViolation('tests/nm/pkg/a.test.js', intoModules), 'canonical-reserved-segment');
  const intoSecure = pathOpts({ types: { tests: 'directory', 'tests/s': 'symlink', 'tests/s/x': 'directory' }, real: { 'tests/s/x': at('Secure/x') }, sensitivePaths: ['secure/**'] });
  assert.strictEqual(pathRuleViolation('tests/s/x/a.test.js', intoSecure), 'canonical-protected-or-sensitive');
  // An in-tree symlink to a harmless directory, and an unresolvable path, trip neither canonical rule.
  const harmless = pathOpts({ types: { tests: 'directory', 'tests/l': 'symlink', 'tests/l/x': 'directory' }, real: { 'tests/l/x': at('fixtures/x') } });
  assert.strictEqual(pathRuleViolation('tests/l/x/a.test.js', harmless), null);
  const unresolved = pathOpts({ types: { tests: 'directory', 'tests/l': 'symlink' } });
  assert.strictEqual(canonicalProtected.test('tests/l/a.test.js', unresolved), false);
  assert.strictEqual(canonicalReserved.test('tests/l/a.test.js', unresolved), false);
});

test('AC4: the rules fail closed without options and stay linear past the length bound', () => {
  assert.strictEqual(pathRuleViolation('tests/a.test.js'), 'exists');
  assert.strictEqual(pathRuleViolation('tests/a.test.js', {}), 'exists');
  assert.strictEqual(pathRuleViolation('tests/a.test.js', { deps: pathOpts().deps }), 'exists');
  assert.strictEqual(ruleNamed('parent-escapes').test('tests/a.test.js', {}), true);
  // not-test-path refuses an over-length path on its own, without reaching isTestPath.
  assert.strictEqual(ruleNamed('not-test-path').test(testPathOfLength(EVIDENCE_PATH_MAX_CHARS + 1), pathOpts()), true);
  assert.strictEqual(ruleNamed('not-test-path').test(testPathOfLength(EVIDENCE_PATH_MAX_CHARS), pathOpts()), false);
  // The parent walk likewise refuses an over-length path before walking it.
  assert.strictEqual(ruleNamed('parent-escapes').test(testPathOfLength(EVIDENCE_PATH_MAX_CHARS + 1), pathOpts()), true);
  assert.strictEqual(ruleNamed('parent-escapes').test(testPathOfLength(EVIDENCE_PATH_MAX_CHARS), pathOpts()), false);
});

test('AC5: content rules at the edge', () => {
  const max = EVIDENCE_CONTENT_MAX_BYTES;
  for (const c of ['', 5, null, undefined, 'a'.repeat(max + 1), 'é'.repeat(max / 2) + 'a', 'é'.repeat(max / 2 + 1)]) {
    assert.ok(isReason(contentViolation(c)), typeof c === 'string' ? `${c.length} chars` : String(c));
  }
  assert.strictEqual(contentViolation('a'.repeat(max)), null);
  assert.strictEqual(Buffer.byteLength('é'.repeat(max / 2), 'utf8'), max);
  assert.strictEqual(contentViolation('é'.repeat(max / 2)), null);
});

test('AC5: named bounds', () => {
  assert.strictEqual(EVIDENCE_PATH_MAX_CHARS, 200);
  assert.strictEqual(EVIDENCE_CONTENT_MAX_BYTES, 65536);
  assert.strictEqual(MAX_FINDINGS, 5);
  assert.strictEqual(EVENT_TEXT_MAX_CHARS, 200);
  const wallClock = POLICY_KEYS.find((k) => k.key === 'express-driver-wall-clock-minutes');
  assert.ok(Number.isSafeInteger(wallClock.min) && wallClock.min >= 1);
  assert.ok(EVIDENCE_RUN_TIMEOUT_MS < 60000 * wallClock.min);
});
