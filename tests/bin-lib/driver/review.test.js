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
  EVIDENCE_RUN_TIMEOUT_MS, EVENT_TEXT_MAX_CHARS, runEvidence, writeEvidence, removeEvidence, treeDelta, isIgnored,
} = require(path.join(LIB, 'driver', 'review.js'));
const { lstatType, canonicalRealpath } = require(path.join(LIB, 'path-guard'));
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

const ruleNamed = (name) => PATH_RULES.find((r) => r.name === name);
const testPathOfLength = (n) => `tests/${'a'.repeat(n - 'tests/'.length - '.test.js'.length)}.test.js`;

// One row per PATH_RULES entry; each input trips that rule and no other, so dropping the rule
// turns its row (and only its row) red. The one declared exception: the length guards inside
// not-test-path and the parent walk (they keep each rule linear when called directly) refuse every
// over-length path too.
const PATH_RULE_ROWS = [
  { rule: 'empty-or-too-long', input: testPathOfLength(EVIDENCE_PATH_MAX_CHARS + 1), alsoTrips: ['not-test-path', 'parent-escapes'] },
  // `ſ` folds to `s` on APFS: `hookſ/` is `hooks/`.
  { rule: 'non-ascii', input: 'hookſ/a.test.js' },
  { rule: 'absolute-or-scheme', input: '/abs/a.test.js' },
  { rule: 'backslash', input: 'tests\\a.test.js' },
  { rule: 'percent-encoded', input: 'tests/%2e%2e/a.test.js' },
  { rule: 'dot-segment-or-not-normal', input: 'tests/../a.test.js' },
  { rule: 'trailing-slash', input: 'tests/' },
  { rule: 'flag-shaped', input: '-a.test.js' },
  { rule: 'git-segment', input: '.git/info/a.test.js' },
  { rule: 'win32-alias', input: 'tests/a.test.js:x.test.js' },
  // A printable reserved character: control characters and DEL trip non-ascii first.
  { rule: 'reserved-char', input: 'tests/a?.test.js' },
  { rule: 'node-modules-segment', input: 'tests/node_modules/a.test.js' },
  { rule: 'not-test-path', input: 'src/contest.js' },
  // A case variant of a protected name that does not exist yet.
  { rule: 'protected-or-sensitive', input: '.GITHUB/test/a.test.js' },
  { rule: 'exists', input: 'tests/a.test.js', fs: { types: { tests: 'directory', 'tests/a.test.js': 'file' } } },
  { rule: 'parent-escapes', input: 'tests/link/a.test.js', fs: { types: { tests: 'directory', 'tests/link': 'symlink' } } },
  // In-tree symlinks, each with an existing subdirectory: tests/g/info -> .git/info; tests/l/sub ->
  // src/sub (the file lands at src/sub/widget.js, no test path); tests/l/x -> skills, with the
  // missing middle segment `_shared` kept in the rebuilt path (skills/_shared/a.test.js).
  { rule: 'canonical-reserved-segment', input: 'tests/g/info/a.test.js', fs: { types: { tests: 'directory', 'tests/g': 'symlink', 'tests/g/info': 'directory' }, real: { 'tests/g/info': at('.git/info') } } },
  { rule: 'canonical-not-test-path', input: 'tests/l/sub/widget.js', fs: { types: { tests: 'directory', 'tests/l': 'symlink', 'tests/l/sub': 'directory' }, real: { 'tests/l/sub': at('src/sub') } } },
  { rule: 'canonical-protected-or-sensitive', input: 'tests/l/x/_shared/a.test.js', fs: { types: { tests: 'directory', 'tests/l': 'symlink', 'tests/l/x': 'directory' }, real: { 'tests/l/x': at('skills') } } },
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
    ['tests/COM9', 'win32-alias'],
    // A device name followed by spaces then an extension, and CONIN$ / CONOUT$ (git's is_valid_win32_path).
    ['tests/nul .test.js', 'win32-alias'],
    ['tests/con  .test.js', 'win32-alias'],
    ['tests/com1 .test.js', 'win32-alias'],
    ['tests/conin$.test.js', 'win32-alias'],
    ['tests/CONOUT$', 'win32-alias'],
    // Anything outside printable ASCII: Unicode that folds on APFS, a lone surrogate, the superscript
    // device digits, control characters and DEL.
    ['tests/node_moduleſ/a.test.js', 'non-ascii'],
    ['tests/Keep.test.js', 'non-ascii'],
    ['tests/a\ud800.test.js', 'non-ascii'],
    ['tests/café.test.js', 'non-ascii'],
    ['tests/LPT¹.test.js', 'non-ascii'],
    ...['\n', '\r', '\t', '\x00', '\x1b', '\x7f'].map((c) => [`tests/a${c}b.test.js`, 'non-ascii']),
    // The printable characters Windows forbids in a name.
    ...['<', '>', '"', '|', '?', '*'].map((c) => [`tests/a${c}b.test.js`, 'reserved-char']),
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
  for (const input of ['tests/console.test.js', 'tests/console .test.js', 'tests/conin.test.js', 'tests/a~b.test.js', 'tests/nullable.test.js', 'tests/.gitkeep.test.js']) {
    assert.strictEqual(pathRuleViolation(input, pathOpts()), null, input);
  }
  // The arms non-ascii shadows still hold when their rule is called on its own.
  for (const c of ['\n', '\x00', '\x7f']) assert.strictEqual(ruleNamed('reserved-char').test(`tests/a${c}b.test.js`), true, JSON.stringify(c));
  for (const p of ['tests/LPT¹.test.js', 'tests/com³']) assert.strictEqual(ruleNamed('win32-alias').test(p), true, p);
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
  // In-tree symlinks into hooks/, into node_modules and into a configured merge-sensitive directory.
  const intoHooks = pathOpts({ types: { tests: 'directory', 'tests/link': 'symlink', 'tests/link/sub': 'directory' }, real: { 'tests/link/sub': at('hooks/sub') } });
  assert.strictEqual(pathRuleViolation('tests/link/sub/a.test.js', intoHooks), 'canonical-protected-or-sensitive');
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
  // null, or a non-object, reads as no options, for the walk and for every rule called directly.
  for (const opts of [null, 5, 'x']) {
    assert.strictEqual(pathRuleViolation('tests/a.test.js', opts), 'exists', String(opts));
    for (const rule of PATH_RULES) assert.doesNotThrow(() => rule.test('tests/a.test.js', opts), `${rule.name} ${opts}`);
  }
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

// An evidence run over fakes. The runner records every call and answers with `outcome`; with
// `hang` its child never exits until killed (by the handle's kill, or on win32 by a taskkill call
// through the same runner). `tap` is what deps.readFile returns for the destination (undefined:
// it throws). With `deaf` the hanging child survives every kill. `existing` maps a path to the type
// deps.lstatType reports for it; every other path is missing. Every call lands in `calls` in order.
const RUN_DIR = path.resolve('/run');
const DEST = path.join(RUN_DIR, 'review', 'evidence-0.tap');
const REL = 'tests/new/a.test.js';
function evidenceRig({ outcome = { code: 0 }, tap, platform = 'darwin', hang = false, deaf = false, exited, existing = {}, timers } = {}) {
  const calls = [];
  const kills = [];
  let settle = null;
  const runner = (call) => {
    calls.push({ kind: 'runner', ...call });
    if (call.file === 'taskkill') {
      if (settle && !deaf) settle({ code: 1, signal: null, stdout: '', stderr: '' });
      return { pid: 99, kill() {}, exited: Promise.resolve({ code: 0, signal: null }) };
    }
    if (hang || deaf) {
      return {
        pid: 4242,
        kill(signal) { kills.push(signal); if (settle && !deaf) settle({ code: null, signal, stdout: '', stderr: '' }); },
        exited: new Promise((resolve) => { settle = resolve; }),
      };
    }
    return { pid: 4242, kill(signal) { kills.push(signal); }, exited: exited ? exited() : Promise.resolve({ signal: null, stdout: '', stderr: '', ...outcome }) };
  };
  const deps = {
    execPath: path.resolve('/opt/node/bin/node'),
    platform,
    env: { PATH: '/bin', HOME: '/h', GH_TOKEN: 'gho_secret', Path: 'C:\\bin', SystemRoot: 'C:\\Windows' },
    timers: timers || { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (timer) => clearTimeout(timer) },
    runner,
    lstatType: (p) => { calls.push({ kind: 'lstatType', p }); return { type: Object.hasOwn(existing, p) ? existing[p] : 'missing', code: null }; },
    mkdirSync: (p, opts) => { calls.push({ kind: 'mkdirSync', args: [p, opts] }); },
    readFile: (p) => {
      calls.push({ kind: 'readFile', p });
      if (tap === undefined) throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
      return tap;
    },
  };
  const shared = { activeWorker: null, interrupted: false };
  const args = { wt: WT, rel: REL, dest: DEST, runDir: RUN_DIR, shared, testCommand: 'npm test', deps };
  return { args, deps, calls, kills, shared };
}

// One test per discard case; each fixture's frozen TAP with its recorded exit code.
const RUN_CASES = [
  { name: 'assert-fail', code: 1, verdict: 'reproduced' },
  { name: 'pass', code: 0, verdict: 'passed' },
  { name: 'no-test', code: 0, verdict: 'passed' },
  { name: 'syntax', code: 1, verdict: 'load-failure' },
  { name: 'load-throw', code: 1, verdict: 'load-failure' },
];
for (const c of RUN_CASES) {
  test(`AC7: a confirmed run needs the reproduced verdict (${c.name} -> ${c.verdict})`, async () => {
    const rig = evidenceRig({ outcome: { code: c.code }, tap: tapOf(c.name) });
    assert.deepStrictEqual(await runEvidence(rig.args), { verdict: c.verdict, timedOut: false });
    assert.deepStrictEqual(rig.calls.filter((x) => x.kind === 'readFile').map((x) => x.p), [DEST]);
  });
}

test('AC7: a confirmed run needs the reproduced verdict (an unplaceable stream)', async () => {
  const rig = evidenceRig({ outcome: { code: 1 }, tap: 'TAP version 13\ngarbage\n' });
  assert.deepStrictEqual(await runEvidence(rig.args), { verdict: 'unplaceable', timedOut: false });
});

test('AC7: a confirmed run needs the reproduced verdict (an unreadable TAP destination reads as empty)', async () => {
  const rig = evidenceRig({ outcome: { code: 1 } });
  assert.deepStrictEqual(await runEvidence(rig.args), { verdict: 'unplaceable', timedOut: false });
});

test('AC7: a confirmed run needs the reproduced verdict (a timed-out run, even with a reproduced TAP)', async () => {
  const rig = evidenceRig({ hang: true, tap: tapOf('assert-fail') });
  assert.deepStrictEqual(await runEvidence({ ...rig.args, wallClockMs: 50 }), { verdict: 'timeout', timedOut: true });
});

test('AC7: the test command is spawned without a shell, in the worktree, with the relative path as one argument', async () => {
  const rig = evidenceRig({ outcome: { code: 1 }, tap: tapOf('assert-fail') });
  await runEvidence(rig.args);
  const spawns = rig.calls.filter((x) => x.kind === 'runner');
  assert.strictEqual(spawns.length, 1);
  const [call] = spawns;
  assert.strictEqual(call.file, rig.deps.execPath);
  assert.deepStrictEqual(call.args, evidenceArgs('npm test', REL, DEST));
  assert.strictEqual(call.args.filter((a) => a === REL).length, 1);
  assert.strictEqual(call.options.cwd, WT);
  assert.ok(!Object.hasOwn(call.options, 'shell'));
  assert.ok(!Object.hasOwn(call.options.env, 'GH_TOKEN'));
  assert.strictEqual(call.options.env.GH_CONFIG_DIR, path.join(RUN_DIR, 'gh-config-empty'));
  assert.deepStrictEqual(call.options.env, { PATH: '/bin', HOME: '/h', GH_CONFIG_DIR: path.join(RUN_DIR, 'gh-config-empty') });
  assert.strictEqual(call.input, '');
  assert.strictEqual(call.platform, 'darwin');
});

test('AC7: runEvidence creates the TAP destination\'s directory before the spawn', async () => {
  const rig = evidenceRig({ outcome: { code: 0 }, tap: tapOf('pass') });
  await runEvidence(rig.args);
  const kinds = rig.calls.map((x) => x.kind);
  const first = kinds.indexOf('mkdirSync');
  assert.deepStrictEqual(rig.calls[first], { kind: 'mkdirSync', args: [path.dirname(DEST), { recursive: true }] });
  assert.ok(first < kinds.indexOf('runner'));
  // The empty gh config directory the child is pointed at exists too, before the spawn.
  const ghDir = rig.calls.findIndex((x) => x.kind === 'mkdirSync' && x.args[0] === path.join(RUN_DIR, 'gh-config-empty'));
  assert.ok(ghDir > 0 && ghDir < kinds.indexOf('runner'), JSON.stringify(rig.calls));
});

test('AC7: a run past the bound kills the child tree', async () => {
  const posix = evidenceRig({ hang: true, tap: 'TAP version 13\n' });
  assert.deepStrictEqual(await runEvidence({ ...posix.args, wallClockMs: 50 }), { verdict: 'timeout', timedOut: true });
  assert.deepStrictEqual(posix.kills, ['SIGTERM']);
  assert.strictEqual(posix.calls.filter((x) => x.kind === 'runner').length, 1);
  const win = evidenceRig({ hang: true, tap: 'TAP version 13\n', platform: 'win32' });
  assert.deepStrictEqual(await runEvidence({ ...win.args, wallClockMs: 50 }), { verdict: 'timeout', timedOut: true });
  const taskkill = win.calls.filter((x) => x.kind === 'runner' && x.file === 'taskkill');
  assert.strictEqual(taskkill.length, 1);
  assert.deepStrictEqual(taskkill[0].args, ['/T', '/F', '/PID', '4242']);
  assert.strictEqual(win.calls.find((x) => x.kind === 'runner').options.env.SystemRoot, 'C:\\Windows');
});

test('AC7: the evidence child is shared.activeWorker for exactly the run, and an interrupt yields', async () => {
  let seen = null;
  let rig = null;
  rig = evidenceRig({ tap: tapOf('assert-fail'), exited: () => Promise.resolve().then(() => { seen = rig.shared.activeWorker; return { code: 1, signal: null }; }) });
  assert.deepStrictEqual(await runEvidence(rig.args), { verdict: 'reproduced', timedOut: false });
  assert.ok(seen && seen.pid === 4242, 'the handle was not shared.activeWorker during the run');
  assert.strictEqual(rig.shared.activeWorker, null);
  // A signal during the run: no TAP is read and no verdict is given.
  const hit = evidenceRig({ tap: tapOf('assert-fail'), exited: () => Promise.resolve().then(() => { hit.shared.interrupted = 'SIGINT'; return { code: 1, signal: null }; }) });
  assert.deepStrictEqual(await runEvidence(hit.args), { verdict: 'unplaceable', interrupted: true });
  assert.strictEqual(hit.shared.activeWorker, null);
  assert.ok(!hit.calls.some((x) => x.kind === 'readFile'));
});

test('AC7: an evidence run that cannot start, or a command the rule does not cover, throws', async () => {
  const failed = evidenceRig({ exited: () => Promise.reject(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })) });
  await assert.rejects(runEvidence(failed.args), /did not start/);
  assert.strictEqual(failed.shared.activeWorker, null);
  const thrown = evidenceRig();
  thrown.deps.runner = () => { throw new Error('spawn EAGAIN'); };
  await assert.rejects(runEvidence(thrown.args), /EAGAIN/);
  assert.strictEqual(thrown.shared.activeWorker, null);
  const uncovered = evidenceRig();
  await assert.rejects(runEvidence({ ...uncovered.args, testCommand: 'pytest' }), /does not cover/);
  assert.ok(!uncovered.calls.some((x) => x.kind === 'runner'));
});

