'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const { run, realDeps } = require('../../../plugin/bin/release-claim');
const claimsGitCas = require('../../../plugin/bin/lib/issues/claims-git-cas');
const release = require('../../../plugin/bin/lib/release-claim/release');

const NOW = Date.parse('2026-08-16T12:00:00Z');
const RUN_DIR_NAME = '2026-08-16T100000-spec-999';
const live = (runId) => JSON.stringify({ runId, sessionId: 's', claimedAt: '2026-08-16T11:00:00.000Z', ttlHours: 72, host: 'h' });
const isGet = (a) => a[0] === 'api' && String(a[1]).startsWith('repos/acme/w/contents/claims/issue-999.json?ref=');
const isPut = (a) => a[0] === 'api' && a[1] === '--method' && a[2] === 'PUT';
const isComment = (a) => a[0] === 'issue' && a[1] === 'comment';
const isEdit = (a) => a[0] === 'issue' && a[1] === 'edit';
const isView = (a) => a[0] === 'issue' && a[1] === 'view';
// One gh call -> its step name; a label edit reports the label it removed.
function callKind(a) {
  if (isGet(a)) return 'get';
  if (isView(a)) return 'view';
  if (isPut(a)) return 'put';
  if (isComment(a)) return 'comment';
  return a[a.indexOf('--remove-label') + 1];
}

function mkRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-'));
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RUN_DIR_NAME);
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.git'));
  return runDir;
}
// The real main checkout for `root/.claude-tweaks/pipelines/<name>` — resolveTarget's
// anchoring check needs this injected as `mainRoot` in tests (the same seam
// bin/log-decision.js's own cli.test.js uses), since a synthetic fixture root never
// matches the real repo that mainCheckoutRoot(process.cwd()) would resolve to.
function rootOf(runDir) { return path.dirname(path.dirname(path.dirname(runDir))); }
function deps({
  content, putThrows, gh = true, out, mainRoot, editFailLabel, contentAfterConflict, issueState, viewThrows,
}) {
  const calls = [];
  let getCount = 0;
  const runner = (a) => {
    calls.push(a);
    if (isGet(a)) {
      getCount += 1;
      // A conflicted PUT's own safety net re-reads the blob one or more
      // times (the fallback's pre-PUT/self-write checks inside
      // claim-store.js, and releaseClaim's own post-conflict
      // re-verification) — contentAfterConflict lets a test model those
      // later reads returning something different from the FIRST read
      // (e.g. a genuine tombstone), distinct from the "nothing really
      // changed" case where every read returns the same `content`.
      const c = (getCount > 1 && contentAfterConflict !== undefined) ? contentAfterConflict : content;
      if (c === null) throw new Error('HTTP 404');
      return JSON.stringify({ content: c, sha: 'blobsha1' });
    }
    if (isView(a)) {
      if (viewThrows) throw new Error(viewThrows);
      return `${issueState || 'OPEN'}\n`;
    }
    if (isPut(a)) { if (putThrows) throw new Error(putThrows); return '{}'; }
    if (isEdit(a)) {
      const label = a[a.indexOf('--remove-label') + 1];
      if (editFailLabel && label === editFailLabel) throw new Error('HTTP 404');
      return '';
    }
    if (isComment(a)) return '';
    throw new Error('unexpected ' + a.join(' '));
  };
  return { calls, d: { runner, ghAvailable: () => gh, remoteUrl: () => 'git@github.com:acme/w.git', now: () => NOW, cwd: () => process.cwd(), mainRoot, stdout: (s) => out.push(['out', s]), stderr: (s) => out.push(['err', s]) } };
}
const streamOf = (out, kind) => out.filter((o) => o[0] === kind).map((o) => o[1]).join('');
const stderrOf = (out) => streamOf(out, 'err');
const envelope = (out) => JSON.parse(streamOf(out, 'out'));

test('happy path: read -> PUT(sha) -> comment; --remove-grants adds three label removals; bot:in-progress removed by default; exit 0; logs to decisions.md', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ content: live(RUN_DIR_NAME), out, mainRoot: rootOf(runDir) });
  const code = run(['999', '--run', runDir + '/', '--reason', 'merged: spec 999', '--link', 'https://x/1', '--remove-grants'], d);
  assert.equal(code, 0);
  assert.deepEqual(calls.map(callKind), ['get', 'put', 'comment', 'auto:build', 'auto:merge-pending', 'auto:merge', 'bot:in-progress']);
  const put = calls.find(isPut);
  assert.ok(put.includes('sha=blobsha1'), 'PUT carries the read sha');
  const env = envelope(out);
  assert.equal(env.outcome, 'released');
  assert.equal(env.runId, RUN_DIR_NAME, 'runId is basename(--run), trailing slash stripped');
  assert.equal(env.logged, true);
  assert.deepEqual(env.labelsRemoved, ['auto:build', 'auto:merge-pending', 'auto:merge', 'bot:in-progress']);
  const log = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(log, /^- AUTO \d{2}:\d{2}:\d{2} — Section E: released claim on #999 \(merged: spec 999\); link https:\/\/x\/1; labels removed: auto:build, auto:merge-pending, auto:merge, bot:in-progress\. Reversibility: high\.$/m);
});

