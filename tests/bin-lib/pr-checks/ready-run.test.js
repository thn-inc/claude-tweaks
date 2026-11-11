'use strict';
// #5153 — the ready-run reader (plugin/bin/lib/pr-checks/ready-run.js) and its
// status-as-data CLI (plugin/bin/ready-run.js). Fake `gh` and `git` runners
// branch on argv shape and throw `unexpected …` on anything else; argv is
// recorded inside the runner and asserted after the call returns.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { gitRepo, fixtureGit } = require('../../helpers/git-fixtures');
const { readPullRequestWorkflow } = require('../../../plugin/bin/lib/merge-verification');
const {
  STATES, READY_EVENT_QUERY, defaultDeps, readReadyRun, readyRunState, resolveReadyRun,
} = require('../../../plugin/bin/lib/pr-checks/ready-run');
const { run, parseArgs, USAGE } = require('../../../plugin/bin/ready-run');

const SHA = 'a'.repeat(40);
const PR = 7;
const READY = '2026-11-11T00:45:28Z';
const BEFORE = '2026-11-11T00:29:06Z';
const AFTER = '2026-11-11T00:50:00Z';
const TARGET = { owner: 'o', repo: 'r', slug: 'o/r', host: 'github.com', ghRepo: 'o/r' };
const CI = '.github/workflows/ci.yml';

// A draft-skip job under the default activity types (no ready_for_review).
const DRAFT_SKIP_DEFAULT = 'name: ci\non:\n  pull_request:\njobs:\n  test:\n    if: github.event.pull_request.draft == false\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n';
// The same skip, but the workflow fires on ready_for_review.
const DRAFT_SKIP_READY = 'name: ci\non:\n  pull_request:\n    types: [opened, synchronize, reopened, ready_for_review]\njobs:\n  test:\n    if: github.event.pull_request.draft == false\n    runs-on: ubuntu-latest\n';
// A bare pull_request workflow with no draft reference: no ready-run requirement.
const BARE_PR = 'name: test\non:\n  pull_request:\njobs:\n  t:\n    runs-on: ubuntu-latest\n';
// An `on:` the reader cannot read: prTrigger true, unparsed true.
const UNPARSED = 'name: weird\non: *anchor\njobs: {}\n';

const wf = (file, text) => ({ file, ...readPullRequestWorkflow(text) });

function restRun(p, { event = 'pull_request', created = AFTER, status = 'completed', conclusion = 'success', id = 1, name = 'ci' } = {}) {
  return { id, name, path: p, event, status, conclusion, created_at: created, html_url: `https://github.com/o/r/actions/runs/${id}` };
}

// Serves ls-tree / cat-file from an in-memory map through parseLsTreeZ's input
// shape (`<mode> <type> <sha>\t<path>\0`). A value of { tree: true } is a
// sub-directory entry; anything else is a blob's text.
function fakeGit(files, calls) {
  const blobs = new Map();
  let i = 0;
  const entries = Object.entries(files).map(([p, v]) => {
    const sha = String(++i).padStart(40, '0');
    if (v && v.tree) return `040000 tree ${sha}\t${p}\0`;
    blobs.set(sha, v);
    return `100644 blob ${sha}\t${p}\0`;
  });
  return (args) => {
    calls.push(args);
    if (args[0] === 'ls-tree') return entries.join('');
    if (args[0] === 'cat-file' && args[1] === 'blob' && blobs.has(args[2])) return blobs.get(args[2]);
    throw new Error('unexpected git ' + args.join(' '));
  };
}

function throwingGit(calls, err = Object.assign(new Error('fatal: not a tree object'), { status: 128 })) {
  return (args) => { calls.push(args); throw err; };
}

function timelineBody(nodes) {
  return JSON.stringify({ data: { repository: { pullRequest: { timelineItems: { nodes } } } } });
}