// Timers that record each armed delay and never fire on their own.
function recordingTimers() {
  const armed = [];
  return { armed, timers: { setTimeout: (fn, ms) => { armed.push(ms); return armed.length; }, clearTimeout: () => {} } };
}

test('AC5: runEvidence arms EVIDENCE_RUN_TIMEOUT_MS when no wallClockMs is passed', async () => {
  const { armed, timers } = recordingTimers();
  const rig = evidenceRig({ outcome: { code: 0 }, tap: tapOf('pass'), timers });
  assert.deepStrictEqual(await runEvidence(rig.args), { verdict: 'passed', timedOut: false });
  assert.strictEqual(armed[0], EVIDENCE_RUN_TIMEOUT_MS);
  const given = recordingTimers();
  await runEvidence({ ...evidenceRig({ outcome: { code: 0 }, tap: tapOf('pass'), timers: given.timers }).args, wallClockMs: 1234 });
  assert.strictEqual(given.armed[0], 1234);
});

test('AC7: runEvidence refuses a TAP destination that is not missing, before any mkdir or spawn', async () => {
  // Every lstatType answer but `missing`; an unreadable one cannot be shown absent, so it fails closed.
  const cases = [
    ['file', "the evidence run's TAP destination already exists"],
    ['symlink', "the evidence run's TAP destination already exists"],
    ['directory', "the evidence run's TAP destination already exists"],
    ['other', "the evidence run's TAP destination already exists"],
    ['unreadable', "the evidence run's TAP destination is unreadable"],
  ];
  for (const [type, message] of cases) {
    const rig = evidenceRig({ outcome: { code: 1 }, tap: tapOf('assert-fail'), existing: { [DEST]: type } });
    await assert.rejects(runEvidence(rig.args), { message }, type);
    assert.deepStrictEqual(rig.calls.map((x) => x.kind), ['lstatType'], type);
    assert.strictEqual(rig.calls[0].p, DEST, type);
  }
});

