// bin/lib/wrap-up/engine-verify.js — deterministic checks for wrap-up's
// closure gate. Verifies the run this verb is invoked on, immediately after
// that run's own execution step (`execution-and-verification.md`'s "Execute
// approved actions" section) — it is not a retrospective auditor of an
// arbitrary historical run-dir, whose commit conventions may predate the
// trailers/markers this module greps for.
//
// Injectable seam: every check function takes `deps.git`/`deps.gh`
// (execFileSync-backed defaults below), following the same fake-runner
// convention as bin/lib/merge-size-probe.js (see the gh-api-module-pattern
// skill) — argv array only, never a shell string.
//
// Deliberately gh-CLI-only, same constraint every other reconcile check
// states: a Node subprocess cannot reach an agent session's MCP tools, so a
// gh-absent environment reports that reason (per-check, via the `deps.gh`
// seam) rather than attempting an MCP fallback.
//
// Read-only by design: only `git log`, `git ls-files`, `git worktree list`,
// `fs.readdirSync`/`fs.existsSync`, and `gh issue view`/`gh pr view`. No
// state-changing command belongs in this module.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseWorktreeList } = require('../hooks/worktree-reap');
const { ghAvailable: sharedGhAvailable, parseRepo } = require('../repo-resolve');
const { fetchNativeParent } = require('../issues/native-dependencies');

// Shared factory (not two hand-duplicated functions) so defaultGit and
// defaultGh can never again drift on their execFileSync options the way
// #1230 found them to (defaultGit missing the `timeout` defaultGh already
// had) -- one options object, reused by construction.
function makeDefaultRunner(cmd) {
  return function run(args, cwd) {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
  };
}

const defaultGit = makeDefaultRunner('git');
const defaultGh = makeDefaultRunner('gh');

// Registry of check functions, populated by Tasks 2-5. Each entry:
// { name: string, fn: ({runDir, originalRunDir, base, repoRoot, cwd, expectations, deps}) => {result, detail} }.
// A flat array (not an object keyed by name) preserves the fixed row order
// the table renders in, matching the prose checklist's original order.
const CHECKS = [];

function registerCheck(name, fn) {
  CHECKS.push({ name, fn });
}

// A multi-spec per-spec leaf ('spec-{N}') resolves relative to its PARENT
// run's id -- the worktree/branch and the archived layout
// (archive-merged.js's archiveRunDir) both nest under the parent, never a
// flattened 'spec-{N}' alone.
function isSpecLeaf(base) {
  return /^spec-\d+$/.test(base);
}

function runIdFromRunDir(runDir) {
  // Strip a leading ISO-timestamp prefix (YYYY-MM-DDTHHMMSS-) when present;
  // otherwise the whole basename is already the id.
  const base = path.basename(runDir);
  const m = base.match(/^\d{4}-\d{2}-\d{2}T\d{6}-(.+)$/);
  return m ? m[1] : base;
}

// The id used for matching against worktree paths/branch names AND (see
// archiveRelativeId below) for locating the archived copy. For a per-spec
// subdirectory this is the PARENT's id (worktree/branch naming reflects the
// parent, not the per-spec leaf); otherwise it's this dir's own id.
function specSlugFromRunDir(runDir) {
  const base = path.basename(runDir);
  if (isSpecLeaf(base)) return runIdFromRunDir(path.dirname(runDir));
  return runIdFromRunDir(runDir);
}

// Path segment(s), relative to .claude-tweaks/pipelines/archive/, where this
// run's archived copy lives -- '{parent-run-id}/spec-{N}' for a per-spec
// subdirectory (preserving archive-merged.js's own nesting), or just the
// run's own id otherwise. Unlike specSlugFromRunDir (worktree/branch
// substring matching, which needs the ISO-timestamp prefix stripped),
// archive-merged.js's archiveRunDir() archives to
// `archive/{path.basename(runDir)}` -- the FULL basename, timestamp
// included -- so this must use the raw basename, never runIdFromRunDir's
// stripped form, or a real archived run is never located (regression caught
// by the record #900 whole-branch re-review: resolveArchivedRunDir returned
// null for every timestamped run dir).
function archiveRelativeId(runDir) {
  const base = path.basename(runDir);
  if (isSpecLeaf(base)) return path.join(path.basename(path.dirname(runDir)), base);
  return base;
}

