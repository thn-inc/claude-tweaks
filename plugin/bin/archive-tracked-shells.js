#!/usr/bin/env node
// bin/archive-tracked-shells.js — archive the "tracked shell" run dirs (#3975).
//
// A tracked shell is a run dir under .claude-tweaks/pipelines/ that holds only
// git-tracked `work/` content (plus `spec-N/work/` for a multi-spec parent): its
// gitignored half was archived but the tracked half stayed behind, because it
// reached the main checkout by merge after the run's own archival. This CLI
// enumerates them and archives each through reconcile's own `archiveRunDir`, in a
// scratch worktree on the local branch housekeeping/archive-tracked-shells. It
// never commits on the main checkout, never runs `git stash`, never force-pushes.
//
// Usage: archive-tracked-shells.js [--root <dir>] [--dry-run] [--no-pr]
//   --root     main checkout (default: the main checkout of the cwd's repo)
//   --dry-run  classify only: no branch, no worktree, no network, no PR
//   --no-pr    commit on the local branch and stop (also the only mode under
//              integration-model local-merge, or with gh absent)
//
// Stdout: one JSON envelope line { moved, deleted, conflicts, untwinned, branch, pr,
// notes[, dryRun] }.
// Exit codes (a Combined-2 family): 0 success, including nothing to do and every
// --dry-run; 1 a shell was left behind (its work twin differs, or archival refused
// it); 2 a malformed call or an unsupported environment (local-merge or no gh
// without --no-pr, an unresolvable integration branch, a dirty scratch worktree).
// An untwinned shell (no clean archive twin to resolve against) is reported, not an
// exit-1 outcome: nothing here can converge it.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runGit, repoPinnedEnv } = require('./lib/hooks/git-exec');
const { splitNul } = require('./lib/git-z');
const { mainCheckoutRoot } = require('./lib/hooks/worktree-detect');
const { readRunState, isTrackedShellDir } = require('./lib/hooks/context');
const { archiveRunDir, listSpecDirs, compareWorkTwin } = require('./lib/reconcile/archive-merged');
const { lstatType } = require('./lib/path-guard');
const { ghAvailable: probeGh, ghOptions } = require('./lib/repo-resolve');
const { GH_TIMEOUT_MS, GIT_PUSH_TIMEOUT_MS } = require('./lib/shared-primitives');
const { neutralizeClosingPhrases } = require('./lib/flow/closing-links');
const { defang, unmention } = require('./lib/learned-skills/land');
const { resolvePolicy, callerDeps, scalarValue, EXIT_OK } = require('./resolve-policy');

const BRANCH = 'housekeeping/archive-tracked-shells';
const USAGE = 'usage: archive-tracked-shells.js [--root <dir>] [--dry-run] [--no-pr]\n';
const POLICY_KEYS = ['integration-model', 'integration-branch', 'housekeeping-auto-merge'];

function parseArgs(argv) {
  const opts = { root: null, dryRun: false, noPr: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--no-pr') opts.noPr = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--root') {
      const v = argv[i + 1];
      if (typeof v !== 'string' || !v.trim() || v.startsWith('-')) return { error: '--root needs a directory' };
      opts.root = v;
      i += 1;
    } else return { error: `unknown argument: ${a}` };
  }
  return { opts };
}

const pipelinesDir = (root) => path.join(root, '.claude-tweaks', 'pipelines');
const archiveDirOf = (root, runId) => path.join(pipelinesDir(root), 'archive', runId);

// Every shell under `root`: { shells: [{ runId, dir }], untwinned: [runId] }. A candidate
// is a directory under pipelines/ (not archive/) that isTrackedShellDir accepts and that
// holds at least one git-tracked file. A shell whose archive twin run-state reads
// status 'clean' is archivable; any other is untwinned.
function findShells(root, deps) {
  const base = pipelinesDir(root);
  let names;
  try {
    names = fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'archive')
      .map((e) => e.name)
      .sort();
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return { shells: [], untwinned: [] };
    throw err;
  }
  const candidates = names.filter((n) => isTrackedShellDir(path.join(base, n)));
  if (candidates.length === 0) return { shells: [], untwinned: [] };
  const listed = deps.git(['ls-files', '-z', '--', '.claude-tweaks/pipelines'], { cwd: root, env: deps.env });
  if (listed.failure) throw new Error(`git ls-files failed: ${listed.stderr || listed.failure}`);
  const tracked = new Set(splitNul(listed.stdout || '').map((p) => p.split('/')[2]));
  const out = { shells: [], untwinned: [] };
  for (const runId of candidates) {
    if (!tracked.has(runId)) continue;
    const state = readRunState(archiveDirOf(root, runId));
    if (state && state.status === 'clean') out.shells.push({ runId, dir: path.join(base, runId) });
    else out.untwinned.push(runId);
  }
  return out;
}