test('AC7: a child that survives its kill is reported as survived, not as a plain timeout', async () => {
  // Timers that fire at once: the ceiling, the grace kill and the reap deadline all elapse.
  const timers = { setTimeout: (fn) => setImmediate(fn), clearTimeout: (h) => clearImmediate(h) };
  for (const platform of ['darwin', 'win32']) {
    const rig = evidenceRig({ deaf: true, tap: tapOf('assert-fail'), timers, platform });
    const got = await runEvidence(rig.args);
    assert.deepStrictEqual(got, { verdict: 'timeout', timedOut: true, survived: true, detail: 'the evidence run did not exit after its kill' }, platform);
    assert.ok(!rig.calls.some((x) => x.kind === 'readFile'), platform);
    assert.strictEqual(rig.shared.activeWorker, null, platform);
  }
});

test('AC7: runEvidence yields to an interrupt on entry without spawning', async () => {
  const rig = evidenceRig({ outcome: { code: 1 }, tap: tapOf('assert-fail') });
  rig.shared.interrupted = 'SIGTERM';
  assert.deepStrictEqual(await runEvidence(rig.args), { verdict: 'unplaceable', interrupted: true });
  assert.deepStrictEqual(rig.calls, []);
});

// The real file system, through the path-guard primitives realDeps uses, with every write and
// removal recorded.
function fsDeps(log = []) {
  return {
    lstatType: (p) => lstatType(p),
    canonicalRealpath: (p) => canonicalRealpath(p),
    mkdirSync: (p, opts) => { log.push(['mkdirSync', p, opts]); fs.mkdirSync(p, opts); },
    writeFileExclusive: (p, s) => { log.push(['writeFileExclusive', p]); fs.writeFileSync(p, s, { flag: 'wx' }); },
    rmFile: (p) => { log.push(['rmFile', p]); fs.unlinkSync(p); },
    rmdir: (p) => { log.push(['rmdir', p]); fs.rmdirSync(p); },
  };
}
const tmpWt = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'review-wt-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  fs.mkdirSync(path.join(d, 'tests'));
  return d;
};
const CONTENT = VALID_EVIDENCE.content;