// opts: ready (nodes, default one READY event), timeline (fn replacing the
// graphql answer), runs (rows or fn), total (total_count), contents (fn).
function fakeGh(opts, calls) {
  const { ready = [{ createdAt: READY }], timeline, runs = [], total, contents } = opts;
  return (args) => {
    calls.push(args);
    if (args[1] === 'graphql') return timeline ? timeline(args) : timelineBody(ready);
    if (typeof args[1] === 'string' && args[1].includes('/actions/runs?')) {
      if (typeof runs === 'function') return runs(args);
      return JSON.stringify({ total_count: total ?? runs.length, workflow_runs: runs });
    }
    if (typeof args[1] === 'string' && args[1].includes('/contents/') && contents) return contents(args);
    throw new Error('unexpected ' + args.join(' '));
  };
}

function harness({ files = {}, git, gh = {}, repoTarget = () => TARGET, ghAvailable = () => true } = {}) {
  const ghCalls = [];
  const gitCalls = [];
  const deps = {
    gh: fakeGh(gh, ghCalls),
    git: git ? git(gitCalls) : fakeGit(files, gitCalls),
    repoTarget,
    ghAvailable,
  };
  return { deps, ghCalls, gitCalls };
}

const isRunsCall = (a) => typeof a[1] === 'string' && a[1].includes('/actions/runs?');
const isContentsCall = (a) => typeof a[1] === 'string' && a[1].includes('/contents/');

// gh's real 404 throw: exit 1, the JSON body on stdout, the summary on stderr.
function gh404(message) {
  return Object.assign(new Error(`Command failed: gh api repos/o/r/contents/.github/workflows?ref=${SHA}\ngh: ${message} (HTTP 404)\n`), {
    status: 1,
    stdout: JSON.stringify({ message, documentation_url: 'https://docs.github.com/rest/repos/contents#get-repository-content', status: '404' }),
    stderr: `gh: ${message} (HTTP 404)\n`,
  });
}

function contentsServing(files) {
  return (args) => {
    const [, url] = args;
    if (url === `repos/o/r/contents/.github/workflows?ref=${SHA}`) {
      return JSON.stringify([
        ...Object.keys(files).map((p) => ({ type: 'file', name: p.split('/').pop(), path: p })),
        { type: 'dir', name: 'sub', path: '.github/workflows/sub' },
        { type: 'file', name: 'README.md', path: '.github/workflows/README.md' },
      ]);
    }
    for (const [p, text] of Object.entries(files)) {
      if (url === `repos/o/r/contents/${p}?ref=${SHA}`) {
        return JSON.stringify({ type: 'file', path: p, encoding: 'base64', content: Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n') });
      }
    }
    throw new Error('unexpected ' + args.join(' '));
  };
}

const ARGS = { pr: PR, sha: SHA };

test('readReadyRun: a ready event but no workflow requiring a ready run → not-applicable with no runs read', () => {
  const h = harness({ files: { '.github/workflows/test.yml': BARE_PR } });
  const read = readReadyRun(h.deps, ARGS);
  assert.equal(read.readySince, READY);
  assert.deepEqual(read.headRuns, []);
  assert.deepEqual(read.workflows.map((w) => w.file), ['.github/workflows/test.yml']);
  assert.equal(readyRunState(read).state, 'not-applicable');
  assert.equal(h.ghCalls.filter(isRunsCall).length, 0);
  assert.equal(h.ghCalls.filter(isContentsCall).length, 0);
});

test('readReadyRun: the timeline argv passes owner/name with -f and number with -F, and the query asks last:1', () => {
  assert.equal(READY_EVENT_QUERY, 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){timelineItems(itemTypes:[READY_FOR_REVIEW_EVENT],last:1){nodes{...on ReadyForReviewEvent{createdAt}}}}}}');
  const h = harness({ gh: { ready: [] } });
  readReadyRun(h.deps, ARGS);
  assert.deepEqual(h.ghCalls, [['api', 'graphql', '-f', 'owner=o', '-f', 'name=r', '-F', 'number=7', '-f', `query=${READY_EVENT_QUERY}`]]);
});