// #1631 regression: this is the exact reported shape — a bare release call
// (no --remove-in-progress, no --remove-grants — just the minimum a caller
// composing its own release command might type) must still strip
// bot:in-progress, with labelsRemoved reflecting it in the JSON envelope.
test('#1631: a release with no label flags at all still strips bot:in-progress by default', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ content: live(RUN_DIR_NAME), out, mainRoot: rootOf(runDir) });
  const code = run(['999', '--run', runDir, '--reason', 'merged PR #1627'], d);
  assert.equal(code, 0);
  assert.deepEqual(calls.map(callKind), ['get', 'put', 'comment', 'bot:in-progress']);
  const env = envelope(out);
  assert.deepEqual(env.labelsRemoved, ['bot:in-progress']);
  assert.deepEqual(env.labelsFailed, []);
});

test('--keep-in-progress-label opts back out of the default bot:in-progress removal', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ content: live(RUN_DIR_NAME), out, mainRoot: rootOf(runDir) });
  const code = run(['999', '--run', runDir, '--reason', 'merged: spec 999', '--keep-in-progress-label'], d);
  assert.equal(code, 0);
  assert.deepEqual(calls.map(callKind), ['get', 'put', 'comment'], 'no label edit at all');
  assert.deepEqual(envelope(out).labelsRemoved, []);
});

test('--remove-in-progress and --keep-in-progress-label together are a malformed invocation: exit 2', () => {
  const runDir = mkRun();
  const out = [];
  const { d } = deps({ content: live(RUN_DIR_NAME), out });
  const code = run(['999', '--run', runDir, '--reason', 'r', '--remove-in-progress', '--keep-in-progress-label'], d);
  assert.equal(code, 2);
  assert.match(stderrOf(out), /contradictory/);
});

test('--repo owner/.. is rejected before any gh call (#1443: parseRepo accepts ".." segments)', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ content: live(RUN_DIR_NAME), out });
  const code = run(['999', '--run', runDir, '--reason', 'r', '--repo', 'owner/..'], d);
  assert.equal(code, 2);
  assert.match(stderrOf(out), /invalid --repo value/);
  assert.deepEqual(calls, []);
});

test('--repo ../evil is rejected before any gh call', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ content: live(RUN_DIR_NAME), out });
  const code = run(['999', '--run', runDir, '--reason', 'r', '--repo', '../evil'], d);
  assert.equal(code, 2);
  assert.match(stderrOf(out), /invalid --repo value/);
  assert.deepEqual(calls, []);
});