test('AC7: writeEvidence creates parents and removeEvidence takes back only what it created', (t) => {
  const wt = tmpWt(t);
  const log = [];
  const deps = fsDeps(log);
  const { abs, createdDirs } = writeEvidence({ wt, rel: 'tests/new/deep/a.test.js', content: CONTENT, sensitivePaths: [], deps });
  assert.strictEqual(abs, path.join(wt, 'tests', 'new', 'deep', 'a.test.js'));
  assert.deepStrictEqual(createdDirs, [path.join(wt, 'tests', 'new'), path.join(wt, 'tests', 'new', 'deep')]);
  assert.strictEqual(fs.readFileSync(abs, 'utf8'), CONTENT);
  // One component at a time, never recursive.
  assert.deepStrictEqual(log.filter((e) => e[0] === 'mkdirSync').map((e) => e.slice(1)), createdDirs.map((d) => [d, undefined]));
  removeEvidence({ abs, createdDirs, deps });
  assert.strictEqual(lstatType(path.join(wt, 'tests')).type, 'directory');
  assert.strictEqual(lstatType(path.join(wt, 'tests', 'new')).type, 'missing');
  // Deepest first.
  assert.deepStrictEqual(log.filter((e) => e[0] === 'rmdir').map((e) => e[1]), [...createdDirs].reverse());
  // A file at the worktree root creates no directory.
  const root = writeEvidence({ wt, rel: 'a.test.js', content: CONTENT, sensitivePaths: [], deps });
  assert.deepStrictEqual(root.createdDirs, []);
  removeEvidence({ ...root, deps });
  assert.strictEqual(lstatType(path.join(wt, 'a.test.js')).type, 'missing');
});

