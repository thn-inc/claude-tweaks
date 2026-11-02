'use strict';
// #4588: pins the dispatch-resume eligibility verdict (plugin/bin/lib/dispatch/resume-eligibility.js)
// and its resume-context derivation. Every input shape is the real #4589 stall: draft PR #4604 on
// worktree-dispatch-record-4589, run 2026-10-30T101632-record-4589, a failed: tombstone.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText, crlfCheckoutRead } = require('../../helpers/read-skill');
const {
  REFUSAL_REASONS, runIdFromPrBody, claimRunId, openPrLine, selectResumePr, resumeEligibility, resumeContext,
  worktreeNameForHead, closeRedispatchRemedy, refusalDetail,
} = require('../../../plugin/bin/lib/dispatch/resume-eligibility');
const { claimPayload, releasePayload } = require('../../../plugin/bin/lib/issues/claims');

const N = 4589;
const PR = 4604;
const HEAD = 'worktree-dispatch-record-4589';
const RUN = '2026-10-30T101632-record-4589';
const URL = 'https://github.com/o/r/pull/4604';
const OID = 'a'.repeat(40);
const WT = '/repo/.claude/worktrees/dispatch-record-4589';
const NOW = Date.parse('2026-10-31T12:00:00Z');
const HOUR = 3600 * 1000;

const BODY = `## Summary\n\nclaude-tweaks-run: ${RUN}\n<!-- claude-tweaks-run: ${RUN} -->\n`;

function prEntry(over = {}) {
  return {
    url: URL, number: PR, headRefName: HEAD, headRefOid: OID, body: BODY, isDraft: true, isCrossRepository: false, closingRecords: 1, ...over,
  };
}

function tombstone(reason, over = {}) {
  return releasePayload({
    issueNumber: N, runId: RUN, reason, now: NOW - 5 * HOUR, ...over,
  }).tombstoneContent;
}
const FAILED = () => tombstone('failed: plan-review-needs-human');
const STALE = (runId = RUN) => claimPayload({
  issueNumber: N, runId, sessionId: 's1', ttlHours: 72, host: 'h', now: NOW - 100 * HOUR,
}).fileContent;
const LIVE = () => claimPayload({
  issueNumber: N, runId: RUN, sessionId: 's1', ttlHours: 72, host: 'h', now: NOW - HOUR,
}).fileContent;

function input(over = {}) {
  return {
    issue: N,
    prs: [prEntry()],
    claimContent: FAILED(),
    labels: ['ready', 'auto:build', 'type:task'],
    now: NOW,
    priorRunDir: 'archived',
    priorRunOpen: false,
    priorRunOwnerHost: null,
    siblingLive: false,
    worktreePath: WT,
    worktreeDirty: [],
    worktreeBranch: HEAD,
    issueState: 'OPEN',
    openBlockers: [],
    localBranchSha: null,
    branchCheckedOutAt: null,
    mainRoot: '/repo',
    ...over,
  };
}
const verdict = (over) => resumeEligibility(input(over));

const REMEDY = /run \/claude-tweaks:|wait for|close PR|check out|rebind|remove that label|until that PR merges or closes/;
const CLAIM_HINT = 'dispatch resume needs a failed:, abandoned: or swept: stale claim tombstone, or a stale claim';

// ---- runIdFromPrBody ----

test('runIdFromPrBody: reads either marker form from a whole trimmed line', () => {
  assert.equal(runIdFromPrBody(`x\n  claude-tweaks-run: ${RUN}  \ny`), RUN);
  assert.equal(runIdFromPrBody(`x\r\n<!-- claude-tweaks-run: ${RUN} -->\r\n`), RUN);
  assert.equal(runIdFromPrBody(BODY), RUN);
});

test('runIdFromPrBody: ignores a substring mention, a malformed id and non-strings', () => {
  assert.equal(runIdFromPrBody(`see claude-tweaks-run: ${RUN} for details`), null);
  assert.equal(runIdFromPrBody('claude-tweaks-run: not-a-run-id'), null);
  assert.equal(runIdFromPrBody('<!-- claude-tweaks-run: 2026-10-30 -->'), null);
  assert.equal(runIdFromPrBody(`claude-tweaks-run: ${RUN} extra`), null);
  assert.equal(runIdFromPrBody(''), null);
  assert.equal(runIdFromPrBody(null), null);
  assert.equal(runIdFromPrBody(undefined), null);
});

// ---- claimRunId ----

test('claimRunId: sweptFrom for a swept: tombstone, runId otherwise, null when not a non-empty string', () => {
  assert.equal(claimRunId({ released: true, runId: 'sweeper', reason: 'swept: stale claim', sweptFrom: RUN }), RUN);
  assert.equal(claimRunId({ released: true, runId: RUN, reason: 'failed: x' }), RUN);
  assert.equal(claimRunId({ runId: RUN, claimedAt: 'x' }), RUN);
  // a non-swept tombstone's sweptFrom is not consulted
  assert.equal(claimRunId({ released: true, runId: RUN, reason: 'failed: x', sweptFrom: 'other' }), RUN);
  assert.equal(claimRunId({ released: true, runId: 'sweeper', reason: 'swept: stale claim' }), null);
  assert.equal(claimRunId({ released: true, reason: 'abandoned: x' }), null);
  assert.equal(claimRunId({ runId: '' }), null);
  assert.equal(claimRunId({ runId: 42 }), null);
  assert.equal(claimRunId(null), null);
  assert.equal(claimRunId('x'), null);
});

// ---- openPrLine ----

test('openPrLine: byte-identical to open-pr-exclusion-report.md\'s named-record base line', () => {
  assert.equal(
    openPrLine(4589, 4604),
    '#4589 already has an open PR (#4604) — not re-dispatch-eligible until that PR merges or closes',
  );
});

// ---- eligible shapes ----

test('own stalled PR with a failed: tombstone is eligible and echoes the prior run, PR and dir class', () => {
  assert.deepStrictEqual(verdict(), {
    eligible: true,
    priorRunId: RUN,
    prUrl: URL,
    prNumber: PR,
    priorRunDir: 'archived',
    archivePriorRun: false,
    closePriorRun: false,
    localBranchExists: false,
  });
});

test('own stalled PR with an abandoned: tombstone is eligible', () => {
  const v = verdict({ claimContent: tombstone('abandoned: spec 4589') });
  assert.equal(v.eligible, true);
  assert.equal(v.priorRunId, RUN);
});

test('own stalled PR with a stale claim is eligible, including with bot:in-progress', () => {
  assert.equal(verdict({ claimContent: STALE() }).eligible, true);
  const v = verdict({ claimContent: STALE(), labels: ['auto:build', 'bot:in-progress'] });
  assert.equal(v.eligible, true);
});

test('swept: stale claim tombstone is eligible; the sweeping run id must not trigger run-mismatch', () => {
  const swept = tombstone('swept: stale claim', { runId: '2026-10-31T080000-tidy-sweep', sweptFrom: RUN });
  assert.equal(JSON.parse(swept).runId, '2026-10-31T080000-tidy-sweep');
  const v = verdict({ claimContent: swept });
  assert.equal(v.eligible, true);
  assert.equal(v.priorRunId, RUN);
});

test('swept: issue closed tombstone is claim-not-resumable and names its reason', () => {
  const v = verdict({ claimContent: tombstone('swept: issue closed', { runId: '2026-10-31T080000-tidy-sweep', sweptFrom: RUN }) });
  assert.equal(v.reason, 'claim-not-resumable');
  assert.ok(v.line.includes('swept: issue closed'), v.line);
});