test('a failed label removal (issue edit throws) warns to stderr and logs "label removal failed"; exit unchanged', () => {
  const runDir = mkRun();
  const out = [];
  const { d } = deps({ content: live(RUN_DIR_NAME), out, mainRoot: rootOf(runDir), editFailLabel: 'auto:merge' });
  const code = run(['999', '--run', runDir, '--reason', 'merged: spec 999', '--remove-grants'], d);
  assert.equal(code, 0, 'a best-effort label failure never changes the release outcome/exit code');
  const err = stderrOf(out);
  assert.match(err, /release-claim\.js: warning — could not remove label auto:merge on #999 \(best-effort, continuing\)/);
  const log = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(log, /labels removed: auto:build, auto:merge-pending, bot:in-progress; label removal failed: auto:merge\./);
});

test('--section places the log line under the named heading; --step overrides the default "Section E"', () => {
  const runDir = mkRun();
  const out = [];
  const { d } = deps({ content: live(RUN_DIR_NAME), out, mainRoot: rootOf(runDir) });
  const code = run(['999', '--run', runDir, '--reason', 'failed: build', '--section', '/dispatch', '--step', 'Settle'], d);
  assert.equal(code, 0);
  const log = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  const lines = log.split('\n');
  assert.equal(lines[0], '## /dispatch');
  assert.match(lines[1], /^- AUTO \d{2}:\d{2}:\d{2} — Settle: released claim on #999 \(failed: build\); labels removed: bot:in-progress\. Reversibility: high\.$/);
});

// A 422/409 rejection whose re-verification shows a genuine tombstone (the
// claim really was released — by a sweep, or a duplicate release call) is
// a true already-released: comment posted, exit 3.
test('404/422 on the PUT, re-verified as a genuine tombstone: comment still posted, exit 3', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({
    content: live(RUN_DIR_NAME), contentAfterConflict: JSON.stringify({ released: true }), putThrows: 'HTTP 422 sha mismatch', out,
  });
  assert.equal(run(['999', '--run', runDir, '--reason', 'merged: spec 999'], d), 3);
  assert.equal(calls.filter(isComment).length, 1);
  assert.equal(envelope(out).outcome, 'already-released');
});

// #787 hindsight finding: a 422/409 rejection whose re-verification shows
// the SAME content (this run still holds a live claim — the rejection came
// from unrelated claims-registry activity, not a real release) must fail
// closed, not report a false already-released that strips grant labels off
// a claim that is still live and still ours.
test('404/422 on the PUT, re-verified as STILL held by this run: fails closed, exit 1, no comment', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ content: live(RUN_DIR_NAME), putThrows: 'HTTP 422 sha mismatch', out });
  assert.equal(run(['999', '--run', runDir, '--reason', 'merged: spec 999'], d), 1);
  assert.equal(calls.filter(isComment).length, 0, 'no release comment — the release did not actually happen');
  const env = envelope(out);
  assert.equal(env.outcome, 'failed');
  assert.match(env.error, /still held by this run/);
});

test('blob owned by another run: exit 4, nothing written, skip line logged', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ content: live('2026-08-16T110000-spec-999'), out, mainRoot: rootOf(runDir) });
  assert.equal(run(['999', '--run', runDir, '--reason', 'merged: spec 999', '--remove-grants'], d), 4);
  assert.equal(calls.length, 1, 'only the read');
  assert.match(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'), /skipped release of issue #999: claim held by run 2026-08-16T110000-spec-999/);
});

test('corrupt/unreadable claim blob: exit 5 (distinct from exit 4), nothing written, skip line logged', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ content: 'not json', out, mainRoot: rootOf(runDir) });
  const code = run(['999', '--run', runDir, '--reason', 'merged: spec 999'], d);
  assert.equal(code, 5);
  assert.notEqual(code, 4, 'must not be conflated with a live competing claim');
  assert.equal(calls.length, 1, 'only the read');
  assert.equal(envelope(out).outcome, 'unreadable');
  assert.match(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'), /skipped release of issue #999: claim blob is corrupt\/unreadable/);
});

test('failed PUT (500): exit 1, no comment, FAILED line still logged; missing run dir still releases (logged:false, warning)', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ content: live(RUN_DIR_NAME), putThrows: 'HTTP 500', out, mainRoot: rootOf(runDir) });
  assert.equal(run(['999', '--run', runDir, '--reason', 'r'], d), 1);
  assert.equal(calls.filter(isComment).length, 0);
  const log = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  // writeTombstone's ghApi now classifies the raw PUT error (#787 hindsight
  // finding — see release.test.js) rather than letting it escape unclassified
  // with `.conflict` unset; an unrecognized status collapses to the same
  // generic 'network-failure' claim-store.js's own defaultGhApi already uses
  // for any other unclassified gh failure.
  assert.match(log, /^- AUTO \d{2}:\d{2}:\d{2} — Section E: release of #999 FAILED \(r\): network-failure\. Reversibility: n\/a\.$/m);
  const out2 = [];
  const { d: d2 } = deps({ content: live(RUN_DIR_NAME), out: out2 });
  // Same basename (so the ownership check still matches) under a directory that does not exist.
  assert.equal(run(['999', '--run', path.join(os.tmpdir(), 'rc-none-' + process.pid, RUN_DIR_NAME), '--reason', 'r'], d2), 0);
  assert.equal(envelope(out2).logged, false);
  assert.match(stderrOf(out2), /decisions\.md not written/);

  // A run dir that exists but sits under a worktree-local shadow (a linked
  // worktree's `.git` is a FILE, not a directory) must be refused, never
  // silently written to — [IL-127].
  const shadowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-shadow-'));
  const wt = path.join(shadowRoot, '.claude', 'worktrees', 'wt');
  const shadowRunDir = path.join(wt, '.claude-tweaks', 'pipelines', RUN_DIR_NAME);
  fs.mkdirSync(shadowRunDir, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ../../../.git/worktrees/wt\n');
  const out3 = [];
  const { d: d3 } = deps({ content: live(RUN_DIR_NAME), out: out3 });
  assert.equal(run(['999', '--run', shadowRunDir, '--reason', 'r'], d3), 0);
  assert.equal(envelope(out3).logged, false);
  assert.match(stderrOf(out3), /not anchored/);
  assert.equal(fs.existsSync(path.join(shadowRunDir, 'decisions.md')), false);
});