test('readReadyRun: no ready event (never a draft, or still a draft) → no requirement with zero git calls and no runs read', () => {
  const h = harness({ git: (calls) => (args) => { calls.push(args); throw new Error('git must not be called'); }, gh: { ready: [] } });
  const read = readReadyRun(h.deps, ARGS);
  assert.deepEqual(read, { readySince: null, workflows: [], headRuns: [] });
  assert.equal(h.gitCalls.length, 0);
  assert.equal(h.ghCalls.length, 1);
  assert.equal(h.ghCalls[0][1], 'graphql');
  assert.equal(resolveReadyRun(h.deps, ARGS).state, 'not-applicable');
});

test('readReadyRun: the last ready event wins, and a body on a failed exit is still read', () => {
  const two = harness({ files: { [CI]: BARE_PR }, gh: { ready: [{ createdAt: BEFORE }, { createdAt: READY }] } });
  assert.equal(readReadyRun(two.deps, ARGS).readySince, READY);
  // gh exits non-zero on a GraphQL `errors` entry but still prints the body on stdout.
  const thrown = harness({
    files: { [CI]: BARE_PR },
    gh: { timeline: () => { throw Object.assign(new Error('Command failed: gh api graphql'), { status: 1, stdout: timelineBody([{ createdAt: READY }]), stderr: 'gh: partial\n' }); } },
  });
  assert.equal(readReadyRun(thrown.deps, ARGS).readySince, READY);
  // A failed exit whose body carries an empty `nodes` (and `errors`) is a failed read, never "no event".
  const emptyOnError = harness({
    files: { [CI]: DRAFT_SKIP_DEFAULT },
    gh: { timeline: () => { throw Object.assign(new Error('Command failed: gh api graphql\ngh: something failed\n'), { status: 1, stdout: JSON.stringify({ data: { repository: { pullRequest: { timelineItems: { nodes: [] } } } }, errors: [{ message: 'something failed' }] }), stderr: 'gh: something failed\n' }); } },
  });
  const failedEmpty = resolveReadyRun(emptyOnError.deps, ARGS);
  assert.equal(failedEmpty.state, 'read-failed');
  assert.equal(failedEmpty.reason, 'ready-event read failed: gh: something failed');
});

test('readReadyRun: the runs read is a GET path with head_sha and per_page=100 and no -f/-F', () => {
  const h = harness({ files: { [CI]: DRAFT_SKIP_READY } });
  readReadyRun(h.deps, ARGS);
  const runsCalls = h.ghCalls.filter(isRunsCall);
  assert.deepEqual(runsCalls, [['api', `repos/o/r/actions/runs?head_sha=${SHA}&per_page=100`]]);
});

test('readReadyRun: a ready event and a non-local head read the workflows through the contents API at the ref', () => {
  const h = harness({ git: throwingGit, gh: { contents: contentsServing({ [CI]: DRAFT_SKIP_DEFAULT }) } });
  const env = resolveReadyRun(h.deps, ARGS);
  assert.equal(env.state, 'draft-skip-without-ready-trigger');
  assert.deepEqual(env.draftSkipWithoutReadyTrigger, [CI]);
  const contentsCalls = h.ghCalls.filter(isContentsCall);
  assert.deepEqual(contentsCalls, [
    ['api', `repos/o/r/contents/.github/workflows?ref=${SHA}`],
    ['api', `repos/o/r/contents/${CI}?ref=${SHA}`],
  ]);
  for (const c of contentsCalls) {
    assert.ok(c[1].endsWith(`?ref=${SHA}`));
    assert.ok(!c.includes('-f') && !c.includes('-F'));
  }
});

