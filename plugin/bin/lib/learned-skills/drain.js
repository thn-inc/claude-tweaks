// plugin/bin/lib/learned-skills/drain.js — merges green learned-skills PRs at the end of wrap-up (#6112).
//
// A candidate is an open PR whose body carries `<!-- wrap-up-skills-pr -->`; nothing else is listed or
// reported. Each candidate, oldest number first, is scope-checked (same repository, `learned-skills/*`
// head, every changed file under `.claude/skills/`), read (state, head runs, ready-run), classified and
// then merged, armed, watched or left open. The semantics are `_shared/pr-first-merge.md` Step 2.5's:
// the strict-green rule (an empty rollup, a pending entry or run, or any completed non-success
// conclusion is never green), the Conflict-path-first rule, and the lever table below. The drain never
// takes Step 2.5's explicit-`off` "merge anyway" route: its green is stricter.
//
// leftOpen reasons (closed set, spec Decision 1): LEFT_OPEN_REASONS. `conflicting` and `armed` are
// separate lists; `rebuilt` lists the PRs whose conflict the rebuild cleared (#6113). A failed files/state/runs/ready-run read is `pending` with the error as `detail`,
// never merged or watched. The one merge call is `gh pr merge --squash --delete-branch
// --match-head-commit {sha}` with a subject composed by compose-subject's record-less form; no label
// or issue call exists here. Every classified PR writes one decisions.md line when a run dir is set;
// only the own PR writes the ci-gate event and drain.json.
//
// Scope is proven at three points: before the state read (the files read, so the first-failure order stays
// cross-repository, not-learned-skills-branch, files-outside-skills), on the state read that guards the
// arm, watch and immediate-merge paths, and again on the pre-merge re-read, whose state call also
// requests `files`, so a push between the reads is never merged unchecked.
// `gh pr view --json files` caps at 100 entries: a list of 100 or more cannot prove scope and reports
// `files-outside-skills`. A merge failure re-reads the PR state once; a PR no longer OPEN (a concurrent
// drain merged it) is a no-op, and a head mismatch is classified from the "was modified" wording on
// stderr only, never from the command line in an error message.
//
// Under `mergeVerification: off` the rollup of a repo with no PR CI stays empty forever, so an own PR
// whose rollup is empty and which has no head runs is left open `pending` at once, without the watch.
//
// A PR that classifies conflicting is rebuilt on the integration tip (rebuild.js: a pure double append, one
// leased push) and then follows the pending path, the own PR on the running watch's deadline, with at most one
// rebuild per PR per drain. A refusal is left open with the rebuild's reason (`conflict needs a human: {files}`,
// `lease-rejected`, `git-too-old`, `rebuild-failed`). `conflicting` now means only a conflict the merge call
// itself reported, or a PR that conflicts again after its rebuild.
//
// Every side effect goes through `deps` so tests inject a fake gh and a fake clock.
'use strict';

const path = require('path');
const { realDeps: lsRealDeps, firstStderrLine } = require('./learned-skills');
const { drainPath } = require('./layout');
const { classifyRollup, normalizeEntry, normalizeHeadRun } = require('../pr-checks/classify');
const { MERGE_GATE_WATCH_SECONDS } = require('../ci-health/constants');
const { defaultDeps: readyRunDefaultDeps, resolveReadyRun } = require('../pr-checks/ready-run');
const { rebuild: realRebuild } = require('./rebuild');
const { formatEntry, appendEntries } = require('../log-decision/append');
const composeSubject = require('../compose-subject');

const MARKER = /<!-- wrap-up-skills-pr -->/;
const BRANCH_PREFIX = 'learned-skills/';
const SKILLS_PREFIX = '.claude/skills/';
const POLL_MS = 30000;
const FILES_CAP = 100; // gh pr view --json files returns at most 100 entries
const LOG_SECTION = '/wrap-up';
const STEP = 'Learned-skills drain';
const LEVER = 'learned-skills-auto-merge=true';
const OK_CONCLUSIONS = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];

const LEFT_OPEN_REASONS = Object.freeze([
  'pending', 'timeout', 'red', 'head-changed', 'cross-repository', 'not-learned-skills-branch',
  'files-outside-skills', 'merge-failed', 'no-gh',
  'lease-rejected', 'git-too-old', 'rebuild-failed', 'conflict needs a human',
]);

