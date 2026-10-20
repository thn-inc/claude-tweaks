// tests/windows-regression-file-issue.test.js — tools/windows-regression/file-issue.js (#3316).
// In-process via run(argv, deps); the fake gh records calls and returns canned
// output or throws, so nothing here reaches GitHub.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { run, findMergedPr, classify } = require('../tools/windows-regression/file-issue');
const { readText } = require('./helpers/read-skill');

const SHA = 'abcdef1234567';
const RUN_URL = 'https://github.com/o/r/actions/runs/42';
const PULLS = [
  { number: 7, merged_at: null, html_url: 'u7' },
  { number: 9, merged_at: '2026-10-17T00:00:00Z', html_url: 'https://github.com/o/r/pull/9' },
];
const FAIL_ATTRIBUTABLE = { eligible: true, verdict: 'fail', attributable: ['tests/a.test.js'] };

// gh: { api, 'issue list', 'issue create', 'issue comment': <stdout string | Error> },
// keyed by the first one or two args; a function value is called with the args and
// its result used the same way. `files` serves any other readFile path
// (e.g. --log); an Error value throws. An unkeyed call gets an explicit default
// (empty list / the issue URL / empty comment / empty api list); any other call throws.
const GH_DEFAULTS = { 'issue list': '[]', 'issue create': 'https://github.com/o/r/issues/1\n', 'issue comment': '', api: '[]' };
function fakeDeps(report, gh = {}, files = {}) {
  const calls = { gh: [], stdout: [], stderr: [], read: [] };
  const raw = typeof report === 'string' ? report : JSON.stringify(report);
  return {
    calls,
    readFile: (p) => {
      calls.read.push(p);
      if (p in files) { if (files[p] instanceof Error) throw files[p]; return files[p]; }
      if (report === undefined) throw new Error('ENOENT');
      return raw;
    },
    gh: (args, input) => {
      calls.gh.push({ args, input });
      const key = args[0] === 'issue' ? `issue ${args[1]}` : args[0];
      const h = typeof gh[key] === 'function' ? gh[key](args) : gh[key];
      if (h instanceof Error) throw h;
      if (h !== undefined) return h;
      if (key in GH_DEFAULTS) return GH_DEFAULTS[key];
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
  };
}
const argv = (over = {}) => {
  const f = { '--report': 'r.json', '--ref': 'refs/heads/main', '--sha': SHA, '--repo': 'o/r', '--run-url': RUN_URL, ...over };
  return Object.entries(f).flatMap(([k, v]) => (v === null ? [] : [k, v]));
};
const created = (deps) => deps.calls.gh.find((c) => c.args[0] === 'issue' && c.args[1] === 'create');
const commented = (deps) => deps.calls.gh.find((c) => c.args[0] === 'issue' && c.args[1] === 'comment');
const listed = (deps) => deps.calls.gh.find((c) => c.args[0] === 'issue' && c.args[1] === 'list');
const issueList = (number, title) => JSON.stringify([{ number, title }]);
const flag = (call, name) => call.args[call.args.indexOf(name) + 1];

test('AC5.1: a raw-pass report files nothing and exits 0', () => {
  const deps = fakeDeps({ pass: true });
  assert.equal(run(argv(), deps), 0);
  assert.equal(deps.calls.gh.length, 0);
});

test('AC5.2: a baseline-adjudicated pass files nothing and exits 0', () => {
  const deps = fakeDeps({ pass: false, effectivePass: true, baselineAdjudicated: { eligible: true, verdict: 'pass', attributable: [] } });
  assert.equal(run(argv(), deps), 0);
  assert.equal(deps.calls.gh.length, 0);
});

test('R1: report.effectivePass is the verdict authority — a false one beats pass: true', () => {
  const deps = fakeDeps({ pass: true, effectivePass: false, checks: { tests: { failingRegion: 'not ok 1 - x' } } });
  assert.equal(run(argv(), deps), 1);
  assert.ok(created(deps));
});

test('R1: no effectivePass (an older verify.js) fails closed — an adjudicated-pass shape is a failure', () => {
  for (const report of [
    { pass: false, baselineAdjudicated: { eligible: true, verdict: 'pass', attributable: [] } },
    { pass: false, preExistingAdjudicated: { declared: ['tests/a.test.js'], matched: ['tests/a.test.js'] } },
  ]) {
    const deps = fakeDeps(report);
    assert.equal(run(argv(), deps), 1, JSON.stringify(report));
    assert.ok(created(deps), JSON.stringify(report));
  }
});

test('R1: no effectivePass and pass: true is a pass', () => {
  const deps = fakeDeps({ pass: true });
  assert.equal(run(argv(), deps), 0);
  assert.equal(deps.calls.gh.length, 0);
});

test('AC5.3: attributable failures compose title, file list, merged PR and run URL', () => {
  const deps = fakeDeps({ pass: false, baselineAdjudicated: FAIL_ATTRIBUTABLE }, { api: JSON.stringify(PULLS) });
  assert.equal(run(argv(), deps), 1);
  const call = created(deps);
  assert.equal(flag(call, '--title'), 'Windows regression: 1 test file(s) newly failing after abcdef123');
  assert.equal(flag(call, '--label'), 'type:bug');
  assert.equal(flag(call, '--repo'), 'o/r');
  assert.match(call.input, /`tests\/a\.test\.js`/);
  assert.match(call.input, /\*\*Merged PR:\*\* #9 \(https:\/\/github\.com\/o\/r\/pull\/9\)/);
  assert.ok(call.input.includes(RUN_URL));
  assert.deepEqual(deps.calls.gh[0].args, ['api', `repos/o/r/commits/${SHA}/pulls`]);
});

test('AC5.4: a failed PR lookup composes unknown', () => {
  const deps = fakeDeps({ pass: false, baselineAdjudicated: FAIL_ATTRIBUTABLE }, { api: new Error('HTTP 502') });
  assert.equal(run(argv(), deps), 1);
  assert.match(created(deps).input, /\*\*Merged PR:\*\* unknown/);
  assert.ok(deps.calls.stderr.includes('windows-regression: merged-PR lookup failed: HTTP 502 — composing "unknown"\n'), 'the swallowed failure leaves a stderr note');
});

test('AC5.5: a non-main ref files nothing and exits 1', () => {
  const deps = fakeDeps({ pass: false, baselineAdjudicated: FAIL_ATTRIBUTABLE });
  assert.equal(run(argv({ '--ref': 'refs/heads/ci-probe/3316-planted' }), deps), 1);
  assert.equal(deps.calls.gh.length, 0);
  assert.match(deps.calls.stdout.join(''), /not filing \(main only\)/);
});

test('R6: only exactly refs/heads/main files — near-miss refs exit 1 with no gh call', () => {
  for (const ref of ['refs/heads/main-x', 'refs/heads/main/', 'refs/tags/main', 'refs/heads/MAIN', 'refs/pull/1/merge', 'main']) {
    const deps = fakeDeps({ pass: false, baselineAdjudicated: FAIL_ATTRIBUTABLE });
    assert.equal(run(argv({ '--ref': ref }), deps), 1, ref);
    assert.equal(deps.calls.gh.length, 0, ref);
  }
});

test('R6: adjudication that named no failing test file is titled not adjudicated and says why', () => {
  for (const extra of [{}, { effectivePass: false }]) {
    const deps = fakeDeps({
      pass: false, ...extra,
      baselineAdjudicated: { eligible: true, verdict: 'fail', attributable: [] },
      checks: { tests: { failingRegion: 'not ok 1 - x' } },
    });
    assert.equal(run(argv(), deps), 1);
    const call = created(deps);
    assert.match(flag(call, '--title'), /\(not adjudicated\)$/);
    assert.ok(call.input.includes('baseline adjudication named no failing test file'));
    assert.match(call.input, /not ok 1 - x/);
  }
});

test('R6: an excerpt containing a ``` run is wrapped in a longer fence and keeps the inner run', () => {
  const region = ['not ok 1 - fenced', "  location: 'tests/a.test.js:1:1'", '  ```js', '  inner', '  ```'].join('\n');
  const deps = fakeDeps({ ...adjudicated('tests/a.test.js'), checks: { tests: { failingRegion: region } } });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  assert.match(body, /^````\nnot ok 1 - fenced\n/m, 'opens with 4 backticks');
  assert.match(body, /\n  ```\n````$/m, 'the inner run survives and the 4-backtick fence closes after it');
});

test('L4: an eligible fail verdict naming no file (empty, or no string entry) is classified not adjudicated — never "0 test file(s)"', () => {
  for (const attributable of [[], [null, 42]]) {
    const report = { pass: false, baselineAdjudicated: { eligible: true, verdict: 'fail', attributable }, checks: { tests: { failingRegion: 'not ok 1 - x' } } };
    assert.deepEqual(classify(report), { outcome: 'fail', adjudicated: false, attributable: [], reason: 'baseline adjudication named no failing test file' });
    const deps = fakeDeps(report);
    assert.equal(run(argv(), deps), 1);
    assert.equal(flag(created(deps), '--title'), 'Windows regression: tests failing after abcdef123 (not adjudicated)', JSON.stringify(attributable));
  }
});

test('L4: a 5-backtick run in the failing output widens the fence past the longest run, and it closes', () => {
  const region = ['not ok 1 - x', '`', '```', '`````', 'tail'].join('\n');
  const deps = fakeDeps({ pass: false, checks: { tests: { failingRegion: region } } });
  assert.equal(run(argv(), deps), 1);
  const m = created(deps).input.match(/^(`+)\nnot ok 1 - x\n`\n```\n`````\ntail\n(`+)$/m);
  assert.ok(m, 'the fenced output is intact');
  assert.ok(m[1].length > 5, `fence of ${m[1].length} is longer than the 5-backtick run`);
  assert.equal(m[2], m[1], 'the closing fence matches the opening one');
});

test('L7: with no tests failing region, a non-adjudicated failure shows the first failed check\'s region', () => {
  const deps = fakeDeps({ pass: false, checks: {
    tests: { exitCode: 0, failingRegion: null },
    types: { exitCode: 0, failingRegion: null },
    lint: { exitCode: 1, failingRegion: 'src/x.js:1:1 error no-unused-vars' },
  } });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  assert.ok(body.includes('src/x.js:1:1 error no-unused-vars'));
  assert.ok(!body.includes('(no failing output captured)'));
  const none = fakeDeps({ pass: false, checks: { tests: { exitCode: null, failingRegion: null }, lint: { exitCode: 0, failingRegion: null } } });
  run(argv(), none);
  assert.ok(created(none).input.includes('(no failing output captured)'), 'no region anywhere still says so');
});

test('L7: the tests region wins over another failed check\'s', () => {
  const deps = fakeDeps({ pass: false, checks: {
    lint: { exitCode: 1, failingRegion: 'lint-region' },
    tests: { exitCode: 1, failingRegion: 'not ok 1 - tests-region' },
  } });
  run(argv(), deps);
  const body = created(deps).input;
  assert.ok(body.includes('tests-region'));
  assert.ok(!body.includes('lint-region'));
});

test('AC5.6: a gh issue create failure exits non-zero', () => {
  const deps = fakeDeps({ pass: false, baselineAdjudicated: FAIL_ATTRIBUTABLE }, { 'issue create': new Error('HTTP 403') });
  assert.equal(run(argv(), deps), 1);
  assert.match(deps.calls.stderr.join(''), /gh issue create failed/);
});

test('fail-closed: ineligible adjudication still files, titled not adjudicated', () => {
  const deps = fakeDeps({
    pass: false,
    baselineAdjudicated: { eligible: false, reason: 'adjudication error: boom' },
    checks: { tests: { failingRegion: 'not ok 1 - x' } },
  });
  assert.equal(run(argv(), deps), 1);
  const call = created(deps);
  assert.match(flag(call, '--title'), /\(not adjudicated\)$/);
  assert.match(call.input, /baseline adjudication did not run: adjudication error: boom/);
  assert.match(call.input, /not ok 1 - x/);
});

test('fail-closed: a failed run with no baselineAdjudicated still files', () => {
  const deps = fakeDeps({ pass: false, checks: { tests: { failingRegion: 'not ok 1 - x' } } });
  assert.equal(run(argv(), deps), 1);
  const call = created(deps);
  assert.match(flag(call, '--title'), /\(not adjudicated\)$/);
  assert.ok(call.input.includes('### Failing output (baseline adjudication did not run)\n'), 'the heading names the cause once');
  assert.ok(!call.input.includes('did not run: baseline adjudication did not run'));
  assert.match(call.input, /not ok 1 - x/);
});

// A real Windows TAP block as Node's reporter writes it: single-line YAML values go
// through inspect(), so every backslash in the location is DOUBLED in the text.
const LEDGER_FILE = 'tests/bin-lib/wrap-up/ledger-write.test.js';
const winBlock = (n, name, file, detail = 'Expected values to be strictly deep-equal:') => [
  `not ok ${n} - ${name}`,
  '  ---',
  '  duration_ms: 1.2',
  `  location: 'D:\\\\a\\\\repo\\\\repo\\\\${file.replace(/\//g, '\\\\')}:27:3'`,
  "  failureType: 'testCodeFailure'",
  '  error: |-',
  `    ${detail}`,
  '  ...',
].join('\n');
const adjudicated = (...attributable) => ({ pass: false, baselineAdjudicated: { eligible: true, verdict: 'fail', attributable } });

test('F1: excerpt matches a real inspect()-shaped Windows location and opens at its not-ok line', () => {
  const block = winBlock(3, 'writes the ledger under the run dir', LEDGER_FILE);
  assert.ok(block.includes("location: 'D:\\\\a\\\\repo\\\\repo\\\\tests\\\\bin-lib"), 'fixture has doubled backslashes');
  const deps = fakeDeps({
    ...adjudicated(LEDGER_FILE),
    checks: { tests: { failingRegion: `ok 1 - fine\n${block}\nok 4 - next` } },
  });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  assert.ok(body.includes('not ok 3 - writes the ledger under the run dir'), 'excerpt opens at the not-ok line');
  assert.ok(body.includes('Expected values to be strictly deep-equal'), 'excerpt carries the failure detail');
  assert.ok(!body.includes('ok 4 - next'), 'excerpt stops before the next test');
});

test('F1: --log is the excerpt source when readable — the block missing from a truncated failingRegion is found', () => {
  const filler = Array.from({ length: 100 }, (_, i) => `not ok ${i + 1} - noise ${i}`).join('\n');
  const deps = fakeDeps(
    { ...adjudicated(LEDGER_FILE), checks: { tests: { failingRegion: filler } } },
    {},
    { 'tests.log': `${filler}\n${winBlock(101, 'the new failure', LEDGER_FILE, 'only in the uncapped log')}\n` },
  );
  assert.equal(run(argv({ '--log': 'tests.log' }), deps), 1);
  assert.ok(deps.calls.read.includes('tests.log'));
  const body = created(deps).input;
  assert.ok(body.includes('not ok 101 - the new failure'));
  assert.ok(body.includes('only in the uncapped log'));
});

test('F1: an unreadable --log is not an error — stderr note, falls back to failingRegion', () => {
  const block = winBlock(3, 'from the region', LEDGER_FILE, 'region detail');
  const deps = fakeDeps(
    { ...adjudicated(LEDGER_FILE), checks: { tests: { failingRegion: block } } },
    {},
    { 'gone.log': new Error('ENOENT') },
  );
  assert.equal(run(argv({ '--log': 'gone.log' }), deps), 1);
  assert.match(deps.calls.stderr.join(''), /gone\.log/);
  assert.ok(created(deps).input.includes('region detail'));
});

test('F1: tests/a.test.js does not match tests/a.test.js.snap or xtests/a.test.js lines', () => {
  const region = [
    'not ok 1 - snap',
    "  location: 'D:\\\\a\\\\tests\\\\a.test.js.snap:1:1'",
    '  detail-for-snap',
    'not ok 2 - prefixed',
    "  location: 'D:\\\\a\\\\xtests\\\\a.test.js:1:1'",
    '  detail-for-prefixed',
    'not ok 3 - the real one',
    "  location: 'D:\\\\a\\\\tests\\\\a.test.js:5:5'",
    '  detail-for-real',
  ].join('\n');
  const deps = fakeDeps({ ...adjudicated('tests/a.test.js'), checks: { tests: { failingRegion: region } } });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  assert.ok(body.includes('detail-for-real'));
  assert.ok(!body.includes('detail-for-snap'));
  assert.ok(!body.includes('detail-for-prefixed'));
});

test('F1: an excerpt is capped at 12 lines and stops at the next ok line', () => {
  const lines = ['not ok 1 - long', "  location: 'tests/a.test.js:1:1'", ...Array.from({ length: 30 }, (_, i) => `  line-${i}`)];
  const deps = fakeDeps({ ...adjudicated('tests/a.test.js'), checks: { tests: { failingRegion: lines.join('\n') } } });
  run(argv(), deps);
  const body = created(deps).input;
  assert.ok(body.includes('line-9'));
  assert.ok(!body.includes('line-10'), 'cut at 12 lines (not ok + location + 10)');
});

test('F1: a file that crashes at load opens its excerpt at its own stderr, never at an earlier file\'s not-ok (run 39034279077)', () => {
  // Transcribed from the live run's tests.log: Node prints a crashed file's stderr as
  // `#` lines BEFORE that file's `# Subtest:` / whole-file `not ok` — the first line
  // naming the file is the stack, which sits after another file's failure block.
  const log = [
    winBlock(70, 'an earlier failure in another file', 'tests/apply-refine-labels.test.js', 'detail-for-other-file'),
    '# Subtest: every bracketed leaf in argument-hint appears in Input',
    'ok 83 - every bracketed leaf in argument-hint appears in Input',
    '  ---',
    '  duration_ms: 11.5205',
    "  type: 'test'",
    '  ...',
    '# node:internal/test_runner/harness:99',
    '#       throw err;',
    '# Error: docs/skill-authoring.md: no "Argument-hint mirror surfaces" heading',
    '#     at parseEnumeration (D:\\\\a\\\\repo\\\\repo\\\\tests\\\\argument-hint-mirrors.test.js:51:29)',
    '# Subtest: tests\\\\argument-hint-mirrors.test.js',
    'not ok 11 - tests\\\\argument-hint-mirrors.test.js',
  ].join('\n');
  const deps = fakeDeps({ ...adjudicated('tests/argument-hint-mirrors.test.js'), checks: { tests: { failingRegion: log } } });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  assert.ok(body.includes('no "Argument-hint mirror surfaces" heading'), 'excerpt carries the crash message');
  assert.ok(!body.includes('detail-for-other-file'), 'excerpt never opens at another file\'s failure');
  assert.ok(!body.includes('an earlier failure in another file'));
});

test('F1: a "..." or "ok 1" line inside a failure\'s own error text is not a boundary — the excerpt still opens at its not-ok', () => {
  const log = [
    'ok 1 - fine',
    'not ok 2 - the failing test',
    '  ---',
    '  error: |-',
    '    Expected values to be strictly deep-equal:',
    '    ...',
    '    ok 1 - quoted in the message',
    '    at Object.<anonymous> (D:\\\\a\\\\repo\\\\tests\\\\a.test.js:5:1)',
    '  ...',
    'ok 3 - next',
  ].join('\n');
  const deps = fakeDeps({ ...adjudicated('tests/a.test.js'), checks: { tests: { failingRegion: log } } });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  assert.ok(body.includes('not ok 2 - the failing test'), 'excerpt keeps the failing test\'s name');
  assert.ok(body.includes('at Object.<anonymous>'), 'an indented ok line inside the error text does not end the excerpt');
  assert.ok(!body.includes('ok 3 - next'), 'the next top-level test still ends it');
});

test('R3: a nested not-ok ends at its sibling at the SAME indent, not at a deeper ok line in its own error text', () => {
  const log = [
    '# Subtest: s',
    '    not ok 2 - nested failing',
    "      location: 'tests/a.test.js:5:5'",
    '      error: |-',
    '        ok 1 - quoted in the message',
    '        tail-line-of-its-own-error',
    '    not ok 3 - sibling',
    '      sibling-detail',
  ].join('\n');
  const deps = fakeDeps({ ...adjudicated('tests/a.test.js'), checks: { tests: { failingRegion: log } } });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  assert.ok(body.includes('tail-line-of-its-own-error'));
  assert.ok(!body.includes('not ok 3 - sibling'));
  assert.ok(!body.includes('sibling-detail'));
});

test('L13: a file no readable --log line names takes its excerpt from the failingRegion', () => {
  const deps = fakeDeps(
    { ...adjudicated(LEDGER_FILE), checks: { tests: { failingRegion: winBlock(3, 'only in the region', LEDGER_FILE, 'region-only detail') } } },
    {},
    { 'tests.log': 'ok 1 - unrelated\nnot ok 2 - another file\n' },
  );
  assert.equal(run(argv({ '--log': 'tests.log' }), deps), 1);
  assert.ok(deps.calls.read.includes('tests.log'));
  const body = created(deps).input;
  assert.ok(body.includes('### Failure excerpts'));
  assert.ok(body.includes('not ok 3 - only in the region'));
  assert.ok(body.includes('region-only detail'));
  assert.ok(!body.includes('another file'), 'the log, which names no file, contributes nothing');
});

// A crashed file's stderr whose nearest boundary above is `boundary`, placed
// after another file's closed failure block. The tests that follow this loop
// cover the case with no such line, where the block's own YAML terminator is
// the boundary.
const crashAfter = (boundary) => [
  winBlock(70, 'an earlier failure in another file', 'tests/apply-refine-labels.test.js', 'detail-for-other-file'),
  boundary,
  '# node:internal/test_runner/harness:99',
  '# Error: crashed at load',
  '#     at parse (D:\\\\a\\\\repo\\\\repo\\\\tests\\\\argument-hint-mirrors.test.js:51:29)',
  'not ok 11 - tests\\\\argument-hint-mirrors.test.js',
].join('\n');

for (const [name, boundary] of [['an `ok N` line', 'ok 83 - a passing test'], ['a `# Subtest:` line', '# Subtest: a passing suite']]) {
  test(`L21: a crashed file's excerpt opens on the first stderr line after ${name} boundary`, () => {
    const deps = fakeDeps({ ...adjudicated('tests/argument-hint-mirrors.test.js'), checks: { tests: { failingRegion: crashAfter(boundary) } } });
    assert.equal(run(argv(), deps), 1);
    const body = created(deps).input;
    assert.match(body, /\n```\n# node:internal\/test_runner\/harness:99\n# Error: crashed at load\n/, 'the fence opens on the first stderr line');
    assert.ok(!body.includes(boundary), 'the boundary line itself is not in the excerpt');
    assert.ok(!body.includes('detail-for-other-file'));
  });
}

test("L21: a crashed file's non-comment stderr directly after another file's closed failure block opens on the first stderr line", () => {
  const log = [
    winBlock(70, 'an earlier failure in another file', 'tests/apply-refine-labels.test.js', 'detail-for-other-file'),
    'Error: crashed at load',
    '    at parse (D:\\\\a\\\\repo\\\\repo\\\\tests\\\\argument-hint-mirrors.test.js:51:29)',
    'not ok 11 - tests\\\\argument-hint-mirrors.test.js',
  ].join('\n');
  const deps = fakeDeps({ ...adjudicated('tests/argument-hint-mirrors.test.js'), checks: { tests: { failingRegion: log } } });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  assert.match(body, /\n```\nError: crashed at load\n/, 'the fence opens on the first stderr line');
  assert.ok(!body.includes('an earlier failure in another file'), "the other test's name is not in the excerpt");
  assert.ok(!body.includes('detail-for-other-file'));
});

test("L21: a crashed file's non-comment stderr line, followed by `#` stderr naming the file, still opens on that first stderr line", () => {
  const log = [
    winBlock(70, 'an earlier failure in another file', 'tests/apply-refine-labels.test.js', 'detail-for-other-file'),
    'Error: crashed at load',
    '# node:internal/test_runner/harness:99',
    '#     at parse (D:\\\\a\\\\repo\\\\repo\\\\tests\\\\argument-hint-mirrors.test.js:51:29)',
    'not ok 11 - tests\\\\argument-hint-mirrors.test.js',
  ].join('\n');
  const deps = fakeDeps({ ...adjudicated('tests/argument-hint-mirrors.test.js'), checks: { tests: { failingRegion: log } } });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  assert.match(body, /\n```\nError: crashed at load\n/, 'the fence opens on the un-prefixed Error: line, not on the # line below it');
  assert.ok(!body.includes('an earlier failure in another file'), "the other test's name is not in the excerpt");
  assert.ok(!body.includes('detail-for-other-file'));
});

test("F1: the first line naming the file in a block's stack: key opens at that block's not-ok, not at a not-ok quoted in its error: text", () => {
  const log = [
    'ok 1 - fine',
    'not ok 2 - the real parent',
    '  ---',
    '  duration_ms: 1.2',
    "  failureType: 'testCodeFailure'",
    '  error: |-',
    '    child output follows:',
    '    not ok 1 - quoted child failure',
    '  stack: |-',
    '    at run (D:\\\\a\\\\repo\\\\tests\\\\a.test.js:5:1)',
    '  ...',
    'ok 3 - next',
  ].join('\n');
  const deps = fakeDeps({ ...adjudicated('tests/a.test.js'), checks: { tests: { failingRegion: log } } });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  assert.match(body, /\n```\nnot ok 2 - the real parent\n/, 'the fence opens at the real parent');
  assert.ok(!body.includes('ok 3 - next'));
});

test("L21: a crash's stderr after another test's not-ok with no YAML block opens at the stderr, not at that not-ok", () => {
  const log = [
    'ok 1 - fine',
    'not ok 2 - other test without a yaml block',
    '  plain-body-of-other-test',
    '# node:internal/test_runner/harness:99',
    '# Error: crashed at load',
    '#     at parse (D:\\\\a\\\\repo\\\\repo\\\\tests\\\\argument-hint-mirrors.test.js:51:29)',
    'not ok 3 - tests\\\\argument-hint-mirrors.test.js',
  ].join('\n');
  const deps = fakeDeps({ ...adjudicated('tests/argument-hint-mirrors.test.js'), checks: { tests: { failingRegion: log } } });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  assert.match(body, /\n```\n# node:internal\/test_runner\/harness:99\n# Error: crashed at load\n/, 'the fence opens on the first stderr line');
  assert.ok(!body.includes('other test without a yaml block'));
  assert.ok(!body.includes('plain-body-of-other-test'));
});

test('unreadable report on main exits 1 and files a "no verify report" issue naming the commit and run', () => {
  for (const report of ['null', '[]', '3', undefined]) {
    const deps = fakeDeps(report);
    assert.equal(run(argv(), deps), 1, String(report));
    assert.match(deps.calls.stderr.join(''), /r\.json/);
    const call = created(deps);
    assert.ok(call, `files an issue for ${String(report)}`);
    assert.equal(flag(call, '--title'), 'Windows regression: no verify report for abcdef123 (not adjudicated)');
    assert.equal(flag(call, '--label'), 'type:bug');
    assert.ok(call.input.includes(SHA) && call.input.includes(RUN_URL) && call.input.includes('r.json'));
    assert.match(call.input, /next push to `main` compares against this commit/);
  }
});

test('unreadable report on main comments on the open issue already covering the commit', () => {
  const deps = fakeDeps('null', { 'issue list': issueList(9, 'Windows regression: no verify report for abcdef123 (not adjudicated)') });
  assert.equal(run(argv(), deps), 1);
  assert.equal(created(deps), undefined);
  assert.equal(commented(deps).args[2], '9');
});

test('unreadable report on a non-main ref exits 1 with no gh call', () => {
  for (const report of ['null', undefined]) {
    const deps = fakeDeps(report);
    assert.equal(run(argv({ '--ref': 'refs/heads/ci-probe/x' }), deps), 1);
    assert.equal(deps.calls.gh.length, 0);
  }
});

const NOTE = '\n\n…(truncated — see the run\'s verify-report artifact)';

// The backtick run of a fence `text` leaves open at its end, or null — an
// independent CommonMark scan (opener: 3+ backticks; closer: a backtick-only line
// at least as long).
const unclosedFence = (text) => {
  let open = null;
  for (const line of text.split('\n')) {
    const ticks = (line.match(/^ {0,3}(`{3,})/) || [])[1];
    if (!ticks) continue;
    if (open === null) open = ticks;
    else if (line.trim() === line.trim().replace(/[^`]/g, '') && line.trim().length >= open.length) open = null;
  }
  return open;
};

test('body over 60000 chars is cut, the fence it cut inside is closed, and the note ends it', () => {
  const region = Array.from({ length: 300 }, (_, i) => `${i} ${'x'.repeat(400)}`).join('\n');
  const deps = fakeDeps({ pass: false, checks: { tests: { failingRegion: region } } });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  const uncutOutput = region.split('\n').slice(0, 200).join('\n');
  assert.ok(body.length < uncutOutput.length, `cut: ${body.length} < the ${uncutOutput.length}-char output the uncut body holds`);
  assert.ok(!body.includes('199 x'), 'the last fallback line was cut off');
  assert.ok(body.length <= 60000 + NOTE.length, `length ${body.length}`);
  assert.ok(body.endsWith(NOTE));
  assert.equal(unclosedFence(body.slice(0, -NOTE.length)), null, 'every fence that opens also closes');
  assert.ok(body.endsWith(`\n\`\`\`${NOTE}`), 'the closer sits right before the note');
});

test('truncation never splits a UTF-16 surrogate pair straddling the cap', () => {
  const probe = fakeDeps({ pass: false, checks: { tests: { failingRegion: 'MARK' } } });
  run(argv(), probe);
  const offset = created(probe).input.indexOf('MARK');
  // The emoji's high surrogate lands at index 59999, its low one at 60000.
  const region = `${'a'.repeat(60000 - 1 - offset)}😀${'b'.repeat(70000)}`;
  const deps = fakeDeps({ pass: false, checks: { tests: { failingRegion: region } } });
  assert.equal(run(argv(), deps), 1);
  assert.equal((created(probe).input.slice(0, offset) + region).charCodeAt(59999), 0xd83d, 'fixture check: uncut, the cap would split the pair');
  const body = created(deps).input;
  assert.ok(body.length <= 60000 + NOTE.length, `length ${body.length}`);
  assert.doesNotMatch(body, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/, 'no lone surrogate');
  assert.ok(!body.includes('😀'), 'the straddling pair is dropped whole');
  assert.ok(body.endsWith(`aaaa\n\`\`\`${NOTE}`), 'cut before the pair, fence closed, note last');
});

test('usage: a trailing bare --report exits 2', () => {
  const deps = fakeDeps({ pass: true });
  assert.equal(run([...argv({ '--report': null }), '--report'], deps), 2);
  assert.equal(deps.calls.gh.length, 0);
  const missingRepo = fakeDeps({ pass: true });
  assert.equal(run(argv({ '--repo': null }), missingRepo), 2);
  assert.equal(missingRepo.calls.gh.length, 0);
});

test('usage: a trailing bare --log or --base exits 2, and neither is required', () => {
  for (const f of ['--log', '--base']) {
    const deps = fakeDeps({ pass: true });
    assert.equal(run([...argv(), f], deps), 2, f);
    assert.equal(deps.calls.gh.length, 0, f);
  }
  assert.equal(run(argv(), fakeDeps({ pass: true })), 0);
});

test('F2: --base puts the comparison base in the lead line', () => {
  const deps = fakeDeps(adjudicated('tests/a.test.js'));
  assert.equal(run(argv({ '--base': '0123456789abcdef' }), deps), 1);
  assert.ok(created(deps).input.startsWith(`The post-merge Windows check failed on commit ${SHA} (compared against 012345678).`));
  const without = fakeDeps(adjudicated('tests/a.test.js'));
  run(argv(), without);
  assert.ok(created(without).input.startsWith(`The post-merge Windows check failed on commit ${SHA}.`));
});

test('F3: an open issue naming this commit gets a comment, not a second issue', () => {
  const list = issueList(5, 'Windows regression: 1 test file(s) newly failing after abcdef123');
  const deps = fakeDeps(adjudicated('tests/a.test.js'), { 'issue list': list });
  assert.equal(run(argv(), deps), 1);
  assert.equal(created(deps), undefined);
  const c = commented(deps);
  assert.deepEqual(c.args, ['issue', 'comment', '5', '--repo', 'o/r', '--body-file', '-']);
  assert.match(c.input, /`tests\/a\.test\.js`/);
  assert.match(deps.calls.stdout.join(''), /windows-regression: commented on #5 \(existing open issue\)/);
  assert.deepEqual(listed(deps).args, ['issue', 'list', '--repo', 'o/r', '--state', 'open', '--label', 'type:bug',
    '--search', 'Windows regression abcdef123 in:title', '--json', 'number,title', '--limit', '50']);
  assert.equal(deps.calls.gh.filter((c) => c.args[1] === 'list').length, 1, 'an adjudicated run lists once');
});

const SHA_SEARCH = 'Windows regression abcdef123 in:title';
const NOT_ADJUDICATED_SEARCH = 'Windows regression not adjudicated in:title';

test('F3/L12: a not-adjudicated run searches by sha first, then for an open "(not adjudicated)" issue, and comments on it', () => {
  const list = issueList(8, 'Windows regression: tests failing after 111111111 (not adjudicated)');
  const deps = fakeDeps({ pass: false, baselineAdjudicated: { eligible: false, reason: 'x' } },
    { 'issue list': (args) => (flag({ args }, '--search') === NOT_ADJUDICATED_SEARCH ? list : '[]') });
  assert.equal(run(argv(), deps), 1);
  assert.equal(created(deps), undefined);
  assert.equal(commented(deps).args[2], '8');
  assert.deepEqual(deps.calls.gh.filter((c) => c.args[1] === 'list').map((c) => c.args), [SHA_SEARCH, NOT_ADJUDICATED_SEARCH].map((search) =>
    ['issue', 'list', '--repo', 'o/r', '--state', 'open', '--label', 'type:bug', '--search', search, '--json', 'number,title', '--limit', '50']));
});

test('L12: a not-adjudicated run whose sha search hits comments there without the fallback search', () => {
  const list = issueList(5, 'Windows regression: tests failing after abcdef123 (not adjudicated)');
  const deps = fakeDeps({ pass: false, baselineAdjudicated: { eligible: false, reason: 'x' } },
    { 'issue list': (args) => (flag({ args }, '--search') === SHA_SEARCH ? list : new Error('fallback search not expected')) });
  assert.equal(run(argv(), deps), 1);
  assert.equal(commented(deps).args[2], '5');
  assert.equal(deps.calls.stderr.length, 0);
});

test('L11: an open issue that contains the sha (or the suffix) but is not titled "Windows regression: …" is never chosen', () => {
  const list = JSON.stringify([
    { number: 4, title: 'Flaky build after abcdef123' },
    { number: 6, title: 'Re: Windows regression: tests failing after 111111111 (not adjudicated)' },
  ]);
  for (const report of [adjudicated('tests/a.test.js'), { pass: false, baselineAdjudicated: { eligible: false, reason: 'x' } }]) {
    const deps = fakeDeps(report, { 'issue list': list });
    assert.equal(run(argv(), deps), 1);
    assert.equal(commented(deps), undefined, JSON.stringify(report));
    assert.ok(created(deps), JSON.stringify(report));
  }
});

test('F3: an adjudicated run does not comment on an unrelated "(not adjudicated)" issue — it creates', () => {
  const list = issueList(8, 'Windows regression: tests failing after 111111111 (not adjudicated)');
  const deps = fakeDeps(adjudicated('tests/a.test.js'), { 'issue list': list });
  assert.equal(run(argv(), deps), 1);
  assert.equal(commented(deps), undefined);
  assert.ok(created(deps));
});

test('F3: a failing or unparseable issue list falls through to create', () => {
  for (const gh of [{ 'issue list': new Error('HTTP 502') }, { 'issue list': 'not json' }, { 'issue list': '{"a":1}' }]) {
    const deps = fakeDeps(adjudicated('tests/a.test.js'), gh);
    assert.equal(run(argv(), deps), 1);
    assert.ok(created(deps), JSON.stringify(gh));
    assert.equal(commented(deps), undefined);
  }
});

test('R5: a thrown issue-list lookup leaves a stderr note and still files', () => {
  for (const [gh, msg] of [[{ 'issue list': new Error('HTTP 502') }, 'HTTP 502'], [{ 'issue list': 'not json' }, 'Unexpected token']]) {
    const deps = fakeDeps(adjudicated('tests/a.test.js'), gh);
    assert.equal(run(argv(), deps), 1);
    assert.ok(created(deps));
    assert.match(deps.calls.stderr.join(''), new RegExp(`windows-regression: open-issue lookup failed: .*${msg}.* — filing a new issue\n`));
  }
});

test('F3: a failing comment call exits 1 with a stderr note', () => {
  const list = issueList(5, 'Windows regression: x after abcdef123');
  const deps = fakeDeps(adjudicated('tests/a.test.js'), { 'issue list': list, 'issue comment': new Error('HTTP 403') });
  assert.equal(run(argv(), deps), 1);
  assert.match(deps.calls.stderr.join(''), /gh issue comment failed: HTTP 403/);
  assert.equal(created(deps), undefined);
});

test('M1: every attributable file name is listed before the excerpts, so the body cap can only drop excerpts', () => {
  const files = Array.from({ length: 15 }, (_, i) => `tests/f${i}.test.js`);
  const region = files.map((f, i) => `not ok ${i + 1} - t${i}\n  location: '${f}:1:1'\n  ${'x'.repeat(5000)}`).join('\n');
  const deps = fakeDeps({ ...adjudicated(...files), checks: { tests: { failingRegion: region } } });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  assert.ok(body.endsWith('verify-report artifact)'), 'the body was truncated');
  for (const f of files) assert.ok(body.includes(`- \`${f}\``), `${f} listed`);
  const lastBullet = body.lastIndexOf('- `tests/f14.test.js`');
  assert.ok(lastBullet < body.indexOf('```'), 'all bullets precede the first excerpt');
});

test('M2: a file in baselineAdjudicated.timedOut is annotated', () => {
  const report = adjudicated('tests/a.test.js', 'tests/b.test.js');
  report.baselineAdjudicated.timedOut = ['tests/b.test.js'];
  const deps = fakeDeps(report);
  run(argv(), deps);
  const body = created(deps).input;
  assert.ok(body.includes('- `tests/b.test.js` (timed out — no evidence)'));
  assert.ok(!body.includes('- `tests/a.test.js` (timed out'));
});

test('M4: a preExistingAdjudicated.matched allowlist match is a pass', () => {
  const deps = fakeDeps({ pass: false, effectivePass: true, preExistingAdjudicated: { declared: ['tests/a.test.js'], matched: ['tests/a.test.js'] } });
  assert.equal(run(argv(), deps), 0);
  assert.equal(deps.calls.gh.length, 0);
  const unmatched = fakeDeps({ pass: false, effectivePass: false, preExistingAdjudicated: { declared: [], eligible: false, reason: 'no-parse' } });
  assert.equal(run(argv(), unmatched), 1);
});

test('findMergedPr picks the merged entry and returns null when none merged', () => {
  assert.deepEqual(findMergedPr(PULLS), { number: 9, url: 'https://github.com/o/r/pull/9' });
  assert.equal(findMergedPr([PULLS[0]]), null);
  assert.equal(findMergedPr([]), null);
});

// Workflow shape — .github/workflows/windows-regression.yml, read as text (no YAML
// parser dependency). The workflow itself only runs on a Windows runner. Read through
// readText so a CRLF checkout parses like CI's LF one — stepAnchor's `steps:\n` match
// failed on windows-latest without it (#3407).
const WORKFLOW = readText(path.join(__dirname, '..', '.github', 'workflows', 'windows-regression.yml'));

test('AC1.1: the windows-regression workflow has no pull_request trigger', () => {
  assert.doesNotMatch(WORKFLOW, /pull_request/);
  assert.match(WORKFLOW, /push:\s*\n\s*branches:\s*\[main\]/);
});

test('AC2.1: concurrency sets cancel-in-progress: false', () => {
  assert.match(WORKFLOW, /cancel-in-progress:\s*false/);
});

test('concurrency group is keyed on github.sha so no pending run is replaced', () => {
  assert.match(WORKFLOW, /group:\s*windows-regression-\$\{\{\s*github\.sha\s*\}\}/);
});

// The "\n<indent>- " that starts each step in a job block, its indent read off the
// first item under `steps:` — so a reindented workflow keeps the same anchor and a
// deeper nested list item is never mistaken for a step.
const stepAnchor = (block) => {
  const m = block.match(/^[ \t]*steps:[ \t]*\n(?:[ \t]*(?:#.*)?\n)*([ \t]*)- /m);
  assert.ok(m, 'steps: list present');
  return `\n${m[1]}- `;
};

// The text of the single step containing `marker` (from its step line to the next step's).
const stepContaining = (block, marker) => {
  const at = block.indexOf(marker);
  assert.ok(at !== -1, `${marker} present`);
  const anchor = stepAnchor(block);
  const start = block.lastIndexOf(anchor, at) + 1;
  const end = block.indexOf(anchor, at);
  return block.slice(start, end === -1 ? undefined : end);
};

// Every `run:` script body in a workflow text: the inline value plus, for a block
// scalar (`|`, `>-`), the following lines indented deeper than the `run:` key.
const runScripts = (text) => {
  const lines = text.split('\n');
  const scripts = [];
  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)(- )?run:\s*(.*)$/);
    if (!m) return;
    const keyIndent = m[1].length + (m[2] ? 2 : 0);
    const body = [m[3]];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== '' && lines[j].search(/\S/) <= keyIndent) break;
      body.push(lines[j]);
    }
    scripts.push(body.join('\n'));
  });
  return scripts;
};

// The text of one top-level job block (from "  name:" to the next top-level job).
const jobBlock = (name) => {
  const start = WORKFLOW.search(new RegExp(`^  ${name}:\\s*$`, 'm'));
  assert.ok(start !== -1, `job ${name} present`);
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.search(/^  [a-z][\w-]*:\s*$/m);
  return next === -1 ? WORKFLOW.slice(start) : WORKFLOW.slice(start, start + 1 + next);
};

test('L10: stepContaining finds a step at any indentation and is not cut by a deeper nested list item', () => {
  const block = ['  job:', '    steps:', '    - name: one', '      with:', '        paths:', '          - a', '          - b', '      id: target', '    - name: two'].join('\n');
  assert.equal(stepContaining(block, 'id: target'), ['    - name: one', '      with:', '        paths:', '          - a', '          - b', '      id: target'].join('\n'));
});

test('F4: the filer runs in a separate ubuntu job after windows, if: always() on the job', () => {
  const windows = jobBlock('windows');
  const file = jobBlock('file');
  assert.ok(!windows.includes('file-issue.js'), 'windows job does not run the filer');
  assert.ok(file.includes('file-issue.js'), 'file job runs the filer');
  assert.match(file, /runs-on:\s*ubuntu-latest/);
  assert.match(file, /needs:\s*windows/);
  assert.match(file, /^    if:\s*always\(\)\s*$/m, 'if: always() on the job itself');
  assert.match(windows, /runs-on:\s*windows-latest/);
  assert.match(stepContaining(windows, 'id: verify'), /continue-on-error:\s*true/);
});

test('F4: issues: write is granted only to the file job; the windows job is contents: read only', () => {
  const windows = jobBlock('windows');
  const file = jobBlock('file');
  assert.match(WORKFLOW.split(/^jobs:/m)[0], /^permissions:\s*\n  contents: read\s*$/m, 'workflow-level permissions are contents: read only');
  assert.doesNotMatch(WORKFLOW.split(/^jobs:/m)[0], /issues:/);
  assert.match(windows, /permissions:\s*\n      contents: read\s*\n/);
  assert.doesNotMatch(windows, /issues:|pull-requests:/);
  assert.match(file, /issues: write/);
  assert.match(file, /pull-requests: read/);
  assert.equal(WORKFLOW.match(/issues: write/g).length, 1);
});

test('F4: the windows job uploads verify-report and the file job downloads it, tolerating a miss', () => {
  const windows = jobBlock('windows');
  const file = jobBlock('file');
  assert.match(stepContaining(windows, 'upload-artifact@v4'), /name: verify-report/);
  const dlAt = file.indexOf('download-artifact@v4');
  const download = file.slice(dlAt, file.indexOf(stepAnchor(file), dlAt));
  assert.ok(dlAt !== -1 && /name: verify-report/.test(download) && /continue-on-error:\s*true/.test(download), 'download step tolerates a missing artifact');
  assert.match(file, /--report "\$RUNNER_TEMP\/verify\/verify-report\.json"/);
  assert.match(file, /--log "\$RUNNER_TEMP\/verify\/verify-logs\/tests\.log"/);
  assert.match(file, /BASE_SHA:\s*\$\{\{\s*needs\.windows\.outputs\.base\s*\}\}/);
  assert.match(file, /--base "\$BASE_SHA"/);
  assert.match(windows, /outputs:\s*\n      base:\s*\$\{\{\s*steps\.base\.outputs\.base\s*\}\}/);
});

test('F2b: verify opts out of the base full run — nothing here reads `fixed`, and the job budget has no room for another suite (#3313)', () => {
  const windows = jobBlock('windows');
  assert.match(windows, /--baseline-cmd tests="node --test \{file\}"\s+--no-baseline-fixed/);
});

test('F2: verify compares against "$BASE"; the base step reads PUSH_BEFORE and falls back to HEAD^1', () => {
  const windows = jobBlock('windows');
  assert.match(windows, /--baseline "\$BASE"/);
  assert.doesNotMatch(windows, /--baseline HEAD\^1/);
  const stepAt = windows.indexOf('id: base');
  assert.ok(stepAt !== -1 && stepAt < windows.indexOf('id: verify'), 'base step precedes verify');
  const step = windows.slice(stepAt, windows.indexOf('id: verify'));
  assert.match(step, /PUSH_BEFORE:\s*\$\{\{\s*github\.event\.before\s*\}\}/);
  assert.match(step, /EVENT_NAME:\s*\$\{\{\s*github\.event_name\s*\}\}/);
  assert.match(step, /INTEGRATION_BRANCH:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/);
  assert.match(step, /\$PUSH_BEFORE/);
  assert.match(step, /git merge-base HEAD/);
  assert.match(step, /git rev-parse HEAD\^1/);
  assert.match(step, /git cat-file -e/);
  assert.match(step, /GITHUB_ENV/);
  assert.match(step, /GITHUB_OUTPUT/);
});

const SKIP_NO_BASH = spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0 ? false : 'bash not available';
const ZERO_SHA = '0000000000000000000000000000000000000000';
function fixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wr-base-'));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=ci', '-c', 'user.email=ci@invalid.example', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  const commit = (msg) => { git('commit', '-q', '--allow-empty', '-m', msg); return git('rev-parse', 'HEAD'); };
  git('init', '-q', '-b', 'main');
  const A = commit('A');
  git('checkout', '-q', '-b', 'feature');
  const B = commit('fix');
  commit('C');
  git('update-ref', 'refs/remotes/origin/main', A);
  return { dir, git, commit, A, B, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// Runs the literal `id: base` run body (dedented) in a fixture repo, the way the
// runner does (bash --noprofile --norc -eo pipefail), and reads back `base=`.
function runBaseStep({ repo, env }) {
  const body = runScripts(stepContaining(jobBlock('windows'), 'id: base'))[0].split('\n').slice(1);
  const indent = Math.min(...body.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  const script = body.map((l) => l.slice(indent)).join('\n');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-wr-base-out-'));
  try {
    const githubEnv = path.join(out, 'github_env.txt');
    const githubOutput = path.join(out, 'github_output.txt');
    fs.writeFileSync(githubEnv, '');
    fs.writeFileSync(githubOutput, '');
    const stdout = execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ENV: githubEnv, GITHUB_OUTPUT: githubOutput, ...env },
    });
    const base = fs.readFileSync(githubOutput, 'utf8').match(/^base=(.*)$/m);
    return { base: base ? base[1].trim() : '', stdout };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

test('AC1.1: a workflow_dispatch run on a feature branch baselines against the merge-base with origin/main, not HEAD^1', { skip: SKIP_NO_BASH }, (t) => {
  const fx = fixtureRepo();
  t.after(fx.cleanup);
  const r = runBaseStep({ repo: fx.dir, env: { EVENT_NAME: 'workflow_dispatch', PUSH_BEFORE: '', INTEGRATION_BRANCH: 'main' } });
  assert.equal(r.base, fx.A);
  assert.notEqual(r.base, fx.B);
  assert.match(r.stdout, /Comparison base: [0-9a-f]{40} \(merge-base with origin\/main\)/);
});

test('dispatch on the integration branch itself falls back to HEAD^1', { skip: SKIP_NO_BASH }, (t) => {
  const fx = fixtureRepo();
  t.after(fx.cleanup);
  fx.git('checkout', '-q', 'main');
  const M = fx.commit('M');
  fx.git('update-ref', 'refs/remotes/origin/main', M);
  const r = runBaseStep({ repo: fx.dir, env: { EVENT_NAME: 'workflow_dispatch', PUSH_BEFORE: '', INTEGRATION_BRANCH: 'main' } });
  assert.equal(r.base, fx.A);
  assert.match(r.stdout, /\(HEAD\^1 fallback\)/);
});

test('dispatch with no origin integration ref falls back to HEAD^1', { skip: SKIP_NO_BASH }, (t) => {
  const fx = fixtureRepo();
  t.after(fx.cleanup);
  const r = runBaseStep({ repo: fx.dir, env: { EVENT_NAME: 'workflow_dispatch', PUSH_BEFORE: '', INTEGRATION_BRANCH: 'nope' } });
  assert.equal(r.base, fx.B);
  assert.match(r.stdout, /HEAD\^1 fallback/);
});

test('AC2.1: a push run still baselines against github.event.before', { skip: SKIP_NO_BASH }, (t) => {
  const fx = fixtureRepo();
  t.after(fx.cleanup);
  const r = runBaseStep({ repo: fx.dir, env: { EVENT_NAME: 'push', PUSH_BEFORE: fx.A, INTEGRATION_BRANCH: 'main' } });
  assert.equal(r.base, fx.A);
  assert.match(r.stdout, /\(push event before\)/);
});

test('AC2.1: push with all-zero before falls back to HEAD^1', { skip: SKIP_NO_BASH }, (t) => {
  const fx = fixtureRepo();
  t.after(fx.cleanup);
  const r = runBaseStep({ repo: fx.dir, env: { EVENT_NAME: 'push', PUSH_BEFORE: ZERO_SHA, INTEGRATION_BRANCH: 'main' } });
  assert.equal(r.base, fx.B);
});

test('no ${{ }} is interpolated into any run: script body — inline or block scalar', () => {
  const planted = 'steps:\n  - name: x\n    run: |\n      echo "${{ github.event.head_commit.message }}"\n';
  assert.ok(runScripts(planted).some((b) => b.includes('${{')), 'negative control: the helper sees a block-scalar interpolation');
  assert.ok(runScripts('    run: echo "${{ github.sha }}"').some((b) => b.includes('${{')), 'negative control: and an inline one');
  const scripts = runScripts(WORKFLOW);
  assert.ok(scripts.length >= 4, `found the workflow's run scripts (${scripts.length})`);
  for (const body of scripts) assert.ok(!body.includes('${{'), `interpolation in a run script: ${body}`);
});

test('R7: verify bounds each tests run with a 20-minute --cmd-timeout inside the 90-minute job limit', () => {
  const windows = jobBlock('windows');
  assert.match(windows, /--cmd-timeout tests=1200000/);
  assert.doesNotMatch(windows, /2700000/);
  assert.match(windows, /^    timeout-minutes:\s*90\s*$/m);
});

test('the workflow no longer claims linear history', () => {
  assert.doesNotMatch(WORKFLOW, /squashed|linear history/i);
});