test('readReadyRun: a ready event with neither local objects nor the contents API is read-failed naming both causes and git fetch origin pull/{n}/head', () => {
  // Both errors in their real shape: the `Command failed:` argv line is dropped, the stderr kept.
  const gitErr = Object.assign(new Error('Command failed: git -C /r ls-tree -z --end-of-options x\nfatal: not a tree object\n'), { status: 128, stderr: 'fatal: not a tree object\n' });
  const h = harness({
    git: (calls) => throwingGit(calls, gitErr),
    gh: { contents: () => { throw Object.assign(new Error('Command failed: gh api repos/o/r/contents\ngh: HTTP 502\n'), { status: 1, stderr: 'gh: HTTP 502\n' }); } },
  });
  const env = resolveReadyRun(h.deps, ARGS);
  assert.equal(env.state, 'read-failed');
  assert.equal(env.reason, `workflows unreadable at ${SHA}: local objects (fatal: not a tree object); contents API (gh: HTTP 502) — run: git fetch origin pull/7/head`);
  assert.equal(h.ghCalls.filter(isRunsCall).length, 0);
});

test('readReadyRun: a contents-API 404 on the workflows listing is no workflows, never read-failed', () => {
  const h = harness({ git: throwingGit, gh: { contents: () => { throw gh404('Not Found'); } } });
  const read = readReadyRun(h.deps, ARGS);
  assert.deepEqual(read, { readySince: READY, workflows: [], headRuns: [] });
  assert.equal(readyRunState(read).state, 'not-applicable');
  assert.equal(h.ghCalls.filter(isRunsCall).length, 0);
  // A 404 naming the ref is an unresolved input, not an absent directory: fail closed.
  const noCommit = harness({ git: throwingGit, gh: { contents: () => { throw gh404(`No commit found for the ref ${SHA}`); } } });
  const env = resolveReadyRun(noCommit.deps, ARGS);
  assert.equal(env.state, 'read-failed');
  assert.match(env.reason, /^workflows unreadable at a{40}: local objects \(fatal: not a tree object\); contents API \(gh: No commit found for the ref a{40} \(HTTP 404\)\) — run: git fetch origin pull\/7\/head$/);
});

test('readReadyRun: a failed timeline read is read-failed unless the local workflows show no requirement', () => {
  const failing = () => { throw Object.assign(new Error('Command failed: gh api graphql\ngh: HTTP 502\n'), { status: 1, stdout: '', stderr: 'gh: HTTP 502\n' }); };
  // Local objects show a draft skip: a ready-run rule could apply, so fail closed.
  const skip = harness({ files: { [CI]: DRAFT_SKIP_DEFAULT }, gh: { timeline: failing } });
  const env = resolveReadyRun(skip.deps, ARGS);
  assert.equal(env.state, 'read-failed');
  assert.equal(env.reason, 'ready-event read failed: gh: HTTP 502');
  assert.equal(skip.ghCalls.filter(isContentsCall).length, 0);
  // Local objects with only a bare pull_request workflow: no rule can apply.
  const bare = harness({ files: { '.github/workflows/test.yml': BARE_PR }, gh: { timeline: failing } });
  const read = readReadyRun(bare.deps, ARGS);
  assert.equal(read.readySince, null);
  assert.deepEqual(read.headRuns, []);
  assert.equal(readyRunState(read).state, 'not-applicable');
  assert.equal(bare.ghCalls.filter(isRunsCall).length, 0);
  // A missing pullRequest (NOT_FOUND) is malformed, and takes the same local-only route.
  const nullPr = () => JSON.stringify({ data: { repository: { pullRequest: null } } });
  assert.equal(resolveReadyRun(harness({ files: { '.github/workflows/test.yml': BARE_PR }, gh: { timeline: nullPr } }).deps, ARGS).state, 'not-applicable');
  const malformed = resolveReadyRun(harness({ files: { [CI]: DRAFT_SKIP_DEFAULT }, gh: { timeline: () => 'not json' } }).deps, ARGS);
  assert.equal(malformed.state, 'read-failed');
  assert.match(malformed.reason, /^ready-event read failed: /);
  // An unparseable createdAt on the last node is malformed too.
  assert.equal(resolveReadyRun(harness({ files: { [CI]: DRAFT_SKIP_DEFAULT }, gh: { ready: [{ createdAt: 'soon' }] } }).deps, ARGS).state, 'read-failed');
  // The local read failing as well never reaches for the contents API.
  const noLocal = harness({ git: throwingGit, gh: { timeline: failing } });
  assert.equal(resolveReadyRun(noLocal.deps, ARGS).reason, 'ready-event read failed: gh: HTTP 502');
  assert.equal(noLocal.ghCalls.filter(isContentsCall).length, 0);
});

