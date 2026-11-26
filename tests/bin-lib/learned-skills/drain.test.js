'use strict';
// The learned-skills drain (#6112): merges green marker PRs through _shared/pr-first-merge.md Step 2.5's
// semantics. A scripted fake `gh` answers by argv and a fake clock advances on `sleep`; nothing touches the network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { readText } = require('../../helpers/read-skill');
const os = require('node:os');
const path = require('node:path');
const {
  drain, LEFT_OPEN_REASONS, LEVER_ACTIONS, scopeProblem, classifyPr, defaultReadyRun,
} = require('../../../plugin/bin/lib/learned-skills/drain.js');

const { rebuildFixture, FILE } = require('../../helpers/learned-skills-rebuild');
const { MERGE_GATE_WATCH_SECONDS } = require('../../../plugin/bin/lib/ci-health/constants');

const REPO = 'acme/repo';
const MARKER = '<!-- wrap-up-skills-pr -->';
const SHA = (c) => c.repeat(40);
const GOOD_FILES = [{ path: '.claude/skills/x/SKILL.md' }];
const OK = [{ name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const RUNNING = [{ name: 't', status: 'IN_PROGRESS', conclusion: null }];

const view = (o = {}) => ({
  number: 1, state: 'OPEN', isDraft: false, mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', headRefOid: SHA('a'),
  statusCheckRollup: OK, title: 't', body: MARKER, ...o,
});
const pr = (number, o = {}) => ({ number, headRefName: `learned-skills/run-${number}`, isCrossRepository: false, body: `${MARKER}\nrefs #6112`, ...o });

// prs: the `pr list` answer. views[n]: a view, or an array answered in order (the last one repeats).
function harness({ prs = [], views = {}, runs = {}, files = {}, ready = {}, mergeThrows = {}, viewThrows = {}, ciGate = 0, listThrows = null, rebuild } = {}) {
  const calls = [];
  const clock = { t: 1_700_000_000_000, sleeps: [] };
  const seq = {};
  const gh = (args) => {
    calls.push(args);
    const [a, b] = args;
    const n = Number(args[2]);
    if (a === 'pr' && b === 'list') {
      if (listThrows) throw new Error(listThrows);
      return JSON.stringify(prs);
    }
    if (a === 'pr' && b === 'view' && args[args.indexOf('--json') + 1] === 'files') return JSON.stringify({ files: files[n] || GOOD_FILES });
    if (a === 'pr' && b === 'view' && args[args.indexOf('--json') + 1] === 'number,title,body,closingIssuesReferences') {
      return JSON.stringify({ number: n, title: 'Add learned skill updates from wrap-up of #6112', body: `${MARKER}\nLearned skill updates (refs #6112).`, closingIssuesReferences: [] });
    }
    if (a === 'pr' && b === 'view') {
      if (viewThrows[n]) throw Object.assign(new Error('Command failed'), { stderr: `${viewThrows[n]}\nsecond line` });
      const v = views[n] === undefined ? view({ number: n }) : views[n];
      const withFiles = (o) => ({ files: files[n] || GOOD_FILES, ...o }); // the state call requests `files` too
      if (!Array.isArray(v)) return JSON.stringify(withFiles(v));
      seq[n] = seq[n] || 0;
      const out = v[Math.min(seq[n], v.length - 1)];
      seq[n] += 1;
      return JSON.stringify(withFiles(out));
    }
    if (a === 'run' && b === 'list') return JSON.stringify(runs[args[args.indexOf('--commit') + 1]] || []);
    if (a === 'pr' && b === 'merge') {
      if (mergeThrows[n] !== undefined) {
        const t = typeof mergeThrows[n] === 'object' ? mergeThrows[n] : { stderr: mergeThrows[n] };
        throw Object.assign(new Error(t.message || 'Command failed: gh pr merge'), { stderr: t.stderr });
      }
      return '';
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  const logged = [];
  const gateCalls = [];
  const rebuildCalls = [];
  const deps = {
    gh,
    ghAvailable: () => true,
    now: () => clock.t,
    sleep: (ms) => { clock.sleeps.push(ms); clock.t += ms; },
    readyRun: () => ({ state: 'not-applicable', readySince: null, readyWorkflows: [], ...ready }),
    appendEntries: ({ items }) => { logged.push(...items.map((i) => i.entry)); },
    ciGateRecord: (a) => { gateCalls.push(a); return ciGate; },
    rebuild: (a) => { rebuildCalls.push(a); return (rebuild || (() => { throw new Error('unexpected rebuild'); }))(a); },
  };
  return { deps, calls, clock, logged, gateCalls, rebuildCalls, merges: () => calls.filter((c) => c[0] === 'pr' && c[1] === 'merge') };
}

const base = (o = {}) => ({ repo: REPO, autoMerge: true, mergeVerification: 'wait', integrationBranch: 'main', ...o });

test('AC1.1 AC2.1: a green marker PR is merged with the composed chore subject, Refs body, no Fixes, no undefined', () => {
  const h = harness({ prs: [pr(6200)], views: { 6200: view({ number: 6200 }) } });
  const out = drain(base(), h.deps);
  assert.deepEqual(out.merged, [6200]);
  const [m] = h.merges();
  const arg = (f) => m[m.indexOf(f) + 1];
  assert.equal(arg('--subject'), 'chore: Add learned skill updates from wrap-up of #6112 (#6200)');
  assert.match(arg('--body'), /Refs #6112/);
  assert.doesNotMatch(arg('--body'), /Fixes|undefined/);
  assert.doesNotMatch(arg('--subject'), /undefined/);
  assert.equal(arg('--match-head-commit'), SHA('a'));
  assert.ok(m.includes('--squash') && m.includes('--delete-branch'));
  assert.equal(arg('--repo'), REPO);
  assert.ok(!m.includes('--auto'));
});

test('AC1.2: a pending sibling is left untouched (no merge, no sleep), with its one SKIP line', () => {
  const h = harness({ prs: [pr(6201)], views: { 6201: view({ number: 6201, statusCheckRollup: RUNNING }) } });
  const out = drain(base({ runDir: '/run' }), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6201, reason: 'pending' }]);
  assert.equal(h.merges().length, 0);
  assert.equal(h.clock.sleeps.length, 0);
  assert.equal(h.logged.length, 1);
  assert.match(h.logged[0], /^- SKIP /);
});

test('AC1.3: a pending --own-pr is watched and merged when it turns green', () => {
  const pending = view({ number: 6202, statusCheckRollup: RUNNING });
  const h = harness({ prs: [pr(6202)], views: { 6202: [pending, pending, view({ number: 6202 })] } });
  const out = drain(base({ ownPr: 6202 }), h.deps);
  assert.deepEqual(out.merged, [6202]);
  assert.deepEqual(h.clock.sleeps, [30000, 30000]);
});

test('AC1.4: a red PR is left open with no label writes', () => {
  const h = harness({ prs: [pr(6203)], views: { 6203: view({ number: 6203, statusCheckRollup: [{ name: 't', status: 'COMPLETED', conclusion: 'FAILURE' }] }) } });
  const out = drain(base(), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6203, reason: 'red' }]);
  assert.equal(h.merges().length, 0);
  assert.ok(!h.calls.some((c) => c[0] === 'issue' || c.includes('--add-label') || c.includes('--remove-label')));
});

const dirtyView = (n, o = {}) => view({ number: n, mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING', statusCheckRollup: [], ...o });
const REBUILT = () => ({ ok: true, commit: SHA('c'), tip: SHA('d') });

test('a DIRTY PR is rebuilt and left pending', () => {
  const h = harness({ prs: [pr(6204)], views: { 6204: dirtyView(6204) }, rebuild: REBUILT });
  const out = drain(base({ runDir: '/run' }), h.deps);
  assert.deepEqual(out.rebuilt, [6204]);
  assert.deepEqual(out.leftOpen, [{ pr: 6204, reason: 'pending' }]);
  assert.deepEqual(out.conflicting, []);
  assert.deepEqual(h.rebuildCalls, [{ pr: 6204, headRef: 'learned-skills/run-6204', oldHead: SHA('a'), integrationBranch: 'main' }]);
  assert.equal(h.merges().length, 0);
  const auto = h.logged.filter((l) => l.startsWith('- AUTO'));
  assert.equal(auto.length, 1);
  assert.match(auto[0], /PR #6204 rebuilt on main \(old head a{40}\)/);
  assert.match(auto[0], /\[lever: learned-skills-auto-merge=true\]$/);
});

test('a refused rebuild is left open naming the files', () => {
  const reason = 'conflict needs a human: .claude/skills/x/SKILL.md';
  const h = harness({ prs: [pr(6204)], views: { 6204: dirtyView(6204) }, rebuild: () => ({ ok: false, reason }) });
  const out = drain(base({ runDir: '/run' }), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6204, reason }]);
  assert.deepEqual(out.rebuilt, []);
  assert.deepEqual(out.conflicting, []);
  const skips = h.logged.filter((l) => l.startsWith('- SKIP'));
  assert.equal(skips.length, 1);
  assert.match(skips[0], /\[lever: learned-skills-auto-merge=true\]$/);
});

test('a refusal with a detail carries it', () => {
  const h = harness({ prs: [pr(6204)], views: { 6204: dirtyView(6204) }, rebuild: () => ({ ok: false, reason: 'rebuild-failed', detail: 'fetch failed' }) });
  assert.deepEqual(drain(base(), h.deps).leftOpen, [{ pr: 6204, reason: 'rebuild-failed', detail: 'fetch failed' }]);
});

test('a rebuild that throws is rebuild-failed with the error as detail', () => {
  const h = harness({ prs: [pr(6204)], views: { 6204: dirtyView(6204) }, rebuild: () => { throw new Error('boom\nsecond'); } });
  const out = drain(base(), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6204, reason: 'rebuild-failed', detail: 'boom' }]);
  assert.deepEqual(out.rebuilt, []);
});