test('AC7: writeEvidence is create-only', (t) => {
  const wt = tmpWt(t);
  const target = path.join(wt, 'tests', 'a.test.js');
  fs.writeFileSync(target, 'original');
  // A pre-existing file is refused by the write-time path check.
  assert.throws(() => writeEvidence({ wt, rel: 'tests/a.test.js', content: CONTENT, sensitivePaths: [], deps: fsDeps() }), /exists/);
  // A file that appears after the check is refused by the exclusive create itself.
  const racing = { ...fsDeps(), lstatType: (p) => (p === target ? { type: 'missing', code: 'ENOENT' } : lstatType(p)) };
  assert.throws(() => writeEvidence({ wt, rel: 'tests/a.test.js', content: CONTENT, sensitivePaths: [], deps: racing }), { code: 'EEXIST' });
  assert.strictEqual(fs.readFileSync(target, 'utf8'), 'original');
  // The raw fs error names the path; the thrown message does not.
  assert.throws(() => writeEvidence({ wt, rel: 'tests/a.test.js', content: CONTENT, sensitivePaths: [], deps: racing }), (err) => {
    assert.strictEqual(err.message, 'evidence write failed (EEXIST)');
    assert.ok(!err.message.includes('a.test.js') && !err.message.includes(wt));
    return true;
  });
  // A failing mkdir is wrapped the same way.
  const noMkdir = { ...fsDeps(), mkdirSync: (p) => { throw Object.assign(new Error(`EACCES: permission denied, mkdir '${p}'`), { code: 'EACCES' }); } };
  assert.throws(() => writeEvidence({ wt, rel: 'tests/new/a.test.js', content: CONTENT, sensitivePaths: [], deps: noMkdir }), { message: 'evidence write failed (EACCES)', code: 'EACCES' });
});