test('readReadyRun: a truncated runs page, a non-list runs body, gh absent and an unresolvable repo are each read-failed with their own reason', () => {
  const files = { [CI]: DRAFT_SKIP_READY };
  const reason = (opts) => resolveReadyRun(harness({ files, ...opts }).deps, ARGS).reason;
  assert.equal(reason({ gh: { runs: [restRun(CI)], total: 150 } }), 'runs read truncated: 1 of 150');
  assert.equal(reason({ gh: { runs: () => JSON.stringify({ total_count: 0, workflow_runs: null }) } }), 'runs read failed: not a list');
  // A page is whole only when total_count proves it: absent or non-integer fails closed.
  assert.equal(reason({ gh: { runs: () => JSON.stringify({ workflow_runs: [] }) } }), 'runs read failed: no total_count');
  assert.equal(reason({ gh: { runs: () => JSON.stringify({ total_count: '500', workflow_runs: [] }) } }), 'runs read failed: no total_count');
  assert.equal(reason({ gh: { runs: () => { throw Object.assign(new Error('Command failed: gh api\ngh: HTTP 500\n'), { status: 1, stderr: 'gh: HTTP 500\n' }); } } }), 'runs read failed: gh: HTTP 500');
  // A silent non-zero exit names its exit, never the `Command failed:` argv line.
  assert.equal(reason({ gh: { runs: () => { throw Object.assign(new Error(`Command failed: gh api repos/o/r/actions/runs?head_sha=${SHA}&per_page=100`), { status: 1, stderr: '' }); } } }), 'runs read failed: exit 1');
  assert.equal(reason({ ghAvailable: () => false }), 'gh absent');
  assert.equal(reason({ repoTarget: () => null }), 'repo unresolvable from origin');
  assert.equal(reason({ repoTarget: () => ({ refusal: 'origin host x.example is not a known GitHub host' }) }), 'repo unresolvable from origin: origin host x.example is not a known GitHub host');
  assert.equal(reason({ repoTarget: () => ({ ...TARGET, owner: '..' }) }), 'repo unresolvable from origin');
  assert.equal(reason({ repoTarget: () => ({ ...TARGET, repo: '.' }) }), 'repo unresolvable from origin');
  assert.equal(reason({ repoTarget: () => { throw new Error('boom'); } }), 'repo unresolvable from origin');
  // A caller that bypasses the CLI's validation never reaches gh with a bad value.
  const bad = harness({ files });
  assert.match(resolveReadyRun(bad.deps, { pr: 7, sha: 'HEAD&x=1' }).reason, /^invalid arguments: /);
  assert.match(resolveReadyRun(bad.deps, { pr: 0, sha: SHA }).reason, /^invalid arguments: /);
  assert.equal(bad.ghCalls.length, 0);
});

test('AC6.1: a draft-skip workflow with default types gives draft-skip-without-ready-trigger naming the file', () => {
  const files = { [CI]: DRAFT_SKIP_DEFAULT, '.github/workflows/README.md': 'not a workflow', '.github/workflows/sub': { tree: true } };
  const h = harness({ files });
  const env = resolveReadyRun(h.deps, ARGS);
  assert.equal(env.state, 'draft-skip-without-ready-trigger');
  assert.deepEqual(env.draftSkipWithoutReadyTrigger, [CI]);
  assert.deepEqual(h.gitCalls[0], ['ls-tree', '-z', '--end-of-options', SHA, '--', '.github/workflows/']);
  assert.deepEqual(h.gitCalls.slice(1).map((a) => a.slice(0, 2)), [['cat-file', 'blob']]);
  // CRLF checkout bytes read the same.
  const crlf = harness({ files: { [CI]: DRAFT_SKIP_DEFAULT.replace(/\n/g, '\r\n') } });
  assert.deepEqual(resolveReadyRun(crlf.deps, ARGS).draftSkipWithoutReadyTrigger, [CI]);
});