test('a PR-marker slug must be exactly record-{N}', () => {
  const marked = (id) => [prEntry({ body: `claude-tweaks-run: ${id}\n` })];
  const foreign = verdict({ prs: marked('2026-10-30T101632-dispatch-record-4589') });
  assert.equal(foreign.reason, 'foreign-pr');
  const other = input({
    issue: 12,
    worktreeBranch: 'worktree-dispatch-record-12',
    prs: [prEntry({ headRefName: 'worktree-dispatch-record-12', body: 'claude-tweaks-run: 2026-10-30T101632-record-120\n' })],
    claimContent: tombstone('failed: x', { runId: '2026-10-30T101632-record-12' }),
  });
  assert.equal(resumeEligibility(other).reason, 'foreign-pr');
  const own = {
    ...other,
    prs: [prEntry({ headRefName: 'worktree-dispatch-record-12', body: 'claude-tweaks-run: 2026-10-30T101632-record-12\n' })],
  };
  assert.equal(resumeEligibility(own).eligible, true);
});

// ---- prior run directory ----

test('prior run dir: archived, absent, residue and stateless are eligible without archiving; each echoes its own class', () => {
  const results = {};
  for (const cls of ['archived', 'absent', 'residue', 'stateless']) {
    const v = verdict({ priorRunDir: cls });
    assert.equal(v.eligible, true, cls);
    assert.equal(v.priorRunDir, cls);
    assert.equal(v.archivePriorRun, false, cls);
    assert.equal(v.closePriorRun, false, cls);
    results[cls] = v;
  }
  assert.notDeepStrictEqual(results.residue, results.stateless);
});

test('prior run dir: dead-owner archives, and closes first only when the run is still open', () => {
  const open = verdict({ priorRunDir: 'dead-owner', priorRunOpen: true });
  assert.equal(open.eligible, true);
  assert.equal(open.archivePriorRun, true);
  assert.equal(open.closePriorRun, true);
  const closed = verdict({ priorRunDir: 'dead-owner', priorRunOpen: false });
  assert.equal(closed.eligible, true);
  assert.equal(closed.archivePriorRun, true);
  assert.equal(closed.closePriorRun, false);
});

test('prior run dir: priorRunOpen is ignored for every class but dead-owner', () => {
  for (const cls of ['archived', 'absent', 'residue', 'stateless']) {
    assert.equal(verdict({ priorRunDir: cls, priorRunOpen: true }).closePriorRun, false, cls);
  }
});

// ---- reaped worktree ----

test('worktree missing is eligible; localBranchExists tracks a local branch at the PR head', () => {
  const none = verdict({ worktreeBranch: null, localBranchSha: null });
  assert.equal(none.eligible, true);
  assert.equal(none.localBranchExists, false);
  const same = verdict({ worktreeBranch: null, localBranchSha: OID });
  assert.equal(same.eligible, true);
  assert.equal(same.localBranchExists, true);
});

// ---- selectResumePr ----

test('selectResumePr returns the kept entry and its marker run id for the base listing', () => {
  assert.deepStrictEqual(selectResumePr(N, [prEntry()]), { ok: true, pr: prEntry(), runId: RUN });
});

test('selectResumePr drops a fork entry before deciding', () => {
  const fork = prEntry({ number: 4610, isCrossRepository: true });
  assert.deepStrictEqual(selectResumePr(N, [prEntry(), fork]), { ok: true, pr: prEntry(), runId: RUN });
  assert.equal(verdict({ prs: [prEntry(), fork] }).eligible, true);
  // an entry that does not state isCrossRepository === false is not trusted either
  const unstated = prEntry({ number: 4611 });
  delete unstated.isCrossRepository;
  assert.equal(selectResumePr(N, [prEntry(), unstated]).ok, true);
});

test('selectResumePr and resumeEligibility agree on the three listing refusals', () => {
  const listings = {
    empty: [],
    forkOnly: [prEntry({ isCrossRepository: true })],
    multi: [prEntry(), prEntry({ number: 4610 })],
    foreign: [prEntry({ headRefName: 'worktree-dispatch-record-9999', body: 'claude-tweaks-run: 2026-10-30T101632-record-999\n' })],
  };
  const reasons = { empty: 'no-pr', forkOnly: 'cross-repo-pr', multi: 'multiple-prs', foreign: 'foreign-pr' };
  for (const [name, prs] of Object.entries(listings)) {
    const sel = selectResumePr(N, prs);
    const full = verdict({ prs });
    assert.equal(sel.ok, false, name);
    assert.equal(sel.reason, reasons[name], name);
    assert.deepStrictEqual({ eligible: false, reason: sel.reason, line: sel.line, disposition: sel.disposition }, full, name);
  }
});

test('multiple-prs lists the PR numbers in ascending order whatever order the listing came in', () => {
  const v = verdict({ prs: [prEntry({ number: 4610 }), prEntry()] });
  assert.equal(v.reason, 'multiple-prs');
  assert.ok(v.line.includes('#4604, #4610 in ascending number order'), v.line);
  assert.ok(v.line.startsWith('#4589 has 2 open PRs'), v.line);
});

// ---- foreign / live-sibling use the base line unchanged ----

test('foreign-pr and live-sibling lines equal openPrLine and never name dispatch resume', () => {
  const base = openPrLine(N, PR);
  for (const v of [
    verdict({ prs: [prEntry({ headRefName: 'a$(x)' })] }),
    verdict({ prs: [prEntry({ body: 'claude-tweaks-run: 2026-10-30T101632-record-12\n' })] }),
    verdict({ prs: [prEntry({ body: 'no marker here' })] }),
    verdict({ siblingLive: true }),
  ]) {
    assert.equal(v.eligible, false);
    assert.equal(v.line, base);
    assert.ok(!v.line.includes('dispatch resume'));
    assert.ok(v.line.includes('already has an open PR'));
  }
  assert.equal(verdict({ siblingLive: true }).reason, 'live-sibling');
});

// ---- the refusal table: exact line, reason and a remedy for every refusal ----