test('AC7: writeEvidence re-checks the whole path rule chain at write time', (t) => {
  const wt = tmpWt(t);
  const log = [];
  // A rule from each part of the chain: lexical, the merge-sensitive setting, the file system.
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'review-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(wt, 'tests', 'escape'));
  const cases = [
    ['tests/../a.test.js', [], /dot-segment-or-not-normal/],
    ['secure/a.test.js', ['secure/**'], /protected-or-sensitive/],
    ['tests/escape/a.test.js', [], /parent-escapes/],
  ];
  for (const [rel, sensitivePaths, want] of cases) {
    assert.throws(() => writeEvidence({ wt, rel, content: CONTENT, sensitivePaths, deps: fsDeps(log) }), want, rel);
  }
  assert.deepStrictEqual(log, [], 'a refused path wrote or created something');
});

test('AC7: writeEvidence refuses a parent that left the worktree once created, and takes back its directories', (t) => {
  const wt = tmpWt(t);
  const log = [];
  const deep = path.join(wt, 'tests', 'new', 'deep');
  // The final parent resolves outside the worktree only once it exists (a swap after the check).
  const deps = { ...fsDeps(log), canonicalRealpath: (p) => (p === deep && lstatType(p).type === 'directory' ? path.resolve('/elsewhere/deep') : canonicalRealpath(p)) };
  assert.throws(() => writeEvidence({ wt, rel: 'tests/new/deep/a.test.js', content: CONTENT, sensitivePaths: [], deps }), /outside the worktree/);
  assert.ok(!log.some((e) => e[0] === 'writeFileExclusive'));
  assert.strictEqual(lstatType(path.join(wt, 'tests', 'new')).type, 'missing');
  assert.strictEqual(lstatType(path.join(wt, 'tests')).type, 'directory');
});