// Step 2.5's table, Value column x Green/Pending/Red. An unknown value resolves to `wait`.
const LEVER_ACTIONS = Object.freeze({
  'merge-when-green': Object.freeze({ green: 'merge', pending: 'arm-if-blocked-else-watch', red: 'leave-open' }),
  wait: Object.freeze({ green: 'merge', pending: 'watch', red: 'leave-open' }),
  off: Object.freeze({ green: 'merge', pending: 'watch', red: 'leave-open' }),
});

// null when the PR may be considered for a merge, else the first failing scope reason.
function scopeProblem({ isCrossRepository, headRefName } = {}, files) {
  if (isCrossRepository) return 'cross-repository';
  if (typeof headRefName !== 'string' || !headRefName.startsWith(BRANCH_PREFIX)) return 'not-learned-skills-branch';
  if (!Array.isArray(files) || files.length === 0 || files.length >= FILES_CAP) return 'files-outside-skills';
  const inside = (p) => typeof p === 'string' && !p.split('/').includes('..') && p.startsWith(SKILLS_PREFIX) && p.length > SKILLS_PREFIX.length;
  return files.every(inside) ? null : 'files-outside-skills';
}

// 'green' | 'pending' | 'red' | 'conflicting' | 'closed'. `ready` is the ready-run read's envelope.
function classifyPr(view, headRuns, ready) {
  if (!view || view.state !== 'OPEN') return 'closed';
  const rollup = Array.isArray(view.statusCheckRollup) ? view.statusCheckRollup : null;
  const r = ready || {};
  const conflicting = view.mergeStateStatus === 'DIRTY' || view.mergeable === 'CONFLICTING';
  const verdict = classifyRollup({
    rollup, headRefOid: view.headRefOid, localHead: view.headRefOid, hasPrCi: true, headRuns,
    readySince: r.readySince, readyWorkflows: r.readyWorkflows,
  });
  if (verdict.state === 'red') return 'red';
  const checks = [...(rollup || []).map(normalizeEntry), ...(Array.isArray(headRuns) ? headRuns : []).map(normalizeHeadRun)];
  if (checks.some((c) => c.status === 'COMPLETED' && !OK_CONCLUSIONS.includes(c.conclusion || ''))) return 'red';
  // Step 2.5: only `awaiting` and `draft-skip-without-ready-trigger` yield to the Conflict path; a red ready-run stays red.
  if (r.state === 'red' || (!conflicting && r.state === 'draft-skip-without-ready-trigger')) return 'red';
  if (conflicting) return 'conflicting';
  if (view.isDraft || verdict.state !== 'green' || r.state === 'awaiting' || r.state === 'read-failed') return 'pending';
  return 'green';
}

const parseJson = (text, what) => {
  try { return JSON.parse(text); } catch { throw new Error(`${what} returned unparseable JSON`); }
};

function defaultCompose(deps) {
  return (prNumber, repo) => {
    let stdout = '';
    let stderr = '';
    const code = composeSubject.run(['--housekeeping', '--pr', String(prNumber), '--repo', repo], {
      ...composeSubject.realDeps,
      ghAvailable: () => true, // the drain already checked gh (or its injected transport)
      runner: (a) => deps.gh(a),
      stdout: (s) => { stdout += s; },
      stderr: (s) => { stderr += s; },
    });
    if (code !== 0) throw new Error(`compose-subject exited ${code}: ${stderr.trim().split(/\r?\n/)[0] || 'no output'}`);
    const composed = parseJson(stdout, 'compose-subject');
    if (!composed || typeof composed.title !== 'string' || !composed.title || typeof composed.body !== 'string') {
      throw new Error('compose-subject printed no title and body');
    }
    return { title: composed.title, body: composed.body };
  };
}

function defaultCiGateRecord({ pr, headSha, gateStartEpoch, runDir, repo }) {
  return require('../../ci-gate-record').run([
    '--pr', String(pr), '--head-sha', headSha, '--verdict', 'green',
    '--gate-start-epoch', String(gateStartEpoch), '--run', runDir, '--repo', repo,
  ]);
}