function resolveArchivedRunDir(runDir, repoRoot) {
  if (fs.existsSync(runDir)) return runDir;
  const archived = path.join(repoRoot, '.claude-tweaks', 'pipelines', 'archive', archiveRelativeId(runDir));
  if (fs.existsSync(archived)) return archived;
  return null;
}

// ---- verify-expectations.json (v1) -----------------------------------------
//
// Written by the wrap-up Review Console at resolution time, always -- even
// an empty { version: 1, memory: [], upstream: [] } when nothing resolved.
// Absent-entirely is DISTINCT from present-but-empty (spec's load-bearing
// asymmetry): absent means the console's own write step failed -- exactly
// the silent-non-execution class this whole verb exists to catch -- so it
// renders 'unknown', never folded into 'skip'.
const SUPPORTED_EXPECTATIONS_VERSION = 1;

function readExpectations(runDir) {
  const expPath = path.join(runDir, 'verify-expectations.json');
  if (!fs.existsSync(expPath)) return { ok: false, reason: 'missing' };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(expPath, 'utf8'));
  } catch {
    return { ok: false, reason: 'missing' };
  }
  if (data === null || typeof data !== 'object') return { ok: false, reason: 'missing' };
  if (data.version !== SUPPORTED_EXPECTATIONS_VERSION) {
    return { ok: false, reason: 'unsupported-version', version: data.version };
  }
  return { ok: true, data };
}

function deferredSet(expectations) {
  return expectations.ok ? new Set(expectations.data.deferred || []) : new Set();
}

// #2383: issue numbers whose Oversight-floor gate (verification-brief.md,
// #367) resolved `exceeds: false` -- these records legitimately carry no
// `demo:pending` (Steps 1-4 were correctly skipped), so acceptance-labeling
// below must render 'skip' for them instead of 'fail'. Written by the gate
// itself into verify-expectations.json's `oversightExempt` array, the same
// way `memory`/`upstream` are written by the Review Console. Absent
// expectations degrades to an empty set here (not 'unknown') -- an unrelated
// check (memory-updates/upstream-feedback) already surfaces a missing
// expectations file as 'unknown'; acceptance-labeling itself only consults
// this set to narrow its failing population, never to gate its own result on
// the file's presence.
function oversightExemptSet(expectations) {
  return expectations.ok ? new Set((expectations.data.oversightExempt || []).map(Number)) : new Set();
}

function expectationsUnknownDetail(expectations) {
  return expectations.reason === 'unsupported-version'
    ? `expectations version ${expectations.version} unsupported`
    : 'expectations file missing';
}

