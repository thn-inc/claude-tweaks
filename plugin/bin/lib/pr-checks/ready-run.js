// bin/lib/pr-checks/ready-run.js — the merge gate's ready-run read (#5153):
// does the CI run that `gh pr ready` starts exist and pass yet, so draft-time
// skipped jobs never read as green. Consumed by bin/ready-run.js (the
// status-as-data CLI _shared/pr-first-merge.md Step 2.5 runs) and
// bin/pr-checks.js (readReadyRun / defaultDeps).
//
// readReadyRun reads, in this fixed order, and stops at the first that settles it:
//   1. the PR timeline's last ReadyForReviewEvent (GraphQL). No event means the
//      PR was never a draft, or still is one: no requirement, and no workflow
//      file or run is read — so a head missing from the local object store can
//      never demote that verdict;
//   2. the workflow files at `sha`: local objects first (`git ls-tree` +
//      `git cat-file`), else the REST contents API at that ref;
//   3. the REST runs listing for `sha` (`actions/runs?head_sha=`), only when
//      readyRequirement (merge-verification.js) names a workflow to wait on.
// readyRunState then classifies with classify.js's readyRunVerdict.
//
// Fail closed: a read failure is `read-failed` with a named reason, never
// `not-applicable`. The one exception is a failed or malformed timeline read
// whose local workflows show no requirement (no draft reference, no
// ready_for_review, nothing unparsed): no ready-run rule could apply there, so
// a GraphQL blip does not park merges on a repo that never skips drafts. That
// exception reads local objects only — never the contents API.
'use strict';

const { execFileSync } = require('child_process');
const { readPullRequestWorkflow, readyRequirement } = require('../merge-verification');
const { readyRunVerdict } = require('./classify');
const { parseLsTreeZ } = require('../git-z');
const { repoTargetOf } = require('../hooks/git-exec');
const { ghOptions, ghAvailable } = require('../repo-resolve');
const sharedPrimitives = require('../shared-primitives');

const STATES = Object.freeze(['not-applicable', 'met', 'awaiting', 'red', 'draft-skip-without-ready-trigger', 'read-failed']);

const READY_EVENT_QUERY = 'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){timelineItems(itemTypes:[READY_FOR_REVIEW_EVENT],last:1){nodes{...on ReadyForReviewEvent{createdAt}}}}}}';

const WORKFLOWS_DIR = '.github/workflows/';

// GH_TIMEOUT_MS / GIT_TIMEOUT_MS are lazy getters (a policy read); they are
// resolved per call, never at require time.
function defaultDeps(root) {
  const { LARGE_MAX_BUFFER_BYTES } = sharedPrimitives;
  return {
    gh: (args) => execFileSync('gh', args, ghOptions(args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: sharedPrimitives.GH_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true })),
    git: (args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: sharedPrimitives.GIT_TIMEOUT_MS, maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true }),
    repoTarget: () => repoTargetOf(root),
    ghAvailable: () => ghAvailable(),
  };
}

