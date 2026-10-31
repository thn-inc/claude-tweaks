#!/usr/bin/env node
// bin/dispatch-resume.js — the gatherer behind `/claude-tweaks:dispatch resume #N` (#4588).
// Reads the open PR, labels, claim, prior-run and stalled-worktree state for one record and hands
// it to the pure verdict (lib/dispatch/resume-eligibility.js); the verdict, not this file, decides
// what is eligible. Every read is read-only — resume mints, archives and binds in its own steps.
//
// Usage: dispatch-resume.js --issue <N> [--bound-run <run-dir>] [--help]
//   (verdict)    Stdout is one JSON line.
//     eligible → {eligible:true, issue, prUrl, prNumber, headRefName, priorRunId, priorRunDir,
//                 priorRunPath, archivePriorRun, closePriorRun, localBranchExists, worktreePath,
//                 context:{lastPhase, openDefects}}
//     refused  → {eligible:false, issue, reason, line}   (`line` is the verdict's, printed verbatim)
//   --bound-run  resume step 6a, after `record-worktree --dispatch` bound the new run: skips the
//                verdict and re-checks concurrency. Prints {concurrent:false}, or {concurrent:true,
//                reason:'live-sibling'|'concurrent-resume', line}. The bound run dir must resolve to a
//                top-level dir of the main checkout's .claude-tweaks/pipelines/ (a worktree-local
//                shadow is refused, [IL-127]); the run's own binding excludes its worktree lock from
//                the sibling check, so a second resume that bound first shows up in the run-dir scan.
// Exit codes (a CLI-specific vocabulary — the verdict is data on stdout, no exit 1 at all):
//   0  eligible, or {concurrent:false}
//   2  malformed invocation (including a --bound-run outside the main checkout's pipelines dir),
//      `gh` absent, the main checkout or the repo slug unresolved
//   3  refused / concurrent — JSON on stdout
//   4  a read failed transiently (PR list, label or blocker read, claim read, stalled-worktree
//      `git status`, branch reads); no failed read is taken as clean, with one exception by design:
//      the sibling-session check fails open (findConflictingSession returns null when `git worktree
//      list` cannot be read, so `siblingLive` is then false)
// Order: list the PRs, then selectResumePr — a refusal there prints and exits 3 before any run-dir,
// sibling, claim or worktree read (the prior run id comes from the chosen PR's marker). The only git
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
const { ghAvailable } = require('./lib/repo-resolve');
const { GH_TIMEOUT_MS, GIT_TIMEOUT_MS, LARGE_MAX_BUFFER_BYTES } = require('./lib/shared-primitives');
const { mainCheckoutRoot, safeReal } = require('./lib/hooks/worktree-detect');
const { parseWorktreeList } = require('./lib/hooks/worktree-reap');
const { findConflictingSession } = require('./lib/hooks/sibling-sessions');
const { listRunDirsWithState, isAdHocRunDir } = require('./lib/hooks/context');
const { NON_TERMINAL } = require('./lib/hooks/run-integrity');
const { DEFAULT_PROBES } = require('./lib/run-liveness/probes');
const { MAX_PID, probeOwnerPid } = require('./lib/run-liveness/owner-pid-probe');
const { resolveTarget } = require('./lib/stage-item/write');
const { lstatType } = require('./lib/path-guard');
const { selectResumePr, resumeEligibility, resumeContext } = require('./lib/dispatch/resume-eligibility');

const USAGE = 'usage: dispatch-resume.js --issue <N> [--bound-run <run-dir>] [--help]\n'
  + '  prints one JSON line: {eligible:true,…} (exit 0) or {eligible:false, issue, reason, line} (exit 3)\n'
  + '  --bound-run <dir>  re-check concurrency after the new run dir is bound: {concurrent:false} (exit 0)\n'
  + '                     or {concurrent:true, reason, line} (exit 3)\n'
  + '  exit 2 malformed invocation / gh absent / repo or main checkout unresolved; exit 4 transient read failure\n';

const PR_FIELDS = 'url,number,headRefName,headRefOid,body,isDraft,isCrossRepository';
const NATIVE_TIMEOUT_MS = 30000; // one aliased GraphQL call (resolve-blockers.js's precedent)

// ---- real deps ----

// maxBuffer: the PR listing carries every matching PR's body.
function defaultGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS,
    maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true,
  });
}

