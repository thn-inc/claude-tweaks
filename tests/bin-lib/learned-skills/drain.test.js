'use strict';
// The learned-skills drain (#6112): merges green marker PRs through _shared/pr-first-merge.md Step 2.5's
// semantics. A scripted fake `gh` answers by argv and a fake clock advances on `sleep`; nothing touches the network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  drain, LEFT_OPEN_REASONS, LEVER_ACTIONS, scopeProblem, classifyPr,
} = require('../../../plugin/bin/lib/learned-skills/drain.js');

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
function harness({ prs = [], views = {}, runs = {}, files = {}, ready = {}, mergeThrows = {}, viewThrows = {}, ciGate = 0, listThrows = null } = {}) {
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
      if (!Array.isArray(v)) return JSON.stringify(v);
      seq[n] = seq[n] || 0;
      const out = v[Math.min(seq[n], v.length - 1)];
      seq[n] += 1;
      return JSON.stringify(out);
    }
    if (a === 'run' && b === 'list') return JSON.stringify(runs[args[args.indexOf('--commit') + 1]] || []);
    if (a === 'pr' && b === 'merge') {
      if (mergeThrows[n]) throw Object.assign(new Error('Command failed: gh pr merge'), { stderr: mergeThrows[n] });
      return '';
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  const logged = [];
  const gateCalls = [];
  const deps = {
    gh,
    ghAvailable: () => true,
    now: () => clock.t,
    sleep: (ms) => { clock.sleeps.push(ms); clock.t += ms; },
    readyRun: () => ({ state: 'not-applicable', readySince: null, readyWorkflows: [], ...ready }),
    appendEntries: ({ items }) => { logged.push(...items.map((i) => i.entry)); },
    ciGateRecord: (a) => { gateCalls.push(a); return ciGate; },
  };
  return { deps, calls, clock, logged, gateCalls, merges: () => calls.filter((c) => c[0] === 'pr' && c[1] === 'merge') };
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
  assert.ok(h.clock.sleeps.length >= 1 && h.clock.sleeps.every((s) => s === 30000));
});

test('AC1.4: a red PR is left open with no label writes', () => {
  const h = harness({ prs: [pr(6203)], views: { 6203: view({ number: 6203, statusCheckRollup: [{ name: 't', status: 'COMPLETED', conclusion: 'FAILURE' }] }) } });
  const out = drain(base(), h.deps);
  assert.deepEqual(out.leftOpen, [{ pr: 6203, reason: 'red' }]);
  assert.equal(h.merges().length, 0);
  assert.ok(!h.calls.some((c) => c[0] === 'issue' || c.includes('--add-label') || c.includes('--remove-label')));
});

