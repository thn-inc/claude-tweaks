'use strict';
// #4849: pins plugin/bin/lib/dispatch/stuck-open-pr.js (the two pure functions behind the
// `stuck:open-pr` attention row) and plugin/bin/stuck-open-prs.js (the CLI that finds the stuck
// records in a snapshot). The CLI tests drive `run(argv, deps)` with fakes; the verdict itself is
// dispatch-resume.js's and is faked here as the JSON it prints.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stuckCandidates, stuckRow } = require('../../../plugin/bin/lib/dispatch/stuck-open-pr');
const { run, realDeps } = require('../../../plugin/bin/stuck-open-prs');
const dispatchResume = require('../../../plugin/bin/dispatch-resume');
const { resumeEligibility, refusalDetail } = require('../../../plugin/bin/lib/dispatch/resume-eligibility');
const { claimPayload, releasePayload } = require('../../../plugin/bin/lib/issues/claims');
const { findConflictingSession, findSessionOnWorktree } = require('../../../plugin/bin/lib/hooks/sibling-sessions');

const label = (...names) => names.map((name) => ({ name }));

// ---- stuckCandidates / stuckRow ----

test('stuckCandidates keeps only open, granted records with no bot:* label', () => {
  const rs = [
    { number: 1, state: 'OPEN', labels: label('auto:build') },
    { number: 2, labels: label('auto:build', 'ready') },
    { number: 3, state: 'OPEN', labels: label('ready') },
    { number: 4, state: 'OPEN', labels: label('auto:build', 'bot:in-progress') },
    { number: 5, state: 'CLOSED', labels: label('auto:build') },
  ];
  assert.deepStrictEqual(stuckCandidates(rs), [1, 2]);
});

test('stuckCandidates skips a record with no labels array rather than throwing', () => {
  assert.deepStrictEqual(stuckCandidates([{ number: 1, state: 'OPEN' }, { number: 2, labels: label('auto:build') }]), [2]);
});

test('AC3.1: an eligible verdict renders the resume remedy', () => {
  assert.deepStrictEqual(stuckRow({ number: 7, pr: 70, verdict: { eligible: true } }),
    { number: 7, pr: 70, remedy: 'run /claude-tweaks:dispatch resume #7 — restarts its stalled PR #70' });
});

test('eligible is read as a boolean true only: a truthy non-true value reads as unreadable, never the resume remedy', () => {
  assert.deepStrictEqual(stuckRow({ number: 7, pr: 70, failed: 'dispatch-resume exit 0', verdict: { eligible: 1, prNumber: 71 } }),
    { number: 7, pr: 70, remedy: "could not read #7's state (dispatch-resume exit 0) — re-run /claude-tweaks:backlog attention" });
});

const refused = (reason, over = {}) => ({
  eligible: false, reason, line: 'x', disposition: 'resume', remedy: `remedy for ${reason}`, ...over,
});

test('AC3.1: a live claim, a live sibling, no PR, or a provably live run renders no row', () => {
  for (const reason of ['live-claim', 'live-sibling', 'no-pr']) {
    assert.equal(stuckRow({ number: 7, pr: 70, verdict: refused(reason) }), null, reason);
  }
  for (const reason of ['prior-run-live', 'concurrent-resume']) {
    assert.equal(stuckRow({ number: 7, pr: 70, verdict: refused(reason, { liveRun: true }) }), null, `${reason} with liveRun`);
  }
});

test('a prior-run-live or concurrent-resume refusal without liveRun renders a row with the verdict remedy', () => {
  for (const reason of ['prior-run-live', 'concurrent-resume']) {
    const row = stuckRow({ number: 7, pr: 70, verdict: refused(reason) });
    assert.deepStrictEqual(row, { number: 7, pr: 70, remedy: `remedy for ${reason}` }, reason);
  }
});

test('liveRun is read as a boolean true only: a truthy string is not proof of a live run', () => {
  assert.notEqual(stuckRow({ number: 7, pr: 70, verdict: refused('prior-run-live', { liveRun: 'true' }) }), null);
});