const invalidLine = (what, kind) => `#4589's ${what} was not usable (${kind}) — not resumable on a malformed check; run /claude-tweaks:dispatch resume #4589 again, and report it if it repeats`;
const REFUSALS = [
  ['no PR', { prs: [] }, 'no-pr',
    '#4589 has no open PR that closes it — nothing to resume; run /claude-tweaks:dispatch #4589', null],
  ['fork-only listing', { prs: [prEntry({ isCrossRepository: true })] }, 'cross-repo-pr',
    "#4589's open closing PR #4604 (https://github.com/o/r/pull/4604) comes from a fork or another repository — dispatch resume only restarts a build on this repository's own branch; merge or close it, then run /claude-tweaks:dispatch #4589", 'close'],
  ['two same-repo PRs', { prs: [prEntry(), prEntry({ number: 4610 })] }, 'multiple-prs',
    '#4589 has 2 open PRs that close it (#4604, #4610 in ascending number order) — not resumable until only one remains; close the extra PR, then run /claude-tweaks:dispatch resume #4589', 'resume'],
  ['PR closing several records', { prs: [prEntry({ closingRecords: 2 })] }, 'multi-record-pr',
    "#4589's PR #4604 closes 2 records — dispatch resume restarts one record's build, never a bundle; merge or close PR #4604 by hand, then run /claude-tweaks:dispatch #4589", 'close'],
  ['unsafe-charset head', { prs: [prEntry({ headRefName: 'a$(x)' })] }, 'foreign-pr', openPrLine(N, PR), 'close'],
  ['foreign marker record', { prs: [prEntry({ body: 'claude-tweaks-run: 2026-10-30T101632-record-12\n' })] }, 'foreign-pr', openPrLine(N, PR), 'close'],
  ['malformed marker', { prs: [prEntry({ body: 'claude-tweaks-run: nope\n' })] }, 'foreign-pr', openPrLine(N, PR), 'close'],
  ['non-draft PR', { prs: [prEntry({ isDraft: false })] }, 'not-draft',
    "#4589's PR #4604 is not a draft — dispatch resume only restarts a stalled build's draft PR; if it awaits review, run /claude-tweaks:dispatch close-out #4589", 'close-out'],
  ['live sibling', { siblingLive: true }, 'live-sibling', openPrLine(N, PR), 'resume'],
  ['pr-opened tombstone', { claimContent: tombstone('pr-opened: PR #4604 awaiting review', { link: URL }) }, 'pr-opened',
    "#4589's PR #4604 finished its build and awaits review — run /claude-tweaks:dispatch close-out #4589", 'close-out'],
  ['live claim', { claimContent: LIVE() }, 'live-claim',
    '#4589 is already claimed by a live run — not resumable; wait for that run to finish or its claim to expire, then run /claude-tweaks:dispatch resume #4589', 'resume'],
  ['absent claim', { claimContent: null }, 'claim-not-resumable',
    `#4589's claim is absent — not resumable: ${CLAIM_HINT}; close PR #4604 and run /claude-tweaks:dispatch #4589 to rebuild it fresh`, 'close'],
  ['unreadable claim', { claimContent: 'not json' }, 'claim-not-resumable',
    `#4589's claim is unreadable — not resumable: ${CLAIM_HINT}; close PR #4604 and run /claude-tweaks:dispatch #4589 to rebuild it fresh`, 'close'],
  ['other tombstone', { claimContent: tombstone('merged: PR #4604') }, 'claim-not-resumable',
    `#4589's claim is tombstone (merged: PR #4604) — not resumable: ${CLAIM_HINT}; close PR #4604 and run /claude-tweaks:dispatch #4589 to rebuild it fresh`, 'close'],
  ['reasonless tombstone', { claimContent: JSON.stringify({ released: true, runId: RUN }) }, 'claim-not-resumable',
    `#4589's claim is tombstone (no reason) — not resumable: ${CLAIM_HINT}; close PR #4604 and run /claude-tweaks:dispatch #4589 to rebuild it fresh`, 'close'],
  ['stale claim of another run', { claimContent: STALE('2026-10-31T090000-record-4589') }, 'run-mismatch',
    "#4589's claim names run 2026-10-31T090000-record-4589 but PR #4604's claude-tweaks-run: marker names 2026-10-30T101632-record-4589 — not resumable while they disagree; rebind PR #4604's claude-tweaks-run: marker to 2026-10-31T090000-record-4589 by hand (the run that claimed #4589 last), then run /claude-tweaks:dispatch resume #4589", 'resume'],
  ['failed tombstone of another run', { claimContent: tombstone('failed: x', { runId: '2026-10-31T090000-record-4589' }) }, 'run-mismatch',
    "#4589's claim names run 2026-10-31T090000-record-4589 but PR #4604's claude-tweaks-run: marker names 2026-10-30T101632-record-4589 — not resumable while they disagree; rebind PR #4604's claude-tweaks-run: marker to 2026-10-31T090000-record-4589 by hand (the run that claimed #4589 last), then run /claude-tweaks:dispatch resume #4589", 'resume'],
  ['swept tombstone whose sweptFrom differs', { claimContent: tombstone('swept: stale claim', { runId: '2026-10-31T080000-tidy-sweep', sweptFrom: '2026-10-29T000000-record-4589' }) }, 'run-mismatch',
    "#4589's claim names run 2026-10-29T000000-record-4589 but PR #4604's claude-tweaks-run: marker names 2026-10-30T101632-record-4589 — not resumable while they disagree; rebind PR #4604's claude-tweaks-run: marker to 2026-10-29T000000-record-4589 by hand (the run that claimed #4589 last), then run /claude-tweaks:dispatch resume #4589", 'resume'],
  ['tombstone with no run id', { claimContent: JSON.stringify({ released: true, reason: 'failed: x' }) }, 'run-mismatch',
    "#4589's claim names no run id but PR #4604's claude-tweaks-run: marker names 2026-10-30T101632-record-4589 — not resumable; close PR #4604 and run /claude-tweaks:dispatch #4589 to rebuild it fresh", 'close'],
  ['swept tombstone with no sweptFrom', { claimContent: tombstone('swept: stale claim', { runId: RUN }) }, 'run-mismatch',
    "#4589's claim names no run id but PR #4604's claude-tweaks-run: marker names 2026-10-30T101632-record-4589 — not resumable; close PR #4604 and run /claude-tweaks:dispatch #4589 to rebuild it fresh", 'close'],
  ['closed issue', { issueState: 'CLOSED' }, 'record-closed',
    '#4589 is closed — not resumable; reopen it first if the work is still wanted, or close PR #4604', 'close'],
  ['open blockers', { openBlockers: [4500, 4501] }, 'blocked-by',
    '#4589 is blocked by open #4500, #4501 — not resumable until they close; then run /claude-tweaks:dispatch resume #4589', 'resume'],
  ['bot:blocked', { labels: ['auto:build', 'bot:blocked'] }, 'not-granted',
    '#4589 carries bot:blocked — re-grant it with /claude-tweaks:backlog refine #4589, then run /claude-tweaks:dispatch resume #4589', 'resume'],
  ['no auto:build', { labels: ['ready', 'type:task'] }, 'not-granted',
    '#4589 lacks auto:build — re-grant it with /claude-tweaks:backlog refine #4589, then run /claude-tweaks:dispatch resume #4589', 'resume'],
  ['in-progress with a failed tombstone', { labels: ['auto:build', 'bot:in-progress'] }, 'label-drift',
    '#4589 carries bot:in-progress without a stale claim — remove that label (gh issue edit 4589 --remove-label bot:in-progress), then run /claude-tweaks:dispatch resume #4589', 'resume'],
  ['bot:parked', { labels: ['auto:build', 'bot:parked'] }, 'unlisted-label',
    '#4589 carries bot:parked — not resumable while it is set; clear it (gh issue edit 4589 --remove-label bot:parked) once its trigger has fired, then run /claude-tweaks:dispatch resume #4589', 'resume'],
  ['unknown prior-run class', { priorRunDir: 'weird-class' }, 'unlisted-state',
    `#4589's prior run ${RUN} is in an unrecognised state (weird-class) — not resumable; inspect .claude-tweaks/pipelines/${RUN} by hand, archive it with hooks.js archive-run if its owner is gone, then run /claude-tweaks:dispatch resume #4589`, 'resume'],
  ['live owner', { priorRunDir: 'live-owner' }, 'prior-run-live',
    `#4589's prior run ${RUN} has an owner that is not provably dead (live) — not resumable while it may still be running; wait for it to exit, then run /claude-tweaks:dispatch resume #4589`, 'resume'],
  ['unknown owner', { priorRunDir: 'unknown-owner' }, 'prior-run-live',
    `#4589's prior run ${RUN} has an owner that is not provably dead (unknown) — not resumable while it may still be running; wait for it to exit, then run /claude-tweaks:dispatch resume #4589`, 'resume'],
  ['other-host owner', { priorRunDir: 'other-host-owner', priorRunOwnerHost: 'other-mac.local' }, 'prior-run-other-host',
    `#4589's prior run ${RUN} is owned by a session on another host (other-mac.local) — its death cannot be proven from this machine; run /claude-tweaks:dispatch resume #4589 on other-mac.local`, 'resume'],
  ['dirty worktree', { worktreeDirty: ['plugin/x.js', 'docs/y.md'] }, 'dirty-worktree',
    "#4589's stalled worktree /repo/.claude/worktrees/dispatch-record-4589 has uncommitted edits: plugin/x.js, docs/y.md — commit or discard them, then run /claude-tweaks:dispatch resume #4589; resume never commits or pushes them", 'resume'],
  ['worktree on another branch', { worktreeBranch: 'main' }, 'worktree-branch',
    "#4589's stalled worktree /repo/.claude/worktrees/dispatch-record-4589 is on branch main, not worktree-dispatch-record-4589 — check out worktree-dispatch-record-4589 there, or remove the worktree so resume recreates it, then run /claude-tweaks:dispatch resume #4589", 'resume'],
  ['worktree detached', { worktreeBranch: '' }, 'worktree-branch',
    "#4589's stalled worktree /repo/.claude/worktrees/dispatch-record-4589 is on a detached HEAD, not worktree-dispatch-record-4589 — check out worktree-dispatch-record-4589 there, or remove the worktree so resume recreates it, then run /claude-tweaks:dispatch resume #4589", 'resume'],
  ['branch checked out elsewhere', { worktreeBranch: null, branchCheckedOutAt: '/repo/.claude/worktrees/other' }, 'branch-checked-out',
    "#4589's branch worktree-dispatch-record-4589 is checked out at /repo/.claude/worktrees/other — remove that worktree (or resume from it), then run /claude-tweaks:dispatch resume #4589", 'resume'],
  ['branch still registered to the missing stalled worktree', { worktreeBranch: null, branchCheckedOutAt: WT }, 'branch-checked-out',
    "#4589's branch worktree-dispatch-record-4589 is still registered to the missing worktree /repo/.claude/worktrees/dispatch-record-4589 — run git -C \"/repo\" worktree unlock \"/repo/.claude/worktrees/dispatch-record-4589\" (ignore a \"not locked\" error), then git -C \"/repo\" worktree prune, then run /claude-tweaks:dispatch resume #4589", 'resume'],
  ['local branch diverged', { worktreeBranch: null, localBranchSha: 'b'.repeat(40) }, 'branch-diverged',
    "#4589's local branch worktree-dispatch-record-4589 is at bbbbbbb, not PR #4604's head aaaaaaa — push its commits or reset it to origin/worktree-dispatch-record-4589, then run /claude-tweaks:dispatch resume #4589", 'resume'],
  // A guard input the gatherer forgot or mistyped is a refusal, never "nothing to refuse" (Closed rule).
  ['siblingLive omitted', { siblingLive: undefined }, 'invalid-input', invalidLine('sibling-session check', 'undefined'), 'resume'],
  ['siblingLive not a boolean', { siblingLive: 'false' }, 'invalid-input', invalidLine('sibling-session check', 'string'), 'resume'],
  ['openBlockers omitted', { openBlockers: undefined }, 'invalid-input', invalidLine('open-blocker list', 'undefined'), 'resume'],
  ['openBlockers a bare number', { openBlockers: 4500 }, 'invalid-input', invalidLine('open-blocker list', 'number'), 'resume'],
  ['worktreeDirty omitted', { worktreeDirty: undefined }, 'invalid-input', invalidLine('dirty-path list', 'undefined'), 'resume'],
  ['worktreeDirty raw porcelain text', { worktreeDirty: 'plugin/x.js' }, 'invalid-input', invalidLine('dirty-path list', 'string'), 'resume'],
  ['worktreeDirty null', { worktreeDirty: null }, 'invalid-input', invalidLine('dirty-path list', 'null'), 'resume'],
];

