#!/usr/bin/env node
// bin/dispatch-resume.js — the gatherer behind `/claude-tweaks:dispatch resume #N` (#4588).
// Reads the open PR, labels, claim, prior-run and stalled-worktree state for one record and hands
// it to the pure verdict (lib/dispatch/resume-eligibility.js); the verdict, not this file, decides
// what is eligible. Every read is read-only — resume mints, archives and binds in its own steps.
//
// Usage: dispatch-resume.js --issue <N> [--bound-run <run-dir>] [--help]
//   (verdict)    Stdout is one JSON line. The PR is whichever open PR closes the record, on any head;
//                the stalled worktree is derived from that PR's head.
//     eligible → {eligible:true, issue, prUrl, prNumber, headRefName, priorRunId, priorRunDir,
//                 priorRunPath, archivePriorRun, closePriorRun, localBranchExists, worktreePath,
//                 context:{lastPhase, openDefects}}
//     refused  → {eligible:false, issue, reason, line, prNumbers, disposition, remedy, headRefName}
//                (`line` is the verdict's, printed verbatim; the rest is refusalDetail's: [], null,
//                null, null for no-pr), plus liveRun:true when a provably live owner holds the run,
//                whatever the refusal's reason.
//     An eligible verdict then runs the run-dir scan below with the prior run's own root dir
//     excluded, so a run left bound to the stalled worktree refuses before anything is archived.
//   --bound-run  resume step 6a, after `record-worktree --dispatch` bound the new run: skips the
//                verdict and re-checks concurrency against the worktree stamped on that run. Prints
//                {concurrent:false}, or {concurrent:true, reason:'live-sibling'|'concurrent-resume'|
//                'stale-bound-run', line}, plus liveRun:true when a provably live owner refused it.
//                The bound run dir must resolve to a top-level dir of the main checkout's
//                .claude-tweaks/pipelines/ (a worktree-local shadow is refused, [IL-127]); the run's
//                own binding excludes its worktree lock from the sibling check, so a second resume
//                that bound first shows up in the run-dir scan.
//   The sibling check reads `#N` by token, then, on no hit, an exact read of the head and derived
//   worktree (verdict) or the stamped worktree (--bound-run), so a worktree with no record number is
//   still seen and a head sharing tokens with an unrelated session is not refused over it.
//   The run-dir scan: a non-terminal top-level run dir (never an ad-hoc one) bound to the stalled
//   worktree is `concurrent-resume`, or `stale-bound-run` — naming hooks.js close-run on that dir —
//   when its owner is provably dead by the same owner ladder the prior run's probe uses (an owner
//   block naming this session is never dead here: its line names both a resume still running and
//   close-run for a crashed one; an unknown or other-host owner's line names how to settle that run).
// Exit codes (a CLI-specific vocabulary — the verdict is data on stdout, no exit 1 at all):
//   0  eligible, or {concurrent:false}
//   2  malformed invocation (including a --bound-run outside the main checkout's pipelines dir),
//      `gh` absent, the main checkout or the repo slug unresolved
//   3  refused / concurrent — JSON on stdout
//   4  a read failed transiently (closing-PR read, truncated connection included, label or blocker
//      read, claim read, stalled-worktree `git status`, branch reads, run-dir listing), or the bound
//      run has no listing entry or no stamped worktree; no failed read is taken as clean, with two
//      exceptions by design: the sibling-session check fails open (findConflictingSession returns
//      null when `git worktree list` cannot be read, so `siblingLive` is then false), and the
//      work-links read does too — resolvePolicyConfig's result carries no read error, so an
//      unreadable policy.yml resolves the `body-text` default and skips the native-blocker gate,
//      exactly as resolve-policy.js (and so Step 2's queue) reads it
// Order: read the closing PRs, classify the run a sole kept PR's marker names, then selectResumePr — a
// refusal there prints and exits 3 before any sibling, claim or worktree read, and before any run-dir
// read when no marker names this record (the worktree comes from the chosen PR's head). The only git
// call against the stalled worktree is the --no-optional-locks `status`.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const claimStore = require('./lib/issues/claim-store');
const { defaultRunner: gitCasRunner } = require('./lib/issues/claims-git-cas');
const { parseDependencies } = require('./lib/issues/record');
const { fetchNativeDependencies } = require('./lib/issues/native-dependencies');
const { resolvePolicyConfig } = require('./lib/policy-schema');
const { ghAvailable, ghOptions } = require('./lib/repo-resolve');
const { GH_TIMEOUT_MS, GIT_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
const { mainCheckoutRoot, safeReal } = require('./lib/hooks/worktree-detect');
const { parseWorktreeList } = require('./lib/hooks/worktree-reap');
const { findConflictingSession, findSessionOnWorktree } = require('./lib/hooks/sibling-sessions');
const { listRunDirsWithState, isAdHocRunDir } = require('./lib/hooks/context');
const { NON_TERMINAL } = require('./lib/hooks/run-integrity');
const { DEFAULT_PROBES } = require('./lib/run-liveness/probes');
const { MAX_PID, probeOwnerPid } = require('./lib/run-liveness/owner-pid-probe');
const { resolveTarget } = require('./lib/stage-item/write');
const { lstatType } = require('./lib/path-guard');
const {
  selectResumePr, resumeEligibility, resumeContext, worktreeNameForHead, refusalDetail, closeOutCannotResolve, ownMarkerRunId,
} = require('./lib/dispatch/resume-eligibility');

const USAGE = 'usage: dispatch-resume.js --issue <N> [--bound-run <run-dir>] [--help]\n'
  + '  prints one JSON line: {eligible:true,…} (exit 0) or\n'
  + '  {eligible:false, issue, reason, line, prNumbers, disposition, remedy, headRefName[, liveRun]} (exit 3)\n'
  + '  --bound-run <dir>  re-check concurrency after the new run dir is bound: {concurrent:false} (exit 0)\n'
  + '                     or {concurrent:true, reason, line[, liveRun]} (exit 3)\n'
  + '  exit 2 malformed invocation / gh absent / repo or main checkout unresolved; exit 4 transient read failure\n';

// The closing connection, so a PR that only mentions the record is never listed and any head resolves.
const RESUME_PR_QUERY = 'query($owner:String!,$repo:String!,$issue:Int!){repository(owner:$owner,name:$repo){issue(number:$issue){closedByPullRequestsReferences(first:100){pageInfo{hasNextPage} nodes{url number state headRefName headRefOid isDraft isCrossRepository repository{nameWithOwner} closingIssuesReferences(first:1){totalCount} body}}}}}';
const NATIVE_TIMEOUT_MS = 30000; // one aliased GraphQL call (resolve-blockers.js's precedent)
// This build's own hooks.js, so the stale-bound-run remedy is a command the human can paste as is.
const HOOKS_JS = path.join(__dirname, 'hooks.js');

// ---- real deps ----

// maxBuffer: the PR listing carries every matching PR's body.
function defaultGh(args) {
  return execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS,
    maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true,
  }));
}