// ---- plans + ledger removal ------------------------------------------------
//
// docs/superpowers/plans/ and docs/plans/ hold ephemeral scratch (execution
// plans; design-wrapper cache JSON) that should be untracked by the time
// wrap-up finishes -- slug-matching a plan's TOPIC filename against the
// run's SPEC identity essentially never matches (they come from unrelated
// naming schemes), so this scans for untracked entries via `git status`
// instead. `cwd` -- the invoking checkout's own working tree, not `repoRoot`
// (always the main checkout) -- since under this project's default
// `worktree`/`pr-first` mode, an execution-plan or design-cache file created
// by a run lives in that run's WORKTREE's own working tree, not the main
// checkout's: a worktree's untracked files never appear in any other
// checkout's `git status`, even though they share one object store.
// `repoRoot`-scoped scanning was blind to a run's own leftovers under the
// default mode and could only ever catch leftovers left directly in the main
// checkout (record #900 whole-branch re-review, finding #3; fixed here,
// record #1222). Residual: in the mainline single-spec `worktree`/`pr-first`
// flow this verb's own cleanup (including worktree removal) runs BEFORE
// verify, so by the time this check runs there `cwd` has already collapsed
// back to the main checkout anyway -- the fix's real value is realized on
// the `MULTISPEC_REVIEW_DEFER=1` path (parent `/flow` console defers
// worktree removal) and standalone/manual `wrap-up` invocations run from
// inside a still-live worktree. `run-dir-archived` still needs `repoRoot`
// for its `.claude-tweaks/pipelines/` lookups (that path genuinely only
// exists in the main checkout, gitignored, never in a worktree) -- this
// check alone reads `cwd`.
// `--porcelain=v1 -uall` (not the default `-uno`) so a wholly-untracked
// directory reports every file inside it individually instead of collapsing
// to one `?? {dir}/` line the suffix/name filters below could never match.
registerCheck('plans-ledger', ({ cwd, deps }) => {
  let status;
  try {
    status = deps.git(['status', '--porcelain=v1', '-uall', '--', 'docs/superpowers/plans', 'docs/plans'], cwd);
  } catch (err) {
    return { result: 'unknown', detail: `git status failed: ${err.message}` };
  }
  const leftovers = status.split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3).trim());
  // .superpowers/sdd/ is gitignored entirely so it never shows up in `git
  // status` even with the paths above -- check it directly. Any entry
  // present there is a leftover SDD ledger workspace that should have been
  // deleted at wrap-up. Dotfiles (the directory's own `.gitignore`
  // scaffolding, always present) are not leftovers -- only real content
  // counts.
  const sddDir = path.join(cwd, '.superpowers', 'sdd');
  let sddEntries = [];
  try {
    if (fs.existsSync(sddDir)) {
      sddEntries = fs.readdirSync(sddDir)
        .filter((e) => !e.startsWith('.'))
        .map((e) => path.join('.superpowers/sdd', e));
    }
  } catch { /* unreadable dir -- treat as no entries rather than throwing */ }
  const all = [...leftovers, ...sddEntries];
  if (all.length) return { result: 'fail', detail: `${all.length} leftover artifact(s) remain: ${all.join(', ')}` };
  return { result: 'pass', detail: '' };
});

// ---- design caches deleted --------------------------------------------------
//
// `cwd`, matching plans-ledger's reasoning above -- this check scans the
// invoking checkout's own working tree, not always the main checkout.
registerCheck('design-caches', ({ cwd, expectations, deps }) => {
  const deferred = deferredSet(expectations);
  if (deferred.has('design-caches')) return { result: 'skip', detail: 'deferred to parent console' };
  const cacheDir = path.join(cwd, 'docs', 'plans');
  if (!fs.existsSync(cacheDir)) return { result: 'pass', detail: '' };
  let status;
  try {
    status = deps.git(['status', '--porcelain=v1', '-uall', '--', 'docs/plans'], cwd);
  } catch (err) {
    return { result: 'unknown', detail: `git status failed: ${err.message}` };
  }
  const suffixes = ['-audit.json', '-recommendations.json', '-declined.json'];
  const untracked = status.split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3).trim());
  const matches = untracked.filter((f) => suffixes.some((suf) => f.endsWith(suf)));
  if (matches.length) return { result: 'fail', detail: `${matches.length} cache file(s) remain: ${matches.join(', ')}` };
  return { result: 'pass', detail: '' };
});

// ---- run-dir archived --------------------------------------------------------
//
// "Archived" means the shape bin/lib/reconcile/archive-merged.js's
// archiveRunDir() produces: the original .claude-tweaks/pipelines/{run-id}/
// path is gone, .claude-tweaks/pipelines/archive/{run-id}/ exists, and its
// work/ subdirectory (when the run had one) is git-tracked at the new path.
registerCheck('run-dir-archived', ({ originalRunDir, repoRoot, expectations, deps }) => {
  const deferred = deferredSet(expectations);
  if (deferred.has('run-dir-archival')) return { result: 'skip', detail: 'deferred to parent console' };
  const originalPath = path.resolve(originalRunDir);
  const archivePath = path.join(repoRoot, '.claude-tweaks', 'pipelines', 'archive', archiveRelativeId(originalRunDir));
  if (fs.existsSync(originalPath)) return { result: 'fail', detail: `original path still present: ${originalPath}` };
  if (!fs.existsSync(archivePath)) return { result: 'fail', detail: `archive path missing: ${archivePath}` };
  const archivedWork = path.join(archivePath, 'work');
  if (fs.existsSync(archivedWork)) {
    let tracked;
    try {
      tracked = deps.git(['ls-files', archivedWork], repoRoot);
    } catch (err) {
      return { result: 'fail', detail: `git ls-files failed for ${archivedWork}: ${err.message}` };
    }
    if (!tracked.trim()) return { result: 'fail', detail: `${archivedWork} exists but is not git-tracked` };
  }
  return { result: 'pass', detail: '' };
});

