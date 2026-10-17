// tests/windows-regression-file-issue.test.js — tools/windows-regression/file-issue.js (#3316).
// In-process via run(argv, deps); the fake gh records calls and returns canned
// output or throws, so nothing here reaches GitHub.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run, findMergedPr } = require('../tools/windows-regression/file-issue');

const SHA = 'abcdef1234567';
const RUN_URL = 'https://github.com/o/r/actions/runs/42';
const PULLS = [
  { number: 7, merged_at: null, html_url: 'u7' },
  { number: 9, merged_at: '2026-10-17T00:00:00Z', html_url: 'https://github.com/o/r/pull/9' },
];
const FAIL_ATTRIBUTABLE = { eligible: true, verdict: 'fail', attributable: ['tests/a.test.js'] };

// gh: { api: <stdout string | Error>, issue: <stdout string | Error> }, keyed by args[0].
function fakeDeps(report, gh = {}) {
  const calls = { gh: [], stdout: [], stderr: [] };
  const raw = typeof report === 'string' ? report : JSON.stringify(report);
  return {
    calls,
    readFile: () => { if (report === undefined) throw new Error('ENOENT'); return raw; },
    gh: (args, input) => {
      calls.gh.push({ args, input });
      const h = gh[args[0]];
      if (h instanceof Error) throw h;
      return h === undefined ? 'https://github.com/o/r/issues/1\n' : h;
    },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
  };
}
const argv = (over = {}) => {
  const f = { '--report': 'r.json', '--ref': 'refs/heads/main', '--sha': SHA, '--repo': 'o/r', '--run-url': RUN_URL, ...over };
  return Object.entries(f).flatMap(([k, v]) => (v === null ? [] : [k, v]));
};
const created = (deps) => deps.calls.gh.find((c) => c.args[0] === 'issue');
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
  const deps = fakeDeps({ pass: false, baselineAdjudicated: FAIL_ATTRIBUTABLE }, { issue: new Error('HTTP 403') });
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

test('excerpt matches a backslash-absolute TAP location', () => {
  const location = "  location: 'D:\\a\\repo\\repo\\tests\\bin-lib\\wrap-up\\ledger-write.test.js:27:3'";
  const deps = fakeDeps({
    pass: false,
    baselineAdjudicated: { eligible: true, verdict: 'fail', attributable: ['tests/bin-lib/wrap-up/ledger-write.test.js'] },
    checks: { tests: { failingRegion: `not ok 1 - other\n${location}\n  failureType: 'x'` } },
  });
  assert.equal(run(argv(), deps), 1);
  assert.ok(created(deps).input.includes(`\`\`\`\n${location}\n`), 'location line opens a fenced excerpt');
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

test('findMergedPr picks the merged entry and returns null when none merged', () => {
  assert.deepEqual(findMergedPr(PULLS), { number: 9, url: 'https://github.com/o/r/pull/9' });
  assert.equal(findMergedPr([PULLS[0]]), null);
  assert.equal(findMergedPr([]), null);
});

// Workflow shape — .github/workflows/windows-regression.yml, read as text (no YAML
// parser dependency). The workflow itself only runs on a Windows runner.
const fs = require('node:fs');
const path = require('node:path');
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

test('the filer step runs under if: always() after the verify step', () => {
  const verifyAt = WORKFLOW.indexOf('id: verify');
  const filerAt = WORKFLOW.indexOf('file-issue.js');
  assert.ok(verifyAt !== -1 && filerAt !== -1, 'both steps present');
  assert.ok(verifyAt < filerAt, 'verify step precedes the filer step');
  assert.ok(WORKFLOW.slice(verifyAt, filerAt).includes('if: always()'));
  // The upload step between them also carries if: always(), so pin the filer step's own.
  const filerStepAt = WORKFLOW.lastIndexOf('\n      - ', filerAt);
  assert.ok(WORKFLOW.slice(filerStepAt, filerAt).includes('if: always()'), 'the filer step has its own if: always()');
});