test('a sibling turned DIRTY by an earlier merge in the same drain is rebuilt (the recheck site)', () => {
  const dirty = view({ number: 6206, mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING' });
  const h = harness({ prs: [pr(6205), pr(6206)], views: { 6206: [view({ number: 6206 }), dirty] }, rebuild: REBUILT });
  const out = drain(base(), h.deps);
  assert.deepEqual(out.merged, [6205]);
  assert.deepEqual(out.rebuilt, [6206]);
  assert.deepEqual(out.leftOpen, [{ pr: 6206, reason: 'pending' }]);
  assert.deepEqual(out.conflicting, []);
  assert.equal(h.merges().length, 1);
  assert.equal(h.rebuildCalls[0].oldHead, SHA('a'));
});

test('a rebuilt own PR follows the pending path to a merge on the new head', () => {
  const lag = view({ number: 6290, statusCheckRollup: RUNNING });
  const h = harness({
    prs: [pr(6290)],
    views: { 6290: [dirtyView(6290), lag, view({ number: 6290, headRefOid: SHA('c') }), view({ number: 6290, headRefOid: SHA('c') })] },
    rebuild: REBUILT,
  });
  const out = drain(base({ ownPr: 6290 }), h.deps);
  assert.deepEqual(out.rebuilt, [6290]);
  assert.deepEqual(out.merged, [6290]);
  assert.equal(h.merges().length, 1);
  const m = h.merges()[0];
  assert.equal(m[m.indexOf('--match-head-commit') + 1], SHA('c'));
  assert.deepEqual(h.clock.sleeps, [30000, 30000]);
});

test('an own PR that turns conflicting mid-watch is rebuilt', () => {
  const pending = view({ number: 6291, statusCheckRollup: RUNNING });
  const h = harness({
    prs: [pr(6291)],
    views: { 6291: [pending, dirtyView(6291), view({ number: 6291, headRefOid: SHA('c') }), view({ number: 6291, headRefOid: SHA('c') })] },
    rebuild: REBUILT,
  });
  const out = drain(base({ ownPr: 6291 }), h.deps);
  assert.deepEqual(out.rebuilt, [6291]);
  assert.deepEqual(out.merged, [6291]);
  assert.deepEqual(out.conflicting, []);
  assert.deepEqual(h.rebuildCalls.map((c) => c.oldHead), [SHA('a')]);
});

test('an own PR whose pre-merge re-read is conflicting is rebuilt and the watch continues', () => {
  const h = harness({
    prs: [pr(6292)],
    views: { 6292: [view({ number: 6292 }), dirtyView(6292), view({ number: 6292, headRefOid: SHA('c') }), view({ number: 6292, headRefOid: SHA('c') })] },
    rebuild: REBUILT,
  });
  const out = drain(base({ ownPr: 6292 }), h.deps);
  assert.deepEqual(out.rebuilt, [6292]);
  assert.deepEqual(out.merged, [6292]);
  assert.equal(h.merges()[0][h.merges()[0].indexOf('--match-head-commit') + 1], SHA('c'));
});

test('a PR conflicting again after its rebuild settles conflicting', () => {
  const h = harness({ prs: [pr(6293)], views: { 6293: [dirtyView(6293), dirtyView(6293, { headRefOid: SHA('c') })] }, rebuild: REBUILT });
  const out = drain(base({ ownPr: 6293 }), h.deps);
  assert.deepEqual(out.rebuilt, [6293]);
  assert.deepEqual(out.conflicting, [6293]);
  assert.deepEqual(out.leftOpen, []);
  assert.equal(h.rebuildCalls.length, 1);
});

test('a rebuild mid-watch keeps the watch deadline', () => {
  const pending = view({ number: 6294, statusCheckRollup: RUNNING });
  const plain = harness({ prs: [pr(6294)], views: { 6294: pending } });
  assert.deepEqual(drain(base({ ownPr: 6294 }), plain.deps).leftOpen, [{ pr: 6294, reason: 'timeout' }]);
  const h = harness({
    prs: [pr(6294)],
    views: { 6294: [pending, pending, dirtyView(6294), view({ number: 6294, headRefOid: SHA('c'), statusCheckRollup: RUNNING })] },
    rebuild: REBUILT,
  });
  const out = drain(base({ ownPr: 6294 }), h.deps);
  assert.deepEqual(out.rebuilt, [6294]);
  assert.deepEqual(out.leftOpen, [{ pr: 6294, reason: 'timeout' }]);
  assert.equal(h.clock.sleeps.length, plain.clock.sleeps.length);
  assert.equal(h.clock.sleeps.length, MERGE_GATE_WATCH_SECONDS * 1000 / 30000);
});

test('AC1.6: a PR without the marker is never touched', () => {
  const h = harness({ prs: [pr(6207, { body: 'refs #6112' }), pr(6208)] });
  const out = drain(base(), h.deps);
  assert.deepEqual(out.merged, [6208]);
  assert.ok(!h.calls.some((c) => c.includes('6207')));
  assert.deepEqual(out.leftOpen, []);
});

test('AC3.1: an empty statusCheckRollup is left open as pending', () => {
  const h = harness({ prs: [pr(6209)], views: { 6209: view({ number: 6209, statusCheckRollup: [] }) } });
  const out = drain(base(), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6209, reason: 'pending' }]);
  assert.equal(h.merges().length, 0);
});