// Local reads only; a non-zero exit throws with the child's status (rev-parse --verify --quiet → 1).
function defaultGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS,
    maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true,
  });
}

function nativeGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: NATIVE_TIMEOUT_MS,
    maxBuffer: LARGE_MAX_BUFFER_BYTES, windowsHide: true,
  });
}

// `resolve-policy.js --values work-links`, in process: the same resolvePolicyConfig that CLI runs.
function resolveWorkLinks() {
  const git = (args) => execFileSync('git', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GIT_TIMEOUT_MS, windowsHide: true,
  });
  const readFile = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
  const { result } = resolvePolicyConfig({ git, readFile, keys: ['work-links'] });
  const entry = result['work-links'];
  return !entry || entry.error !== undefined || entry.value === null || entry.value === undefined ? '' : String(entry.value);
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

function listPrs(ctx) {
  const out = read('gh pr list', () => ctx.deps.gh([
    'pr', 'list', '--repo', ctx.slug, '--head', ctx.head, '--state', 'open', '--json', PR_FIELDS,
  ]));
  const prs = parseJson('gh pr list output', out);
  if (!Array.isArray(prs)) throw new Exit(4, 'gh pr list: the listing was not an array');
  return prs;
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

function readJsonFile(deps, file) {
  try {
    const parsed = JSON.parse(deps.readFile(file));
    return isObject(parsed) ? { ok: true, value: parsed } : { ok: false };
  } catch {
    return { ok: false };
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

  if (deps.exists(archiveDir)) {
    const archiveStatePath = path.join(archiveDir, 'run-state.json');
    const archived = deps.exists(archiveStatePath) ? readJsonFile(deps, archiveStatePath) : { ok: false };
    const realArchive = archived.ok && archived.value.status !== 'archiving';
    const rootHasState = rootPresent && deps.exists(path.join(rootDir, 'run-state.json'));
    if (realArchive || !rootHasState) {
      return {
        ...base, priorRunDir: 'archived', state: archived.ok ? archived.value : null, readsDir: archiveDir,
      };
    }
  }
  if (!rootPresent) return { ...base, priorRunDir: 'absent' };

  let entries;
  try { entries = deps.readdir(rootDir); } catch { return { ...base, priorRunDir: 'unknown-owner' }; }
  if (Array.isArray(entries) && entries.length === 1 && entries[0] === 'work') return { ...base, priorRunDir: 'residue' };

  const statePath = path.join(rootDir, 'run-state.json');
  if (!deps.exists(statePath)) return { ...base, priorRunDir: 'stateless' };
  const parsed = readJsonFile(deps, statePath);
  if (!parsed.ok) return { ...base, priorRunDir: 'unknown-owner' };

  const state = parsed.value;
  const known = { ...base, state, priorRunOpen: NON_TERMINAL.has(state.status) };
  const owner = state.owner;
  if (owner === undefined || owner === null) return { ...known, priorRunDir: 'dead-owner' };
  // Present but not an object is a malformed block, not an absent one: a death must be proven.
  if (!isObject(owner)) return { ...known, priorRunDir: 'unknown-owner' };
  // The resuming session never counts as a live owner of its own earlier run.
  if (nonEmptyString(deps.sessionId) !== null && owner.sessionId === deps.sessionId) return { ...known, priorRunDir: 'dead-owner' };
  if (nonEmptyString(owner.host) === null) {
    // probeOwnerPid answers other-host for a host-less block, which is not a recording on another host.
    const validPid = Number.isInteger(owner.pid) && owner.pid > 0 && owner.pid <= MAX_PID;
    return { ...known, priorRunDir: validPid ? 'unknown-owner' : 'dead-owner' };
  }
  const probe = probeOwnerPid(owner, deps.probes);
  if (probe.result === 'negative') {
    if (['gone', 'pid-reused', 'no-pid'].includes(probe.detail)) return { ...known, priorRunDir: 'dead-owner' };
    if (probe.detail === 'other-host') return { ...known, priorRunDir: 'other-host-owner', priorRunOwnerHost: owner.host };
    if (probe.detail === 'alive-no-start-time') return { ...known, priorRunDir: 'live-owner' };
    return { ...known, priorRunDir: 'unknown-owner' };
  }
  return { ...known, priorRunDir: probe.result === 'positive' ? 'live-owner' : 'unknown-owner' };
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
  const opts = { cwd: ctx.mainRoot, sessionId: ctx.deps.sessionId };
  if (listing) opts.listRunDirsWithState = listing;
  return read('sibling-session check', () => ctx.deps.findSibling(`#${ctx.issue}`, opts));
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
      if (deps.exists(file)) return resumeContext(deps.readFile(file));
    } catch { /* unreadable decisions.md: the context is advisory, fall through to the empty one */ }
  }
  return { lastPhase: null, openDefects: [] };
}