// Wiring, not behavior: every test above injects its own deps, so a dropped
// `gitRunner` in realDeps would leave this whole suite green while the real
// CLI silently fell back to the contents-API transport #787 moved off.
test('realDeps wires the real git-CAS runner and the real gh runner', () => {
  assert.equal(realDeps.gitRunner, claimsGitCas.defaultRunner, 'gitRunner is claims-git-cas.js\'s defaultRunner export');
  assert.equal(realDeps.runner, release.defaultRunner, 'runner is release.js\'s defaultRunner export');
});

// The middle link of the same chain: `realDeps` holds the real git-CAS runner (test
// above) and `releaseClaim` forwards a `gitRunner` on to claim-store (release.test.js) —
// but neither notices if the CLI's own call site stops passing it. Deleting
// `gitRunner: deps.gitRunner` from that call leaves every other test in the repo green
// while production releases silently drop back to the contents-API transport.
test('run() forwards deps.gitRunner into the release.releaseClaim call', (t) => {
  const runDir = mkRun();
  const out = [];
  const { d } = deps({ content: live(RUN_DIR_NAME), out, mainRoot: rootOf(runDir) });
  const sentinelGitRunner = () => { throw new Error('sentinel gitRunner must never be invoked in this test'); };
  d.gitRunner = sentinelGitRunner;
  const spy = t.mock.method(release, 'releaseClaim', () => ({
    outcome: 'released', calls: ['read', 'put', 'comment'], commentPosted: true,
    labelsRemoved: [], labelsFailed: [], note: null,
  }));
  assert.equal(run(['999', '--run', runDir, '--reason', 'merged: spec 999'], d), 0);
  assert.equal(spy.mock.calls.length, 1, 'the CLI made exactly one releaseClaim call');
  const arg = spy.mock.calls[0].arguments[0];
  assert.equal(arg.gitRunner, sentinelGitRunner, 'the call carries deps.gitRunner by reference — not undefined, not some other function');
  assert.equal(arg.runner, d.runner, 'and deps.runner alongside it');
});

test('malformed invocation / gh absent exit 2 with the MCP fallback named; --help exits 0', () => {
  const runDir = mkRun();
  const out = [];
  const { d } = deps({ content: live(RUN_DIR_NAME), out });
  assert.equal(run(['--run', runDir, '--reason', 'r'], d), 2, 'issue missing');
  assert.match(stderrOf(out), /<issue> is required/);
  assert.equal(run(['abc', '--run', runDir, '--reason', 'r'], d), 2, 'issue not a number');
  assert.equal(run(['999', '--reason', 'r'], d), 2, '--run missing');
  assert.equal(run(['999', '--run', runDir], d), 2, '--reason missing');
  const { d: noGh } = deps({ content: live(RUN_DIR_NAME), gh: false, out });
  assert.equal(run(['999', '--run', runDir, '--reason', 'r'], noGh), 2);
  assert.match(stderrOf(out), /github-write-transport\.md/);
  const help = [];
  const { d: h } = deps({ content: null, out: help });
  assert.equal(run(['--help'], h), 0);
  assert.match(help[0][1], /usage: release-claim\.js/);
});

// ---- #2090: --sweep -------------------------------------------------------

test('#2090: --sweep with a --reason not prefixed "swept:" exits 2 before any gh call', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ content: live('someone-else'), out });
  const code = run(['999', '--run', runDir, '--reason', 'merged: spec 999', '--sweep'], d);
  assert.equal(code, 2);
  assert.match(stderrOf(out), /--sweep requires --reason to start with "swept:"/);
  assert.deepEqual(calls, [], 'no gh call at all — rejected before repo resolution or the issue-state query');
});