// One line of a failed call's cause. execFileSync's message is `Command failed:
// <argv>` (the whole GraphQL query) followed by the child's stderr, so that
// first line is dropped; a child that exited non-zero silently leaves its exit.
function errText(e) {
  const message = e && typeof e.message === 'string'
    ? e.message.split('\n').filter((l) => !l.startsWith('Command failed:')).join(' ').trim()
    : '';
  const text = message || (e && Number.isInteger(e.status) ? `exit ${e.status}` : String(e));
  return text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

// `.github/workflows/{name}` with a .yml/.yaml name and no further `/`.
function isWorkflowPath(p) {
  if (typeof p !== 'string' || !p.startsWith(WORKFLOWS_DIR)) return false;
  const name = p.slice(WORKFLOWS_DIR.length);
  return !name.includes('/') && /\.ya?ml$/i.test(name);
}

// Throws on any failure; the caller decides which way it falls.
function readLocalWorkflows(deps, sha) {
  const listing = parseLsTreeZ(String(deps.git(['ls-tree', '-z', '--end-of-options', sha, '--', WORKFLOWS_DIR])));
  return listing
    .filter((r) => r.type === 'blob' && isWorkflowPath(r.path))
    .map((r) => ({ file: r.path, ...readPullRequestWorkflow(String(deps.git(['cat-file', 'blob', r.sha]))) }));
}

// gh's 404 for a path absent at a commit GitHub knows: the body's message is
// exactly `Not Found`. A 404 naming the ref (`No commit found for the ref …`)
// is an unresolved input, not an absent directory, so it is not this.
function isPathNotFound(e) {
  try {
    const body = JSON.parse(String(e && e.stdout));
    return String(body.status) === '404' && body.message === 'Not Found';
  } catch {
    return false; // no body to read: not provably a missing path — fails closed
  }
}

// Throws on any failure but a missing-directory 404.
function readContentsWorkflows(deps, target, sha) {
  const at = (p) => `repos/${target.owner}/${target.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}?ref=${sha}`;
  let listing;
  try {
    listing = JSON.parse(deps.gh(['api', at('.github/workflows')]));
  } catch (e) {
    if (isPathNotFound(e)) return []; // the head carries no .github/workflows: no workflows to wait on
    throw e;
  }
  if (!Array.isArray(listing)) throw new Error('contents listing is not a list');
  const workflows = [];
  for (const entry of listing) {
    if (!entry || entry.type !== 'file' || !isWorkflowPath(entry.path)) continue;
    const file = JSON.parse(deps.gh(['api', at(entry.path)]));
    if (!file || file.encoding !== 'base64' || typeof file.content !== 'string') throw new Error(`${entry.path}: no base64 content`);
    workflows.push({ file: entry.path, ...readPullRequestWorkflow(Buffer.from(file.content, 'base64').toString('utf8')) });
  }
  return workflows;
}

const noRequirement = (req) => req.readyWorkflows.length === 0 && req.draftSkipWithoutReadyTrigger.length === 0;

// The PR's last ready event as an ISO string, null when there is none, or
// { failed } when the read failed or its body is malformed.
function readReadyEvent(deps, target, pr) {
  let stdout;
  let cause = null;
  try {
    stdout = deps.gh(['api', 'graphql', '-f', `owner=${target.owner}`, '-f', `name=${target.repo}`, '-F', `number=${pr}`, '-f', `query=${READY_EVENT_QUERY}`]);
  } catch (e) {
    // gh exits non-zero on a GraphQL `errors` entry but still prints the body: read it before failing.
    stdout = e && e.stdout;
    cause = errText(e);
  }
  let nodes;
  try {
    nodes = JSON.parse(String(stdout)).data.repository.pullRequest.timelineItems.nodes;
  } catch {
    nodes = null; // unparseable, or no pullRequest: a failed read, never "no event"
  }
  if (!Array.isArray(nodes)) return { failed: cause || `malformed timeline body: ${String(stdout).slice(0, 200)}` };
  if (nodes.length === 0) return null;
  const at = nodes[nodes.length - 1] && nodes[nodes.length - 1].createdAt;
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return { failed: `malformed ready event createdAt: ${JSON.stringify(at)}` };
  return at;
}

function readReadyRun(deps, { pr, sha } = {}) {
  if (!Number.isInteger(pr) || pr <= 0 || typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha)) {
    return { reason: `invalid arguments: pr must be a positive integer and sha a 40-hex commit (got pr ${JSON.stringify(pr)}, sha ${JSON.stringify(sha)})` };
  }
  let available = false;
  try { available = deps.ghAvailable() === true; } catch { available = false; } // could not tell: reported as absent, which is read-failed
  if (!available) return { reason: 'gh absent' };

  let target;
  try { target = deps.repoTarget(); } catch { target = null; } // a throw is the same unresolved origin
  if (target && target.refusal) return { reason: `repo unresolvable from origin: ${target.refusal}` };
  const segmentOk = (s) => typeof s === 'string' && s !== '' && s !== '.' && s !== '..' && !s.includes('/');
  if (!target || !segmentOk(target.owner) || !segmentOk(target.repo)) return { reason: 'repo unresolvable from origin' };

  const event = readReadyEvent(deps, target, pr);
  if (event === null) return { readySince: null, workflows: [], headRuns: [] };
  if (typeof event === 'object') {
    // A failed timeline read: local objects alone may show no rule can apply.
    try {
      const workflows = readLocalWorkflows(deps, sha);
      if (noRequirement(readyRequirement(workflows))) return { readySince: null, workflows, headRuns: [] };
    } catch {
      // local objects unreadable too: nothing shows the rule cannot apply — falls to read-failed
    }
    return { reason: `ready-event read failed: ${event.failed}` };
  }
  const readySince = event;

  let workflows;
  try {
    workflows = readLocalWorkflows(deps, sha);
  } catch (localErr) {
    // Typically `ls-tree` exit 128: the head is not in the local object store. Ask GitHub at the ref.
    try {
      workflows = readContentsWorkflows(deps, target, sha);
    } catch (apiErr) {
      // both sources failed: fail closed with both causes and the fetch that fixes the local one
      return { reason: `workflows unreadable at ${sha}: local objects (${errText(localErr)}); contents API (${errText(apiErr)}) — run: git fetch origin pull/${pr}/head` };
    }
  }

  if (noRequirement(readyRequirement(workflows))) return { readySince, workflows, headRuns: [] };

  let body;
  try {
    body = JSON.parse(deps.gh(['api', `repos/${target.owner}/${target.repo}/actions/runs?head_sha=${sha}&per_page=100`]));
  } catch (e) {
    return { reason: `runs read failed: ${errText(e)}` }; // no runs, no verdict: fail closed
  }
  const rows = body && body.workflow_runs;
  if (!Array.isArray(rows)) return { reason: 'runs read failed: not a list' };
  // One page only: a run missing from a short page could be the failing or the pending one.
  if (typeof body.total_count === 'number' && body.total_count > rows.length) {
    return { reason: `runs read truncated: ${rows.length} of ${body.total_count}` };
  }
  return { readySince, workflows, headRuns: rows };
}