test('a failed state read is left open as pending with the error as detail, no merge, no watch', () => {
  const h = harness({ prs: [pr(6210)], viewThrows: { 6210: 'HTTP 502 bad gateway' } });
  const out = drain(base({ ownPr: 6210 }), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6210, reason: 'pending', detail: 'HTTP 502 bad gateway' }]);
  assert.equal(h.merges().length, 0);
  assert.equal(h.clock.sleeps.length, 0);
});

test('ready-run awaiting is pending; ready-run red is red; a failed ready-run read is pending with detail', () => {
  for (const [state, want] of [['awaiting', 'pending'], ['red', 'red']]) {
    const h = harness({ prs: [pr(6211)], ready: { state } });
    const out = drain(base(), h.deps);
    assert.equal(out.leftOpen[0].reason, want, state);
    assert.equal(h.merges().length, 0, state);
  }
  const h = harness({ prs: [pr(6211)], ready: { state: 'read-failed', reason: 'graphql down' } });
  const out = drain(base(), h.deps);
  assert.equal(out.leftOpen[0].reason, 'pending');
  assert.match(out.leftOpen[0].detail, /graphql down/);
  assert.equal(h.merges().length, 0);
});

test('AC3.2: a head that changes between classification and merge is left open as head-changed', () => {
  const h = harness({ prs: [pr(6212)], views: { 6212: [view({ number: 6212 }), view({ number: 6212, headRefOid: SHA('b') })] } });
  const out = drain(base(), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6212, reason: 'head-changed' }]);
  assert.equal(h.merges().length, 0);
});

