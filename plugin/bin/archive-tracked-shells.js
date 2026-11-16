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
const { GH_TIMEOUT_MS } = require('./lib/shared-primitives');
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
  const listed = deps.git(['ls-files', '-z', '--', '.claude-tweaks/pipelines'], { cwd: root });
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
  const head = gitText(deps.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root }));
  return head.startsWith('origin/') ? head.slice('origin/'.length) : null;
}

function removeWorktree(root, wt, deps) {
  if (lstatType(wt).type !== 'missing') deps.git(['worktree', 'remove', '--force', wt], { cwd: root });
  deps.git(['worktree', 'prune'], { cwd: root });
}

// The real run: archive every shell in a scratch worktree on the local branch. The worktree
// is always removed; the branch stays. -> { code, branch }
function archiveInWorktree(root, shells, integration, deps, envelope) {
  const wt = deps.worktreePath(root);
  const env = repoPinnedEnv(deps.env);
  const fetched = deps.git(['fetch', 'origin', `+refs/heads/${integration}:refs/remotes/origin/${integration}`], { cwd: root });
  if (fetched.failure) envelope.notes.push(`fetch of origin ${integration} failed; using the last fetched ref`);
  const hasLocal = !deps.git(['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`], { cwd: root }).failure;
  const base = hasLocal ? `refs/heads/${BRANCH}` : `refs/remotes/origin/${integration}`;
  if (deps.git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], { cwd: root }).failure) {
    deps.stderr(`archive-tracked-shells: cannot resolve ${base} to start ${BRANCH} from\n`);
    return { code: 2, branch: null };
  }
  removeWorktree(root, wt, deps);
  const added = deps.git(['worktree', 'add', '-B', BRANCH, wt, base], { cwd: root });
  if (added.failure) {
    deps.stderr(`archive-tracked-shells: git worktree add failed: ${added.stderr || added.failure}\n`);
    return { code: 2, branch: null };
  }
  try {
    const dirty = deps.git(['--no-optional-locks', 'status', '--porcelain'], { cwd: wt }); // git-path-read: not a path list (emptiness only)
    if (dirty.failure || (dirty.stdout || '').trim() !== '') {
      deps.stderr('archive-tracked-shells: the scratch worktree is not clean; refusing to commit into it\n');
      return { code: 2, branch: BRANCH };
    }
    let left = 0;
    for (const shell of shells) {
      const wtRunDir = path.join(pipelinesDir(wt), shell.runId);
      if (!isTrackedShellDir(wtRunDir)) {
        envelope.notes.push(`${shell.runId}: already archived on ${BRANCH}`);
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
    // Task 4 (#3975) adds the push, the PR and its auto-merge arming here, after the loop
    // and only without --no-pr; until then every real run stops at the local branch.
    return { code: left > 0 ? 1 : 0, branch: BRANCH };
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
    const out = archiveInWorktree(root, found.shells, integration, deps, envelope);
    envelope.branch = out.branch;
    code = out.code;
    if (out.code === 2) return 2;
  }
  deps.stdout(`${JSON.stringify(envelope)}\n`);
  return code;
}

// git through runGit with the repo-locating env pinned, stdout untrimmed (-z readers need it).
// `input` is ignored: no git call here reads stdin.
function realGit(args, { cwd }) {
  return runGit(args, cwd, { raw: true, env: repoPinnedEnv() });
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

module.exports = { run, realDeps, findShells, BRANCH };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