// ---- worktree removed ---------------------------------------------------------
registerCheck('worktree-removed', ({ runDir, expectations, deps, cwd }) => {
  const deferred = deferredSet(expectations);
  if (deferred.has('worktree')) return { result: 'skip', detail: 'deferred to parent console' };
  // Worktree paths/branches are named from the spec-slug alone (e.g.
  // .claude/worktrees/flow-spec-900, branch worktree-flow-spec-900), not the
  // ISO-timestamp-prefixed run-dir basename -- match against the same slug
  // plans-ledger/design-caches already derive, not the raw basename.
  const slug = specSlugFromRunDir(runDir);
  let porcelain;
  try {
    porcelain = deps.git(['worktree', 'list', '--porcelain'], cwd);
  } catch (err) {
    return { result: 'unknown', detail: `git worktree list failed: ${err.message}` };
  }
  const list = parseWorktreeList(porcelain);
  const match = list.find((wt) => wt.path.includes(slug) || (wt.branch && wt.branch.includes(slug)));
  if (match) return { result: 'fail', detail: `worktree still listed: ${match.path}` };
  return { result: 'pass', detail: '' };
});

// ---- resolved-issue-number resolution --------------------------------------
//
// existsSync-then-read is a TOCTOU by construction: this project's own
// reconcile/archive processes concurrently prune exactly these pipeline
// run-dirs. Reading straight off readdirSync (no existsSync guard -- a
// missing work/ throws ENOENT the same as a mid-read prune) and wrapping in
// try/catch degrades to "no headers found" (falls through to the
// expectations-file fallback below) on either case, rather than throwing
// uncaught -- matching every other read site in this module.
function resolvedIssueNumbers(runDir) {
  const workDir = path.join(runDir, 'work');
  const fromHeaders = [];
  try {
    for (const entry of fs.readdirSync(workDir)) {
      if (!entry.endsWith('-spec.md')) continue;
      const content = fs.readFileSync(path.join(workDir, entry), 'utf8');
      const m = content.match(/^record:\s*(\d+)/m);
      if (m) fromHeaders.push(Number(m[1]));
    }
  } catch { /* work/ absent, or pruned mid-read (reconcile/archive race) -- fall through to the expectations fallback below */ }
  if (fromHeaders.length) return fromHeaders;
  const expPath = path.join(runDir, 'verify-expectations.json');
  if (fs.existsSync(expPath)) {
    try {
      const exp = JSON.parse(fs.readFileSync(expPath, 'utf8'));
      if (Array.isArray(exp.issues)) return exp.issues;
    } catch { /* malformed expectations file -- Task 5 owns reporting this on the expectations-dependent rows; this fallback simply yields nothing here */ }
  }
  return [];
}

// ---- carrier commit -----------------------------------------------------------
//
// Under `worktree` mode + `integration-model: pr-first`, there is
// deliberately no `Fixes #{n}` commit on the branch -- the run's draft PR
// body carries that line instead (execution-and-verification.md's
// worktree/pr-first note). Only fall back to the PR body when a PR number
// actually resolves for this run (resolvePrNumber); local-merge /
// current-branch runs have no PR, and the branch-log commit is their only
// carrier -- missing there stays a genuine `fail`, unchanged from before.
registerCheck('carrier-commit', ({ runDir, base, deps, cwd }) => {
  const issues = resolvedIssueNumbers(runDir);
  if (!issues.length) return { result: 'skip', detail: 'no resolved issue numbers found (conversation-based work, or no materialized headers and no expectations issues)' };
  const prNumber = resolvePrNumber(runDir);
  let prBody = null; // cached across issues once fetched -- never re-fetched per issue
  let prBodyFetched = false;
  const missing = [];
  for (const n of issues) {
    let out;
    try {
      out = deps.git(['log', `--grep=Fixes #${n}`, `${base}..HEAD`, '--oneline'], cwd);
    } catch (err) {
      return { result: 'unknown', detail: `git log failed: ${err.message}` };
    }
    if (out.trim()) continue;

    if (!prNumber) { missing.push(n); continue; }
    if (!prBodyFetched) {
      prBodyFetched = true;
      try {
        prBody = JSON.parse(deps.gh(['pr', 'view', String(prNumber), '--json', 'body'], cwd)).body || '';
      } catch (err) {
        return { result: 'unknown', detail: `gh pr view failed for PR #${prNumber}: ${err.message}` };
      }
    }
    if (!prBody.includes(`Fixes #${n}`)) missing.push(n);
  }
  if (missing.length) return { result: 'fail', detail: `no carrier commit found for #${missing.join(', #')}` };
  return { result: 'pass', detail: '' };
});