test('a push between the files read and the pre-merge re-read is scope-checked again (files-outside-skills, no merge)', () => {
  const pushed = view({ number: 6214, files: [{ path: '.claude/skills/x/SKILL.md' }, { path: 'plugin/bin/x.js' }] });
  const h = harness({ prs: [pr(6214)], views: { 6214: [view({ number: 6214 }), pushed] } });
  assert.deepEqual(drain(base(), h.deps).leftOpen, [{ pr: 6214, reason: 'files-outside-skills' }]);
  assert.equal(h.merges().length, 0);
  assert.ok(h.calls.some((c) => c[1] === 'view' && c[c.indexOf('--json') + 1].split(',').includes('files') && c[c.indexOf('--json') + 1] !== 'files'), 'the state call requests files');
});

test('a files list of 100 entries cannot prove scope: files-outside-skills; 99 entries still merge', () => {
  const many = (k) => Array.from({ length: k }, (_, i) => ({ path: `.claude/skills/s${i}/SKILL.md` }));
  const full = harness({ prs: [pr(6215)], files: { 6215: many(100) } });
  assert.deepEqual(drain(base(), full.deps).leftOpen, [{ pr: 6215, reason: 'files-outside-skills' }]);
  assert.equal(full.merges().length, 0);
  const under = harness({ prs: [pr(6216)], files: { 6216: many(99) } });
  assert.deepEqual(drain(base(), under.deps).merged, [6216]);
  assert.equal(scopeProblem({ isCrossRepository: false, headRefName: 'learned-skills/a' }, many(101).map((f) => f.path)), 'files-outside-skills');
});

test('an empty-stderr merge failure whose message carries the command line is merge-failed, not head-changed', () => {
  const h = harness({ prs: [pr(6217)], mergeThrows: { 6217: '' } });
  const out = drain(base(), h.deps);
  assert.equal(out.leftOpen[0].reason, 'merge-failed');
  assert.match(out.leftOpen[0].detail, /Command failed/);
  // the message carries the command line (with the subject/body and the flag name): only stderr may classify
  const cmd = harness({ prs: [pr(6229)], mergeThrows: { 6229: { stderr: '', message: 'Command failed: gh pr merge 6229 --match-head-commit abc --subject "was modified conflict"' } } });
  const cmdOut = drain(base(), cmd.deps);
  assert.equal(cmdOut.leftOpen[0].reason, 'merge-failed');
  assert.deepEqual(cmdOut.conflicting, []);
  const old = harness({ prs: [pr(6218)], mergeThrows: { 6218: 'unknown flag: --match-head-commit' } });
  assert.equal(drain(base(), old.deps).leftOpen[0].reason, 'merge-failed');
});

test('a merge failure on a PR that is no longer OPEN (merged by a concurrent drain) is a no-op in no list', () => {
  const open = view({ number: 6219 });
  const h = harness({ prs: [pr(6219)], views: { 6219: [open, open, view({ number: 6219, state: 'MERGED' })] }, mergeThrows: { 6219: 'Pull request is already merged' } });
  const out = drain(base({ runDir: '/run' }), h.deps);
  assert.deepEqual(out, { merged: [], armed: [], leftOpen: [], conflicting: [], rebuilt: [] });
  assert.equal(h.logged.length, 0);
});

test('under merge-verification off, an own PR with an empty rollup and no head runs is pending at once, without the watch', () => {
  const h = harness({ prs: [pr(6226)], views: { 6226: view({ number: 6226, statusCheckRollup: [] }) } });
  const out = drain(base({ ownPr: 6226, mergeVerification: 'off' }), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6226, reason: 'pending' }]);
  assert.equal(h.clock.sleeps.length, 0);
  assert.equal(h.merges().length, 0);
  // every other off path is unchanged: a running check still gets the watch, and the clause is off-only.
  const running = harness({ prs: [pr(6227)], views: { 6227: view({ number: 6227, statusCheckRollup: RUNNING }) } });
  assert.deepEqual(drain(base({ ownPr: 6227, mergeVerification: 'off' }), running.deps).leftOpen, [{ pr: 6227, reason: 'timeout' }]);
  const wait = harness({ prs: [pr(6228)], views: { 6228: view({ number: 6228, statusCheckRollup: [] }) } });
  assert.deepEqual(drain(base({ ownPr: 6228, mergeVerification: 'wait' }), wait.deps).leftOpen, [{ pr: 6228, reason: 'timeout' }]);
});

test('a head mismatch reported by gh pr merge is head-changed', () => {
  const h = harness({ prs: [pr(6213)], mergeThrows: { 6213: 'Head branch was modified. Review and try the merge again.' } });
  assert.deepEqual(drain(base(), h.deps).leftOpen, [{ pr: 6213, reason: 'head-changed' }]);
});