test('a refused row carries the verdict remedy as is', () => {
  const remedy = 'whatever the verdict says';
  for (const disposition of ['resume', 'close-out', 'close']) {
    assert.equal(stuckRow({ number: 7, pr: 70, verdict: refused('dirty-worktree', { disposition, remedy }) }).remedy, remedy);
  }
});

test('AC5.1: a non-draft PR row, from the real verdict, names close-out and never a close instruction', () => {
  const prs = [{ url: 'u', number: 70, headRefName: 'worktree-record-7', headRefOid: 'a', body: 'claude-tweaks-run: 2026-10-30T101632-record-7\n', isDraft: false, isCrossRepository: false, closingRecords: 1 }];
  const v = resumeEligibility({ issue: 7, prs });
  const row = stuckRow({ number: 7, pr: 70, verdict: { ...v, ...refusalDetail({ issue: 7, verdict: v, prs, mainRoot: '/repo' }) } });
  assert.match(row.remedy, /\/claude-tweaks:dispatch close-out #7/);
  assert.doesNotMatch(row.remedy, /gh pr close|close PR/);
});

test('an unreadable state stays visible, never silently absent, and names the read that failed', () => {
  for (const failed of ['dispatch-resume exit 2', 'dispatch-resume exit 4', 'claim read', 'sibling session check']) {
    const row = stuckRow({ number: 7, pr: 70, failed, verdict: null });
    assert.equal(row.remedy, `could not read #7's state (${failed}) — re-run /claude-tweaks:backlog attention`);
    assert.doesNotMatch(row.remedy, /dispatch resume/, 'never points at a command that may start a real resume');
    assert.equal(row.pr, 70);
  }
});

test('the row names the verdict\'s own PR when it has one, not the linked-PR read\'s (a fork can be listed first)', () => {
  const eligible = stuckRow({ number: 7, pr: 70, verdict: { eligible: true, prNumber: 71 } });
  assert.deepStrictEqual(eligible, { number: 7, pr: 71, remedy: 'run /claude-tweaks:dispatch resume #7 — restarts its stalled PR #71' });
  assert.equal(stuckRow({ number: 7, pr: 70, failed: 'x', verdict: refused('dirty-worktree', { prNumbers: [72] }) }).pr, 72);
  // No usable PR on the verdict (several, none, or a non-integer): the linked-PR number stands.
  for (const prNumbers of [[], [72, 73], ['72'], undefined]) {
    assert.equal(stuckRow({ number: 7, pr: 70, failed: 'x', verdict: refused('dirty-worktree', { prNumbers }) }).pr, 70, JSON.stringify(prNumbers));
  }
  assert.equal(stuckRow({ number: 7, pr: 70, verdict: { eligible: true, prNumber: 'a' } }).pr, 70);
});

test('a refused verdict with no remedy string reads as unreadable, not as an empty row', () => {
  for (const remedy of [undefined, null, '']) {
    const row = stuckRow({ number: 7, pr: 70, failed: 'dispatch-resume exit 3', verdict: refused('dirty-worktree', { remedy }) });
    assert.match(row.remedy, /could not read #7's state \(dispatch-resume exit 3\)/);
  }
});

// ---- the CLI ----

const NOW = Date.parse('2026-11-02T12:00:00Z');
const MAIN = '/repo';
const RECORDS_PATH = '/tmp/records.json';
const LIVE_CLAIM = () => claimPayload({
  issueNumber: 1, runId: '2026-11-02T100000-record-1', sessionId: 's1', ttlHours: 72, host: 'h', now: NOW - 1000,
}).fileContent;
const STALE_CLAIM = () => claimPayload({
  issueNumber: 1, runId: '2026-11-02T100000-record-1', sessionId: 's1', ttlHours: 72, host: 'h', now: NOW - 100 * 3600 * 1000,
}).fileContent;
const TOMBSTONE = () => releasePayload({
  issueNumber: 1, runId: '2026-11-02T100000-record-1', reason: 'failed: plan-review-needs-human', now: NOW - 5 * 3600 * 1000,
}).tombstoneContent;

// A candidate record shaped like the session snapshot's entries (`labels: [{name}]`).
const rec = (number, over = {}) => ({
  number, state: 'OPEN', title: `Record ${number}`, createdAt: `2026-10-0${number}T08:00:00Z`, labels: label('ready', 'auto:build'), ...over,
});
const eligibleJson = (n, pr) => ({ eligible: true, issue: n, prUrl: `https://github.com/o/r/pull/${pr}`, prNumber: pr, headRefName: `worktree-dispatch-record-${n}` });
const refusedJson = (n, reason, over = {}) => ({
  eligible: false, issue: n, reason, line: 'a line', prNumbers: [], disposition: 'resume', remedy: `remedy: ${reason}`, headRefName: null, ...over,
});

// A fake world. `cfg` holds each dep's answer; `calls` records every dep touch in order.
function makeEnv(over = {}) {
  const cfg = {
    records: [rec(1), rec(2)],
    recordsText: null,
    readThrows: false,
    gh: true,
    repo: { host: 'github.com', owner: 'o', repo: 'r' },
    mainRoot: MAIN,
    linked: new Map([[1, { openPR: 10 }], [2, { openPR: null }]]),
    linkedThrows: false,
    claim: { content: null, failure: null, absent: true },
    claimThrows: false,
    sibling: null,
    siblingThrows: false,
    exact: null,
    exactThrows: false,
    verdicts: { 1: { code: 0, json: eligibleJson(1, 10) } },
    resumeThrows: false,
    ...over,
  };
  const calls = [];
  const out = [];
  const err = [];
  const deps = {
    readFile: (p) => {
      calls.push(['readFile', p]);
      if (cfg.readThrows) throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
      return cfg.recordsText !== null ? cfg.recordsText : JSON.stringify(cfg.records);
    },
    ghAvailable: () => cfg.gh,
    repo: () => {
      if (cfg.repo instanceof Error) throw cfg.repo;
      return cfg.repo;
    },
    mainRoot: () => {
      if (cfg.mainRoot instanceof Error) throw cfg.mainRoot;
      return cfg.mainRoot;
    },
    linked: (arg) => {
      calls.push(['linked', arg.numbers, arg.owner, arg.repo]);
      if (cfg.linkedThrows) throw new Error('missing linked-PR data for #1');
      return cfg.linked;
    },
    readClaim: (slug, n) => {
      calls.push(['readClaim', slug, n]);
      if (cfg.claimThrows) throw new Error('claim boom');
      return typeof cfg.claim === 'function' ? cfg.claim(n) : cfg.claim;
    },
    findSibling: (ref, opts) => {
      calls.push(['findSibling', ref, opts]);
      if (cfg.siblingThrows) throw new Error('sibling boom');
      return typeof cfg.sibling === 'function' ? cfg.sibling(ref) : cfg.sibling;
    },
    findSiblingOnWorktree: (arg, opts) => {
      calls.push(['findSiblingOnWorktree', arg, opts]);
      if (cfg.exactThrows) throw new Error('exact boom');
      return typeof cfg.exact === 'function' ? cfg.exact(arg) : cfg.exact;
    },
    resume: (n, io) => {
      calls.push(['resume', n]);
      if (cfg.resumeThrows) throw new Error('resume boom');
      const v = cfg.verdicts[n];
      if (!v) return 4;
      if (v.json !== undefined) io.stdout(`${JSON.stringify(v.json)}\n`);
      if (v.raw !== undefined) io.stdout(v.raw);
      return v.code;
    },
    now: () => NOW,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  };
  return { cfg, deps, calls, out, err, names: () => calls.map((c) => c[0]) };
}
const rows = (env) => JSON.parse(env.out.join('').trim()).rows;
// The could-not-run line: one JSON object with a `failed` key and no `rows`, so a redirected file never reads as "no rows".
const failedLine = (env) => {
  assert.equal(env.out.length, 1, 'one line on stdout');
  const parsed = JSON.parse(env.out[0]);
  assert.equal(parsed.rows, undefined);
  assert.equal(typeof parsed.failed.message, 'string');
  return parsed.failed;
};

test('AC3.1: exactly one row for the granted, unclaimed, open-PR, no-live-run record; no verdict without an open PR', () => {
  // linked: #1 -> PR 10, #2 -> null. Only #1 has a verdict read; #2 never reaches the claim or the verdict.
  const env = makeEnv();
  assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
  assert.deepStrictEqual(JSON.parse(env.out.join('').trim()), {
    rows: [{
      number: 1,
      pr: 10,
      remedy: 'run /claude-tweaks:dispatch resume #1 — restarts its stalled PR #10',
      title: 'Record 1',
      createdAt: '2026-10-01T08:00:00Z',
      labels: label('ready', 'auto:build'),
    }],
  });
  assert.equal(env.out.length, 1, 'one JSON line');
  assert.ok(env.out[0].endsWith('\n'));
  assert.deepStrictEqual(env.calls.filter((c) => c[0] === 'resume'), [['resume', 1]]);
  assert.deepStrictEqual(env.calls.filter((c) => c[0] === 'readClaim'), [['readClaim', 'o/r', 1]]);
  assert.deepStrictEqual(env.calls.find((c) => c[0] === 'linked'), ['linked', [1, 2], 'o', 'r'], 'one batched read for every candidate');
  assert.deepStrictEqual(env.err, []);
});

test('the read order per candidate is claim, token sibling, verdict, exact sibling', () => {
  // The verdict carries a head, so the exact read runs; nothing matches, so a row renders.
  const env = makeEnv({ verdicts: { 1: { code: 3, json: refusedJson(1, 'not-draft', { headRefName: 'fix/thing', prNumbers: [10] }) } } });
  assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
  assert.deepStrictEqual(env.names().filter((n) => n !== 'readFile' && n !== 'linked'), ['readClaim', 'findSibling', 'resume', 'findSiblingOnWorktree']);
  assert.deepStrictEqual(env.calls.find((c) => c[0] === 'findSibling'), ['findSibling', '#1', { cwd: MAIN }]);
  assert.deepStrictEqual(env.calls.find((c) => c[0] === 'findSiblingOnWorktree'), ['findSiblingOnWorktree', { branch: 'fix/thing' }, { cwd: MAIN }]);
  assert.equal(rows(env)[0].remedy, 'remedy: not-draft');
});

test('AC7.1: a live claim renders no row on an early-refusal path, and the verdict never runs', () => {
  // readClaim is live for #1; the resume fake would refuse not-draft with a remedy, so a row would show if the claim read were skipped.
  const env = makeEnv({ claim: { content: LIVE_CLAIM(), failure: null, absent: false }, verdicts: { 1: { code: 3, json: refusedJson(1, 'not-draft') } } });
  assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
  assert.deepStrictEqual(rows(env), []);
  assert.equal(env.names().includes('resume'), false, 'the verdict never ran');
  assert.equal(env.names().includes('findSibling'), false, 'a live claim ends the record before the sibling read');
});

test('a stale or released claim does not hide the record: the verdict decides', () => {
  for (const content of [STALE_CLAIM(), TOMBSTONE(), null]) {
    const env = makeEnv({ claim: { content, failure: null, absent: content === null } });
    assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
    assert.equal(rows(env).length, 1, String(content && content.slice(0, 20)));
  }
});

const SIBLING = { path: '/repo/.claude/worktrees/record-1', branch: 'worktree-record-1', pid: 9 };

test('AC3.1: a live sibling session renders no row on an early-refusal path', () => {
  // findSibling returns an entry for #1; the verdict refuses foreign-pr before its own sibling read, so a row would show if the hit were dropped.
  const env = makeEnv({ sibling: SIBLING, verdicts: { 1: { code: 3, json: refusedJson(1, 'foreign-pr', { headRefName: 'fix/thing' }) } } });
  assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
  assert.deepStrictEqual(rows(env), []);
  assert.equal(env.names().includes('resume'), true, 'the verdict always runs');
  assert.equal(env.names().includes('findSiblingOnWorktree'), false, 'the held hit already ended a refusal');
});

test('a sibling hit with an eligible verdict still renders the row: the verdict excluded this session\'s own lock', () => {
  // The session that dispatched the build holds its archived run's kept lock, which both CLI reads see as a sibling.
  for (const patch of [{ sibling: SIBLING }, { exact: SIBLING }, { sibling: SIBLING, exact: SIBLING }]) {
    const env = makeEnv(patch);
    assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
    assert.equal(rows(env).length, 1, JSON.stringify(Object.keys(patch)));
    assert.equal(rows(env)[0].remedy, 'run /claude-tweaks:dispatch resume #1 — restarts its stalled PR #10');
  }
});

test('a sibling hit with no verdict stays a visible row, since a failed read proves nothing', () => {
  const env = makeEnv({ sibling: SIBLING, verdicts: { 1: { code: 4 } } });
  assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
  assert.equal(rows(env)[0].remedy, "could not read #1's state (dispatch-resume exit 4) — re-run /claude-tweaks:backlog attention");
});

test('a sibling hit with a truthy non-true eligible is no eligible verdict: never the resume remedy', () => {
  const env = makeEnv({ sibling: SIBLING, verdicts: { 1: { code: 0, json: { eligible: 1, prNumber: 10 } } } });
  assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
  assert.equal(rows(env)[0].remedy, "could not read #1's state (dispatch-resume exit 0) — re-run /claude-tweaks:backlog attention");
});

test('a live exact sibling on the PR head renders no row (a head carrying no record number)', () => {
  // not-draft verdict naming head fix/thing; the exact read matches that branch -> rows [].
  const env = makeEnv({
    verdicts: { 1: { code: 3, json: refusedJson(1, 'not-draft', { headRefName: 'fix/thing', prNumbers: [10] }) } },
    exact: (arg) => (arg.branch === 'fix/thing' ? { path: '/repo/.claude/worktrees/fix-thing', branch: 'fix/thing', pid: 9 } : null),
  });
  assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
  assert.deepStrictEqual(rows(env), []);
  assert.equal(env.names().includes('findSiblingOnWorktree'), true);
});

test('a verdict with no head makes no exact read', () => {
  const env = makeEnv({ verdicts: { 1: { code: 3, json: refusedJson(1, 'multiple-prs', { headRefName: null }) } } });
  assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
  assert.equal(env.names().includes('findSiblingOnWorktree'), false);
  assert.equal(rows(env).length, 1);
});

test('a provably live run renders no row; an unproven one renders the verdict remedy', () => {
  const live = makeEnv({ verdicts: { 1: { code: 3, json: refusedJson(1, 'prior-run-live', { liveRun: true }) } } });
  assert.equal(run(['--records', RECORDS_PATH], live.deps), 0);
  assert.deepStrictEqual(rows(live), []);
  const unknown = makeEnv({ verdicts: { 1: { code: 3, json: refusedJson(1, 'prior-run-live') } } });
  assert.equal(run(['--records', RECORDS_PATH], unknown.deps), 0);
  assert.equal(rows(unknown)[0].remedy, 'remedy: prior-run-live');
});

test('a claim read failure stays visible as a row, and the verdict never runs', () => {
  // readClaim returns {failure:"x"}; separately, an empty result and a throw.
  const unreadable = /could not read #1's state \(claim read\) — re-run \/claude-tweaks:backlog attention/;
  for (const patch of [{ claim: { content: null, failure: 'x', absent: false } }, { claim: null }, { claimThrows: true }]) {
    const env = makeEnv(patch);
    assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
    assert.equal(rows(env).length, 1);
    assert.match(rows(env)[0].remedy, unreadable);
    assert.equal(env.names().includes('resume'), false, 'the verdict never ran');
  }
});

test('a throwing sibling read stays visible as a row, never as a clean record', () => {
  for (const patch of [{ siblingThrows: true }, {
    exactThrows: true, verdicts: { 1: { code: 3, json: refusedJson(1, 'not-draft', { headRefName: 'fix/thing' }) } },
  }]) {
    const env = makeEnv(patch);
    assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
    assert.equal(rows(env).length, 1);
    assert.match(rows(env)[0].remedy, /could not read #1's state \(sibling session check\) — re-run \/claude-tweaks:backlog attention/);
    assert.doesNotMatch(rows(env)[0].remedy, /dispatch-resume exit/, 'dispatch-resume did not fail');
  }
});

test('a throwing verdict run is a row naming the dispatch-resume step, never the sibling check, and carries its cause to stderr', () => {
  const env = makeEnv({ resumeThrows: true });
  assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
  assert.equal(rows(env).length, 1);
  assert.equal(rows(env)[0].remedy, "could not read #1's state (dispatch-resume exit 4) — re-run /claude-tweaks:backlog attention");
  assert.doesNotMatch(rows(env)[0].remedy, /sibling session check/);
  assert.match(env.err.join(''), /stuck-open-prs\.js: #1: resume boom/);
  assert.doesNotMatch(env.err.join(''), /threw after/, 'readVerdict caught it; the outer catch never ran');
});

test('a throw that reaches the blanket catch writes its record, last step and cause to stderr, row unchanged', () => {
  const cases = [
    [{ claimThrows: true }, 'claim read', 'claim boom'],
    [{ siblingThrows: true }, 'sibling session check', 'sibling boom'],
    [{ exactThrows: true, verdicts: { 1: { code: 3, json: refusedJson(1, 'not-draft', { headRefName: 'fix/thing' }) } } }, 'sibling session check', 'exact boom'],
  ];
  for (const [patch, step, cause] of cases) {
    const env = makeEnv(patch);
    assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
    assert.equal(rows(env).length, 1, cause);
    assert.equal(rows(env)[0].remedy, `could not read #1's state (${step}) — re-run /claude-tweaks:backlog attention`, cause);
    assert.equal(env.err.join(''), `stuck-open-prs.js: #1: threw after ${step}: ${cause}\n`, cause);
  }
});

test('a no-row verdict ends the record before the exact read, so that read throwing cannot turn it into a row', () => {
  for (const [reason, over] of [['live-sibling', {}], ['live-claim', {}], ['prior-run-live', { liveRun: true }]]) {
    const env = makeEnv({
      exactThrows: true, verdicts: { 1: { code: 3, json: refusedJson(1, reason, { headRefName: 'fix/thing', ...over }) } },
    });
    assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
    assert.deepStrictEqual(rows(env), [], reason);
    assert.equal(env.names().includes('findSiblingOnWorktree'), false, reason);
  }
});

test('a verdict that fails to run or parse stays visible as a row naming its exit code', () => {
  for (const [verdict, code] of [[{ code: 4 }, 4], [{ code: 2 }, 2], [{ code: 3, raw: 'not json\n' }, 3], [{ code: 0, raw: '[]\n' }, 0]]) {
    const env = makeEnv({ verdicts: { 1: verdict } });
    assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
    assert.match(rows(env)[0].remedy, new RegExp(`could not read #1's state \\(dispatch-resume exit ${code}\\)`));
  }
});

test('only exit 0 or 3 carries a verdict: exit 1 with valid refusal JSON reads as no verdict', () => {
  for (const code of [1, 2, 4, 5]) {
    const env = makeEnv({ verdicts: { 1: { code, json: refusedJson(1, 'not-draft') } } });
    assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
    assert.equal(rows(env)[0].remedy, `could not read #1's state (dispatch-resume exit ${code}) — re-run /claude-tweaks:backlog attention`, String(code));
  }
});

test('a fork listed first in the linked-PR read does not name the row: the verdict\'s PR does', () => {
  // linked says PR 10 (the fork); the eligible verdict is about PR 11.
  const env = makeEnv({ verdicts: { 1: { code: 0, json: eligibleJson(1, 11) } } });
  assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
  assert.equal(rows(env)[0].pr, 11);
  assert.equal(rows(env)[0].remedy, 'run /claude-tweaks:dispatch resume #1 — restarts its stalled PR #11');
  const refusedEnv = makeEnv({ verdicts: { 1: { code: 3, json: refusedJson(1, 'not-draft', { prNumbers: [11] }) } } });
  assert.equal(run(['--records', RECORDS_PATH], refusedEnv.deps), 0);
  assert.equal(rows(refusedEnv)[0].pr, 11);
});

test('no candidate: no linked-PR read and an empty rows line', () => {
  const env = makeEnv({ records: [rec(1, { labels: label('ready') }), rec(2, { labels: label('auto:build', 'bot:blocked') })] });
  assert.equal(run(['--records', RECORDS_PATH], env.deps), 0);
  assert.deepStrictEqual(rows(env), []);
  assert.equal(env.names().includes('linked'), false);
});

test('an unreadable --records file is exit 2 with no row', () => {
  // readFile throws; then a file that is not JSON, not an array, or holds a non-record entry.
  const bad = [{ readThrows: true }, { recordsText: '{nope' }, { recordsText: '{"rows":[]}' }, { recordsText: '[null]' }, { recordsText: '[{"state":"OPEN"}]' }];
  for (const patch of bad) {
    const env = makeEnv(patch);
    assert.equal(run(['--records', RECORDS_PATH], env.deps), 2, JSON.stringify(patch));
    assert.equal(failedLine(env).code, 2);
    assert.match(env.err.join(''), /stuck-open-prs\.js:/);
    assert.equal(env.names().includes('linked'), false);
  }
});

test('a linked-PR read failure is exit 4', () => {
  // linked throws (fetchLinkedPRs' partial-result throw); a result that lacks a candidate's entry is the same failure.
  for (const patch of [{ linkedThrows: true }, { linked: new Map([[2, { openPR: null }]]) }, { linked: null }]) {
    const env = makeEnv(patch);
    assert.equal(run(['--records', RECORDS_PATH], env.deps), 4);
    assert.equal(failedLine(env).code, 4);
    assert.match(env.err.join(''), /linked-PR read failed/);
  }
});

test('gh absent, repo unresolved and main checkout unresolved are exit 2', () => {
  for (const patch of [{ gh: false }, { repo: null }, { repo: new Error('no remote') }, { mainRoot: null }, { mainRoot: new Error('no git') }]) {
    const env = makeEnv(patch);
    assert.equal(run(['--records', RECORDS_PATH], env.deps), 2, JSON.stringify(patch));
    assert.equal(failedLine(env).code, 2);
  }
});

test('gh-absent stderr says gh is needed', () => {
  const env = makeEnv({ gh: false });
  run(['--records', RECORDS_PATH], env.deps);
  assert.match(env.err.join(''), /gh CLI not found/);
});

test('malformed argv is exit 2; --help prints usage and exits 0 before any probe', () => {
  for (const argv of [[], ['--records'], ['--records', '--help'], ['--records', ''], ['--bogus'], ['--records', 'a', 'b']]) {
    const env = makeEnv();
    assert.equal(run(argv, env.deps), 2, JSON.stringify(argv));
    assert.deepStrictEqual(env.out, []);
  }
  const env = makeEnv({ gh: false });
  assert.equal(run(['--help'], env.deps), 0);
  assert.match(env.out.join(''), /usage: stuck-open-prs\.js --records <path>/);
});

test('realDeps wires the real sibling reads, the claim read and the verdict CLI', () => {
  assert.strictEqual(realDeps.findSibling, findConflictingSession);
  assert.strictEqual(realDeps.findSiblingOnWorktree, findSessionOnWorktree);
  assert.strictEqual(realDeps.readClaim, dispatchResume.realDeps.readClaim);
  for (const key of ['readFile', 'ghAvailable', 'repo', 'mainRoot', 'linked', 'resume', 'now', 'stdout', 'stderr']) {
    assert.equal(typeof realDeps[key], 'function', key);
  }
});