// ---- reference-repair commit scoping -------------------------------------------
registerCheck('reference-repairs', ({ runDir, base, deps, cwd }) => {
  const statePath = path.join(runDir, 'engine-state.json');
  if (!fs.existsSync(statePath)) return { result: 'skip', detail: 'no engine-state.json (curation deferred or not run)' };
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (err) {
    return { result: 'unknown', detail: `could not parse engine-state.json: ${err.message}` };
  }
  const findings = (state.results && state.results.references && state.results.references.findings) || [];
  const applied = findings.filter((f) => f.action === 'applied').map((f) => f.targetPath).filter(Boolean);
  if (!applied.length) return { result: 'skip', detail: 'no applied reference-repair findings this run' };
  let commitLog;
  try {
    commitLog = deps.git(['log', '--grep=Initiative-Fix:', `${base}..HEAD`, '--format=%H'], cwd);
  } catch (err) {
    return { result: 'unknown', detail: `git log failed: ${err.message}` };
  }
  const commits = commitLog.split('\n').filter(Boolean);
  if (!commits.length) return { result: 'fail', detail: 'no Initiative-Fix: commit found in range' };
  const touched = new Set();
  for (const sha of commits) {
    let diff;
    try {
      diff = deps.git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha], cwd);
    } catch (err) {
      return { result: 'unknown', detail: `git diff-tree failed for ${sha}: ${err.message}` };
    }
    for (const f of diff.split('\n').filter(Boolean)) touched.add(f);
  }
  const appliedSet = new Set(applied);
  const extra = [...touched].filter((f) => !appliedSet.has(f));
  if (extra.length) return { result: 'fail', detail: `Initiative-Fix: commit touches unrelated file(s): ${extra.join(', ')}` };
  return { result: 'pass', detail: '' };
});

// ---- gh availability probe ------------------------------------------------
// Delegates to the shared plugin/bin/lib/repo-resolve.js helper (the
// six-call-site consolidation, #2017) via a one-call adapter: this module's
// own deps.gh(args, cwd) seam takes a cwd the shared helper's
// deps.execFileSync(cmd, args, opts) shape has no slot for, so the adapter
// closes over cwd and discards the shared helper's own cmd/opts arguments
// (deps.gh always means "gh", and this module's own makeDefaultRunner
// already carries the timeout bound).
function ghAvailable(deps, cwd) {
  return sharedGhAvailable({ execFileSync: (_cmd, args) => deps.gh(args, cwd) });
}

// ---- parent resolution + pr-first pointer helpers ---------------------------
//
// `verification-brief.md`'s Routing section: a resolvable-parent sub-issue
// never carries its own `demo:pending` -- its parent carries one gate for
// all of them. Callers must redirect to the parent before checking labels/
// comments. Returns { ok:false, error } instead of throwing so a gather
// failure can be distinguished from a genuine labeling mismatch by the
// caller -- the acceptance-labeling check below renders 'unknown', never
// 'fail', for an { ok: false } result.
//
// GraphQL, not `gh issue view --json parent`: that REST field is unknown to
// gh <2.96 (#1841), while Issue.parent via GraphQL works on every gh version
// that can run GraphQL at all. A GraphQL variable can't be filled by gh's
// {owner}/{repo} placeholder substitution (gh-api-module-pattern skill) --
// the repo slug has to be resolved locally first, via the same `deps.git`
// seam every other check in this file already uses.
function resolveParent(n, deps, cwd) {
  let remote;
  try {
    remote = deps.git(['remote', 'get-url', 'origin'], cwd);
  } catch (err) {
    return { ok: false, error: `git remote get-url failed for #${n} (${err.message})` };
  }
  const repoSpec = parseRepo(remote);
  if (!repoSpec) {
    return { ok: false, error: `could not resolve owner/repo for #${n}` };
  }
  try {
    const parent = fetchNativeParent({
      number: n,
      owner: repoSpec.owner,
      repo: repoSpec.repo,
      runner: (args) => deps.gh(args, cwd),
    });
    return { ok: true, parent };
  } catch (err) {
    return { ok: false, error: `gh api graphql (parent) failed for #${n} (${err.message})` };
  }
}