// The ready-run read pinned to the drain's repo: its reads take owner/name from `repoTarget`, not a
// --repo flag, so a cwd whose origin is another repo cannot redirect them.
function defaultReadyRun(repo, { resolve = resolveReadyRun, makeDeps = readyRunDefaultDeps, cwd = process.cwd() } = {}) {
  const [owner, name] = String(repo).split('/').slice(-2);
  return ({ pr, sha }) => resolve({ ...makeDeps(cwd), repoTarget: () => ({ owner, repo: name }) }, { pr, sha });
}

const defaults = {
  gh: (args) => lsRealDeps.gh(args),
  ghAvailable: () => require('../repo-resolve').ghAvailable(),
  now: () => Date.now(),
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  ciGateRecord: defaultCiGateRecord,
  appendEntries,
  mkdir: lsRealDeps.mkdir,
  writeFile: lsRealDeps.writeFile,
};
const defaultRebuild = (cwd) => (args) => realRebuild({ ...args, cwd });

// { runDir, integrationBranch, ownPr, repo, autoMerge, mergeVerification } -> the outcome lists.
function drain(opts, overrides = {}) {
  const { runDir, ownPr, repo, autoMerge } = opts;
  const cwd = opts.cwd || process.cwd();
  const deps = { ...defaults, ...overrides };
  if (!overrides.compose) deps.compose = defaultCompose(deps);
  if (!overrides.rebuild) deps.rebuild = defaultRebuild(cwd);
  if (!overrides.readyRun) deps.readyRun = defaultReadyRun(repo);
  const notes = {}; // a PR's own ci-gate miss, folded into its one decision line
  const own = ownPr ? Number(ownPr) : null;
  const lever = LEVER_ACTIONS[opts.mergeVerification] ? opts.mergeVerification : 'wait';
  const out = { merged: [], armed: [], leftOpen: [], conflicting: [], rebuilt: [] };
  if (autoMerge !== true) return { ...out, disabled: true };

  const log = (status, step, text, reversibility) => {
    if (!runDir) return;
    try {
      deps.appendEntries({ runDir, items: [{ section: LOG_SECTION, entry: formatEntry({ status, now: deps.now(), step, text, reversibility, lever: LEVER }) }] });
    } catch { /* the outcome lists are the record */ }
  };
  // One outcome per PR: the list, its decisions.md line, and (own PR only) drain.json.
  const settle = (pr, outcome, reason, detail) => {
    const note = notes[pr] || '';
    if (outcome === 'merged') { out.merged.push(pr); log('AUTO', STEP, `PR #${pr} merged${note}`, 'low'); }
    else if (outcome === 'armed') { out.armed.push(pr); log('AUTO', STEP, `PR #${pr} armed to merge when the forge's checks pass${note}`, 'high'); }
    else {
      const what = outcome === 'conflicting' ? 'conflicting' : `left open (${reason})`;
      if (outcome === 'conflicting') out.conflicting.push(pr);
      else out.leftOpen.push({ pr, reason, ...(detail ? { detail } : {}) });
      log('SKIP', `${STEP} (degraded)`, `condition: PR #${pr} ${what}${detail ? `: ${detail}` : ''}${note} → fallback: left for a human or a later drain.`, 'n/a');
    }
    if (pr === own && runDir) {
      const record = { pr, outcome: outcome === 'leftOpen' ? 'left-open' : outcome, ...(reason ? { reason } : {}) };
      try { deps.mkdir(path.dirname(drainPath(runDir))); deps.writeFile(drainPath(runDir), JSON.stringify(record) + '\n'); } catch { /* best effort */ }
    }
  };
  const open = (pr, reason, detail) => settle(pr, 'leftOpen', reason, detail);

  // A classified-conflicting PR: rebuild it once on the integration tip. The new head, or null when the PR
  // was settled (refused, failed, or conflicting again after its rebuild).
  const rebuiltOnce = new Set();
  const rebuildOrSettle = (n, headRef, oldHead) => {
    if (rebuiltOnce.has(n)) { settle(n, 'conflicting'); return null; }
    rebuiltOnce.add(n);
    let res;
    try { res = deps.rebuild({ pr: n, headRef, oldHead, integrationBranch: opts.integrationBranch }); } catch (err) {
      open(n, 'rebuild-failed', firstStderrLine(err));
      return null;
    }
    if (!res || res.ok !== true) {
      open(n, (res && res.reason) || 'rebuild-failed', res && res.detail);
      return null;
    }
    out.rebuilt.push(n);
    log('AUTO', STEP, `PR #${n} rebuilt on ${opts.integrationBranch} (old head ${oldHead})`, 'med');
    return res.commit;
  };

  if (!deps.ghAvailable()) {
    if (own) open(own, 'no-gh');
    return out;
  }

  const candidates = parseJson(deps.gh(['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'number,headRefName,isCrossRepository,body']), 'gh pr list');
  if (!Array.isArray(candidates)) throw new Error('gh pr list did not return an array');
  const marked = candidates.filter((c) => c && MARKER.test(String(c.body || ''))).sort((a, b) => a.number - b.number);

  // state + head runs + ready-run for one PR; throws on any failed read.
  const read = (n) => {
    const view = parseJson(deps.gh(['pr', 'view', String(n), '--repo', repo, '--json', 'number,state,isDraft,mergeStateStatus,mergeable,headRefOid,statusCheckRollup,files,title,body']), 'gh pr view');
    if (!view || typeof view !== 'object' || Array.isArray(view)) throw new Error('gh pr view returned no object');
    if (view.state !== 'OPEN') return { view, headRuns: [], ready: null, verdict: 'closed' };
    if (typeof view.headRefOid !== 'string' || !view.headRefOid || !Array.isArray(view.statusCheckRollup)) throw new Error('gh pr view returned no head commit or check rollup');
    const headRuns = parseJson(deps.gh(['run', 'list', '--repo', repo, '--commit', view.headRefOid, '--limit', '100', '--json', 'name,workflowName,status,conclusion,url']), 'gh run list');
    if (!Array.isArray(headRuns)) throw new Error('gh run list did not return an array');
    const ready = deps.readyRun({ pr: n, sha: view.headRefOid });
    if (!ready || ready.state === 'read-failed' || typeof ready.state !== 'string') throw new Error(`ready-run read failed: ${(ready && ready.reason) || 'no state'}`);
    return { view, headRuns, ready, verdict: classifyPr(view, headRuns, ready) };
  };

  const mergeArgs = (n, sha, composed, arm) => [
    'pr', 'merge', String(n), ...(arm ? ['--auto'] : []), '--repo', repo, '--squash', '--delete-branch',
    '--match-head-commit', sha, '--subject', composed.title, '--body', composed.body,
  ];

  // The merge (or the arm) itself. Throws nothing: every failure settles the PR.
  const land = (n, sha, arm) => {
    let composed;
    try { composed = deps.compose(n, repo); } catch (err) { return open(n, 'merge-failed', firstStderrLine(err)); }
    try {
      deps.gh(mergeArgs(n, sha, composed, arm));
    } catch (err) {
      // A concurrent drain may have merged it already: a PR no longer OPEN is a no-op.
      try {
        const now = parseJson(deps.gh(['pr', 'view', String(n), '--repo', repo, '--json', 'state']), 'gh pr view state');
        if (now && now.state && now.state !== 'OPEN') return undefined;
      } catch { /* classify from the merge error */ }
      const text = String((err && err.stderr) || '');
      if (/conflict/i.test(text)) return settle(n, 'conflicting');
      if (/was modified/i.test(text)) return open(n, 'head-changed');
      return open(n, 'merge-failed', firstStderrLine(err));
    }
    return settle(n, arm ? 'armed' : 'merged');
  };

  const filePaths = (files) => (Array.isArray(files) ? files.map((f) => f && f.path) : []);

  // Green verdict at `sha`: a fresh re-read, then the one merge call.
  // Returns { rebuilt: newHead } when the own PR was rebuilt and its watch must continue on that head.
  const mergeGreen = (n, sha, gateStart, cand) => {
    let fresh;
    try { fresh = read(n); } catch (err) { return open(n, 'pending', firstStderrLine(err)); }
    if (fresh.verdict === 'closed') return undefined;
    if (fresh.view.headRefOid !== sha) return open(n, 'head-changed');
    const recheck = scopeProblem(cand, filePaths(fresh.view.files));
    if (recheck) return open(n, recheck);
    if (fresh.verdict === 'conflicting') {
      const commit = rebuildOrSettle(n, cand.headRefName, sha);
      if (!commit) return undefined;
      return n === own ? { rebuilt: commit } : open(n, 'pending');
    }
    if (fresh.verdict === 'red') return open(n, 'red');
    if (fresh.verdict !== 'green') return open(n, 'pending');
    if (n === own && runDir) {
      let code;
      try { code = deps.ciGateRecord({ pr: n, headSha: sha, gateStartEpoch: gateStart, runDir, repo }); } catch { code = 1; }
      if (code !== 0) notes[n] = ` (ci-gate not recorded, exit ${code})`;
    }
    return land(n, sha, false);
  };

  // The own PR's one bounded watch; `lag` is a head a poll may still report while GitHub catches up.
  const watch = (n, sha, lag, gateStart, c, deadline) => {
    let cur = sha;
    let stale = lag;
    while (deps.now() < deadline) {
      deps.sleep(POLL_MS);
      let poll;
      try { poll = read(n); } catch (err) { return open(n, 'pending', firstStderrLine(err)); }
      if (poll.verdict === 'closed') return undefined;
      const head = poll.view.headRefOid;
      if (stale && head === stale) continue;
      if (head !== cur) return open(n, 'head-changed');
      if (poll.verdict === 'conflicting') {
        const commit = rebuildOrSettle(n, c.headRefName, cur);
        if (!commit) return undefined;
        stale = cur;
        cur = commit;
        continue;
      }
      if (poll.verdict === 'red') return open(n, 'red');
      if (poll.verdict === 'green') {
        const r = mergeGreen(n, cur, gateStart, c);
        if (r && r.rebuilt) { stale = cur; cur = r.rebuilt; continue; }
        return undefined;
      }
    }
    return open(n, 'timeout');
  };

  for (const c of marked) {
    const n = c.number;
    try {
      const problem = scopeProblem(c, null);
      let scope = problem === 'files-outside-skills' ? null : problem;
      if (!scope) {
        let files;
        try {
          files = (parseJson(deps.gh(['pr', 'view', String(n), '--repo', repo, '--json', 'files']), 'gh pr view files') || {}).files;
        } catch (err) { open(n, 'pending', firstStderrLine(err)); continue; }
        scope = scopeProblem(c, filePaths(files));
      }
      if (scope) { open(n, scope); continue; }

      const gateStart = Math.floor(deps.now() / 1000);
      let state;
      try { state = read(n); } catch (err) { open(n, 'pending', firstStderrLine(err)); continue; }
      const sha = state.view.headRefOid;
      if (state.verdict === 'closed') continue;
      const stateScope = scopeProblem(c, filePaths(state.view.files)); // before any arm, watch or merge
      if (stateScope) { open(n, stateScope); continue; }
      if (state.verdict === 'conflicting') {
        const commit = rebuildOrSettle(n, c.headRefName, sha);
        if (!commit) continue;
        if (n !== own) { open(n, 'pending'); continue; }
        watch(n, commit, sha, gateStart, c, deps.now() + MERGE_GATE_WATCH_SECONDS * 1000);
        continue;
      }
      if (state.verdict === 'red') { open(n, 'red'); continue; }
      if (state.verdict === 'green') {
        const r = mergeGreen(n, sha, gateStart, c);
        if (r && r.rebuilt) watch(n, r.rebuilt, sha, gateStart, c, deps.now() + MERGE_GATE_WATCH_SECONDS * 1000);
        continue;
      }
      // pending
      if (n !== own) { open(n, 'pending'); continue; }
      if (opts.mergeVerification === 'off' && state.view.statusCheckRollup.length === 0 && state.headRuns.length === 0) { open(n, 'pending'); continue; }
      if (LEVER_ACTIONS[lever].pending === 'arm-if-blocked-else-watch' && state.view.mergeStateStatus === 'BLOCKED') {
        land(n, sha, true);
        continue;
      }
      watch(n, sha, null, gateStart, c, deps.now() + MERGE_GATE_WATCH_SECONDS * 1000);
    } catch (err) {
      open(n, 'pending', firstStderrLine(err));
    }
  }
  return out;
}

module.exports = { LEFT_OPEN_REASONS, LEVER_ACTIONS, scopeProblem, classifyPr, defaultReadyRun, drain };