test('AC3.3 / Decision AC: each scope reason, none merged', () => {
  const cases = [
    [pr(6220, { headRefName: 'feature/x' }), 'not-learned-skills-branch'],
    [pr(6221, { isCrossRepository: true }), 'cross-repository'],
    [pr(6222, { isCrossRepository: true, headRefName: 'feature/x' }), 'cross-repository'],
  ];
  for (const [p, reason] of cases) {
    const h = harness({ prs: [p] });
    const out = drain(base(), h.deps);
    assert.deepEqual(out.leftOpen, [{ pr: p.number, reason }], reason);
    assert.equal(h.merges().length, 0, reason);
    assert.ok(!h.calls.some((c) => c.includes('files')), `${reason}: no files read`);
  }
  const h = harness({ prs: [pr(6223)], files: { 6223: [{ path: '.claude/skills/x/SKILL.md' }, { path: 'plugin/bin/x.js' }] } });
  assert.deepEqual(drain(base(), h.deps).leftOpen, [{ pr: 6223, reason: 'files-outside-skills' }]);
  assert.equal(h.merges().length, 0);
  const none = harness({ prs: [pr(6224)], files: { 6224: [] } });
  assert.equal(drain(base(), none.deps).leftOpen[0].reason, 'files-outside-skills');
  const dots = harness({ prs: [pr(6225)], files: { 6225: [{ path: '.claude/skills/../../x' }] } });
  assert.equal(drain(base(), dots.deps).leftOpen[0].reason, 'files-outside-skills');
});

test('scopeProblem checks in order and reads files only when the first two pass', () => {
  assert.equal(scopeProblem({ isCrossRepository: true, headRefName: 'x' }, GOOD_FILES), 'cross-repository');
  assert.equal(scopeProblem({ isCrossRepository: false, headRefName: 'x' }, GOOD_FILES), 'not-learned-skills-branch');
  assert.equal(scopeProblem({ isCrossRepository: false, headRefName: 'learned-skills/a' }, GOOD_FILES.map((f) => f.path)), null);
  assert.equal(scopeProblem({ isCrossRepository: false, headRefName: 'learned-skills/a' }, undefined), 'files-outside-skills');
});

test('Decision AC: a non-zero gh pr merge (not a head mismatch) is merge-failed with its stderr line as detail', () => {
  const h = harness({ prs: [pr(6230)], mergeThrows: { 6230: 'GraphQL: Pull request is not mergeable\nmore' } });
  const out = drain(base(), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6230, reason: 'merge-failed', detail: 'GraphQL: Pull request is not mergeable' }]);
  assert.deepEqual(out.merged, []);
});

test('a gh pr merge conflict is conflicting', () => {
  const h = harness({ prs: [pr(6231)], mergeThrows: { 6231: 'Pull request has merge conflicts' } });
  assert.deepEqual(drain(base(), h.deps).conflicting, [6231]);
});

test('Decision AC: an own PR under merge-when-green + BLOCKED is armed with --auto, in armed and not in leftOpen', () => {
  const blocked = view({ number: 6232, mergeStateStatus: 'BLOCKED', statusCheckRollup: RUNNING });
  const h = harness({ prs: [pr(6232)], views: { 6232: blocked } });
  const out = drain(base({ ownPr: 6232, mergeVerification: 'merge-when-green' }), h.deps);
  assert.deepEqual(out.armed, [6232]);
  assert.deepEqual(out.leftOpen, []);
  const [m] = h.merges();
  assert.equal(m[3], '--auto');
  assert.equal(h.clock.sleeps.length, 0);
});

test('merge-when-green with a pending own PR that is not BLOCKED degrades to the watch, never arms', () => {
  const clean = view({ number: 6233, mergeStateStatus: 'CLEAN', statusCheckRollup: RUNNING });
  const h = harness({ prs: [pr(6233)], views: { 6233: clean } });
  const out = drain(base({ ownPr: 6233, mergeVerification: 'merge-when-green' }), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6233, reason: 'timeout' }]);
  assert.equal(h.merges().length, 0);
});

test('a BLOCKED own PR whose state read lists a file outside .claude/skills/ is never armed (files-outside-skills, no merge call)', () => {
  const pushed = view({ number: 6250, mergeStateStatus: 'BLOCKED', statusCheckRollup: RUNNING, files: [{ path: 'plugin/bin/x.js' }] });
  const h = harness({ prs: [pr(6250)], views: { 6250: pushed } });
  const out = drain(base({ ownPr: 6250, mergeVerification: 'merge-when-green' }), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6250, reason: 'files-outside-skills' }]);
  assert.deepEqual(out.armed, []);
  assert.equal(h.merges().length, 0);
});

test('the watch: a head that changes during the bounded watch is head-changed, no merge', () => {
  const pending = view({ number: 6251, statusCheckRollup: RUNNING });
  const moved = view({ number: 6251, statusCheckRollup: RUNNING, headRefOid: SHA('b') });
  const h = harness({ prs: [pr(6251)], views: { 6251: [pending, moved] } });
  assert.deepEqual(drain(base({ ownPr: 6251 }), h.deps).leftOpen, [{ pr: 6251, reason: 'head-changed' }]);
  assert.equal(h.merges().length, 0);
});

test('the watch: a rollup that turns red during the watch is red, no merge', () => {
  const pending = view({ number: 6252, statusCheckRollup: RUNNING });
  const red = view({ number: 6252, statusCheckRollup: [{ name: 't', status: 'COMPLETED', conclusion: 'FAILURE' }] });
  const h = harness({ prs: [pr(6252)], views: { 6252: [pending, red] } });
  assert.deepEqual(drain(base({ ownPr: 6252 }), h.deps).leftOpen, [{ pr: 6252, reason: 'red' }]);
  assert.equal(h.merges().length, 0);
});

test('mergeGreen: green at classification but red at the pre-merge re-read is red, no merge', () => {
  const red = view({ number: 6253, statusCheckRollup: [{ name: 't', status: 'COMPLETED', conclusion: 'FAILURE' }] });
  const h = harness({ prs: [pr(6253)], views: { 6253: [view({ number: 6253 }), red] } });
  assert.deepEqual(drain(base(), h.deps).leftOpen, [{ pr: 6253, reason: 'red' }]);
  assert.equal(h.merges().length, 0);
});