// Local reads only; a non-zero exit throws with the child's status (rev-parse --verify --quiet → 1).
function defaultGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS,
    maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true,
  });
}

function nativeGh(args) {
  return execFileSync('gh', args, ghOptions(args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: NATIVE_TIMEOUT_MS,
    maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true,
  }));
}

// `resolve-policy.js --values work-links`, in process: the same resolvePolicyConfig that CLI runs.
function resolveWorkLinks() {
  const git = (args) => execFileSync('git', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GIT_TIMEOUT_MS, windowsHide: true,
  });
  const readFile = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  const { result } = resolvePolicyConfig({ git, readFile, keys: ['work-links'] });
  const entry = result['work-links'];
  if (!entry || entry.error !== undefined || entry.value === null || entry.value === undefined) return '';
  return String(entry.value);
}

const realDeps = {
  ghAvailable: () => ghAvailable(),
  gh: defaultGh,
  git: defaultGit,
  mainRoot: () => mainCheckoutRoot(process.cwd()),
  readClaim: (slug, issue) => claimStore.readClaimBlob(
    { ghApi: claimStore.defaultGhApi, gitRunner: gitCasRunner }, slug, issue, null,
  ),
  // path-guard's lstat: an unreadable or symlinked leaf reads as present, so the read that follows
  // it fails closed (unknown-owner, or exit 4) instead of passing for an absent one.
  exists: (p) => lstatType(p).type !== 'missing',
  readdir: (p) => fs.readdirSync(p),
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  findSibling: findConflictingSession,
  findSiblingOnWorktree: findSessionOnWorktree,
  listRunDirsWithState,
  probes: DEFAULT_PROBES,
  sessionId: process.env.CLAUDE_CODE_SESSION_ID || '',
  now: () => Date.now(),
  workLinks: resolveWorkLinks,
  fetchNative: ({ numbers, owner, repo }) => fetchNativeDependencies({ numbers, owner, repo, runner: nativeGh }),
  resolveTarget,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
};