test('AC6.2: a workflow declaring ready_for_review never gives draft-skip-without-ready-trigger', () => {
  const files = { [CI]: DRAFT_SKIP_READY };
  const none = resolveReadyRun(harness({ files }).deps, ARGS);
  assert.equal(none.state, 'awaiting');
  assert.deepEqual(none.awaitingReadyRun, [CI]);
  assert.deepEqual(none.readyWorkflows, [CI]);
  assert.deepEqual(none.draftSkipWithoutReadyTrigger, []);
  const met = resolveReadyRun(harness({ files, gh: { runs: [restRun(CI, { event: 'pull_request' })] } }).deps, ARGS);
  assert.equal(met.state, 'met');
  assert.deepEqual(met.awaitingReadyRun, []);
  // A run created before the ready event is a draft-time run and counts for nothing.
  const early = resolveReadyRun(harness({ files, gh: { runs: [restRun(CI, { created: BEFORE })] } }).deps, ARGS);
  assert.equal(early.state, 'awaiting');
  for (const env of [none, met, early]) assert.notEqual(env.state, 'draft-skip-without-ready-trigger');
});

test('readyRunState: red wins over draft-skip and awaiting; an unparsed workflow is awaited and listed in unparsed', () => {
  const A = '.github/workflows/a.yml';
  const B = '.github/workflows/b.yml';
  const C = '.github/workflows/c.yml';
  const workflows = [wf(A, DRAFT_SKIP_DEFAULT), wf(B, DRAFT_SKIP_READY), wf(C, UNPARSED)];
  const red = readyRunState({ readySince: READY, workflows, headRuns: [restRun(B, { conclusion: 'failure', id: 9, name: 'b' })] });
  assert.equal(red.state, 'red');
  assert.deepEqual(red.failing, [{ name: 'b', url: 'https://github.com/o/r/actions/runs/9' }]);
  assert.deepEqual(red.draftSkipWithoutReadyTrigger, [A]);
  assert.deepEqual(red.awaitingReadyRun, [C]);
  assert.deepEqual(red.unparsed, [C]);
  assert.deepEqual(red.readyWorkflows, [B, C]);
  const parked = readyRunState({ readySince: READY, workflows, headRuns: [restRun(B)] });
  assert.equal(parked.state, 'draft-skip-without-ready-trigger');
  assert.deepEqual(parked.awaitingReadyRun, [C]);
  const awaiting = readyRunState({ readySince: READY, workflows, headRuns: [restRun(A), restRun(B)] });
  assert.equal(awaiting.state, 'awaiting');
  assert.deepEqual(awaiting.awaitingReadyRun, [C]);
  assert.deepEqual(awaiting.unparsed, [C]);
  assert.deepEqual(awaiting.draftSkipWithoutReadyTrigger, []);
  // No readySince, or no requirement, is not-applicable whatever the runs say.
  assert.equal(readyRunState({ readySince: null, workflows, headRuns: [] }).state, 'not-applicable');
  assert.equal(readyRunState({ readySince: READY, workflows: [wf(CI, BARE_PR)], headRuns: [] }).state, 'not-applicable');
  assert.deepEqual(Object.keys(red), ['state', 'readySince', 'readyWorkflows', 'awaitingReadyRun', 'pending', 'failing', 'draftSkipWithoutReadyTrigger', 'unparsed']);
});