test('mergeGreen: green at classification but pending at the pre-merge re-read is not merged (pending)', () => {
  const h = harness({ prs: [pr(6254)], views: { 6254: [view({ number: 6254 }), view({ number: 6254, statusCheckRollup: RUNNING })] } });
  assert.deepEqual(drain(base(), h.deps).leftOpen, [{ pr: 6254, reason: 'pending' }]);
  assert.equal(h.merges().length, 0);
});

test('under off, an empty rollup with a running head run still gets the watch (not the immediate pending)', () => {
  const running = [{ name: 'ci', workflowName: 'ci', status: 'IN_PROGRESS', conclusion: null, url: 'u' }];
  const h = harness({ prs: [pr(6255)], views: { 6255: view({ number: 6255, statusCheckRollup: [] }) }, runs: { [SHA('a')]: running } });
  const out = drain(base({ ownPr: 6255, mergeVerification: 'off' }), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6255, reason: 'timeout' }]);
  assert.ok(h.clock.sleeps.length > 0);
  assert.equal(h.merges().length, 0);
});

test('Decision AC: a drain touching two PRs writes two decisions lines with the lever tag, and no ci-gate write for the other run', () => {
  const h = harness({ prs: [pr(6240), pr(6241)] });
  const out = drain(base({ runDir: '/run', ownPr: 6241 }), h.deps);
  assert.deepEqual(out.merged, [6240, 6241]);
  assert.equal(h.logged.length, 2);
  for (const l of h.logged) assert.match(l, /\[lever: learned-skills-auto-merge=true\]$/);
  assert.match(h.logged[0], /^- AUTO \d\d:\d\d:\d\d — Learned-skills drain: PR #6240 merged/);
  assert.deepEqual(h.gateCalls.map((g) => g.pr), [6241]);
});

test('own-PR ci-gate failure folds into the PR\'s one decision line and the merge continues', () => {
  const h = harness({ prs: [pr(6242)], ciGate: 3 });
  const out = drain(base({ runDir: '/run', ownPr: 6242 }), h.deps);
  assert.deepEqual(out.merged, [6242]);
  assert.equal(h.logged.length, 1);
  assert.match(h.logged[0], /^- AUTO .*PR #6242 merged \(ci-gate not recorded, exit 3\)/);
});

test('a behind-base "Head branch is not up to date" refusal is merge-failed with that line as detail, not head-changed', () => {
  const line = 'Head branch is not up to date with the base branch';
  const h = harness({ prs: [pr(6243)], mergeThrows: { 6243: `${line}\nmore` } });
  assert.deepEqual(drain(base(), h.deps).leftOpen, [{ pr: 6243, reason: 'merge-failed', detail: line }]);
});

test('a compose failure is merge-failed with the compose error first line as detail, no merge call', () => {
  const h = harness({ prs: [pr(6244)] });
  h.deps.compose = () => { throw new Error('compose-subject exited 1: no marker\nsecond'); };
  const out = drain(base(), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6244, reason: 'merge-failed', detail: 'compose-subject exited 1: no marker' }]);
  assert.equal(h.merges().length, 0);
});