// The work areas of a run dir as [liveWork, twinWork] pairs: top-level first, then each
// spec-N/ in name order — the order archiveRunDir itself judges them in.
function workAreas(runDir, archiveDir) {
  const areas = [[path.join(runDir, 'work'), path.join(archiveDir, 'work')]];
  for (const spec of listSpecDirs(runDir).sort()) {
    areas.push([path.join(runDir, spec, 'work'), path.join(archiveDir, spec, 'work')]);
  }
  return areas.filter(([live]) => lstatType(live).type === 'directory');
}

const hasTwin = (areas) => areas.some(([, twin]) => lstatType(twin).type === 'directory');

// --dry-run: what the real run would report, from read-only comparisons in the main checkout.
function classifyDry(root, shell, env) {
  const areas = workAreas(shell.dir, archiveDirOf(root, shell.runId));
  for (const [live, twin] of areas) {
    if (lstatType(twin).type !== 'directory') continue;
    const cmp = compareWorkTwin(root, live, twin, env);
    if (!cmp.identical) return { kind: 'conflict', differing: cmp.differing };
  }
  return { kind: hasTwin(areas) ? 'deleted' : 'moved' };
}

function gitText(res) {
  return res.failure ? '' : (res.stdout || '').trim();
}

// The integration branch: the policy value, else origin/HEAD's target, else null.
function resolveIntegration(root, deps, policyValue) {
  if (policyValue) return policyValue;
  const head = gitText(deps.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root, env: deps.env }));
  return head.startsWith('origin/') ? head.slice('origin/'.length) : null;
}