test('AC7: writeEvidence judges the real parent again once it exists', (t) => {
  const wt = tmpWt(t);
  const log = [];
  const deep = path.join(wt, 'tests', 'new', 'deep');
  // Once created, the final parent resolves inside the worktree, but under hooks/ (a swap to an
  // in-tree symlink after the check): the containment check passes, the canonical rules do not.
  const deps = {
    ...fsDeps(log),
    canonicalRealpath: (p) => (p === deep && lstatType(p).type === 'directory' ? path.join(canonicalRealpath(wt), 'hooks', 'deep') : canonicalRealpath(p)),
  };
  assert.throws(() => writeEvidence({ wt, rel: 'tests/new/deep/a.test.js', content: CONTENT, sensitivePaths: [], deps }), /once its parents exist: canonical-protected-or-sensitive/);
  assert.ok(!log.some((e) => e[0] === 'writeFileExclusive'));
  assert.strictEqual(lstatType(path.join(wt, 'tests', 'new')).type, 'missing');
});

test('AC7: removeEvidence: a non-empty directory is not a failure, any other error is', () => {
  const abs = path.join(WT, 'tests', 'new', 'a.test.js');
  const createdDirs = [path.join(WT, 'tests'), path.join(WT, 'tests', 'new')];
  const rig = (rmdirCode, rmFileCode) => {
    const log = [];
    // Errors shaped like fs's own, naming the path.
    const fail = (code, p) => { throw Object.assign(new Error(`${code}: failed, '${p}'`), { code }); };
    const deps = {
      rmFile: (p) => { log.push(['rmFile', p]); if (rmFileCode) fail(rmFileCode, p); },
      rmdir: (p) => { log.push(['rmdir', p]); if (rmdirCode && p === createdDirs[1]) fail(rmdirCode, p); },
    };
    return { log, deps };
  };
  for (const code of ['ENOTEMPTY', 'EEXIST']) {
    const { log, deps } = rig(code);
    assert.doesNotThrow(() => removeEvidence({ abs, createdDirs, deps }), code);
    assert.deepStrictEqual(log, [['rmFile', abs], ['rmdir', createdDirs[1]], ['rmdir', createdDirs[0]]], code);
  }
  assert.throws(() => removeEvidence({ abs, createdDirs, deps: rig('EACCES').deps }), { message: 'evidence remove failed (EACCES)', code: 'EACCES' });
  const noFile = rig(null, 'ENOENT');
  assert.throws(() => removeEvidence({ abs, createdDirs, deps: noFile.deps }), { message: 'evidence remove failed (ENOENT)', code: 'ENOENT' });
  assert.deepStrictEqual(noFile.log, [['rmFile', abs]]);
});