test('ready-run red + DIRTY stays red; draft-skip-without-ready-trigger + DIRTY is rebuilt', () => {
  const dirty = { 6245: view({ number: 6245, mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING', statusCheckRollup: [] }) };
  const red = harness({ prs: [pr(6245)], views: dirty, ready: { state: 'red' } });
  assert.deepEqual(drain(base(), red.deps).leftOpen, [{ pr: 6245, reason: 'red' }]);
  const skip = harness({ prs: [pr(6245)], views: dirty, ready: { state: 'draft-skip-without-ready-trigger' }, rebuild: REBUILT });
  assert.deepEqual(drain(base(), skip.deps).rebuilt, [6245]);
});

test('defaultReadyRun pins the ready-run read to the drain repo, not the cwd origin', () => {
  let seen;
  const read = defaultReadyRun('github.com/acme/repo', {
    makeDeps: () => ({ repoTarget: () => ({ owner: 'other', repo: 'origin' }) }),
    resolve: (d, a) => { seen = { target: d.repoTarget(), a }; return { state: 'met' }; },
  });
  assert.deepEqual(read({ pr: 7, sha: SHA('a') }), { state: 'met' });
  assert.deepEqual(seen, { target: { owner: 'acme', repo: 'repo' }, a: { pr: 7, sha: SHA('a') } });
});

test('AC5.1: in an unprotected repo (CLEAN) a drain never merges a PR whose checks have not all completed green', () => {
  const rollups = {
    empty: { rollup: [], reason: 'timeout' },
    partial: { rollup: [{ name: 'a', status: 'IN_PROGRESS', conclusion: null }, { name: 'b', status: 'COMPLETED', conclusion: 'SUCCESS' }], reason: 'timeout' },
    cancelled: { rollup: [{ name: 'a', status: 'COMPLETED', conclusion: 'CANCELLED' }], reason: 'timeout' },
    headRun: { rollup: OK, runs: [{ workflowName: 'w', status: 'in_progress', conclusion: '' }], reason: 'timeout' },
  };
  for (const [name, c] of Object.entries(rollups)) {
    const h = harness({
      prs: [pr(6250)], views: { 6250: view({ number: 6250, statusCheckRollup: c.rollup }) },
      runs: c.runs ? { [SHA('a')]: c.runs } : {},
    });
    const out = drain(base({ ownPr: 6250, mergeVerification: 'merge-when-green' }), h.deps);
    assert.equal(h.merges().length, 0, name);
    assert.deepEqual(out.leftOpen, [{ pr: 6250, reason: c.reason }], name);
  }
});

test('a PR already merged (state MERGED at the state read) is a no-op in no list', () => {
  const h = harness({ prs: [pr(6252)], views: { 6252: view({ number: 6252, state: 'MERGED' }) } });
  const out = drain(base({ runDir: '/run', ownPr: 6252 }), h.deps);
  assert.deepEqual(out, { merged: [], armed: [], leftOpen: [], conflicting: [], rebuilt: [] });
  assert.equal(h.logged.length, 0);
  assert.equal(h.merges().length, 0);
});

test('autoMerge false merges nothing and makes no gh call; no gh: no-gh for the own PR, no gh call', () => {
  const h = harness({ prs: [pr(6260)] });
  const out = drain(base({ autoMerge: false }), h.deps);
  assert.equal(out.disabled, true);
  assert.equal(h.calls.length, 0);
  const g = harness({ prs: [pr(6260)] });
  g.deps.ghAvailable = () => false;
  assert.deepEqual(drain(base({ ownPr: 6260 }), g.deps).leftOpen, [{ pr: 6260, reason: 'no-gh' }]);
  assert.deepEqual(drain(base(), g.deps).leftOpen, []);
  assert.equal(g.calls.length, 0);
});

test('a failed pr list throws', () => {
  const h = harness({ listThrows: 'HTTP 500' });
  assert.throws(() => drain(base(), h.deps), /HTTP 500/);
});

test('own PR writes drain.json; a sibling writes no drain.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-'));
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'drain-'));
  try {
    const h = harness({ prs: [pr(6270), pr(6271)] });
    drain(base({ runDir: dir, ownPr: 6271 }), h.deps);
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'learned-skills', 'drain.json'), 'utf8'));
    assert.deepEqual(rec, { pr: 6271, outcome: 'merged' });
    const h2 = harness({ prs: [pr(6272, { headRefName: 'x/y' })] });
    drain(base({ runDir: dir2, ownPr: 6273 }), h2.deps);
    assert.ok(!fs.existsSync(path.join(dir2, 'learned-skills', 'drain.json')));
    const h3 = harness({ prs: [pr(6274, { headRefName: 'x/y' })] });
    drain(base({ runDir: dir2, ownPr: 6274 }), h3.deps);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir2, 'learned-skills', 'drain.json'), 'utf8')), { pr: 6274, outcome: 'left-open', reason: 'not-learned-skills-branch' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  }
});

test('LEFT_OPEN_REASONS is exactly the closed set', () => {
  assert.deepEqual([...LEFT_OPEN_REASONS], ['pending', 'timeout', 'red', 'head-changed', 'cross-repository', 'not-learned-skills-branch', 'files-outside-skills', 'merge-failed', 'no-gh', 'lease-rejected', 'git-too-old', 'rebuild-failed', 'conflict needs a human']);
  assert.ok(Object.isFrozen(LEFT_OPEN_REASONS));
});

test('classifyPr: closed, conflicting, draft and green verdicts', () => {
  assert.equal(classifyPr(view({ state: 'CLOSED' }), [], { state: 'met' }), 'closed');
  assert.equal(classifyPr(view(), [], { state: 'met' }), 'green');
  assert.equal(classifyPr(view({ isDraft: true }), [], { state: 'met' }), 'pending');
  assert.equal(classifyPr(view({ mergeable: 'CONFLICTING' }), [], { state: 'awaiting' }), 'conflicting');
  assert.equal(classifyPr(view(), [{ workflowName: 'w', status: 'completed', conclusion: 'cancelled' }], { state: 'met' }), 'pending');
  assert.equal(classifyPr(view(), [], { state: 'draft-skip-without-ready-trigger' }), 'red');
});

test('classifyPr: a held newest run is pending, a newer success over a cancelled run is green, a non-held non-OK conclusion stays red', () => {
  const T1 = '2026-11-26T10:00:00Z';
  const T2 = '2026-11-26T11:00:00Z';
  assert.equal(classifyPr(view(), [{ workflowName: 'w', status: 'completed', conclusion: 'action_required', startedAt: T1, databaseId: 1 }], { state: 'met' }), 'pending');
  assert.equal(classifyPr(view(), [
    { workflowName: 'w', status: 'completed', conclusion: 'cancelled', startedAt: T1, databaseId: 1 },
    { workflowName: 'w', status: 'completed', conclusion: 'success', startedAt: T2, databaseId: 2 },
  ], { state: 'met' }), 'green');
  const weird = view({ statusCheckRollup: [{ name: 'x', status: 'COMPLETED', conclusion: 'WEIRD' }] });
  assert.equal(classifyPr(weird, [], { state: 'met' }), 'red');
});