// `verify`'s --run-dir may be the parent pipeline run directory, or (in a
// multi-spec run) a spec-{N}/ subdirectory with no run-state.json of its
// own -- checks runDir first, then one directory up. Absence or a parse/
// shape failure at whichever path is checked returns null, which correctly
// degrades to "no PR" (local-merge / degraded-pr-first) behavior in the
// caller -- it never falls further than one level up, and it never treats a
// present-but-PR-less run-state.json as a reason to keep searching.
function resolvePrNumber(runDir) {
  const direct = path.join(runDir, 'run-state.json');
  const statePath = fs.existsSync(direct) ? direct : path.join(path.dirname(runDir), 'run-state.json');
  if (!fs.existsSync(statePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return data.pr && data.pr.number ? data.pr.number : null;
  } catch {
    return null;
  }
}

// ---- acceptance labeling ---------------------------------------------------
//
// Reproduces execution-and-verification.md's existing per-backend,
// per-parent-vs-non-parent check (the prose this record deletes), including
// the two nuances the original version of this check omitted (record #900,
// Task 6 fix): parent redirection, and the pr-first pointer+brief split.
// Deliberate scope note (spec's own nuance, preserved here rather than
// re-derived): a resolvable-parent record's brief lives on the PARENT, and
// correctly-gated parents routinely have OTHER comments after the brief
// lands (the Parent-Gate Procedure's already-posted-brief branch only adds
// the label, posting nothing new) -- so this check tests whether ANY
// comment on the target issue (or, under the pr-first pointer form, the PR)
// contains the brief, never only the most recent one. A last-comment-only
// test would hard-stop a correctly-gated parent.
//
// Known, deliberate gap (not reproduced here -- said honestly rather than
// implied by omission): the `local-files` backend's different acceptance
// shape (`facets.acceptance` on the record body, no `gh` comments at all) is
// out of scope for this check as written; it only reproduces the
// `github-issues` path. The Oversight-floor gate's exemption (a non-parent
// record that doesn't clear the floor legitimately carries no
// `demo:pending`) IS reproduced here -- see `oversightExemptSet` above.
registerCheck('acceptance-labeling', ({ runDir, deps, cwd, expectations }) => {
  if (!ghAvailable(deps, cwd)) return { result: 'unknown', detail: 'gh absent' };
  const issues = resolvedIssueNumbers(runDir);
  if (!issues.length) return { result: 'skip', detail: 'no resolved issue numbers found' };

  // Oversight-floor-exempted records (#2383) never carry `demo:pending` --
  // narrow the population this check gathers/labels-checks to the issues
  // that are NOT exempted, before any parent resolution or gh call runs. An
  // exempted record never has a resolvable parent by construction (the
  // Oversight-floor gate only runs on the non-parent path), so it is always
  // its own target -- filtering here is equivalent to, and cheaper than,
  // filtering the resolved `targets` list below.
  const exempt = oversightExemptSet(expectations);
  const checkIssues = issues.filter((n) => !exempt.has(n));
  if (!checkIssues.length) {
    return { result: 'skip', detail: `oversight floor not cleared for #${issues.join(', #')}` };
  }
  const failing = [];

  // Resolve each issue's target (its parent, when resolvable; itself
  // otherwise), deduping by target -- two sub-issues sharing one parent
  // must only be checked once, both to avoid redundant gh calls and to
  // avoid redundant identical detail lines.
  //
  // A gather failure here (GraphQL error, unresolvable owner/repo, an
  // unparseable response) is a tooling gap, not evidence of a labeling
  // mismatch -- it renders the whole check 'unknown', matching this file's
  // other could-not-gather rows, and returns before any label/comment read
  // runs (a real labeling mismatch on a successfully resolved record still
  // reaches the loop below and can still render 'fail').
  const targets = [];
  const seenTargets = new Set();
  const gatherFailures = [];
  for (const n of checkIssues) {
    const resolved = resolveParent(n, deps, cwd);
    if (!resolved.ok) {
      gatherFailures.push(`#${n}: ${resolved.error}`);
      continue;
    }
    const target = resolved.parent || n;
    if (seenTargets.has(target)) continue;
    seenTargets.add(target);
    targets.push(target);
  }
  if (gatherFailures.length) return { result: 'unknown', detail: gatherFailures.join('; ') };

  const prNumber = resolvePrNumber(runDir);

  for (const target of targets) {
    let labelsRaw;
    try {
      labelsRaw = deps.gh(['issue', 'view', String(target), '--json', 'labels'], cwd);
    } catch (err) {
      failing.push(`#${target}: gh issue view failed (${err.message})`);
      continue;
    }
    let labels;
    try {
      labels = JSON.parse(labelsRaw).labels || [];
    } catch {
      failing.push(`#${target}: could not parse labels JSON`);
      continue;
    }
    if (!labels.some((l) => l.name === 'demo:pending')) {
      failing.push(`#${target}: missing demo:pending label`);
      continue;
    }
    let commentsRaw;
    try {
      commentsRaw = deps.gh(['issue', 'view', String(target), '--json', 'comments'], cwd);
    } catch (err) {
      failing.push(`#${target}: gh issue view (comments) failed (${err.message})`);
      continue;
    }
    let comments;
    try {
      comments = JSON.parse(commentsRaw).comments || [];
    } catch {
      failing.push(`#${target}: could not parse comments JSON`);
      continue;
    }
    const hasFullBrief = comments.some((c) => c.body && c.body.includes('## Verification Brief') && c.body.includes('### Confirmed'));
    if (hasFullBrief) continue;

    // No full brief on the issue itself -- under pr-first (run-state.json
    // carries a `pr` object), verification-brief.md's "`pr` object present"
    // branch posts the full brief on the PR instead, leaving only a
    // one-line pointer on the issue. Check for that form before failing.
    if (prNumber) {
      const hasPointer = comments.some((c) => c.body && c.body.includes('Verification Brief posted to PR #'));
      if (hasPointer) {
        let prCommentsRaw;
        try {
          prCommentsRaw = deps.gh(['pr', 'view', String(prNumber), '--json', 'comments'], cwd);
        } catch (err) {
          failing.push(`#${target}: gh pr view failed for PR #${prNumber} (${err.message})`);
          continue;
        }
        let prComments;
        try {
          prComments = JSON.parse(prCommentsRaw).comments || [];
        } catch {
          failing.push(`#${target}: could not parse PR #${prNumber} comments JSON`);
          continue;
        }
        const hasPrBrief = prComments.some(
          (c) => c.body && c.body.includes('<!-- run-comment: brief -->') && c.body.includes('### Confirmed')
        );
        if (hasPrBrief) continue;
        failing.push(`#${target}: pointer to PR #${prNumber} found but no confirmed Verification Brief on PR #${prNumber}`);
        continue;
      }
    }
    failing.push(`#${target}: no comment carries a confirmed Verification Brief`);
  }
  if (failing.length) return { result: 'fail', detail: failing.join('; ') };
  return { result: 'pass', detail: '' };
});

// ---- memory updates -----------------------------------------------------------
registerCheck('memory-updates', ({ expectations }) => {
  if (!expectations.ok) return { result: 'unknown', detail: expectationsUnknownDetail(expectations) };
  const entries = expectations.data.memory || [];
  if (!entries.length) return { result: 'skip', detail: 'nothing recorded' };
  const missing = [];
  for (const { file, indexFile } of entries) {
    if (!fs.existsSync(file)) missing.push(`file missing: ${file}`);
    if (indexFile) {
      // Read straight off the file rather than existsSync-then-read (a
      // TOCTOU): a missing or mid-race-removed index file throws the same
      // way, caught here and degraded to "missing" rather than throwing
      // uncaught.
      let indexContent;
      try {
        indexContent = fs.readFileSync(indexFile, 'utf8');
      } catch {
        missing.push(`index file missing: ${indexFile}`);
        continue;
      }
      const base = path.basename(file, '.md');
      if (!indexContent.includes(base)) missing.push(`index line missing for ${base} in ${indexFile}`);
    }
  }
  if (missing.length) return { result: 'fail', detail: missing.join('; ') };
  return { result: 'pass', detail: '' };
});

// ---- upstream feedback ----------------------------------------------------------
registerCheck('upstream-feedback', ({ expectations, deps, cwd }) => {
  if (!expectations.ok) return { result: 'unknown', detail: expectationsUnknownDetail(expectations) };
  const entries = expectations.data.upstream || [];
  if (!entries.length) return { result: 'skip', detail: 'nothing recorded' };
  if (!ghAvailable(deps, cwd)) return { result: 'unknown', detail: 'gh absent' };
  const failing = [];
  for (const { url } of entries) {
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (!m) { failing.push(`could not parse issue URL: ${url}`); continue; }
    const [, owner, repo, number] = m;
    try {
      deps.gh(['issue', 'view', number, '--repo', `${owner}/${repo}`, '--json', 'number'], cwd);
    } catch (err) {
      failing.push(`${url}: gh issue view failed (${err.message})`);
    }
  }
  if (failing.length) return { result: 'fail', detail: failing.join('; ') };
  return { result: 'pass', detail: '' };
});

function runVerify({ runDir, originalRunDir, base, repoRoot, cwd, deps = {} }) {
  const git = deps.git || defaultGit;
  const gh = deps.gh || defaultGh;
  const resolvedRepoRoot = repoRoot || process.cwd();
  const resolvedCwd = cwd || process.cwd();
  const resolvedOriginalRunDir = originalRunDir || runDir;
  const expectations = runDir === null ? null : readExpectations(runDir);

  // Null runDir (resolveArchivedRunDir found the run neither at its original
  // path nor under the archive) short-circuits here so every check function
  // registered by Tasks 2-6 can assume runDir is a real, existing path — none
  // of them need to re-implement this guard themselves.
  const rows = runDir === null
    ? CHECKS.map(({ name }) => ({
        check: name,
        result: 'unknown',
        detail: 'run dir not found at original or archive path',
      }))
    : CHECKS.map(({ name, fn }) => {
        // A check throwing (a bug in the check itself, or a race this
        // module's own read sites don't yet guard against) must not take
        // down the whole verb uncaught -- that would print no table at all
        // and exit via Node's default uncaught-exception path, silently
        // colliding with the documented exit-code contract. 'fail', not
        // 'unknown': a check that couldn't even determine its own state is
        // evidence something is wrong, and this verb's whole purpose is to
        // never silently non-execute -- erring toward blocking closure.
        try {
          const { result, detail } = fn({
            runDir, originalRunDir: resolvedOriginalRunDir, base, repoRoot: resolvedRepoRoot,
            cwd: resolvedCwd, expectations, deps: { git, gh },
          });
          return { check: name, result, detail: detail || '' };
        } catch (err) {
          return { check: name, result: 'fail', detail: `check threw: ${err.message}` };
        }
      });

  // A run that could not be located at all is not a clean pass -- surface it
  // as exit code 3 too, same as any other failing check.
  const exitCode = runDir === null || rows.some((r) => r.result === 'fail') ? 3 : 0;
  return { rows, exitCode };
}

function sanitizeCell(text) {
  return String(text).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

function renderVerifyTable(rows) {
  const lines = ['| Check | Result | Detail |', '|---|---|---|'];
  for (const row of rows) {
    const resultCell = (row.result === 'skip' || row.result === 'unknown') && row.detail
      ? `${row.result} (${sanitizeCell(row.detail)})`
      : row.result;
    const detailCell = row.result === 'fail' ? sanitizeCell(row.detail) : '';
    lines.push(`| ${row.check} | ${resultCell} | ${detailCell} |`);
  }
  return lines.join('\n');
}

module.exports = {
  runVerify,
  renderVerifyTable,
  sanitizeCell,
  resolveArchivedRunDir,
  registerCheck,
  defaultGit,
  defaultGh,
  resolveParent,
  resolvePrNumber,
};