// ---- modes ----

function emit(ctx, obj) {
  ctx.deps.stdout(`${JSON.stringify(obj)}\n`);
}

function runVerdict(ctx) {
  const { deps, issue } = ctx;
  let available = false;
  try { available = deps.ghAvailable(); } catch { available = false; }
  if (!available) throw new Exit(2, 'gh CLI not found on PATH — dispatch resume needs it to read the PR, labels and claim');
  try {
    ctx.slug = claimStore.resolveRepoSlugOrThrow(deps.gh);
  } catch (e) {
    throw new Exit(2, `could not resolve the repo slug: ${errText(e)}`);
  }
  if (!ctx.slug) throw new Exit(2, 'could not resolve the repo slug (gh repo view returned nothing)');
  ctx.head = `worktree-dispatch-record-${issue}`;

  const prs = listPrs(ctx);
  const selected = selectResumePr(issue, prs);
  if (!selected.ok) {
    emit(ctx, { eligible: false, issue, reason: selected.reason, line: selected.line });
    return 3;
  }
  const { pr, runId } = selected;

  const record = readRecord(ctx);
  const openBlockers = readOpenBlockers(ctx, record.body);
  const claim = read('claim read', () => deps.readClaim(ctx.slug, issue));
  if (!claim || claim.failure) throw new Exit(4, `claim read: ${claim && claim.failure ? claim.failure : 'no result'}`);

  const prior = classifyPriorRun(ctx, runId);
  const siblingLive = siblingConflict(ctx, listingWithPriorRun(ctx, prior)) !== null;
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
  });
  if (!verdict.eligible) {
    emit(ctx, { eligible: false, issue, reason: verdict.reason, line: verdict.line });
    return 3;
  }
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
  return 0;
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

  const conflict = siblingConflict(ctx, deps.listRunDirsWithState);
  if (conflict !== null) {
    emit(ctx, {
      concurrent: true,
      reason: 'live-sibling',
      line: `#${issue} has another worktree in use by a live session (${conflict.path}) — stop this resume, then run /claude-tweaks:dispatch resume #${issue} once that session ends`,
    });
    return 3;
  }

  const boundKey = normalizePath(bound);
  const worktreeKey = normalizePath(ctx.worktreePath);
  const sid = nonEmptyString(deps.sessionId);
  const listing = read('run dir listing', () => deps.listRunDirsWithState(ctx.mainRoot));
  for (const { dir, state } of listing) {
    if (normalizePath(dir) === boundKey) continue;
    if (!state || !NON_TERMINAL.has(state.status)) continue;
    if (isAdHocRunDir(dir) && sid !== null && state.sessionId === sid) continue;
    if (nonEmptyString(state.worktree) === null || normalizePath(state.worktree) !== worktreeKey) continue;
    emit(ctx, {
      concurrent: true,
      reason: 'concurrent-resume',
      line: `#${issue}'s stalled worktree ${ctx.worktreePath} is bound to another active run ${path.basename(dir)} — another dispatch resume may be running; stop this one, then run /claude-tweaks:dispatch resume #${issue} once that run ends`,
    });
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
    try { mainRoot = deps.mainRoot(); } catch { mainRoot = null; }
    if (!mainRoot) return fail(2, 'could not resolve the main checkout root');
    const ctx = {
      deps,
      issue: opts.issue,
      mainRoot,
      root: path.join(mainRoot, '.claude-tweaks', 'pipelines'),
      worktreePath: path.join(mainRoot, '.claude', 'worktrees', `dispatch-record-${opts.issue}`),
    };
    return opts.boundRun ? runBound(ctx, opts.boundRun) : runVerdict(ctx);
  } catch (e) {
    if (e instanceof Exit) return fail(e.code, e.message);
    return fail(4, `unexpected failure: ${errText(e)}`);
  }
}

module.exports = { run, parseArgs, realDeps };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