// The Step 2.5 table's header columns and Value column, parsed from the shared contract.
function leverTable(text) {
  const section = text.slice(text.indexOf('## Step 2.5'));
  const lines = section.slice(0, section.indexOf('\n## ', 5)).split('\n');
  const head = lines.findIndex((l) => /^\|\s*Value\s*\|/.test(l));
  assert.notEqual(head, -1, 'the lever table header');
  const cols = lines[head].split('|').slice(1, -1).map((c) => c.trim());
  const values = [];
  for (let i = head + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const m = /^\|\s*`([^`]+)`/.exec(lines[i]);
    if (m) values.push(m[1]);
  }
  return { cols, values };
}

test("twin pin: LEVER_ACTIONS rows equal Step 2.5's table Value column", () => {
  const text = readText(path.join(__dirname, '..', '..', '..', 'plugin', 'skills', '_shared', 'pr-first-merge.md'));
  const { cols, values } = leverTable(text);
  assert.deepEqual(cols, ['Value', 'Green', 'Pending', 'Red']);
  assert.deepEqual(Object.keys(LEVER_ACTIONS).sort(), [...values].sort());
  assert.deepEqual([...values].sort(), ['merge-when-green', 'off', 'wait']);
  // go-red control: a row added to the table makes the parsed set differ from the module's.
  const drifted = text.replace('| `off` |', '| `strict` | x | x | x |\n| `off` |');
  assert.notDeepEqual(Object.keys(LEVER_ACTIONS).sort(), leverTable(drifted).values.sort());
});

test('an unexpected rebuild reason becomes rebuild-failed naming it', () => {
  for (const [reason, detail] of [['made-up', 'unexpected rebuild reason: made-up'], [undefined, 'unexpected rebuild reason: none']]) {
    const h = harness({ prs: [pr(6204)], views: { 6204: dirtyView(6204) }, rebuild: () => ({ ok: false, reason }) });
    assert.deepEqual(drain(base(), h.deps).leftOpen, [{ pr: 6204, reason: 'rebuild-failed', detail }]);
  }
  for (const reason of ['lease-rejected', 'git-too-old', 'head-changed', 'not-learned-skills-branch', 'conflict needs a human: a, b']) {
    const h = harness({ prs: [pr(6204)], views: { 6204: dirtyView(6204) }, rebuild: () => ({ ok: false, reason }) });
    assert.deepEqual(drain(base(), h.deps).leftOpen, [{ pr: 6204, reason }], reason);
  }
});

test('under off, a rebuilt own PR with no checks at all is pending at once, without the watch', () => {
  const h = harness({ prs: [pr(6295)], views: { 6295: dirtyView(6295) }, rebuild: REBUILT });
  const out = drain(base({ ownPr: 6295, mergeVerification: 'off' }), h.deps);
  assert.deepEqual(out.rebuilt, [6295]);
  assert.deepEqual(out.leftOpen, [{ pr: 6295, reason: 'pending' }]);
  assert.equal(h.clock.sleeps.length, 0);
  const wait = harness({ prs: [pr(6296)], views: { 6296: dirtyView(6296) }, rebuild: REBUILT });
  assert.deepEqual(drain(base({ ownPr: 6296, mergeVerification: 'wait' }), wait.deps).leftOpen, [{ pr: 6296, reason: 'timeout' }]);
});

test('under merge-when-green, a rebuilt own PR that reads BLOCKED pending at the new head is never armed', () => {
  const blockedC = view({ number: 6297, headRefOid: SHA('c'), mergeStateStatus: 'BLOCKED', statusCheckRollup: RUNNING });
  const h = harness({ prs: [pr(6297)], views: { 6297: [dirtyView(6297), blockedC] }, rebuild: REBUILT });
  const out = drain(base({ ownPr: 6297, mergeVerification: 'merge-when-green' }), h.deps);
  assert.deepEqual(out.rebuilt, [6297]);
  assert.deepEqual(out.armed, []);
  assert.equal(h.merges().length, 0);
  assert.deepEqual(out.leftOpen, [{ pr: 6297, reason: 'timeout' }]);
});

test('after a rebuild the ci-gate record gets the pre-rebuild gateStart and the rebuilt head', () => {
  const green = view({ number: 6298, headRefOid: SHA('c') });
  const h = harness({ prs: [pr(6298)], views: { 6298: [dirtyView(6298), green] }, rebuild: REBUILT });
  const out = drain(base({ runDir: '/run', ownPr: 6298 }), h.deps);
  assert.deepEqual(out.merged, [6298]);
  assert.equal(h.gateCalls.length, 1);
  assert.equal(h.gateCalls[0].headSha, SHA('c'));
  assert.equal(h.gateCalls[0].gateStartEpoch, 1_700_000_000);
  assert.ok(h.clock.t > 1_700_000_000_000, 'the clock advanced past the gate start');
});

test('AC1.1 AC1.2: drain rebuilds the second of two double-append PRs (real git)', (t) => {
  const fx = rebuildFixture(t);
  const append = (after, line) => (repo) => {
    const p = path.join(repo, FILE);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(after, `${after}${line}`));
  };
  const A = fx.lsBranch('A', append('- two\n', '- a\n'));
  const B = fx.lsBranch('B', append('- two\n', '- b\n'));
  fx.advanceMain(A);
  const h = harness({
    prs: [pr(6300, { headRefName: 'learned-skills/B' })],
    views: { 6300: dirtyView(6300, { headRefOid: B }) },
  });
  delete h.deps.rebuild; // the real rebuild, pointed at the fixture clone
  const out = drain(base({ cwd: fx.clone }), h.deps);
  assert.deepEqual(out.rebuilt, [6300], JSON.stringify(out));
  assert.deepEqual(out.leftOpen, [{ pr: 6300, reason: 'pending' }]);
  fx.sh(fx.clone, ['fetch', '-q', 'origin']);
  assert.equal(fx.sh(fx.clone, ['show', 'origin/learned-skills/B:' + FILE]), '# x\n\n- one\n- two\n- a\n- b\n\nend\n');
  const diff = fx.sh(fx.clone, ['diff', 'origin/main', 'origin/learned-skills/B']);
  const added = diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
  assert.deepEqual(added, ['+- b']);
});
