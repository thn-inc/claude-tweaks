// tests/windows-regression-file-issue.test.js — tools/windows-regression/file-issue.js (#3316).
// In-process via run(argv, deps); the fake gh records calls and returns canned
// output or throws, so nothing here reaches GitHub.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { run, findMergedPr } = require('../tools/windows-regression/file-issue');

const SHA = 'abcdef1234567';
const RUN_URL = 'https://github.com/o/r/actions/runs/42';
const PULLS = [
  { number: 7, merged_at: null, html_url: 'u7' },
  { number: 9, merged_at: '2026-10-17T00:00:00Z', html_url: 'https://github.com/o/r/pull/9' },
];
const FAIL_ATTRIBUTABLE = { eligible: true, verdict: 'fail', attributable: ['tests/a.test.js'] };

// gh: { api, 'issue list', 'issue create', 'issue comment': <stdout string | Error> },
// keyed by the first one or two args. `files` serves any other readFile path
// (e.g. --log); an Error value throws. An unkeyed `issue list` is an empty list.
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
      const h = args[0] === 'issue' ? gh[`issue ${args[1]}`] : gh[args[0]];
      if (h instanceof Error) throw h;
      if (h === undefined) return args[1] === 'list' ? '[]' : 'https://github.com/o/r/issues/1\n';
      return h;
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
  const deps = fakeDeps({ pass: false, baselineAdjudicated: { eligible: true, verdict: 'pass', attributable: [] } });
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
});

test('AC5.5: a non-main ref files nothing and exits 1', () => {
  const deps = fakeDeps({ pass: false, baselineAdjudicated: FAIL_ATTRIBUTABLE });
  assert.equal(run(argv({ '--ref': 'refs/heads/ci-probe/3316-planted' }), deps), 1);
  assert.equal(deps.calls.gh.length, 0);
  assert.match(deps.calls.stdout.join(''), /not filing \(main only\)/);
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
  assert.match(call.input, /baseline adjudication did not run: baseline adjudication did not run/);
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

test('unreadable report: null JSON exits 1, files nothing', () => {
  for (const report of ['null', '[]', '3']) {
    const deps = fakeDeps(report);
    assert.equal(run(argv(), deps), 1, report);
    assert.equal(deps.calls.gh.length, 0, report);
    assert.match(deps.calls.stderr.join(''), /r\.json/);
  }
  const missing = fakeDeps(undefined);
  assert.equal(run(argv(), missing), 1);
  assert.equal(missing.calls.gh.length, 0);
});

test('body over 60000 chars is truncated with a note', () => {
  const NOTE = '\n\n…(truncated — see the run\'s verify-report artifact)';
  const region = Array.from({ length: 300 }, (_, i) => `${i} ${'x'.repeat(400)}`).join('\n');
  const deps = fakeDeps({ pass: false, checks: { tests: { failingRegion: region } } });
  assert.equal(run(argv(), deps), 1);
  const body = created(deps).input;
  assert.ok(body.length <= 60000 + NOTE.length, `length ${body.length}`);
  assert.ok(body.endsWith(NOTE));
});

test('usage: a trailing bare --report exits 2', () => {
  const deps = fakeDeps({ pass: true });
  assert.equal(run([...argv({ '--report': null }), '--report'], deps), 2);
  assert.equal(run(argv({ '--repo': null }), fakeDeps({ pass: true })), 2);
  assert.equal(deps.calls.gh.length, 0);
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
    '--search', 'Windows regression in:title', '--json', 'number,title', '--limit', '50']);
});

test('F3: a not-adjudicated run comments on an open "(not adjudicated)" issue', () => {
  const list = issueList(8, 'Windows regression: tests failing after 111111111 (not adjudicated)');
  const deps = fakeDeps({ pass: false, baselineAdjudicated: { eligible: false, reason: 'x' } }, { 'issue list': list });
  assert.equal(run(argv(), deps), 1);
  assert.equal(created(deps), undefined);
  assert.equal(commented(deps).args[2], '8');
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
  const deps = fakeDeps({ pass: false, preExistingAdjudicated: { declared: ['tests/a.test.js'], matched: ['tests/a.test.js'] } });
  assert.equal(run(argv(), deps), 0);
  assert.equal(deps.calls.gh.length, 0);
  const unmatched = fakeDeps({ pass: false, preExistingAdjudicated: { declared: [], eligible: false, reason: 'no-parse' } });
  assert.equal(run(argv(), unmatched), 1);
});