test('AC6.1 (Reading B): a draft-skip workflow without ready_for_review parks only while it has no post-ready run', () => {
  const files = { [CI]: DRAFT_SKIP_DEFAULT };
  const at = (runs) => resolveReadyRun(harness({ files, gh: { runs } }).deps, ARGS);
  const parked = at([restRun(CI, { created: BEFORE })]);
  assert.equal(parked.state, 'draft-skip-without-ready-trigger');
  assert.deepEqual(parked.draftSkipWithoutReadyTrigger, [CI]);
  // A later `synchronize` push ran it after ready: judged like any ready workflow.
  const met = at([restRun(CI, { created: BEFORE }), restRun(CI, { event: 'pull_request', created: AFTER, id: 2 })]);
  assert.equal(met.state, 'met');
  assert.deepEqual(met.draftSkipWithoutReadyTrigger, []);
  const running = at([restRun(CI, { status: 'in_progress', conclusion: null })]);
  assert.equal(running.state, 'awaiting');
  assert.deepEqual(running.pending, [CI]);
  assert.deepEqual(running.draftSkipWithoutReadyTrigger, []);
  const failed = at([restRun(CI, { conclusion: 'failure' })]);
  assert.equal(failed.state, 'red');
  assert.deepEqual(failed.draftSkipWithoutReadyTrigger, []);
});

test('real git: workflows are read at the sha from a committed fixture repo', (t) => {
  const repo = gitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.github', 'workflows', 'ci.yml'), DRAFT_SKIP_DEFAULT);
  fs.writeFileSync(path.join(repo, '.github', 'workflows', 'notes.txt'), 'not a workflow\n');
  fixtureGit(['-C', repo, 'add', '.github']);
  fixtureGit(['-C', repo, 'commit', '-q', '-m', 'ci']);
  const sha = String(fixtureGit(['-C', repo, 'rev-parse', 'HEAD'])).trim();
  // A later commit that drops the workflow: the read is at `sha`, not at HEAD.
  fixtureGit(['-C', repo, 'rm', '-q', '-r', '.github']);
  fixtureGit(['-C', repo, 'commit', '-q', '-m', 'drop']);
  const ghCalls = [];
  const deps = { ...defaultDeps(repo), gh: fakeGh({}, ghCalls), repoTarget: () => TARGET, ghAvailable: () => true };
  const read = readReadyRun(deps, { pr: PR, sha });
  assert.deepEqual(read.workflows.map((w) => w.file), [CI]);
  assert.equal(read.workflows[0].draftReference, true);
  assert.equal(readyRunState(read).state, 'draft-skip-without-ready-trigger');
  assert.equal(ghCalls.filter(isContentsCall).length, 0);
});

// ---- CLI ----------------------------------------------------------------

const emitted = new Set();

function cli(argv, readerDeps, cwd = '/work') {
  const out = [];
  const err = [];
  const roots = [];
  const deps = {
    cwd: () => cwd,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    readerDeps: (root) => { roots.push(root); return readerDeps; },
  };
  const code = run(argv, deps);
  return { code, out: out.join(''), err: err.join(''), roots };
}

test('CLI: malformed --pr/--sha/--root, a trailing bare flag, an empty value and an unknown arg each exit 2 with no gh or git call', () => {
  const cases = [
    [],
    ['--sha', SHA],
    ['--pr', '7'],
    ['--pr', '0', '--sha', SHA],
    ['--pr', '07', '--sha', SHA],
    ['--pr', 'abc', '--sha', SHA],
    ['--pr', '', '--sha', SHA],
    ['--pr', '7', '--sha', 'abc'],
    ['--pr', '7', '--sha', SHA.toUpperCase()],
    ['--pr', '7', '--sha', `${SHA}0`],
    ['--pr', '7', '--sha', ''],
    ['--pr', '7', '--sha', SHA, '--root', ''],
    ['--pr', '7', '--sha', SHA, '--root', '-x'],
    ['--pr', '7', '--sha', SHA, '--root'],
    ['--pr', '7', '--sha'],
    ['--pr'],
    ['--pr', '7', '--sha', SHA, '--bogus'],
    ['--pr', '7', '--sha', SHA, 'extra'],
  ];
  for (const argv of cases) {
    const h = harness({ files: { [CI]: DRAFT_SKIP_READY } });
    const r = cli(argv, h.deps);
    assert.equal(r.code, 2, `exit 2 for ${JSON.stringify(argv)}`);
    assert.equal(r.out, '', `no stdout for ${JSON.stringify(argv)}`);
    assert.match(r.err, /^ready-run\.js: /);
    assert.ok(r.err.includes(USAGE));
    assert.deepEqual(r.roots, []);
    assert.equal(h.ghCalls.length + h.gitCalls.length, 0);
  }
  assert.ok(parseArgs(['--pr', '7']).error);
  assert.deepEqual(parseArgs(['--pr', '7', '--sha', SHA, '--root', '/r']), { pr: 7, sha: SHA, root: '/r', help: false });
});