for (const [name, over, reason, line, disposition] of REFUSALS) {
  test(`refusal: ${name} -> ${reason}`, () => {
    const v = verdict(over);
    assert.deepStrictEqual(v, {
      eligible: false, reason, line, disposition, ...(over.priorRunDir === 'live-owner' ? { liveRun: true } : {}),
    });
    assert.ok(v.line.includes('#4589'), v.line);
    assert.match(v.line, REMEDY);
    assert.ok(REFUSAL_REASONS.includes(v.reason), v.reason);
  });
}

test('every refusal reason except the run-dir scan\'s two is produced by the table above', () => {
  const scanOnly = ['concurrent-resume', 'stale-bound-run'];
  const produced = new Set(REFUSALS.map((r) => r[2]));
  const missing = REFUSAL_REASONS.filter((r) => !scanOnly.includes(r) && !produced.has(r));
  assert.deepStrictEqual(missing, []);
  for (const r of scanOnly) assert.ok(REFUSAL_REASONS.includes(r), r);
  assert.equal(new Set(REFUSAL_REASONS).size, REFUSAL_REASONS.length);
  assert.equal(REFUSAL_REASONS.length, 26);
  assert.ok(Object.isFrozen(REFUSAL_REASONS));
});

// ---- the spec's specific pins that the table does not spell out ----

test('dirty-worktree names every dirty path in the order given, and is eligible once clean', () => {
  const v = verdict({ worktreeDirty: ['b.js', 'a.js', 'c/d.md'] });
  assert.ok(v.line.includes('b.js, a.js, c/d.md'), v.line);
  assert.equal(verdict({ worktreeDirty: [] }).eligible, true);
});

test('other-host owner is never eligible, whatever else is true', () => {
  const v = verdict({ priorRunDir: 'other-host-owner', priorRunOwnerHost: 'other-mac.local', priorRunOpen: true });
  assert.equal(v.eligible, false);
  assert.ok(v.line.includes('other-mac.local'));
});

test('unlisted-label names the first unlisted bot:* label in sorted order', () => {
  const v = verdict({ labels: ['auto:build', 'bot:zeta', 'bot:parked', 'bot:in-progress'], claimContent: STALE() });
  assert.equal(v.reason, 'unlisted-label');
  assert.ok(v.line.includes('carries bot:parked'), v.line);
});

test('bot:in-progress rides only with a stale claim', () => {
  const labels = ['auto:build', 'bot:in-progress'];
  assert.equal(verdict({ labels, claimContent: STALE() }).eligible, true);
  assert.equal(verdict({ labels, claimContent: tombstone('abandoned: x') }).reason, 'label-drift');
  assert.equal(verdict({ labels, claimContent: tombstone('swept: stale claim', { sweptFrom: RUN }) }).reason, 'label-drift');
});

test('carries bot:blocked wins over lacks auto:build', () => {
  const v = verdict({ labels: ['bot:blocked'] });
  assert.equal(v.reason, 'not-granted');
  assert.ok(v.line.startsWith('#4589 carries bot:blocked'), v.line);
});

test('branch-diverged does not fire when the worktree exists, nor when the tips match', () => {
  assert.equal(verdict({ worktreeBranch: HEAD, localBranchSha: 'b'.repeat(40) }).eligible, true);
  assert.equal(verdict({ worktreeBranch: null, localBranchSha: OID }).eligible, true);
  // the checked-out/diverged reads belong to a missing worktree only
  const present = verdict({ worktreeBranch: HEAD, branchCheckedOutAt: '/repo/.claude/worktrees/other' });
  assert.equal(present.eligible, true);
});

test('an omitted or mistyped worktreeBranch refuses invalid-input; only an explicit null means the worktree is missing', () => {
  const omitted = input();
  delete omitted.worktreeBranch;
  assert.deepStrictEqual(resumeEligibility(omitted), {
    eligible: false, reason: 'invalid-input', line: invalidLine('stalled-worktree branch', 'undefined'), disposition: 'resume',
  });
  assert.equal(verdict({ worktreeBranch: 7 }).line, invalidLine('stalled-worktree branch', 'number'));
  assert.equal(verdict({ worktreeBranch: null }).eligible, true);
  // its own rule's position: a dirty worktree still refuses first
  assert.equal(verdict({ worktreeBranch: undefined, worktreeDirty: ['x'] }).reason, 'dirty-worktree');
});

test('a malformed guard input yields to the earlier refusal that precedes its rule', () => {
  // each invalid-input check sits at its own rule's position, so valid-input ordering is unchanged
  assert.equal(verdict({ prs: [], siblingLive: undefined }).reason, 'no-pr');
  assert.equal(verdict({ siblingLive: true, openBlockers: undefined }).reason, 'live-sibling');
  assert.equal(verdict({ issueState: 'CLOSED', openBlockers: undefined }).reason, 'record-closed');
  assert.equal(verdict({ labels: [], openBlockers: undefined }).reason, 'invalid-input');
  assert.equal(verdict({ priorRunDir: 'live-owner', worktreeDirty: undefined }).reason, 'prior-run-live');
});

test('a closed issue whose state is lower-case or unknown is still refused, named in lower case; a non-string state is invalid-input', () => {
  assert.ok(verdict({ issueState: 'CLOSED' }).line.startsWith('#4589 is closed'));
  assert.equal(verdict({ issueState: 'open' }).reason, 'record-closed');
  assert.equal(verdict({ issueState: 'MERGED' }).reason, 'record-closed');
  assert.deepStrictEqual(verdict({ issueState: undefined }), {
    eligible: false, reason: 'invalid-input', line: invalidLine('issue state', 'undefined'), disposition: 'resume',
  });
  assert.equal(verdict({ issueState: null }).line, invalidLine('issue state', 'null'));
});