// Best-effort and never throws: it runs from a `finally`. The scratch path is this CLI's own, so a
// leftover that git no longer (or never) registered is deleted outright; `--force --force` also
// removes a registered worktree that is locked.
function removeWorktree(root, wt, deps) {
  const attempt = (args) => { try { deps.git(args, { cwd: root, env: deps.env }); } catch { /* best-effort */ } };
  if (lstatType(wt).type !== 'missing') {
    attempt(['worktree', 'remove', '--force', '--force', wt]);
    if (lstatType(wt).type !== 'missing') {
      try { fs.rmSync(wt, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  }
  attempt(['worktree', 'prune']);
}

// Whether the scratch tree holds this run's archived `work/` (top-level or a spec-N/work).
function hasArchivedWork(wt, runId) {
  const dir = archiveDirOf(wt, runId);
  return lstatType(path.join(dir, 'work')).type === 'directory'
    || listSpecDirs(dir).some((spec) => lstatType(path.join(dir, spec, 'work')).type === 'directory');
}

const firstLine = (text) => String(text || '').split('\n')[0].trim();

// Where the scratch branch starts, from the remote branch and the PRs that ever named it (a
// real run without --no-pr). -> { base, merge, remoteExisted, openPr } | { error }
//   open PR              -> origin/BRANCH, reuse the PR
//   a merged PR          -> origin/{integration}; a lingering remote branch is deleted first
//   closed PR only       -> error when the branch is still on the remote; else as "no PR ever"
//   no PR ever           -> origin/BRANCH if on the remote (crash between push and create), else the
//                           local BRANCH (crash before push), else origin/{integration}
// `merge` says the base predates the integration branch's tip, so origin/{integration} is merged in.
function planPrBase(root, integration, hasLocal, fetchedOk, g, gh) {
  const originRef = `refs/remotes/origin/${integration}`;
  const branchRef = `refs/remotes/origin/${BRANCH}`;
  const ls = g(['ls-remote', '--heads', 'origin', `refs/heads/${BRANCH}`], root);
  if (ls.failure) return { error: `git ls-remote origin failed: ${firstLine(ls.stderr) || ls.failure}` };
  let remoteExisted = gitText(ls) !== '';
  const listed = gh(['pr', 'list', '--head', BRANCH, '--state', 'all', '--json', 'number,url,state']);
  if (listed.failure) return { error: `gh pr list failed: ${firstLine(listed.stderr) || listed.failure}` };
  let prs;
  try { prs = JSON.parse(listed.stdout || '[]'); } catch { prs = null; }
  if (!Array.isArray(prs)) return { error: 'gh pr list printed no JSON array' };
  const open = prs.find((p) => p.state === 'OPEN');
  const closed = prs.find((p) => p.state === 'CLOSED');
  const fetchBranch = () => !g(['fetch', 'origin', `+refs/heads/${BRANCH}:${branchRef}`], root).failure;
  if (open) {
    if (!remoteExisted || !fetchBranch()) return { error: `PR #${open.number} is open but ${BRANCH} could not be fetched from origin` };
    return { base: branchRef, merge: true, remoteExisted, openPr: { number: open.number, url: open.url } };
  }
  if (prs.some((p) => p.state === 'MERGED')) {
    // Its commits already landed, so the local branch is reset to the integration branch (-B) —
    // which must be current, or the new branch would be built on a stale tip.
    if (!fetchedOk) return { error: `a merged PR exists for ${BRANCH} but origin/${integration} could not be fetched, so a fresh branch cannot start from it` };
    if (remoteExisted) {
      const gone = g(['push', 'origin', `:refs/heads/${BRANCH}`], root);
      if (gone.failure) return { error: `deleting the merged remote branch ${BRANCH} failed: ${firstLine(gone.stderr) || gone.failure}` };
      remoteExisted = false;
    }
    return { base: originRef, merge: false, remoteExisted, openPr: null };
  }
  // A closed PR whose remote branch is gone has nothing left to resume: same as no PR ever. With the
  // branch still on the remote, only a human can say whether it is to be reopened or discarded.
  if (closed && remoteExisted) {
    return { error: `PR #${closed.number} (${closed.url}) for ${BRANCH} was closed without merging and the branch is still on origin — reopen PR #${closed.number}, or delete the remote branch (git push origin --delete ${BRANCH}), then re-run` };
  }
  if (remoteExisted) {
    if (!fetchBranch()) return { error: `${BRANCH} exists on origin but could not be fetched` };
    return { base: branchRef, merge: true, remoteExisted, openPr: null };
  }
  if (hasLocal) return { base: `refs/heads/${BRANCH}`, merge: true, remoteExisted, openPr: null };
  return { base: originRef, merge: false, remoteExisted, openPr: null };
}

// Run ids and paths come from the checkout, so the body is made inert the way land.js's is: no
// HTML-comment marker, no @-mention, no closing phrase that would close a record on merge.
// `already` lists the run ids found archived on the branch from an earlier run.
function prBody(envelope, already = []) {
  const safe = (text) => unmention(defang(text));
  const lines = ['Archives stranded tracked run spec headers.', ''];
  for (const m of envelope.moved) lines.push(`- moved ${safe(m.runId)}`);
  for (const d of envelope.deleted) lines.push(`- deleted the live copy of ${safe(d.runId)} (archive twin identical)`);
  for (const id of already) lines.push(`- ${safe(id)}: already archived on ${BRANCH}`);
  for (const c of envelope.conflicts) {
    lines.push(`- left ${safe(c.runId)} (${safe(c.reason)}): ${c.differing.length ? c.differing.map(safe).join(', ') : 'no differing paths'}`);
  }
  if (envelope.untwinned.length > 0) {
    lines.push('', 'Untwinned (classify by hand)', '');
    for (const u of envelope.untwinned) lines.push(`- ${safe(u)}`);
  }
  return neutralizeClosingPhrases(`${lines.join('\n')}\n`).text;
}

// The real run: archive every shell in a scratch worktree on the local branch, and (unless
// opts.noPr) push it and open or reuse its one PR. The worktree is always removed; the branch
// stays. -> { code, branch }
function archiveInWorktree(root, shells, integration, deps, envelope, opts) {
  const wt = deps.worktreePath(root);
  const env = repoPinnedEnv(deps.env);
  const g = (args, cwd, extra) => deps.git(args, { cwd, env: deps.env, ...extra });
  const gh = (args, input) => deps.gh(args, { cwd: root, input });
  const refuse = (msg, branch = null) => {
    deps.stderr(`archive-tracked-shells: ${msg}\n`);
    return { code: 2, branch };
  };
  const originRef = `refs/remotes/origin/${integration}`;
  const branchRef = `refs/remotes/origin/${BRANCH}`;
  const fetched = g(['fetch', 'origin', `+refs/heads/${integration}:${originRef}`], root);
  if (fetched.failure) envelope.notes.push(`fetch of origin ${integration} failed; using the last fetched ref`);
  const hasLocal = !g(['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`], root).failure;
  let plan = { base: hasLocal ? `refs/heads/${BRANCH}` : originRef, merge: hasLocal, remoteExisted: false, openPr: null };
  if (!opts.noPr) {
    plan = planPrBase(root, integration, hasLocal, !fetched.failure, g, gh);
    if (plan.error) return refuse(plan.error);
  }
  const { base } = plan;
  if (g(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], root).failure) {
    return refuse(`cannot resolve ${base} to start ${BRANCH} from`);
  }
  removeWorktree(root, wt, deps);
  const added = g(['worktree', 'add', '-B', BRANCH, wt, base], root);
  if (added.failure) return refuse(`git worktree add failed: ${added.stderr || added.failure}`);
  try {
    if (plan.merge) {
      // The base predates this run: bring in what reached the integration branch since, so a
      // shell that landed later is in the scratch tree.
      const merged = g(['merge', '--no-edit', originRef], wt);
      if (merged.failure) {
        g(['merge', '--abort'], wt);
        return refuse(`merging ${originRef} into ${BRANCH} failed: ${merged.stderr || merged.failure}`, BRANCH);
      }
    }
    const dirty = g(['--no-optional-locks', 'status', '--porcelain'], wt); // git-path-read: not a path list (emptiness only)
    if (dirty.failure || (dirty.stdout || '').trim() !== '') {
      deps.stderr('archive-tracked-shells: the scratch worktree is not clean; refusing to commit into it\n');
      return { code: 2, branch: BRANCH };
    }
    let left = 0;
    const already = [];
    for (const shell of shells) {
      const wtRunDir = path.join(pipelinesDir(wt), shell.runId);
      if (!isTrackedShellDir(wtRunDir)) {
        // Done on this branch only when its archived work is here; otherwise the shell is not on
        // the branch at all (landed after, or never pushed) and is left behind.
        if (hasArchivedWork(wt, shell.runId)) {
          already.push(shell.runId);
          envelope.notes.push(`${shell.runId}: already archived on ${BRANCH}`);
        } else {
          left += 1;
          envelope.conflicts.push({ runId: shell.runId, reason: 'not-on-branch', differing: [] });
        }
        continue;
      }
      const twinned = hasTwin(workAreas(wtRunDir, archiveDirOf(wt, shell.runId)));
      const result = archiveRunDir(wt, wtRunDir, { env });
      if (result.ok) {
        (twinned ? envelope.deleted : envelope.moved).push({ runId: shell.runId, commit: (result.commit && result.commit.sha) || null });
      } else {
        left += 1;
        envelope.conflicts.push({
          runId: shell.runId,
          reason: result.reason,
          differing: (result.conflict && result.conflict.differing) || [],
        });
      }
    }
    const leftCode = left > 0 ? 1 : 0;
    if (opts.noPr) return { code: leftCode, branch: BRANCH };

    // Only this branch's own archive commits count: the catch-up merge of the integration branch,
    // and the integration commits it brought in (^originRef), are not new work, so a run that
    // archived nothing pushes nothing.
    const countAhead = (ref) => {
      const res = g(['rev-list', '--count', '--no-merges', `${ref}..HEAD`, `^${originRef}`], wt);
      const n = Number((res.stdout || '').trim());
      if (res.failure || !Number.isInteger(n)) throw new Error(`git rev-list --count ${ref}..HEAD failed: ${res.stderr || res.failure}`);
      return n;
    };
    // New work for the integration branch (decides whether a PR is needed) and for the remote
    // branch (decides whether a push is).
    const aheadOfIntegration = countAhead(originRef);
    const toPush = plan.remoteExisted ? countAhead(branchRef) : aheadOfIntegration;
    let createdRemote = false;
    if (toPush > 0) {
      const pushed = g(['push', 'origin', BRANCH], wt, { timeoutMs: GIT_PUSH_TIMEOUT_MS });
      if (pushed.failure) return refuse(`git push origin ${BRANCH} failed: ${firstLine(pushed.stderr) || pushed.failure}`, BRANCH);
      createdRemote = !plan.remoteExisted;
    }
    let pr = plan.openPr;
    if (!pr && aheadOfIntegration > 0) {
      const total = envelope.moved.length + envelope.deleted.length + already.length;
      const title = total > 0 ? `Archive ${total} stranded run spec headers` : 'Archive stranded run spec headers';
      const created = gh(['pr', 'create', '--base', integration, '--head', BRANCH, '--title', title, '--body-file', '-'], prBody(envelope, already));
      // A successful create prints the new PR's URL: that is the PR, whatever the read-back says. The
      // read-back settles the other cases: a create that errored after it landed still has its PR.
      const printed = created.failure ? null : /\/pull\/(\d+)\s*$/.exec(String(created.stdout || '').trim());
      const back = gh(['pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number,url']);
      let rows = null;
      if (!back.failure) { try { rows = JSON.parse(back.stdout || '[]'); } catch { rows = null; } }
      if (Array.isArray(rows) && rows.length > 0) pr = { number: rows[0].number, url: rows[0].url };
      else if (printed) pr = { number: Number(printed[1]), url: String(created.stdout).trim() };
      if (!pr) {
        const confirmedNone = created.failure && Array.isArray(rows) && rows.length === 0;
        deps.stderr(`archive-tracked-shells: no pull request for ${BRANCH}: ${firstLine(created.failure ? created.stderr : back.stderr) || 'the open-PR read-back was empty'}\n`);
        // The branch goes only when this run pushed it and the create failed with no open PR to show for
        // it: after a successful or unconfirmed create the PR may exist, and deleting its head closes it.
        if (createdRemote && confirmedNone) {
          const gone = g(['push', 'origin', `:refs/heads/${BRANCH}`], wt);
          envelope.notes.push(gone.failure ? `could not delete the remote branch ${BRANCH} after the failure` : `deleted the remote branch ${BRANCH} this run pushed`);
        } else if (createdRemote) {
          envelope.notes.push(`kept the remote branch ${BRANCH}: whether its PR exists is unconfirmed`);
        }
        return { code: 1, branch: BRANCH };
      }
    }
    if (pr) {
      envelope.pr = { number: pr.number, url: pr.url, armed: false };
      if (opts.autoMerge === 'true') {
        const armed = gh(['pr', 'merge', String(pr.number), '--auto', '--squash']);
        if (armed.failure) envelope.pr.armError = firstLine(armed.stderr) || String(armed.failure);
        else envelope.pr.armed = true;
      } else if (opts.autoMerge === 'false') {
        envelope.notes.push('housekeeping-auto-merge is false — PR left unarmed');
      } else {
        envelope.notes.push(`housekeeping-auto-merge is ${opts.autoMerge ? `'${opts.autoMerge}'` : 'unresolved'}, not 'true' — PR left unarmed`);
      }
    }
    return { code: leftCode, branch: BRANCH };
  } finally {
    removeWorktree(root, wt, deps);
  }
}

function run(argv, deps) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    deps.stderr(`archive-tracked-shells: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const { opts } = parsed;
  if (opts.help) {
    deps.stdout(USAGE);
    return 0;
  }
  let root;
  try {
    if (opts.root !== null) root = path.resolve(deps.cwd(), opts.root);
    else {
      const cwd = deps.cwd();
      root = mainCheckoutRoot(cwd) || cwd;
    }
  } catch (err) {
    deps.stderr(`archive-tracked-shells: cannot resolve the repository root: ${err && err.message}\n`);
    return 2;
  }
  let policy;
  try {
    policy = deps.policy(root, POLICY_KEYS, { env: deps.env });
  } catch (err) {
    deps.stderr(`archive-tracked-shells: policy resolution failed: ${err && err.message}\n`);
    return 2;
  }
  if (!opts.dryRun && !opts.noPr) {
    let reason = null;
    if (policy['integration-model'] !== 'pr-first') reason = `integration-model is ${policy['integration-model'] || 'unresolved'}, not pr-first`;
    else if (!deps.ghAvailable()) reason = 'gh is not available';
    if (reason) {
      deps.stderr(`archive-tracked-shells: ${reason}, so no pull request can be opened — re-run with --no-pr to commit on ${BRANCH} locally\n`);
      return 2;
    }
  }

  let found;
  try {
    found = findShells(root, deps);
  } catch (err) {
    deps.stderr(`archive-tracked-shells: ${err && err.message}\n`);
    return 2;
  }
  const envelope = {
    moved: [], deleted: [], conflicts: [], untwinned: found.untwinned, branch: null, pr: null, notes: [],
  };
  let code = 0;
  if (opts.dryRun) {
    envelope.dryRun = true;
    for (const shell of found.shells) {
      const verdict = classifyDry(root, shell, repoPinnedEnv(deps.env));
      if (verdict.kind === 'conflict') envelope.conflicts.push({ runId: shell.runId, reason: 'work-twin-conflict', differing: verdict.differing });
      else envelope[verdict.kind].push({ runId: shell.runId, commit: null });
    }
  } else if (found.shells.length > 0) {
    const integration = resolveIntegration(root, deps, policy['integration-branch']);
    if (!integration) {
      deps.stderr('archive-tracked-shells: cannot resolve the integration branch — set integration-branch in .claude-tweaks/policy.yml\n');
      return 2;
    }
    let out;
    try {
      out = archiveInWorktree(root, found.shells, integration, deps, envelope, {
        noPr: opts.noPr, autoMerge: policy['housekeeping-auto-merge'],
      });
    } catch (err) {
      deps.stderr(`archive-tracked-shells: archiving failed: ${(err && err.message) || err}\n`);
      return 2;
    }
    envelope.branch = out.branch;
    code = out.code;
    if (out.code === 2) return 2;
  }
  deps.stdout(`${JSON.stringify(envelope)}\n`);
  return code;
}

// git through runGit with the repo-locating env pinned, stdout untrimmed (-z readers need it).
// `input` is ignored: no git call here reads stdin.
function realGit(args, { cwd, env, timeoutMs }) {
  return runGit(args, cwd, { raw: true, env: repoPinnedEnv(env), ...(timeoutMs ? { timeoutMs } : {}) });
}

function realGh(args, { cwd, input } = {}) {
  try {
    const stdout = execFileSync('gh', args, ghOptions(args, {
      cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true,
    }));
    return { stdout: String(stdout).trim(), stderr: '', failure: null, exitCode: 0 };
  } catch (err) {
    return {
      stdout: null,
      stderr: String((err && err.stderr) || '').trim(),
      failure: (err && err.code) || 'gh-failed',
      exitCode: err && typeof err.status === 'number' ? err.status : null,
    };
  }
}

const realDeps = {
  cwd: () => process.cwd(),
  env: process.env,
  homeDir: () => os.homedir(),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  git: realGit,
  gh: realGh,
  ghAvailable: () => probeGh(),
  // In-process through resolve-policy.js's core (no kill timeout, per gh-api-module-pattern).
  policy: (root, keys, { env } = {}) => {
    const out = resolvePolicy({ keys }, callerDeps({ cwd: root, ...(env ? { env } : {}), stderr: () => {} }));
    if (out.code !== EXIT_OK) throw new Error(out.message);
    return Object.fromEntries(keys.map((k) => [k, scalarValue(out.result[k])]));
  },
  worktreePath: (root) => path.join(root, '.worktrees', 'archive-tracked-shells'),
};

module.exports = { run, realDeps, findShells, prBody, BRANCH };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