const STATUS_ARGS = ['-C', WT, '--no-optional-locks', 'status', '--porcelain', '-z', '--untracked-files=all'];
const isPipelineArtifact = (p) => p === '.claude-tweaks/pipelines' || p.startsWith('.claude-tweaks/pipelines/');
function gitAnswering(stdout) {
  const calls = [];
  return { calls, deps: { git: (args, opts) => { calls.push([args, opts]); return stdout; } } };
}

test('AC7: treeDelta', () => {
  const delta = (porcelain, expected) => {
    const { calls, deps } = gitAnswering(porcelain);
    const out = treeDelta({ wt: WT, expected: new Set(expected), deps, isRunArtifact: isPipelineArtifact });
    assert.deepStrictEqual(calls, [[STATUS_ARGS, { cwd: WT }]]);
    return out;
  };
  assert.deepStrictEqual(delta('?? a\0', ['a']), []);
  assert.deepStrictEqual(delta(' M src/x.js\0', []), ['src/x.js']);
  assert.deepStrictEqual(delta('?? a\0 M src/x.js\0', ['a']), ['src/x.js']);
  assert.deepStrictEqual(delta('?? a\0?? lock.json\0', ['a']), ['lock.json']);
  assert.deepStrictEqual(delta('?? a\0?? .claude-tweaks/pipelines/r/x\0', ['a']), []);
  assert.deepStrictEqual(delta('', ['a']), ['a']);
  // An expected file git reports as anything but untracked is not the file the driver wrote.
  assert.deepStrictEqual(delta('A  a\0', ['a']), ['a']);
  // Both sides of a rename.
  assert.deepStrictEqual(delta('?? a\0R  src/new.js\0src/old.js\0', ['a']), ['src/new.js', 'src/old.js']);
});

test('AC7: treeDelta throws when git status fails or prints a record it cannot parse', () => {
  const failing = { git: () => { throw Object.assign(new Error('git failed'), { status: 128 }); } };
  assert.throws(() => treeDelta({ wt: WT, expected: new Set(), deps: failing, isRunArtifact: isPipelineArtifact }), /git failed/);
  assert.throws(() => treeDelta({ wt: WT, expected: new Set(), deps: gitAnswering('?? \0').deps, isRunArtifact: isPipelineArtifact }), /shorter/);
});

test('AC7: isIgnored reads check-ignore\'s three answers', () => {
  const ask = (git) => {
    const calls = [];
    const deps = { git: (args, opts) => { calls.push([args, opts]); return git(); } };
    return { calls, run: () => isIgnored({ wt: WT, rel: REL, deps }) };
  };
  const exit = (status) => () => { throw Object.assign(new Error(`exit ${status}`), { status }); };
  const ignored = ask(() => '');
  assert.strictEqual(ignored.run(), true);
  assert.deepStrictEqual(ignored.calls, [[['-C', WT, 'check-ignore', '-q', '--no-index', '--', REL], { cwd: WT }]]);
  assert.strictEqual(ask(exit(1)).run(), false);
  assert.throws(ask(exit(128)).run, /exit 128/);
  // A failure with no exit status (a timeout, a missing binary) is no answer either.
  assert.throws(ask(() => { throw new Error('spawnSync git ETIMEDOUT'); }).run, /ETIMEDOUT/);
});