// ---- evaluation order (each pair swaps which of two refusing inputs wins) ----

test('refusals evaluate in the listed order', () => {
  const order = (over, winner) => assert.equal(verdict(over).reason, winner, JSON.stringify(Object.keys(over)));
  order({ prs: [], siblingLive: true, claimContent: null }, 'no-pr');
  order({ prs: [prEntry({ isDraft: false })], siblingLive: true }, 'not-draft');
  order({ siblingLive: true, claimContent: tombstone('pr-opened: x') }, 'live-sibling');
  order({ claimContent: tombstone('pr-opened: x', { runId: 'other' }) }, 'pr-opened');
  order({ claimContent: LIVE(), issueState: 'CLOSED' }, 'live-claim');
  order({ claimContent: null, issueState: 'CLOSED' }, 'claim-not-resumable');
  order({ claimContent: STALE('2026-10-31T090000-record-4589'), issueState: 'CLOSED' }, 'run-mismatch');
  order({ issueState: 'CLOSED', openBlockers: [1] }, 'record-closed');
  order({ openBlockers: [1], labels: [] }, 'blocked-by');
  order({ labels: ['bot:blocked', 'bot:in-progress'] }, 'not-granted');
  order({ labels: ['auto:build', 'bot:in-progress', 'bot:parked'] }, 'label-drift');
  order({ labels: ['auto:build', 'bot:parked'], priorRunDir: 'weird' }, 'unlisted-label');
  order({ priorRunDir: 'weird', worktreeDirty: ['x'] }, 'unlisted-state');
  order({ priorRunDir: 'live-owner', worktreeDirty: ['x'] }, 'prior-run-live');
  order({ priorRunDir: 'other-host-owner', priorRunOwnerHost: 'h', worktreeDirty: ['x'] }, 'prior-run-other-host');
  order({ worktreeDirty: ['x'], worktreeBranch: 'main' }, 'dirty-worktree');
  order({ worktreeBranch: null, branchCheckedOutAt: '/w', localBranchSha: 'b'.repeat(40) }, 'branch-checked-out');
});

// ---- any head, bundles, forks and the refusal's disposition (#4849) ----