test('findMergedPr picks the merged entry and returns null when none merged', () => {
  assert.deepEqual(findMergedPr(PULLS), { number: 9, url: 'https://github.com/o/r/pull/9' });
  assert.equal(findMergedPr([PULLS[0]]), null);
  assert.equal(findMergedPr([]), null);
});

// Workflow shape — .github/workflows/windows-regression.yml, read as text (no YAML
// parser dependency). The workflow itself only runs on a Windows runner.
const WORKFLOW = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'windows-regression.yml'), 'utf8');

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

// The text of one top-level job block (from "  name:" to the next top-level job).
const jobBlock = (name) => {
  const start = WORKFLOW.search(new RegExp(`^  ${name}:\\s*$`, 'm'));
  assert.ok(start !== -1, `job ${name} present`);
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.search(/^  [a-z][\w-]*:\s*$/m);
  return next === -1 ? WORKFLOW.slice(start) : WORKFLOW.slice(start, start + 1 + next);
};

test('F4: the filer runs in a separate ubuntu job after windows, if: always() on the job', () => {
  const windows = jobBlock('windows');
  const file = jobBlock('file');
  assert.ok(!windows.includes('file-issue.js'), 'windows job does not run the filer');
  assert.ok(file.includes('file-issue.js'), 'file job runs the filer');
  assert.match(file, /runs-on:\s*ubuntu-latest/);
  assert.match(file, /needs:\s*windows/);
  assert.match(file, /^    if:\s*always\(\)\s*$/m, 'if: always() on the job itself');
  assert.match(windows, /runs-on:\s*windows-latest/);
  assert.match(windows, /id: verify[\s\S]*continue-on-error:\s*true/);
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
  assert.match(windows, /upload-artifact@v4[\s\S]*name: verify-report/);
  const dlAt = file.indexOf('download-artifact@v4');
  const download = file.slice(dlAt, file.indexOf('\n      - ', dlAt));
  assert.ok(dlAt !== -1 && /name: verify-report/.test(download) && /continue-on-error:\s*true/.test(download), 'download step tolerates a missing artifact');
  assert.match(file, /--report "\$RUNNER_TEMP\/verify\/verify-report\.json"/);
  assert.match(file, /--log "\$RUNNER_TEMP\/verify\/verify-logs\/tests\.log"/);
  assert.match(file, /BASE_SHA:\s*\$\{\{\s*needs\.windows\.outputs\.base\s*\}\}/);
  assert.match(file, /--base "\$BASE_SHA"/);
  assert.match(windows, /outputs:\s*\n      base:\s*\$\{\{\s*steps\.base\.outputs\.base\s*\}\}/);
});

test('F2: verify compares against "$BASE"; the base step reads PUSH_BEFORE and falls back to HEAD^1', () => {
  const windows = jobBlock('windows');
  assert.match(windows, /--baseline "\$BASE"/);
  assert.doesNotMatch(windows, /--baseline HEAD\^1/);
  const stepAt = windows.indexOf('id: base');
  assert.ok(stepAt !== -1 && stepAt < windows.indexOf('id: verify'), 'base step precedes verify');
  const step = windows.slice(stepAt, windows.indexOf('id: verify'));
  assert.match(step, /PUSH_BEFORE:\s*\$\{\{\s*github\.event\.before\s*\}\}/);
  assert.match(step, /\$PUSH_BEFORE/);
  assert.match(step, /git rev-parse HEAD\^1/);
  assert.match(step, /git cat-file -e/);
  assert.match(step, /GITHUB_ENV/);
  assert.match(step, /GITHUB_OUTPUT/);
  assert.doesNotMatch(windows, /run:[^\n]*\$\{\{/, 'no ${{ }} interpolated into a run: script');
});

test('M3: verify bounds the tests check with a 45-minute --cmd-timeout', () => {
  assert.match(jobBlock('windows'), /--cmd-timeout tests=2700000/);
});

test('the workflow no longer claims linear history', () => {
  assert.doesNotMatch(WORKFLOW, /squashed|linear history/i);
});