test('CLI: --help prints USAGE built from STATES and exits 0 without probing', () => {
  assert.ok(Object.isFrozen(STATES));
  assert.deepEqual([...STATES], ['not-applicable', 'met', 'awaiting', 'red', 'draft-skip-without-ready-trigger', 'read-failed']);
  assert.ok(USAGE.includes(`state: ${STATES.join(' | ')}`));
  for (const s of STATES) assert.ok(USAGE.includes(s), s);
  const h = harness();
  const r = cli(['--help'], h.deps);
  assert.equal(r.code, 0);
  assert.equal(r.out, USAGE);
  assert.deepEqual(r.roots, []);
  assert.equal(h.ghCalls.length + h.gitCalls.length, 0);
});

test('CLI: run prints exactly the core envelope plus pr and sha on one line, exit 0 in every state', () => {
  const cases = [
    ['not-applicable', { gh: { ready: [] } }],
    ['met', { files: { [CI]: DRAFT_SKIP_READY }, gh: { runs: [restRun(CI)] } }],
    ['awaiting', { files: { [CI]: DRAFT_SKIP_READY } }],
    ['red', { files: { [CI]: DRAFT_SKIP_READY }, gh: { runs: [restRun(CI, { conclusion: 'failure' })] } }],
    ['draft-skip-without-ready-trigger', { files: { [CI]: DRAFT_SKIP_DEFAULT } }],
    ['read-failed', { ghAvailable: () => false }],
  ];
  for (const [state, opts] of cases) {
    const h = harness(opts);
    const r = cli(['--pr', '7', '--sha', SHA], h.deps);
    assert.equal(r.code, 0, state);
    assert.equal(r.err, '', state);
    assert.ok(r.out.endsWith('\n') && r.out.indexOf('\n') === r.out.length - 1, `one line for ${state}`);
    const printed = JSON.parse(r.out);
    assert.deepEqual(printed, { ...resolveReadyRun(harness(opts).deps, ARGS), pr: PR, sha: SHA });
    assert.equal(printed.state, state);
    assert.deepEqual(r.roots, ['/work']);
    emitted.add(printed.state);
  }
  const rooted = cli(['--pr', '7', '--sha', SHA, '--root', '/elsewhere'], harness({ gh: { ready: [] } }).deps);
  assert.deepEqual(rooted.roots, ['/elsewhere']);
  emitted.add(JSON.parse(rooted.out).state);
  // A removed cwd (a reaped worktree) is read-failed data, still exit 0, with nothing read.
  const out = [];
  const code = run(['--pr', '7', '--sha', SHA], {
    cwd: () => { throw Object.assign(new Error('ENOENT: process.cwd failed'), { code: 'ENOENT' }); },
    stdout: (s) => out.push(s),
    stderr: () => {},
    readerDeps: () => { throw new Error('reader must not be built'); },
  });
  assert.equal(code, 0);
  const gone = JSON.parse(out.join(''));
  assert.equal(gone.state, 'read-failed');
  assert.equal(gone.reason, 'checkout unreadable: ENOENT: process.cwd failed');
  assert.equal(gone.pr, PR);
  emitted.add(gone.state);
});

test('CLI: the states its cases emit cover STATES exactly', () => {
  assert.deepEqual([...emitted].sort(), [...STATES].sort());
});