// ---- argv ----

function parseArgs(argv) {
  const o = { issue: null, boundRun: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (a !== '--issue' && a !== '--bound-run') return { error: `unknown argument: ${a}` };
    const v = argv[++i];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('--')) return { error: `${a} requires a value` };
    if (a === '--issue') {
      if (!/^[1-9]\d*$/.test(v)) return { error: `--issue must be a positive integer, got ${JSON.stringify(v)}` };
      o.issue = Number(v);
    } else o.boundRun = v;
  }
  return o;
}

// ---- failure plumbing ----

// An Exit carries the exit code a failed step maps to; run() turns it into stderr + that code.
class Exit extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const errText = (e) => (e && e.message) || String(e);

// The two exits that print a verdict (verdict mode): in-process callers branch on them, so they import these.
const EXIT_ELIGIBLE = 0;
const EXIT_REFUSED = 3;

// A dep call whose failure is a transient read failure (exit 4), never a clean answer.
function read(label, fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Exit) throw e;
    throw new Exit(4, `${label}: ${errText(e)}`);
  }
}

function parseJson(label, text) {
  return read(label, () => JSON.parse(text));
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyString = (v) => (typeof v === 'string' && v !== '' ? v : null);
const normalizePath = (p) => safeReal(p) || path.resolve(p);

// ---- gathering ----

// The record's open closing PRs. A reply that cannot prove it is the whole connection is a failed read,
// never an empty listing, since no-pr must mean no open PR closes the record. isCrossRepository is
// also true for a PR in another repository: GitHub reports false when its head and base both sit there.
function listPrs(ctx) {
  const [owner, repo] = ctx.slug.split('/').slice(-2);
  const out = read('closing PR read', () => ctx.deps.gh([
    'api', 'graphql', '-f', `query=${RESUME_PR_QUERY}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `issue=${ctx.issue}`,
  ]));
  const issue = parseJson('closing PR read output', out)?.data?.repository?.issue;
  if (!isObject(issue)) throw new Exit(4, `closing PR read: no issue #${ctx.issue} in the reply`);
  const connection = issue.closedByPullRequestsReferences;
  if (!isObject(connection) || !Array.isArray(connection.nodes)) throw new Exit(4, 'closing PR read: nodes was not an array');
  if (connection.pageInfo?.hasNextPage !== false) throw new Exit(4, `closing PR read: more than 100 PRs close #${ctx.issue}, or the page state is missing`);
  if (!connection.nodes.every((node) => isObject(node) && typeof node.state === 'string')) {
    throw new Exit(4, 'closing PR read: a node was unreadable or carried no state');
  }
  const thisRepo = `${owner}/${repo}`.toLowerCase();
  return connection.nodes.filter((node) => node.state === 'OPEN').map((node) => ({
    url: node.url,
    number: node.number,
    headRefName: node.headRefName,
    headRefOid: node.headRefOid,
    body: node.body,
    isDraft: node.isDraft,
    isCrossRepository: node.isCrossRepository !== false || String(node.repository?.nameWithOwner).toLowerCase() !== thisRepo,
    closingRecords: node.closingIssuesReferences?.totalCount,
  }));
}

function issueView(ctx, number, fields) {
  const out = read(`gh issue view #${number}`, () => ctx.deps.gh([
    'issue', 'view', String(number), '--repo', ctx.slug, '--json', fields,
  ]));
  const parsed = parseJson(`gh issue view #${number} output`, out);
  if (!isObject(parsed)) throw new Exit(4, `gh issue view #${number}: unusable output`);
  return parsed;
}

function readRecord(ctx) {
  const rec = issueView(ctx, ctx.issue, 'labels,state,body');
  if (!Array.isArray(rec.labels) || typeof rec.state !== 'string') {
    throw new Exit(4, `gh issue view #${ctx.issue}: labels or state missing`);
  }
  return {
    labels: rec.labels.map((l) => (l && l.name)).filter((l) => typeof l === 'string'),
    issueState: rec.state,
    body: typeof rec.body === 'string' ? rec.body : '',
  };
}

// The open blockers: body `Blocked by` records whose own state reads OPEN, plus — under work-links
// native only, exactly as the queue gates it — the native openBlockerIds. Ascending, deduplicated.
function readOpenBlockers(ctx, body) {
  const open = new Set();
  for (const m of parseDependencies(body)) {
    const dep = issueView(ctx, m, 'state');
    if (typeof dep.state !== 'string') throw new Exit(4, `gh issue view #${m}: state unreadable`);
    if (dep.state === 'OPEN') open.add(m);
  }
  const workLinks = read('work-links policy', () => ctx.deps.workLinks());
  if (workLinks === 'native') {
    const [owner, repo] = ctx.slug.split('/').slice(-2);
    const map = read('native dependency read', () => ctx.deps.fetchNative({ numbers: [ctx.issue], owner, repo }));
    const entry = map && typeof map.get === 'function' ? map.get(ctx.issue) : null;
    if (!entry || !Array.isArray(entry.openBlockerIds)) {
      throw new Exit(4, `native dependency read: no usable entry for #${ctx.issue}`);
    }
    for (const id of entry.openBlockerIds) open.add(id);
  }
  return [...open].sort((a, b) => a - b);
}

// One direct read, never an existence check first ([IL-146]): a missing file (ENOENT/ENOTDIR) is
// `absent: true`; any other read failure, or content that is not a JSON object, is `ok: false`.
function readJsonFile(deps, file) {
  let text;
  try {
    text = deps.readFile(file);
  } catch (e) {
    const absent = Boolean(e) && (e.code === 'ENOENT' || e.code === 'ENOTDIR');
    return { ok: false, absent };
  }
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? { ok: true, value: parsed, absent: false } : { ok: false, absent: false };
  } catch {
    return { ok: false, absent: false };
  }
}

// The prior run's directory class (the verdict's PRIOR_RUN_DIR_CLASSES), and the parsed run-state.json
// the owner probe / own-lock entry read. The owner probe is the only liveness evidence: only a proven
// death is `dead-owner`. `readsDir` is the one directory the run-state and decisions.md reads follow.
//
// `archived` is archive-first but not existence-only (#1103 removed that check as a bug): archiveRunDir
// mkdirs archive/{runId} and writes `status: 'archiving'` there before moving anything, so a failed
// attempt leaves the marker beside the real root dir. It wins when archive/{runId}/run-state.json parses
// as an object whose status is not 'archiving' (archive-merged.js's own real-prior-archive test), or when
// the root dir is absent or holds no run-state.json (a late-write `work/` stub, Review Focus 6). Any other
// state falls through to the root classification, so a live root owner is still probed.
function classifyPriorRun(ctx, runId) {
  const { deps } = ctx;
  const archiveDir = path.join(ctx.root, 'archive', runId);
  const rootDir = path.join(ctx.root, runId);
  const rootPresent = deps.exists(rootDir);
  const priorRunPath = rootPresent ? rootDir : null;
  const base = {
    priorRunPath, priorRunOpen: false, priorRunOwnerHost: null, state: null, readsDir: rootPresent ? rootDir : null,
  };

  const rootState = rootPresent ? readJsonFile(deps, path.join(rootDir, 'run-state.json')) : { ok: false, absent: true };

  if (deps.exists(archiveDir)) {
    const archived = readJsonFile(deps, path.join(archiveDir, 'run-state.json'));
    const realArchive = archived.ok && archived.value.status !== 'archiving';
    if (realArchive || rootState.absent) {
      return {
        ...base, priorRunDir: 'archived', state: archived.ok ? archived.value : null, readsDir: archiveDir,
      };
    }
  }
  if (!rootPresent) return { ...base, priorRunDir: 'absent' };

  let entries;
  try { entries = deps.readdir(rootDir); } catch { return { ...base, priorRunDir: 'unknown-owner' }; }
  if (Array.isArray(entries) && entries.length === 1 && entries[0] === 'work') return { ...base, priorRunDir: 'residue' };

  if (rootState.absent) return { ...base, priorRunDir: 'stateless' };
  if (!rootState.ok) return { ...base, priorRunDir: 'unknown-owner' };

  const state = rootState.value;
  const priorRunDir = ownerClass(deps, state);
  return {
    ...base,
    state,
    priorRunOpen: NON_TERMINAL.has(state.status),
    priorRunDir,
    priorRunOwnerHost: priorRunDir === 'other-host-owner' ? state.owner.host : null,
  };
}

// The owner ladder of a parsed run-state.json: 'dead-owner' | 'live-owner' | 'unknown-owner' |
// 'other-host-owner'. Only a proven death is 'dead-owner'. classifyPriorRun and the bound-run scan
// both judge a run's owner here.
function ownerClass(deps, state) {
  const owner = state.owner;
  if (owner === undefined || owner === null) return 'dead-owner';
  // Present but not an object is a malformed block, not an absent one: a death must be proven.
  if (!isObject(owner)) return 'unknown-owner';
  // The resuming session never counts as a live owner of its own earlier run.
  if (nonEmptyString(deps.sessionId) !== null && owner.sessionId === deps.sessionId) return 'dead-owner';
  if (nonEmptyString(owner.host) === null) {
    // probeOwnerPid answers other-host for a host-less block, which is not a recording on another host.
    const validPid = Number.isInteger(owner.pid) && owner.pid > 0 && owner.pid <= MAX_PID;
    return validPid ? 'unknown-owner' : 'dead-owner';
  }
  const probe = probeOwnerPid(owner, deps.probes);
  if (probe.result === 'negative') {
    if (['gone', 'pid-reused', 'no-pid'].includes(probe.detail)) return 'dead-owner';
    if (probe.detail === 'other-host') return 'other-host-owner';
    if (probe.detail === 'alive-no-start-time') return 'live-owner';
    return 'unknown-owner';
  }
  return probe.result === 'positive' ? 'live-owner' : 'unknown-owner';
}

// The first top-level run dir, other than `excluded`, still non-terminal and bound to the stalled
// worktree -> {reason, line}; null when there is none. Every ad-hoc dir is skipped whoever stamped
// it: EnterWorktree's friction placeholder stays non-terminal while the worktree is registered and
// is never a record claim (#2783), and a second resume always binds a formal record-N run. A
// provably dead owner (ownerClass, never this session's own) is a leftover the human can close;
// this session's own run names both readings (a resume still running, or a crashed one to close);
// an unknown or other-host owner's line names how to settle it; a live owner's run may still end, and
// only that hit sets liveRun.
function boundRunConflict(ctx, excluded, listing) {
  const { deps, issue } = ctx;
  const skip = new Set(excluded.filter((d) => d !== null).map(normalizePath));
  const worktreeKey = normalizePath(ctx.worktreePath);
  for (const { dir, state } of listing) {
    if (skip.has(normalizePath(dir)) || isAdHocRunDir(dir)) continue;
    if (!state || !NON_TERMINAL.has(state.status)) continue;
    if (nonEmptyString(state.worktree) === null || normalizePath(state.worktree) !== worktreeKey) continue;
    const name = path.basename(dir);
    const owner = isObject(state.owner) ? state.owner : null;
    // ownerClass reads this session's own block as dead (right for the prior run); here it may be a
    // second resume sharing the session id (#965), so it is never proven dead in the scan.
    const ownSession = owner !== null && nonEmptyString(deps.sessionId) !== null && owner.sessionId === deps.sessionId;
    if (ownSession) {
      return {
        reason: 'concurrent-resume',
        line: `#${issue}'s stalled worktree ${ctx.worktreePath} is bound to another active run ${name} owned by this same session — if another dispatch resume in this session is still running, stop it, then run /claude-tweaks:dispatch resume #${issue}; if an earlier resume in this session crashed and left that run open, close it with node "${HOOKS_JS}" close-run --run "${dir}", then run /claude-tweaks:dispatch resume #${issue}`,
      };
    }
    const cls = ownerClass(deps, state);
    if (cls === 'dead-owner') {
      return {
        reason: 'stale-bound-run',
        line: `#${issue}'s stalled worktree ${ctx.worktreePath} is bound to run ${name}, which never finished and whose owner is gone — close it with node "${HOOKS_JS}" close-run --run "${dir}", then run /claude-tweaks:dispatch resume #${issue}`,
      };
    }
    if (cls === 'unknown-owner') {
      return {
        reason: 'concurrent-resume',
        line: `#${issue}'s stalled worktree ${ctx.worktreePath} is bound to another active run ${name}, whose owner cannot be proven alive or dead — confirm that run is no longer running, close it with node "${HOOKS_JS}" close-run --run "${dir}", then run /claude-tweaks:dispatch resume #${issue}`,
      };
    }
    if (cls === 'other-host-owner') {
      return {
        reason: 'concurrent-resume',
        line: `#${issue}'s stalled worktree ${ctx.worktreePath} is bound to another active run ${name}, owned by a session on another host (${owner.host}) — resume or close that run from ${owner.host}, then run /claude-tweaks:dispatch resume #${issue}`,
      };
    }
    return {
      reason: 'concurrent-resume',
      line: `#${issue}'s stalled worktree ${ctx.worktreePath} is bound to another active run ${name} — another dispatch resume may be running; stop this one, then run /claude-tweaks:dispatch resume #${issue} once that run ends`,
      liveRun: true,
    };
  }
  return null;
}

// findConflictingSession reads only top-level run dirs when it excludes this session's own worktree
// locks, so the session that dispatched the stalled build would meet its own kept lock as a sibling
// once the prior run is archived. The listing seam adds the prior run's entry — only when its
// recorded session is this one — so the exclusion happens inside the module's own loop.
function listingWithPriorRun(ctx, prior) {
  const { deps } = ctx;
  const state = prior.state;
  const sid = nonEmptyString(deps.sessionId);
  const worktree = state && (nonEmptyString(state.worktreeAtClose) || nonEmptyString(state.worktree));
  const entry = sid !== null && state && state.sessionId === sid && worktree
    ? [{ dir: prior.priorRunPath, state: { sessionId: sid, worktree } }]
    : [];
  return (cwd) => [...deps.listRunDirsWithState(cwd), ...entry];
}

function siblingConflict(ctx, listing) {
  const opts = { cwd: ctx.mainRoot, sessionId: ctx.deps.sessionId, listRunDirsWithState: listing };
  return read('sibling-session check', () => ctx.deps.findSibling(`#${ctx.issue}`, opts));
}

// The exact read, for a worktree with no record number to match: `branch` null reads the path alone.
function siblingOnWorktree(ctx, listing, branch, worktreePath) {
  const opts = { cwd: ctx.mainRoot, sessionId: ctx.deps.sessionId, listRunDirsWithState: listing };
  return read('sibling-session check', () => ctx.deps.findSiblingOnWorktree({ branch, worktreePath }, opts));
}

function parseBranchHeader(header) {
  if (header.startsWith('HEAD (no branch)')) return '';
  const unborn = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(header);
  const name = (unborn ? unborn[1] : header).split('...')[0].split(' ')[0];
  return name === '' ? null : name;
}

// `status --porcelain -b -z` → { branch, dirty }. First record is the `## ` branch header; every later
// `XY path` record is a dirty path, a rename/copy being followed by its original-path record.
function parseStatus(out) {
  const fail = (why) => new Exit(4, `git status (stalled worktree): ${why}`);
  if (typeof out !== 'string') throw fail('output was not text');
  const records = out.split('\0');
  if (!records[0].startsWith('## ')) throw fail('output did not start with a "## " branch header');
  const branch = parseBranchHeader(records[0].slice(3));
  if (branch === null) throw fail('the "## " branch header named no branch');
  const dirty = [];
  for (let i = 1; i < records.length; i++) {
    const rec = records[i];
    if (rec === '') continue;
    if (rec.length < 4) throw fail(`a status record was shorter than "XY path" (${JSON.stringify(rec)})`);
    dirty.push(rec.slice(3));
    if (rec[0] === 'R' || rec[0] === 'C' || rec[1] === 'R' || rec[1] === 'C') i++;
  }
  return { branch, dirty };
}

function readWorktreeState(ctx) {
  const { deps } = ctx;
  if (!deps.exists(ctx.worktreePath)) return { exists: false, worktreeDirty: [], worktreeBranch: null };
  const out = read('git status (stalled worktree)', () => deps.git([
    '-C', ctx.worktreePath, '--no-optional-locks', 'status', '--porcelain', '-b', '-z',
  ]));
  const parsed = parseStatus(out);
  return { exists: true, worktreeDirty: parsed.dirty, worktreeBranch: parsed.branch };
}

// A reaped worktree is recreated from the local head branch when one exists: its tip, and where else
// it is checked out, are decided before the mint.
function readLocalBranch(ctx, head) {
  const { deps } = ctx;
  let localBranchSha = null;
  try {
    localBranchSha = nonEmptyString(String(deps.git([
      '-C', ctx.mainRoot, 'rev-parse', '--verify', '--quiet', '--end-of-options', `refs/heads/${head}`,
    ])).trim());
  } catch (e) {
    // `--verify --quiet` exits 1 with no output when the ref is absent; anything else is a failed read.
    if (!(e && e.status === 1 && String(e.stdout || '').trim() === '')) throw new Exit(4, `git rev-parse (local ${head}): ${errText(e)}`);
  }
  const listing = read('git worktree list', () => deps.git(['-C', ctx.mainRoot, 'worktree', 'list', '--porcelain']));
  const holder = parseWorktreeList(listing).find((entry) => entry.branch === head);
  return { localBranchSha, branchCheckedOutAt: holder ? holder.path : null };
}

// decisions.md from the same directory the prior-run classification chose (`readsDir`).
function readContext(ctx, prior) {
  const { deps } = ctx;
  if (prior.readsDir !== null) {
    const file = path.join(prior.readsDir, 'decisions.md');
    try {
      return resumeContext(deps.readFile(file));
    } catch { /* missing or unreadable decisions.md: the context is advisory, fall through to the empty one */ }
  }
  return { lastPhase: null, openDefects: [] };
}

// ---- modes ----

function emit(ctx, obj) {
  ctx.deps.stdout(`${JSON.stringify(obj)}\n`);
}

// Every verdict-mode refusal: the verdict's reason and line, what a caller reports about them, and
// liveRun only when a provably live owner holds the run: the verdict says so, or `prior` (the PR marker's
// classified run, null when no marker names this record) does, whichever refusal fired first.
function refusal(ctx, prs, verdict, prior = null) {
  const { issue, mainRoot } = ctx;
  const liveRun = verdict.liveRun === true || (prior !== null && prior.priorRunDir === 'live-owner');
  emit(ctx, {
    eligible: false,
    issue,
    reason: verdict.reason,
    line: verdict.line,
    ...refusalDetail({ issue, verdict, prs, mainRoot }),
    ...(liveRun ? { liveRun: true } : {}),
  });
  return EXIT_REFUSED;
}

function listRuns(ctx) {
  return read('run dir listing', () => ctx.deps.listRunDirsWithState(ctx.mainRoot));
}

function runVerdict(ctx) {
  const { deps, issue } = ctx;
  let available = false;
  try { available = deps.ghAvailable(); } catch { /* a throwing probe reads as gh absent */ }
  if (!available) throw new Exit(2, 'gh CLI not found on PATH — dispatch resume needs it to read the PR, labels and claim');
  try {
    ctx.slug = claimStore.resolveRepoSlugOrThrow(deps.gh);
  } catch (e) {
    throw new Exit(2, `could not resolve the repo slug: ${errText(e)}`);
  }
  if (!ctx.slug) throw new Exit(2, 'could not resolve the repo slug (gh repo view returned nothing)');

  const prs = listPrs(ctx);
  const markedRun = ownMarkerRunId(issue, prs);
  const prior = markedRun === null ? null : classifyPriorRun(ctx, markedRun);
  const selected = selectResumePr(issue, prs, {
    runGone: () => prior !== null && closeOutCannotResolve(prior.priorRunDir),
  });
  if (!selected.ok) return refusal(ctx, prs, selected, prior);
  const { pr } = selected;
  ctx.worktreePath = path.join(ctx.mainRoot, '.claude', 'worktrees', ...worktreeNameForHead(pr.headRefName).split('/'));

  const record = readRecord(ctx);
  const openBlockers = readOpenBlockers(ctx, record.body);
  const claim = read('claim read', () => deps.readClaim(ctx.slug, issue));
  if (!claim || claim.failure) throw new Exit(4, `claim read: ${claim && claim.failure ? claim.failure : 'no result'}`);

  const priorListing = listingWithPriorRun(ctx, prior);
  const siblingLive = siblingConflict(ctx, priorListing) !== null
    || siblingOnWorktree(ctx, priorListing, pr.headRefName, ctx.worktreePath) !== null;
  const wt = readWorktreeState(ctx);
  const local = wt.exists ? { localBranchSha: null, branchCheckedOutAt: null } : readLocalBranch(ctx, pr.headRefName);

  const verdict = resumeEligibility({
    issue,
    prs,
    claimContent: claim.content,
    labels: record.labels,
    now: deps.now(),
    priorRunDir: prior.priorRunDir,
    priorRunOpen: prior.priorRunOpen,
    priorRunOwnerHost: prior.priorRunOwnerHost,
    siblingLive,
    worktreePath: ctx.worktreePath,
    worktreeDirty: wt.worktreeDirty,
    worktreeBranch: wt.worktreeBranch,
    issueState: record.issueState,
    openBlockers,
    localBranchSha: local.localBranchSha,
    branchCheckedOutAt: local.branchCheckedOutAt,
    mainRoot: ctx.mainRoot,
  });
  if (!verdict.eligible) return refusal(ctx, prs, verdict, prior);
  // The --bound-run scan, run here too so a run left bound to the worktree refuses at Step 2, before
  // Step 3 archives anything. Only an eligible verdict reaches it, so every verdict refusal keeps
  // its precedence; the prior run's own root dir is the run being resumed, never a rival. Each hit's
  // line says to settle that run and resume, so its disposition is `resume`.
  const hit = boundRunConflict(ctx, [prior.priorRunPath], listRuns(ctx));
  if (hit !== null) return refusal(ctx, prs, { ...hit, disposition: 'resume' });
  emit(ctx, {
    eligible: true,
    issue,
    prUrl: verdict.prUrl,
    prNumber: verdict.prNumber,
    headRefName: pr.headRefName,
    priorRunId: verdict.priorRunId,
    priorRunDir: verdict.priorRunDir,
    priorRunPath: prior.priorRunPath,
    archivePriorRun: verdict.archivePriorRun,
    closePriorRun: verdict.closePriorRun,
    localBranchExists: verdict.localBranchExists,
    worktreePath: ctx.worktreePath,
    context: readContext(ctx, prior),
  });
  return EXIT_ELIGIBLE;
}

// Resume step 6a. The new run's binding makes `ownedWorktreePaths` skip the stalled worktree whatever
// live session holds its lock, so a second resume that bound first is found by scanning the
// top-level run dirs instead.
function runBound(ctx, boundRun) {
  const { deps, issue } = ctx;
  const target = read('--bound-run', () => deps.resolveTarget({ runDir: boundRun, mainRoot: ctx.mainRoot }));
  if (!target || !target.ok) throw new Exit(2, `--bound-run ${boundRun} is not a run dir under the main checkout (${target && target.reason})`);
  const bound = path.resolve(target.dir);
  const pipelines = [ctx.root, normalizePath(ctx.root)];
  if (!pipelines.includes(path.dirname(bound))) {
    throw new Exit(2, `--bound-run ${boundRun} is not a top-level run dir of ${ctx.root}`);
  }

  const liveSibling = (conflict) => {
    emit(ctx, {
      concurrent: true,
      reason: 'live-sibling',
      line: `#${issue} has another worktree in use by a live session (${conflict.path}) — stop this resume, then run /claude-tweaks:dispatch resume #${issue} once that session ends`,
    });
    return 3;
  };
  const conflict = siblingConflict(ctx, deps.listRunDirsWithState);
  if (conflict !== null) return liveSibling(conflict);

  const listing = listRuns(ctx);
  const boundKey = normalizePath(bound);
  const entry = listing.find(({ dir }) => normalizePath(dir) === boundKey);
  const worktree = entry && entry.state ? nonEmptyString(entry.state.worktree) : null;
  if (worktree === null) throw new Exit(4, `--bound-run ${boundRun}: the run has no stamped worktree to re-check`);
  ctx.worktreePath = worktree;

  const onWorktree = siblingOnWorktree(ctx, deps.listRunDirsWithState, null, worktree);
  if (onWorktree !== null) return liveSibling(onWorktree);

  const hit = boundRunConflict(ctx, [bound], listing);
  if (hit !== null) {
    emit(ctx, { concurrent: true, ...hit });
    return 3;
  }
  emit(ctx, { concurrent: false });
  return 0;
}

function run(argv, deps) {
  const opts = parseArgs(argv);
  if (opts.help) { deps.stdout(USAGE); return 0; }
  const fail = (code, message) => { deps.stderr(`dispatch-resume.js: ${message}\n${code === 2 ? USAGE : ''}`); return code; };
  if (opts.error) return fail(2, opts.error);
  if (opts.issue === null) return fail(2, '--issue is required');

  try {
    let mainRoot = null;
    try { mainRoot = deps.mainRoot(); } catch { /* an unresolvable main checkout is refused just below */ }
    if (!mainRoot) return fail(2, 'could not resolve the main checkout root');
    const ctx = {
      deps,
      issue: opts.issue,
      mainRoot,
      root: path.join(mainRoot, '.claude-tweaks', 'pipelines'),
    };
    return opts.boundRun ? runBound(ctx, opts.boundRun) : runVerdict(ctx);
  } catch (e) {
    if (e instanceof Exit) return fail(e.code, e.message);
    return fail(4, `unexpected failure: ${errText(e)}`);
  }
}

module.exports = {
  run, parseArgs, realDeps, classifyPriorRun, EXIT_ELIGIBLE, EXIT_REFUSED,
};

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