test('AC1.5: a DIRTY PR is reported conflicting', () => {
  const h = harness({ prs: [pr(6204)], views: { 6204: view({ number: 6204, mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING', statusCheckRollup: [] }) } });
  const out = drain(base(), h.deps);
  assert.deepEqual(out.conflicting, [6204]);
  assert.deepEqual(out.leftOpen, []);
  assert.equal(h.merges().length, 0);
});

test('a sibling turned DIRTY by an earlier merge in the same drain is conflicting', () => {
  const dirty = view({ number: 6206, mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING' });
  const h = harness({ prs: [pr(6205), pr(6206)], views: { 6206: [view({ number: 6206 }), dirty] } });
  const out = drain(base(), h.deps);
  assert.deepEqual(out.merged, [6205]);
  assert.deepEqual(out.conflicting, [6206]);
  assert.equal(h.merges().length, 1);
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

test('Decision AC: a drain touching two PRs writes two decisions lines with the lever tag, and no ci-gate write for the other run', () => {
  const h = harness({ prs: [pr(6240), pr(6241)] });
  const out = drain(base({ runDir: '/run', ownPr: 6241 }), h.deps);
  assert.deepEqual(out.merged, [6240, 6241]);
  assert.equal(h.logged.length, 2);
  for (const l of h.logged) assert.match(l, /\[lever: learned-skills-auto-merge=true\]$/);
  assert.match(h.logged[0], /^- AUTO \d\d:\d\d:\d\d — Learned-skills drain: PR #6240 merged/);
  assert.deepEqual(h.gateCalls.map((g) => g.pr), [6241]);
});

test('own-PR ci-gate failure logs one SKIP and the merge continues', () => {
  const h = harness({ prs: [pr(6242)], ciGate: 3 });
  const out = drain(base({ runDir: '/run', ownPr: 6242 }), h.deps);
  assert.deepEqual(out.merged, [6242]);
  assert.equal(h.logged.filter((l) => /^- SKIP /.test(l)).length, 1);
});

test('AC5.1: in an unprotected repo (CLEAN) a drain never merges a PR whose checks have not all completed green', () => {
  const rollups = {
    empty: { rollup: [], reason: 'timeout' },
    partial: { rollup: [{ name: 'a', status: 'IN_PROGRESS', conclusion: null }, { name: 'b', status: 'COMPLETED', conclusion: 'SUCCESS' }], reason: 'timeout' },
    cancelled: { rollup: [{ name: 'a', status: 'COMPLETED', conclusion: 'CANCELLED' }], reason: 'red' },
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

test('own PR turning conflicting during the watch is conflicting, not timeout', () => {
  const pending = view({ number: 6251, statusCheckRollup: RUNNING });
  const dirty = view({ number: 6251, mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING', statusCheckRollup: [] });
  const h = harness({ prs: [pr(6251)], views: { 6251: [pending, pending, dirty] } });
  const out = drain(base({ ownPr: 6251 }), h.deps);
  assert.deepEqual(out.conflicting, [6251]);
  assert.deepEqual(out.leftOpen, []);
});

test('a PR already merged (state MERGED at the state read) is a no-op in no list', () => {
  const h = harness({ prs: [pr(6252)], views: { 6252: view({ number: 6252, state: 'MERGED' }) } });
  const out = drain(base({ runDir: '/run', ownPr: 6252 }), h.deps);
  assert.deepEqual(out, { merged: [], armed: [], leftOpen: [], conflicting: [] });
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
  assert.deepEqual([...LEFT_OPEN_REASONS], ['pending', 'timeout', 'red', 'head-changed', 'cross-repository', 'not-learned-skills-branch', 'files-outside-skills', 'merge-failed', 'no-gh']);
  assert.ok(Object.isFrozen(LEFT_OPEN_REASONS));
});

test('classifyPr: closed, conflicting, draft and green verdicts', () => {
  assert.equal(classifyPr(view({ state: 'CLOSED' }), [], { state: 'met' }), 'closed');
  assert.equal(classifyPr(view(), [], { state: 'met' }), 'green');
  assert.equal(classifyPr(view({ isDraft: true }), [], { state: 'met' }), 'pending');
  assert.equal(classifyPr(view({ mergeable: 'CONFLICTING' }), [], { state: 'awaiting' }), 'conflicting');
  assert.equal(classifyPr(view(), [{ workflowName: 'w', status: 'completed', conclusion: 'cancelled' }], { state: 'met' }), 'red');
  assert.equal(classifyPr(view(), [], { state: 'draft-skip-without-ready-trigger' }), 'red');
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
  const text = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'plugin', 'skills', '_shared', 'pr-first-merge.md'), 'utf8');
  const { cols, values } = leverTable(text);
  assert.deepEqual(cols, ['Value', 'Green', 'Pending', 'Red']);
  assert.deepEqual(Object.keys(LEVER_ACTIONS).sort(), [...values].sort());
  assert.deepEqual([...values].sort(), ['merge-when-green', 'off', 'wait']);
  // go-red control: a row added to the table makes the parsed set differ from the module's.
  const drifted = text.replace('| `off` |', '| `strict` | x | x | x |\n| `off` |');
  assert.notDeepEqual(Object.keys(LEVER_ACTIONS).sort(), leverTable(drifted).values.sort());
});