test('AC1.1: selectResumePr accepts an open closing PR on a non-dispatch head', () => {
  const pr = prEntry({ headRefName: 'worktree-record-4589' });
  const r = selectResumePr(N, [pr]);
  assert.equal(r.ok, true);
  assert.equal(r.pr.headRefName, 'worktree-record-4589');
  assert.equal(r.runId, RUN);
});
test('AC2.1: no-pr line names no head and offers the plain dispatch', () => {
  const r = selectResumePr(N, []);
  assert.equal(r.reason, 'no-pr');
  assert.equal(r.line, `#${N} has no open PR that closes it — nothing to resume; run /claude-tweaks:dispatch #${N}`);
  assert.equal(r.disposition, null);
});
test('a PR closing more than one record refuses multi-record-pr naming the count', () => {
  const r = selectResumePr(N, [prEntry({ closingRecords: 3 })]);
  assert.equal(r.reason, 'multi-record-pr');
  assert.equal(r.line, `#${N}'s PR #${PR} closes 3 records — dispatch resume restarts one record's build, never a bundle; merge or close PR #${PR} by hand, then run /claude-tweaks:dispatch #${N}`);
  assert.equal(r.disposition, 'close');
});
test('AC6.1: an open fork or other-repository closing PR refuses by naming that PR, never no-pr', () => {
  const r = selectResumePr(N, [prEntry({ isCrossRepository: true })]);
  assert.equal(r.reason, 'cross-repo-pr');
  assert.equal(r.line, `#${N}'s open closing PR #${PR} (${URL}) comes from a fork or another repository — dispatch resume only restarts a build on this repository's own branch; merge or close it, then run /claude-tweaks:dispatch #${N}`);
  assert.equal(r.disposition, 'close');
});
test('several fork PRs are named ascending, in the plural', () => {
  const r = selectResumePr(N, [prEntry({ number: 4610, url: 'u2', isCrossRepository: true }), prEntry({ url: 'u1', isCrossRepository: true })]);
  assert.equal(r.reason, 'cross-repo-pr');
  assert.equal(r.line, `#${N}'s open closing PRs #${PR} (u1), #4610 (u2) come from a fork or another repository — dispatch resume only restarts a build on this repository's own branch; merge or close them, then run /claude-tweaks:dispatch #${N}`);
  assert.equal(r.disposition, 'close');
});
test('an own PR beside a fork PR still selects the own PR', () => {
  const fork = prEntry({ number: 4610, isCrossRepository: true });
  assert.equal(selectResumePr(N, [prEntry(), fork]).ok, true);
});
test('a missing closingRecords is invalid-input, never read as one record', () => {
  const pr = prEntry();
  delete pr.closingRecords;
  assert.equal(selectResumePr(N, [pr]).reason, 'invalid-input');
  for (const bad of [0, -1, 1.5, '1', null]) {
    const r = selectResumePr(N, [prEntry({ closingRecords: bad })]);
    assert.equal(r.reason, 'invalid-input', String(bad));
    assert.equal(r.disposition, 'resume', String(bad));
  }
});
test('an entry whose number is not a positive integer is invalid-input, never a #undefined line', () => {
  const empty = selectResumePr(N, [{}]);
  assert.equal(empty.reason, 'invalid-input');
  assert.equal(empty.line, `#${N}'s PR number was not usable (undefined) — not resumable on a malformed check; run /claude-tweaks:dispatch resume #${N} again, and report it if it repeats`);
  assert.equal(empty.disposition, 'resume');
  for (const number of [0, -1, 1.5, '7', null]) {
    assert.equal(selectResumePr(N, [prEntry({ number })]).reason, 'invalid-input', String(number));
    assert.equal(selectResumePr(N, [prEntry({ number, isCrossRepository: true })]).reason, 'invalid-input', String(number));
  }
  assert.equal(selectResumePr(N, [prEntry(), prEntry({ number: 'x', isCrossRepository: true })]).reason, 'invalid-input');
  const d = refusalDetail({ issue: N, verdict: verdict({ prs: [{}] }), prs: [{}], mainRoot: '/repo' });
  assert.deepStrictEqual(d.prNumbers, []);
  assert.doesNotMatch(d.remedy, /#undefined/);
});
test('a head outside the worktree-name character set refuses foreign-pr', () => {
  for (const head of ['a$(touch x)', '-rf', 'worktree-', 'a b', 'a/../b']) {
    assert.equal(selectResumePr(N, [prEntry({ headRefName: head })]).reason, 'foreign-pr', head);
  }
});
test('a marker naming another record still refuses foreign-pr on any head', () => {
  const other = '2026-10-30T101632-record-999';
  const r = selectResumePr(N, [prEntry({ headRefName: 'worktree-record-4589', body: `claude-tweaks-run: ${other}\n` })]);
  assert.equal(r.reason, 'foreign-pr');
  assert.equal(r.disposition, 'close');
});
test('worktreeNameForHead strips the worktree- prefix and passes a plain head through', () => {
  assert.equal(worktreeNameForHead('worktree-record-3942'), 'record-3942');
  assert.equal(worktreeNameForHead('worktree-dispatch-record-3977'), 'dispatch-record-3977');
  assert.equal(worktreeNameForHead('fix/thing'), 'fix/thing');
  for (const bad of ['a$(x)', '-rf', 'worktree-', 'a/../b', '.hidden', 'a//b', 'a/.b', 'a/', 'a b', undefined, null, 7]) assert.equal(worktreeNameForHead(bad), null, String(bad));
});
test('worktreeNameForHead resolves a doubled hyphen and a name over 64 characters', () => {
  assert.equal(worktreeNameForHead('fix--thing'), 'fix--thing');
  const long = 'x'.repeat(70);
  assert.equal(worktreeNameForHead(long), long);
  assert.equal(worktreeNameForHead(`worktree-${long}`), long);
  assert.equal(selectResumePr(N, [prEntry({ headRefName: 'fix--thing' })]).ok, true);
});
test('each refusal disposition follows what its line tells the human to do', () => {
  assert.equal(verdict({ prs: [prEntry({ isDraft: false })] }).disposition, 'close-out');
  assert.equal(verdict({ claimContent: tombstone(`pr-opened: ${URL}`) }).disposition, 'close-out');
  assert.equal(verdict({ claimContent: tombstone('merged: x') }).disposition, 'close'); // claim-not-resumable
  assert.equal(verdict({ claimContent: JSON.stringify({ released: true, reason: 'abandoned: x' }) }).disposition, 'close'); // run-mismatch, no run id
  assert.equal(verdict({ claimContent: STALE('2026-10-30T101632-record-999') }).disposition, 'resume'); // run-mismatch, rebind
  assert.equal(verdict({ worktreeDirty: ['a.js'] }).disposition, 'resume');
  assert.equal(verdict({ issueState: 'CLOSED' }).disposition, 'close');
  assert.equal(verdict({ prs: [] }).disposition, null);
});
test('only a provably live prior run carries liveRun', () => {
  const live = verdict({ priorRunDir: 'live-owner' });
  assert.equal(live.reason, 'prior-run-live');
  assert.equal(live.liveRun, true);
  const unknown = verdict({ priorRunDir: 'unknown-owner' });
  assert.equal(unknown.reason, 'prior-run-live');
  assert.equal('liveRun' in unknown, false);
});
test('closeRedispatchRemedy lists every step a fresh dispatch needs', () => {
  const wt = path.join('/repo', '.claude', 'worktrees', 'record-7');
  assert.equal(
    closeRedispatchRemedy({ issue: 7, prNumber: 70, headRefName: 'worktree-record-7', mainRoot: '/repo' }),
    `close PR #70 (gh pr close 70), unlock and remove its worktree if one exists (git worktree unlock "${wt}"; git worktree remove "${wt}"), delete the local and remote branch (git branch -D worktree-record-7; git push origin --delete worktree-record-7), then run /claude-tweaks:dispatch #7`,
  );
});
test('the prune remedy names the given main checkout, quoted, for a head with a slash', () => {
  const main = '/Code Workspaces/repo';
  const wt = path.join(main, '.claude', 'worktrees', 'fix', 'thing');
  const v = verdict({
    prs: [prEntry({ headRefName: 'fix/thing' })], mainRoot: main, worktreePath: wt, worktreeBranch: null, branchCheckedOutAt: wt,
  });
  assert.equal(v.reason, 'branch-checked-out');
  assert.equal(v.line, `#${N}'s branch fix/thing is still registered to the missing worktree ${wt} — run git -C "${main}" worktree unlock "${wt}" (ignore a "not locked" error), then git -C "${main}" worktree prune, then run /claude-tweaks:dispatch resume #${N}`);
});
const FORK = { number: 4611, isCrossRepository: true };
test('a fork PR beside the kept PR ends the close remedy by naming it, never the dispatch it would refuse', () => {
  const prs = [prEntry(), prEntry(FORK)];
  const v = verdict({ prs, claimContent: tombstone('merged: x') });
  assert.equal(v.disposition, 'close');
  const { remedy } = refusalDetail({ issue: N, verdict: v, prs, mainRoot: '/repo' });
  assert.match(remedy, /gh pr close 4604/);
  assert.ok(remedy.endsWith(`, then #${N} stays excluded until fork PR #4611 also closes`), remedy);
  assert.doesNotMatch(remedy, /run \/claude-tweaks:dispatch/);
  const unsafe = closeRedispatchRemedy({
    issue: 7, prNumber: 70, headRefName: 'a$(x)', mainRoot: '/repo', forks: [{ number: 9 }, { number: 8 }],
  });
  assert.ok(unsafe.endsWith(', then #7 stays excluded until fork PRs #8, #9 also close'), unsafe);
});
test('a draft bundle beside a fork PR names the fork too, not a dispatch it would refuse', () => {
  const r = selectResumePr(N, [prEntry({ closingRecords: 2 }), prEntry(FORK)]);
  assert.equal(r.reason, 'multi-record-pr');
  assert.ok(r.line.endsWith(`by hand, then #${N} stays excluded until fork PR #4611 also closes`), r.line);
});
// F1: close-out stops `no run dir` when the marker's run has neither a root nor an archive dir.
const NO_RUN_BY_HAND = `#${N}'s PR #${PR} names run ${RUN}, which left no run directory for close-out to verify — review and merge it by hand`;
const NO_RUN_SHAPES = [
  ['not-draft', { prs: [prEntry({ isDraft: false })] }],
  ['pr-opened', { claimContent: tombstone(`pr-opened: ${URL}`) }],
  ['multi-record-pr', { prs: [prEntry({ isDraft: false, closingRecords: 2 })] }],
  ['foreign-pr', { prs: [prEntry({ isDraft: false, headRefName: 'a$(x)' })] }],
];
for (const [reason, over] of NO_RUN_SHAPES) {
  test(`a close-out remedy with no run dir left reads by hand, disposition still close-out: ${reason}`, () => {
    const gone = verdict({ ...over, priorRunDir: 'absent' });
    assert.deepStrictEqual(gone, {
      eligible: false, reason, line: NO_RUN_BY_HAND, disposition: 'close-out',
    });
    const prs = over.prs || [prEntry()];
    assert.equal(refusalDetail({ issue: N, verdict: gone, prs, mainRoot: '/repo' }).remedy, NO_RUN_BY_HAND);
    assert.doesNotMatch(gone.line, /dispatch close-out/);
    // A dir close-out can still resolve keeps the command: residue and stateless have a root dir.
    for (const priorRunDir of ['archived', 'residue', 'stateless', 'dead-owner']) {
      const kept = verdict({ ...over, priorRunDir });
      assert.equal(kept.reason, reason, priorRunDir);
      assert.match(kept.line, new RegExp(`/claude-tweaks:dispatch close-out #${N}$`), priorRunDir);
    }
  });
}
test('selectResumePr: runGone gets the marker\'s run id and defaults to never gone', () => {
  const prs = [prEntry({ isDraft: false, closingRecords: 2 })];
  const asked = [];
  const r = selectResumePr(N, prs, { runGone: (id) => { asked.push(id); return true; } });
  assert.deepStrictEqual(asked, [RUN]);
  assert.equal(r.line, NO_RUN_BY_HAND);
  assert.equal(r.disposition, 'close-out');
  assert.match(selectResumePr(N, prs).line, /run \/claude-tweaks:dispatch close-out/);
});
test('runGone is never asked about a PR with no marker for this record, and a draft stays close', () => {
  const never = { runGone: () => { throw new Error('asked'); } };
  assert.equal(selectResumePr(N, [prEntry({ isDraft: false, closingRecords: 2, body: 'none' })], never).disposition, 'close-out');
  assert.equal(selectResumePr(N, [prEntry({ closingRecords: 2 })], { runGone: () => true }).disposition, 'close');
});
test('an absent isDraft in a multiple-prs listing reads as non-draft', () => {
  const unstated = prEntry({ number: 4610 });
  delete unstated.isDraft;
  const v = verdict({ prs: [unstated, prEntry()] });
  assert.equal(v.reason, 'multiple-prs');
  assert.equal(v.disposition, 'close-out');
  assert.ok(v.line.endsWith('and #4610 is not a draft — review and merge it by hand'), v.line);
});
test('closeRedispatchRemedy prints no command for a head that is unsafe to paste', () => {
  const s = closeRedispatchRemedy({ issue: 7, prNumber: 70, headRefName: 'a$(x)', mainRoot: '/repo' });
  assert.ok(!s.includes('a$(x)'));
  assert.match(s, /by hand/);
  assert.match(s, /close PR #70 \(gh pr close 70\)/);
  assert.match(s, /then run \/claude-tweaks:dispatch #7$/);
});
test('closeRedispatchRemedy prints no branch-delete command for a bare head, only for a worktree- head', () => {
  for (const head of ['develop', 'release/2.0', 'fix/thing']) {
    const s = closeRedispatchRemedy({ issue: 7, prNumber: 70, headRefName: head, mainRoot: '/repo' });
    assert.doesNotMatch(s, /git branch -D|git push origin --delete|git worktree/, head);
    assert.ok(!s.includes(head), head);
    assert.equal(s, 'close PR #70 (gh pr close 70), remove any worktree holding its branch and delete the local and remote branch by hand, then run /claude-tweaks:dispatch #7', head);
  }
  const own = closeRedispatchRemedy({ issue: 7, prNumber: 70, headRefName: 'worktree-record-7', mainRoot: '/repo' });
  assert.match(own, /git branch -D worktree-record-7; git push origin --delete worktree-record-7/);
  const prs = [prEntry({ headRefName: 'release/2.0' })];
  const d = refusalDetail({ issue: N, verdict: verdict({ prs, claimContent: tombstone('merged: x') }), prs, mainRoot: '/repo' });
  assert.match(d.remedy, /gh pr close 4604/);
  assert.doesNotMatch(d.remedy, /git branch -D|git push origin --delete/);
});
test('AC5.1: a non-draft or pr-opened refusal names close-out and never a close instruction', () => {
  for (const over of [{ prs: [prEntry({ isDraft: false })] }, { claimContent: tombstone(`pr-opened: ${URL}`) }]) {
    const d = refusalDetail({ issue: N, verdict: verdict(over), prs: over.prs || [prEntry()], mainRoot: '/repo' });
    assert.equal(d.disposition, 'close-out');
    assert.ok(d.remedy.includes(`/claude-tweaks:dispatch close-out #${N}`));
    assert.doesNotMatch(d.remedy, /gh pr close|close PR/);
  }
});
const OTHER_MARKER = 'claude-tweaks-run: 2026-10-30T101632-record-999\n';
const NOT_DRAFT_MARKED = `#${N}'s PR #${PR} is not a draft and awaits review — run /claude-tweaks:dispatch close-out #${N}`;
const NOT_DRAFT_UNMARKED = `#${N}'s PR #${PR} is not a draft and carries no claude-tweaks-run marker for this record, which close-out needs — review and merge it by hand`;
const NON_DRAFT_SHAPES = [
  ['foreign marker', { body: OTHER_MARKER }, 'foreign-pr', NOT_DRAFT_UNMARKED],
  ['unsafe head, own marker', { headRefName: 'a$(x)' }, 'foreign-pr', NOT_DRAFT_MARKED],
  ['no marker', { body: 'no marker here' }, 'foreign-pr', NOT_DRAFT_UNMARKED],
  ['bundle with its own marker', { closingRecords: 2 }, 'multi-record-pr', NOT_DRAFT_MARKED],
  ['bundle with a foreign marker', { closingRecords: 2, body: OTHER_MARKER }, 'multi-record-pr', NOT_DRAFT_UNMARKED],
  ['bundle with no marker', { closingRecords: 2, body: 'no marker here' }, 'multi-record-pr', NOT_DRAFT_UNMARKED],
  ['fork', { isCrossRepository: true }, 'cross-repo-pr',
    `#${N}'s open closing PR #${PR} (${URL}) comes from a fork or another repository and is not a draft — review and merge it by hand`],
];
for (const [name, over, reason, line] of NON_DRAFT_SHAPES) {
  test(`a non-draft PR never takes close: ${name}`, () => {
    const prs = [prEntry({ isDraft: false, ...over })];
    const r = selectResumePr(N, prs);
    assert.equal(r.reason, reason);
    assert.equal(r.line, line);
    assert.equal(r.disposition, 'close-out');
    const d = refusalDetail({ issue: N, verdict: verdict({ prs }), prs, mainRoot: '/repo' });
    assert.equal(d.disposition, 'close-out');
    assert.equal(d.remedy, line);
    assert.doesNotMatch(d.remedy, /gh pr close|close PR/);
  });
}
test('a fork listing holding any non-draft PR takes close-out, never a close instruction', () => {
  const prs = [prEntry({ isCrossRepository: true, url: 'u1' }), prEntry({ number: 4610, url: 'u2', isCrossRepository: true, isDraft: false })];
  const r = selectResumePr(N, prs);
  assert.equal(r.reason, 'cross-repo-pr');
  assert.equal(r.disposition, 'close-out');
  assert.equal(r.line, `#${N}'s open closing PRs #${PR} (u1), #4610 (u2) come from a fork or another repository and #4610 is not a draft — review and merge it by hand`);
  const both = selectResumePr(N, [prEntry({ isCrossRepository: true, url: 'u1', isDraft: false }), prEntry({ number: 4610, url: 'u2', isCrossRepository: true, isDraft: false })]);
  assert.equal(both.disposition, 'close-out');
  assert.equal(both.line, `#${N}'s open closing PRs #${PR} (u1), #4610 (u2) come from a fork or another repository and #${PR}, #4610 are not drafts — review and merge them by hand`);
});
test('multiple-prs holding a non-draft PR names it and never a close instruction; all drafts keep the line', () => {
  const prs = [prEntry({ number: 4610, isDraft: false }), prEntry()];
  const v = verdict({ prs });
  assert.equal(v.reason, 'multiple-prs');
  assert.equal(v.disposition, 'close-out');
  assert.equal(v.line, `#${N} has 2 open PRs that close it (#${PR}, #4610 in ascending number order) and #4610 is not a draft — review and merge it by hand`);
  assert.doesNotMatch(refusalDetail({ issue: N, verdict: v, prs, mainRoot: '/repo' }).remedy, /gh pr close|close PR/);
  const two = [prEntry({ number: 4610, isDraft: false }), prEntry({ isDraft: false })];
  assert.equal(verdict({ prs: two }).line, `#${N} has 2 open PRs that close it (#${PR}, #4610 in ascending number order) and #${PR}, #4610 are not drafts — review and merge them by hand`);
  const drafts = verdict({ prs: [prEntry({ number: 4610 }), prEntry()] });
  assert.equal(drafts.disposition, 'resume');
  assert.equal(drafts.line, `#${N} has 2 open PRs that close it (#${PR}, #4610 in ascending number order) — not resumable until only one remains; close the extra PR, then run /claude-tweaks:dispatch resume #${N}`);
});
// Ruling 2: destructive steps only for a PR this record owns alone.
const STEPS = /git branch -D|git push origin --delete|gh pr close/;
const NOT_OWNED = [
  ['no marker', { body: 'no marker here' }],
  ['a marker naming record 999', { body: OTHER_MARKER }],
  ['a bundle with its own marker', { closingRecords: 3 }],
  ['a bundle with a foreign marker', { closingRecords: 3, body: OTHER_MARKER }],
];
for (const [name, over] of NOT_OWNED) {
  test(`refusalDetail prints no close steps for a draft with ${name}`, () => {
    const prs = [prEntry(over)];
    const v = verdict({ prs });
    assert.equal(v.disposition, 'close');
    const d = refusalDetail({ issue: N, verdict: v, prs, mainRoot: '/repo' });
    assert.equal(d.remedy, v.line);
    assert.doesNotMatch(d.remedy, STEPS);
  });
}
test('refusalDetail: close uses the steps on an own-marker PR, except a closed record and a fork, whose lines fit', () => {
  for (const over of [{ claimContent: tombstone('merged: x') }, { claimContent: JSON.stringify({ released: true, reason: 'abandoned: x' }) }, { prs: [prEntry({ headRefName: 'a$(x)' })] }]) {
    const prs = over.prs || [prEntry()];
    const d = refusalDetail({ issue: N, verdict: verdict(over), prs, mainRoot: '/repo' });
    assert.deepStrictEqual(d.prNumbers, [PR]);
    assert.match(d.remedy, /gh pr close 4604/);
  }
  const own = refusalDetail({ issue: N, verdict: verdict({ claimContent: tombstone('merged: x') }), prs: [prEntry()], mainRoot: '/repo' });
  assert.match(own.remedy, /git branch -D worktree-dispatch-record-4589; git push origin --delete worktree-dispatch-record-4589/);
  const closed = verdict({ issueState: 'CLOSED' });
  assert.equal(refusalDetail({ issue: N, verdict: closed, prs: [prEntry()], mainRoot: '/repo' }).remedy, closed.line);
  const forkPrs = [prEntry({ isCrossRepository: true })];
  const fork = selectResumePr(N, forkPrs);
  const d = refusalDetail({ issue: N, verdict: fork, prs: forkPrs, mainRoot: '/repo' });
  assert.equal(d.remedy, fork.line);
  assert.deepStrictEqual(d.prNumbers, [PR]);
});
test('refusalDetail: no-pr carries no PR, no disposition, no remedy and no head', () => {
  assert.deepStrictEqual(
    refusalDetail({ issue: N, verdict: selectResumePr(N, []), prs: [], mainRoot: '/repo' }),
    { prNumbers: [], disposition: null, remedy: null, headRefName: null },
  );
});
test('refusalDetail: headRefName is the one kept PR\'s head, null for a fork or several kept PRs', () => {
  const one = [prEntry({ isDraft: false, headRefName: 'fix/thing' })];
  assert.equal(refusalDetail({ issue: N, verdict: verdict({ prs: one }), prs: one, mainRoot: '/repo' }).headRefName, 'fix/thing');
  const beside = [prEntry({ headRefName: 'fix/thing', isDraft: false }), prEntry({ number: 4610, isCrossRepository: true })];
  assert.equal(refusalDetail({ issue: N, verdict: verdict({ prs: beside }), prs: beside, mainRoot: '/repo' }).headRefName, 'fix/thing');
  const fork = [prEntry({ isCrossRepository: true })];
  assert.equal(refusalDetail({ issue: N, verdict: verdict({ prs: fork }), prs: fork, mainRoot: '/repo' }).headRefName, null);
  const many = [prEntry({ number: 4610 }), prEntry()];
  const d = refusalDetail({ issue: N, verdict: verdict({ prs: many }), prs: many, mainRoot: '/repo' });
  assert.equal(d.headRefName, null);
  assert.deepStrictEqual(d.prNumbers, [PR, 4610]);
  assert.equal(d.remedy, verdict({ prs: many }).line);
});

// ---- resumeContext ----

const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'dispatch-resume', 'record-4589-decisions.md');

test('resumeContext on the real archived #4589 run', () => {
  const ctx = resumeContext(readText(FIXTURE));
  assert.deepStrictEqual(ctx.lastPhase, { section: '/build', step: 'Common Step 1.5' });
  assert.equal(ctx.openDefects.length, 1);
  assert.ok(ctx.openDefects[0].startsWith('plan review: 2 needs-human spec gap(s)'), ctx.openDefects[0]);
});

test('resumeContext reads the same from CRLF text', () => {
  const { raw } = crlfCheckoutRead(FIXTURE);
  assert.ok(raw.includes('\r\n'), 'the CRLF copy carries CRLF line ends');
  assert.deepStrictEqual(resumeContext(raw), resumeContext(readText(FIXTURE)));
});

test('resumeContext: /dispatch and /wrap-up entries are settle bookkeeping, never progress or defects', () => {
  const text = [
    '## /flow', '- AUTO 10:00:00 — Step 2.8: claimed. Reversibility: high.',
    '## /test', '- AUTO 10:10:00 — Step 3: green. Reversibility: n/a.',
    '- REFUSED 10:11:00 — Step 4: lint failed. Reversibility: n/a.',
    '## /dispatch', '- KEPT-PROMPT 10:20:00 — Settle: a question. Reversibility: n/a.',
    '## /wrap-up', '- REFUSED 10:30:00 — Section E: nope. Reversibility: n/a.',
  ].join('\n');
  assert.deepStrictEqual(resumeContext(text), {
    lastPhase: { section: '/test', step: 'Step 4' },
    openDefects: ['lint failed. Reversibility: n/a.'],
  });
});

test('resumeContext: the last pipeline section heading in the file decides lastPhase', () => {
  const text = [
    '## /build', '- AUTO 10:00:00 — Step 1: built. Reversibility: n/a.',
    '## /review', '- AUTO 10:20:00 — Step 2: reviewed. Reversibility: n/a.',
    '## /build', '- AUTO 10:30:00 — Step 9: rebuilt. Reversibility: n/a.',
  ].join('\n');
  assert.deepStrictEqual(resumeContext(text).lastPhase, { section: '/build', step: 'Step 9' });
});

test('resumeContext: a later pipeline heading with no entry resets lastPhase rather than mixing two sections', () => {
  const text = [
    '## /build', '- AUTO 10:00:00 — Step 1: built. Reversibility: n/a.',
    '## /test',
  ].join('\n');
  assert.equal(resumeContext(text).lastPhase, null);
  // a non-pipeline heading after it changes nothing
  assert.equal(resumeContext(`${text}\n## /dispatch\n- AUTO 10:30:00 — Settle: x. Reversibility: n/a.`).lastPhase, null);
});

test('resumeContext: a note line or non-entry line never becomes the step', () => {
  const text = [
    '## /design-wrapper', '- AUTO 10:00:00 — Review: critique ran. Reversibility: n/a.',
    'a hand-written note', '', '- not an entry',
  ].join('\n');
  assert.deepStrictEqual(resumeContext(text).lastPhase, { section: '/design-wrapper', step: 'Review' });
});

test('resumeContext: openDefects keeps KEPT-PROMPT and REFUSED in file order across pipeline sections, only those statuses', () => {
  const text = [
    '## /build', '- KEPT-PROMPT 10:00:00 — Step 1: first. Reversibility: n/a.',
    '- AUTO 10:01:00 — Step 2: fine. Reversibility: n/a.', '- STAGED 10:02:00 — Step 3: staged. Reversibility: n/a.',
    '- SCANNED 10:03:00 — Step 3: scanned. Reversibility: n/a.', '- SKIP 10:04:00 — Step 3: skipped. Reversibility: n/a.',
    '## /review', '- REFUSED 10:05:00 — Step 5: second. Reversibility: n/a.',
  ].join('\n');
  assert.deepStrictEqual(resumeContext(text).openDefects, ['first. Reversibility: n/a.', 'second. Reversibility: n/a.']);
});

test('resumeContext: a defect longer than 300 chars is truncated to 300 chars ending in an ellipsis', () => {
  const long = 'x'.repeat(500);
  const [d] = resumeContext(`## /test\n- REFUSED 10:00:00 — Step 1: ${long}\n`).openDefects;
  assert.equal(d.length, 300);
  assert.ok(d.endsWith('…'));
  const exact = 'y'.repeat(300);
  assert.deepStrictEqual(resumeContext(`## /test\n- REFUSED 10:00:00 — Step 1: ${exact}\n`).openDefects, [exact]);
});

test('resumeContext: no pipeline entries -> null lastPhase and no defects; non-string input is empty', () => {
  const empty = { lastPhase: null, openDefects: [] };
  assert.deepStrictEqual(resumeContext(''), empty);
  assert.deepStrictEqual(resumeContext('# Auto-Decision Log\n\n## /dispatch\n- AUTO 10:00:00 — Settle: x. Reversibility: n/a.\n'), empty);
  assert.deepStrictEqual(resumeContext('## /build\n'), empty);
  assert.deepStrictEqual(resumeContext(null), empty);
  assert.deepStrictEqual(resumeContext(undefined), empty);
});