// Pure. Reading B (plan review): a draft-skip workflow without ready_for_review
// parks only while it has no post-ready run; once a later push has run it, it is
// judged like any ready workflow.
function readyRunState({ readySince, workflows, headRuns } = {}) {
  const req = readyRequirement(workflows);
  const since = typeof readySince === 'string' && readySince !== '' ? readySince : null;
  if (since === null || noRequirement(req)) {
    return { state: 'not-applicable', readySince: since, readyWorkflows: [], awaitingReadyRun: [], pending: [], failing: [], draftSkipWithoutReadyTrigger: [], unparsed: [] };
  }
  const v = readyRunVerdict({ readySince: since, readyWorkflows: [...req.readyWorkflows, ...req.draftSkipWithoutReadyTrigger], headRuns });
  const parked = req.draftSkipWithoutReadyTrigger.filter((w) => v.awaiting.includes(w));
  const awaitingReadyRun = v.awaiting.filter((w) => !parked.includes(w));
  let state = 'met';
  if (v.failing.length) state = 'red';
  else if (parked.length) state = 'draft-skip-without-ready-trigger';
  else if (awaitingReadyRun.length || v.pending.length) state = 'awaiting';
  return {
    state, readySince: since, readyWorkflows: req.readyWorkflows, awaitingReadyRun,
    pending: v.pending, failing: v.failing, draftSkipWithoutReadyTrigger: parked, unparsed: req.unparsed,
  };
}

function readFailed(reason) {
  return { state: 'read-failed', reason, readySince: null, readyWorkflows: [], awaitingReadyRun: [], pending: [], failing: [], draftSkipWithoutReadyTrigger: [], unparsed: [] };
}

// Never throws.
function resolveReadyRun(deps, { pr, sha } = {}) {
  const read = readReadyRun(deps, { pr, sha });
  return read.reason ? readFailed(read.reason) : readyRunState(read);
}

module.exports = { STATES, READY_EVENT_QUERY, defaultDeps, readReadyRun, readyRunState, resolveReadyRun, readFailed };