// A stale foreign claim: --sweep queries the issue's open/closed state
// exactly once and passes it through as `sweep.issueClosed` — here OPEN, so
// (per release.js) the sweep still proceeds since a 'stale' claim is
// unconditionally sweepable; the state query itself is the thing under test.
test('#2090: --sweep queries issue state once and threads it through; the sweep tombstone names the original holder', () => {
  const HOLDER = '2026-08-10T090000-spec-1';
  const staleForeign = JSON.stringify({
    runId: HOLDER, sessionId: 's', claimedAt: '2026-08-12T12:00:00.000Z', ttlHours: 72, host: 'h',
  });
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({
    content: staleForeign, issueState: 'OPEN', out, mainRoot: rootOf(runDir),
  });
  const code = run(['999', '--run', runDir, '--reason', 'swept: stale claim', '--sweep'], d);
  assert.equal(code, 0);
  assert.equal(calls.filter(isView).length, 1, 'exactly one issue-state query');
  assert.deepEqual(calls.map(callKind).filter((k) => k !== 'view'), ['get', 'put', 'comment', 'bot:in-progress']);
  const env = envelope(out);
  assert.equal(env.outcome, 'released');
  assert.equal(env.sweep, true);
  assert.equal(env.sweptFrom, HOLDER);
  const log = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(log, new RegExp(`swept from run ${HOLDER}`), "the decisions.md line names the original holder");
});

// A LIVE foreign claim: --sweep must resolve the issue's real state and only
// proceed when it reads CLOSED — never assume, and never sweep a live claim
// on an issue that's still open.
test('#2090: --sweep on a LIVE foreign claim releases only when the issue reads CLOSED', () => {
  const HOLDER = '2026-08-16T113000-spec-2';
  const runDirOpen = mkRun();
  const outOpen = [];
  const { calls: callsOpen, d: dOpen } = deps({ content: live(HOLDER), issueState: 'OPEN', out: outOpen });
  const codeOpen = run(['999', '--run', runDirOpen, '--reason', 'swept: issue closed', '--sweep'], dOpen);
  assert.equal(codeOpen, 4, 'skipped-not-owner — a live claim on an open issue is never swept');
  assert.deepEqual(callsOpen.filter(isPut), []);

  const runDirClosed = mkRun();
  const outClosed = [];
  const { calls: callsClosed, d: dClosed } = deps({
    content: live(HOLDER), issueState: 'CLOSED', out: outClosed, mainRoot: rootOf(runDirClosed),
  });
  const codeClosed = run(['999', '--run', runDirClosed, '--reason', 'swept: issue closed', '--sweep'], dClosed);
  assert.equal(codeClosed, 0);
  assert.ok(callsClosed.some(isPut), 'the PUT proceeds once the issue is confirmed closed');
  assert.equal(envelope(outClosed).sweptFrom, HOLDER);
});

// A failed issue-state read must abort the release rather than assume
// closed — sweeping a live claim on an issue whose state couldn't be
// confirmed risks breaking a claim that is, in fact, still legitimately in
// progress on an open issue.
test('#2090: a failed issue-state read aborts the sweep rather than assuming closed', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ content: live('someone-else'), out, viewThrows: 'HTTP 500' });
  const code = run(['999', '--run', runDir, '--reason', 'swept: issue closed', '--sweep'], d);
  assert.equal(code, 1);
  assert.match(stderrOf(out), /could not resolve #999's open\/closed state/);
  assert.deepEqual(calls.filter(isPut), [], 'no release attempted without a confirmed issue state');
});

// Without --sweep, the flag and its state query never fire at all —
// byte-identical to pre-#2090 behavior.
test('#2090: without --sweep, no issue-state query is ever made', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ content: live(RUN_DIR_NAME), out, mainRoot: rootOf(runDir) });
  const code = run(['999', '--run', runDir, '--reason', 'merged: spec 999'], d);
  assert.equal(code, 0);
  assert.equal(calls.filter(isView).length, 0);
  assert.equal(envelope(out).sweep, false);
  assert.equal(envelope(out).sweptFrom, null);
});

// Conformance: `/tidy` Step 4.7's Release action must name the CLI's
// --sweep flag literally, so the executor can never drift back to prose
// describing the write instead of invoking it (#2090).
test('#2090 conformance: scan-procedures.md names the --sweep invocation as the Release executor', () => {
  const scanProcedures = fs.readFileSync(path.join(REPO_ROOT, 'plugin', 'skills', 'tidy', 'scan-procedures.md'), 'utf8');
  assert.match(scanProcedures, /release-claim\.js"\s+<n>\s+--run\s+<tidy-run-dir>\s+--sweep\s+--reason/, 'Step 4.7 must invoke release-claim.js --sweep literally, not describe the write in prose');
  const actionsGithubIssues = fs.readFileSync(path.join(REPO_ROOT, 'plugin', 'skills', 'tidy', 'actions-github-issues.md'), 'utf8');
  assert.match(actionsGithubIssues, /## Release claim/, 'actions-github-issues.md must name a Release claim action for the [claim] Release rows');
  assert.match(actionsGithubIssues, /--sweep/);
});
