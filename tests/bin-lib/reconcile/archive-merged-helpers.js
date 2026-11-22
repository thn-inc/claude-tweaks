'use strict';
// Shared fixtures and helpers for the archive-merged*.test.js suites split out
// of tests/bin-lib/reconcile/archive-merged.test.js. Not a test file itself.
const assert = require('node:assert/strict');
const cp = require('child_process');
// Destructured at require time, so this binding is a snapshot of the REAL
// implementation — it stays callable as the pass-through inside the
// compound-failure test's `t.mock.method(cp, 'execFileSync', ...)`.
const { execFileSync } = cp;
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const {
  archiveMerged,
  STRUCTURALLY_STUCK_TTL_MS,
} = require('../../../plugin/bin/lib/reconcile/archive-merged');
const { PROBE_ORDER } = require('../../../plugin/bin/lib/run-liveness');
const { serializeManifestYaml } = require('../../../plugin/bin/lib/flow/manifest');
const { archiveRunHeader } = require('../../../plugin/bin/lib/run-header-archive');
const { fromTemplate, fromTemplateSet, disableReceiveAutoGc } = require('../../helpers/git-template');
const { writeIdentity } = require('../../helpers/git-fixtures');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function trackedFiles(root) {
  return git(root, 'ls-files').split('\n').filter(Boolean);
}

// The repo builders below sit on git templates (#5772): each is built once per
// test process, and every call hands back an fs copy, which starts no git process.
function initRepo(dir) {
  // Loose refs whatever the global init.defaultRefFormat: renameLooseBranch moves ref files.
  // Not `init --ref-format=files`, which git < 2.45 (Apple Git 2.39) rejects.
  git(dir, '-c', 'init.defaultRefFormat=files', 'init', '-b', 'main');
  writeIdentity(dir, { name: 't', email: 't@t' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'init');
}

function makeRepo() {
  return fromTemplate('archive-merged:makeRepo', initRepo, { prefix: 'archive-merged-' });
}

// Template build: fills the empty `dir` with the repo at `src` (a template copy holding no
// absolute path), then removes `src`.
function seedFromCopy(src, dir) {
  fs.cpSync(src, dir, { recursive: true });
  fs.rmSync(src, { recursive: true, force: true });
}

// Template build: fills the empty `dir` with a copy of makeRepo()'s repo, so a
// template built on it starts no init, config or first-commit process of its own.
function seedFromMakeRepo(dir) {
  seedFromCopy(makeRepo(), dir);
}

function commitPath(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(root, 'add', relPath);
  git(root, 'commit', '-m', `add ${relPath}`);
}

// Shell fragment that prints `value` as JSON, for the gh wrapper scripts below.
function ghJsonHeredoc(value) {
  return `cat <<'EOF'\n${JSON.stringify(value)}\nEOF`;
}

// resolvePrState (pr-state.js) shells to `gh pr list` and is bound at
// archive-merged.js's own require time, same non-injectable caveat
// reap-merged.test.js's own copy of this helper documents — intercept at the
// process-spawn boundary via a `gh` wrapper placed first on PATH.
// #3416: when `prsJson` is an array, `gh pr view {n}` prints the element whose
// `number` is {n} (exit 1 when none matches — a probe for an unknown PR is a
// transport-style failure); every other call, and any non-array body, prints
// `prsJson` exactly as before.
// #3503: `issueStates`, when given, maps an issue number to its `gh issue view
// {n} --json state` answer ('OPEN' | 'CLOSED', or 'FAIL' for a non-zero exit);
// any unmapped number exits 1. Without it, `gh issue view` keeps the catch-all
// body this wrapper has always printed.
function installGhWrapper(prsJson, issueStates = null) {
  const wrapperDir = scratchDir('archive-merged-ghwrap-');
  const wrapperPath = path.join(wrapperDir, 'gh');
  const issueBlock = issueStates ? [
    'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
    '  case "$3" in',
    ...Object.entries(issueStates).map(([n, st]) => (st === 'FAIL'
      ? `    ${n}) exit 1 ;;`
      : `    ${n}) echo '${JSON.stringify({ state: st })}' ;;`)),
    '    *) exit 1 ;;',
    '  esac',
    '  exit 0',
    'fi',
  ] : [];
  let script;
  if (Array.isArray(prsJson)) {
    const cases = prsJson.map((pr) => `    ${pr.number}) ${ghJsonHeredoc(pr)}\n      ;;`).join('\n');
    script = [
      '#!/bin/sh',
      ...issueBlock,
      'if [ "$1" = "pr" ] && [ "$2" = "view" ]; then',
      '  case "$3" in',
      cases,
      '    *) exit 1 ;;',
      '  esac',
      'else',
      `  ${ghJsonHeredoc(prsJson)}`,
      'fi',
      '',
    ].join('\n');
  } else {
    script = ['#!/bin/sh', ...issueBlock, ghJsonHeredoc(prsJson), ''].join('\n');
  }
  fs.writeFileSync(wrapperPath, script);
  fs.chmodSync(wrapperPath, 0o755); // root-safe: makes a spy script executable, not a permission-denial simulation
  const originalPath = process.env.PATH;
  process.env.PATH = `${wrapperDir}${path.delimiter}${originalPath}`;
  return { restore: () => { process.env.PATH = originalPath; } };
}

// Template build: `branch` committed in a worktree in a sibling temp dir, merged
// into main, then the worktree removed (the branch ref stays). Returns the
// feature tip sha. `commitEnv` overrides the feature commit's environment.
function mergeFeatureBranch(root, branch, wtPrefix, commitEnv) {
  const wt = scratchDir(wtPrefix);
  try {
    git(root, 'worktree', 'add', '-q', wt, '-b', branch);
    fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
    execFileSync('git', ['add', 'feature.txt'], { cwd: wt, encoding: 'utf8' });
    execFileSync('git', ['commit', '-q', '-m', 'feature work'], { cwd: wt, encoding: 'utf8', ...(commitEnv ? { env: commitEnv } : {}) });
    const featureSha = execFileSync('git', ['rev-parse', branch], { cwd: root, encoding: 'utf8' }).trim();
    git(root, 'merge', '-q', '--ff-only', branch); // --ff-only overrides a global merge.ff=false
    git(root, 'worktree', 'remove', '--force', wt);
    return featureSha;
  } finally {
    fs.rmSync(wt, { recursive: true, force: true }); // a no-op once `worktree remove` took it
  }
}

// Template key -> the feature sha its build recorded, so a copy needs no rev-parse.
const featureShas = new Map();

// The branch name mergedFeatureBranchRepo's one template is built with; each copy renames it.
const MERGED_TEMPLATE_BRANCH = 'feat-merged-template';

// `git branch -m from to` as plain file moves, so it starts no git process: the loose ref,
// its reflog, and the name in main's and HEAD's fast-forward reflog line. The merge is a
// fast-forward, so no commit names the branch.
function renameLooseBranch(root, from, to) {
  if (from === to) return;
  const gitDir = path.join(root, '.git');
  if (fs.existsSync(path.join(gitDir, 'refs/heads', to))) {
    throw new Error(`renameLooseBranch: refs/heads/${to} already exists`);
  }
  for (const sub of ['refs/heads', 'logs/refs/heads']) {
    const dest = path.join(gitDir, sub, to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(path.join(gitDir, sub, from), dest);
  }
  for (const log of ['logs/HEAD', 'logs/refs/heads/main']) {
    const file = path.join(gitDir, log);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split(`\tmerge ${from}:`).join(`\tmerge ${to}:`));
  }
}

// The "PR merged, worktree torn down" repo shape both fixtures below build
// on: a feature branch committed in its own worktree, merged into main, then
// the worktree removed (branch ref stays). The returned `featureSha` is that
// branch's real tip commit, which a test hands back as the PR's
// `mergeCommit.oid` — `git merge --ff-only` folds it into main, so
// `merge-base --is-ancestor` (localHasMerge) sees it as an ancestor, same as
// a genuine fast-forward/merge would. The root is realpath'd (unlike
// makeRepo()'s own return) because mainCheckoutRoot resolves through realpath
// internally (macOS's os.tmpdir() sits behind a /var -> /private/var
// symlink) — archiveMerged's `root` would otherwise differ from a fixture's
// own `runDir` string, and a plain string membership assertion against
// `result.archived` would spuriously fail.
// One template serves every branch name (#5772): it is built on MERGED_TEMPLATE_BRANCH, and
// each copy renames that branch to `branch`, so every copy shares one featureSha.
function mergedFeatureBranchRepo(branch) {
  const key = 'archive-merged:merged';
  const root = fromTemplate(key, (dir) => {
    seedFromMakeRepo(dir);
    const sha = mergeFeatureBranch(dir, MERGED_TEMPLATE_BRANCH, 'archive-merged-featwt-');
    featureShas.set(key, sha);
    const loose = (name) => {
      try { return fs.readFileSync(path.join(dir, '.git', 'refs', 'heads', name), 'utf8').trim(); } catch { return null; }
    };
    // The reflogs renameLooseBranch moves must exist too: a global core.logAllRefUpdates=false
    // writes none, and the failure belongs here (the build cleans up after itself), not in a copy.
    const reflogs = ['logs/HEAD', 'logs/refs/heads/main', `logs/refs/heads/${MERGED_TEMPLATE_BRANCH}`];
    if (loose(MERGED_TEMPLATE_BRANCH) !== sha || loose('main') !== sha
      || reflogs.some((log) => !fs.existsSync(path.join(dir, '.git', log)))) {
      throw new Error('mergedFeatureBranchRepo: the template needs loose refs, their reflogs and a fast-forward merge, so a copy can rename the branch');
    }
  }, { prefix: 'archive-merged-', realpath: true });
  renameLooseBranch(root, MERGED_TEMPLATE_BRANCH, branch);
  return { root, featureSha: featureShas.get(key) };
}

// `git remote add origin {url}` as a plain config append, so it starts no git process.
function addOriginRemote(root, url) {
  fs.appendFileSync(path.join(root, '.git', 'config'),
    `[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
}

// mergedFeatureBranchRepo(branch) with the branch ref deleted too, so only a stamped
// pr.number can reach the merged PR; `origin`, when given, is the origin remote's url.
// A template per (branch, origin) (#5772); the root is realpath'd.
function deletedBranchMergedRepo(branch, origin = null) {
  const key = `archive-merged:deleted-branch:${branch}:${origin}`;
  const root = fromTemplate(key, (dir) => {
    const src = mergedFeatureBranchRepo(branch);
    featureShas.set(key, src.featureSha);
    seedFromCopy(src.root, dir);
    if (origin) addOriginRemote(dir, origin);
    git(dir, 'branch', '-D', branch);
  }, { prefix: 'archive-merged-', realpath: true });
  return { root, featureSha: featureShas.get(key) };
}

// mergedFeatureBranchRepo('feat-reused-branch') plus a live linked worktree `wt` on a new
// `worktree-reused` branch: one template set (#5772), both dirs realpath'd.
function reusedBranchLiveRepo() {
  const key = 'archive-merged:reused-branch-live';
  const { root, wt } = fromTemplateSet(key, (dirs) => {
    const src = mergedFeatureBranchRepo('feat-reused-branch');
    featureShas.set(key, src.featureSha);
    seedFromCopy(src.root, dirs.root);
    git(dirs.root, 'worktree', 'add', '-q', dirs.wt, '-b', 'worktree-reused');
  }, {
    root: { prefix: 'archive-merged-', realpath: true },
    wt: { prefix: 'archive-merged-reusedwt-', realpath: true },
  });
  return { root, wt, featureSha: featureShas.get(key) };
}

// #3975: a clean-twin shell — the archive twin carries a clean run-state, only tracked work/ is live.
function makeShell(root, runId, { twinWork = '# w\n', liveWork = '# w\n' } = {}) {
  commitPath(root, `.claude-tweaks/pipelines/${runId}/work/w-spec.md`, liveWork);
  commitPath(root, `.claude-tweaks/pipelines/archive/${runId}/work/w-spec.md`, twinWork);
  commitPath(root, `.claude-tweaks/pipelines/archive/${runId}/run-state.json`, JSON.stringify({ status: 'clean' }));
  return path.join(root, '.claude-tweaks', 'pipelines', runId);
}

// makeRepo() holding one default makeShell(root, '2026-09-01T100000-spec-1'): a template
// (#5772); the root is realpath'd.
const SHELL_3975_RUN = '2026-09-01T100000-spec-1';
function shellRepo3975() {
  const root = fromTemplate('archive-merged:shell-3975', (dir) => {
    seedFromMakeRepo(dir);
    makeShell(dir, SHELL_3975_RUN);
  }, { prefix: 'archive-merged-', realpath: true });
  return { root, shellDir: path.join(root, '.claude-tweaks', 'pipelines', SHELL_3975_RUN) };
}

// #1544: a run dir close-run already marked `{status: 'clean', worktree:
// null}` whose archive-run step never followed — the worktree is torn down
// (or was never present in this fixture), so the only way to recover a
// branch name is run-state.json's own `pr.branch` stamp (run-integrity.js's
// fallbackBranch, same source #1672's own fixture uses).
// #3416: `prNumber`, when set, stamps the run's PR identity (pr.number).
function fixtureCleanUnarchivedRun({ runId, consoleResolved = true, prNumber, origin = false } = {}) {
  const { root, featureSha } = mergedFeatureBranchRepo('feat-clean-branch');
  if (origin) addOriginRemote(root, 'git@github.com:acme/w.git');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const pr = prNumber ? { number: prNumber, branch: 'feat-clean-branch' } : { branch: 'feat-clean-branch' };
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'clean', worktree: null, pr,
  }));
  if (consoleResolved) {
    fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));
  }
  return { root, runDir, featureSha };
}

// #1673: a torn-down, shipped, `interrupted` run — the shape
// the `abandoned-interrupted` classification + `checkRunIntegrity` must recognize as
// auto-closeable. Mirrors tests/run-integrity.test.js's `fixtureTornDownRepo`
// (a merged feature branch whose worktree is later removed, `pr.branch`
// stamped on run-state.json as the #1672 fallback-evidence source) rather
// than inventing a new shape, plus this file's own `makeRepo()` for the base
// repo. `runId`'s ISO prefix (09:00:00) is before the feature commit's
// pinned date (10:00:00) so checkRunIntegrity's run-start corroboration
// passes. The one seed event is dated 2020 — far outside the 24h staleness
// window — so it satisfies checkRunIntegrity's "at least one skill_invoked,
// no wrap-up" evidence bar AND ownEventRecency's recency check in one line;
// `extraEventLines` lets a caller (case 3) append a second, recent,
// fallback-attributed line without disturbing that.
function fixtureAbandonedShippedRun({ runId, ownerSessionId, extraEventLines = [] } = {}) {
  // realpath'd (unlike makeRepo()'s own return) because mainCheckoutRoot
  // resolves through realpath internally (macOS's os.tmpdir() sits behind a
  // /var -> /private/var symlink) — archiveMerged's `root` would otherwise
  // differ from this fixture's own `runDir` string, and a plain string
  // membership assertion against `result.archived` would spuriously fail.
  const root = fromTemplate('archive-merged:abandoned-shipped', (dir) => {
    seedFromMakeRepo(dir);
    mergeFeatureBranch(dir, 'feat-branch', 'archive-merged-wt-', // branch ref stays, worktree gone
      { ...process.env, GIT_AUTHOR_DATE: '2026-08-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-08-01T10:00:00Z' });
  }, { prefix: 'archive-merged-', realpath: true });
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-branch: main\n');

  // The stamped worktree path: unique per call and absent, as a torn-down worktree's is.
  const wt = scratchDir('archive-merged-wt-');
  fs.rmSync(wt, { recursive: true, force: true });

  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const runState = { status: 'interrupted', worktree: wt, pr: { branch: 'feat-branch' } };
  if (ownerSessionId) runState.sessionId = ownerSessionId;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(runState));
  const seedEvent = '{"skill":"claude-tweaks:build","ts":"2020-01-01T09:05:00.000Z","type":"skill_invoked"}';
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), [seedEvent, ...extraEventLines].join('\n') + '\n');

  return { root, wt, runDir };
}

// A runVerdict fake: every entry negative unless `over[probe]` overrides it.
const verdictOf = (verdict, over = {}) => () => ({
  verdict, evidence: PROBE_ORDER.map((probe) => ({ probe, result: 'negative', detail: 'x', ...(over[probe] || {}) })),
});
const DEAD = verdictOf('dead');
function mkDirWithMtime(ageMs) {
  const dir = scratchDir('archive-merged-stuck-');
  if (ageMs) {
    const backdated = new Date(Date.now() - ageMs);
    fs.utimesSync(dir, backdated, backdated);
  }
  return dir;
}

function seedStuckDir4180(root, id) {
  const dir = path.join(root, '.claude-tweaks', 'pipelines', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.yml'), 'x: 1\n');
  fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: path.join(root, 'long-gone'), sessionId: 'sess-1' }));
  const backdated = new Date(Date.now() - STRUCTURALLY_STUCK_TTL_MS * 2);
  fs.utimesSync(dir, backdated, backdated);
  return dir;
}

function fixtureActiveUnstampedMergedRun({ runId, worktreeExplicitlyNull = false } = {}) {
  const { root, featureSha } = mergedFeatureBranchRepo('feat-unstamped-branch');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  const state = { status: 'active', pr: { branch: 'feat-unstamped-branch' } };
  // record-worktree genuinely never ran — field absent OR null, both must fall back
  if (worktreeExplicitlyNull) state.worktree = null;
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true }));
  return { root, runDir, featureSha };
}

// #3249 (whole-branch review): exercises the archiveMergedRun -> decideArchiveCore
// staged-items path. The fixture stamps `pr.number`, so since #3416 the run's PR
// resolves by number (`gh pr view 3249100`), not via `gh pr list --head`; the
// branch-path coverage lives in the AC4.1 test. The worktree is gone but the
// branch ref still exists (run-state.json's pr.branch). This is the shape
// pr-first-merge-post-merge.md Step 4.2's reconcile call hits; the
// staged-items exception must apply here too. `stagedFiles` seeds staged/
// (absent when empty).
// #3503 options: `origin` stamps the remote repoTargetOf reads (a URL string, or `true` for
// git@github.com:acme/w.git); `gateDeps` is forwarded to archiveMerged; `closes` (record
// numbers) puts closingIssuesReferences on the PR; `manifestSpecs` writes
// manifest.yml; `staleMs` backdates the run dir past the structurally-stuck TTL.
// `runStateBefore` is run-state.json's bytes read just before archiveMerged.
// `issueStates` answers `gh issue view` (installGhWrapper); `claudeMd` writes the
// main checkout's CLAUDE.md.
function fixtureOrdinaryMergedNoConsole(branch, runId, stagedFiles = [], specStaged = {}, {
  origin = false, closes = null, manifestSpecs = null, staleMs = null, issueStates = null, claudeMd = null, findings = null, decisions = null,
  gateDeps = undefined,
} = {}) {
  const { root, featureSha } = mergedFeatureBranchRepo(branch); // branch ref stays — fallbackBranch recovers it
  if (origin) addOriginRemote(root, typeof origin === 'string' ? origin : 'git@github.com:acme/w.git');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n'); // adopted — keeps the orphaned-mint classification out of the way
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active',
    worktree: path.join(root, '.claude', 'worktrees', `gone-${runId}`), // stamped, already torn down
    pr: { number: 3249100, branch },
  }));
  // Deliberately no console.json — the fast-lane short-circuit never writes one.
  for (const name of stagedFiles) {
    fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'staged', name), 'x\n');
  }
  // #3416: per-spec staged items under a multi-spec run dir's spec-{N}/staged/.
  // Maps a spec dir name to its staged entries; an array (even empty) creates
  // spec-{N}/staged/ with those entries, null creates the spec dir alone.
  for (const [spec, entries] of Object.entries(specStaged)) {
    fs.mkdirSync(path.join(runDir, spec), { recursive: true });
    if (!Array.isArray(entries)) continue;
    fs.mkdirSync(path.join(runDir, spec, 'staged'), { recursive: true });
    for (const name of entries) fs.writeFileSync(path.join(runDir, spec, 'staged', name), 'x\n');
  }
  if (manifestSpecs) {
    fs.writeFileSync(path.join(runDir, 'manifest.yml'), serializeManifestYaml({ multispec: { parent: 'parent/', specs: manifestSpecs } }));
  }
  // #3945: an optional review-findings.json body (the tiebreak denominator).
  if (findings !== null) fs.writeFileSync(path.join(runDir, 'review-findings.json'), JSON.stringify(findings));
  // #4171: an optional decisions.md body (the auto-merge line and tiebreak verdicts).
  if (decisions !== null) fs.writeFileSync(path.join(runDir, 'decisions.md'), decisions);
  const pr = {
    number: 3249100, state: 'MERGED', mergedAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
    mergeCommit: { oid: featureSha },
  };
  if (closes) pr.closingIssuesReferences = closes.map((n) => ref(n));
  if (staleMs) {
    const stale = new Date(Date.now() - staleMs);
    fs.utimesSync(runDir, stale, stale);
  }
  const runStateBefore = fs.readFileSync(path.join(runDir, 'run-state.json'), 'utf8');
  if (claudeMd !== null) fs.writeFileSync(path.join(root, 'CLAUDE.md'), claudeMd);
  const wrapper = installGhWrapper([pr], issueStates);
  try {
    return { root, runDir, runStateBefore, result: archiveMerged({ cwd: root, gateDeps }) };
  } finally {
    wrapper.restore();
  }
}

// #4387: a bare origin seeded with one commit (a.txt) from `seed`, plus `root`, a configured clone of it.
// The bare origin has receive.autogc off, so a push into it starts no maintenance process.
function buildSeededOrigin({ origin, seed: s, clone: c }) {
  git(origin, 'init', '--bare', '-b', 'main');
  disableReceiveAutoGc(origin);
  git(s, 'clone', '-q', origin, '.');
  writeIdentity(s, { name: 't', email: 't@t' });
  commitPath(s, 'a.txt', 'a\n');
  git(s, 'push', '-q', 'origin', 'main');
  git(c, 'clone', '-q', origin, '.');
  writeIdentity(c, { name: 't', email: 't@t' });
}

function cloneOfSeededOrigin() {
  const { seed, clone } = fromTemplateSet('archive-merged:cloneOfSeededOrigin', buildSeededOrigin, {
    origin: { prefix: 'archive-merged-origin-' },
    seed: { prefix: 'archive-merged-seed-' },
    clone: { prefix: 'archive-merged-clone-', realpath: true },
  });
  return { seed, root: clone };
}

// Template key -> the feature commit its build recorded.
const behindFeatureOids = new Map();

// The shared fixture of the abandoned-interrupted local-behind tests: a clone whose
// local main is behind origin/main, which holds the run's work/ file — landed by fast-forward,
// or (squash) as a new commit carrying the same patch, so the run's branch tip is no ancestor
// of main and only the cherry shape recognises it as merged. The repos are a template per
// shape (#5772); the seed clone that pushed the merge lives only in the template build.
function fixtureAbandonedBehindOrigin({ squash = false } = {}) {
  const runId = '2026-08-01T090000-record-4387-abandoned';
  const key = `archive-merged:abandoned-behind-origin:${squash ? 'squash' : 'ff'}`;
  const { clone: root } = fromTemplateSet(key, ({ origin, clone }) => {
    const seed = path.join(path.dirname(origin), 'seed');
    fs.mkdirSync(seed);
    buildSeededOrigin({ origin, seed, clone });
    // The feature commit (dated after the run's start so the run-start corroboration passes)
    // carries the run's tracked work/ file, then lands on origin/main.
    git(seed, 'checkout', '-q', '-b', 'feat-4387-abandoned');
    fs.mkdirSync(path.join(seed, '.claude-tweaks', 'pipelines', runId, 'work'), { recursive: true });
    fs.writeFileSync(path.join(seed, '.claude-tweaks', 'pipelines', runId, 'work', '4387-spec.md'), '# spec 4387\n');
    git(seed, 'add', '.claude-tweaks');
    execFileSync('git', ['commit', '-q', '-m', 'feature work'], {
      cwd: seed,
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-08-01T10:00:00Z' },
    });
    const featureOid = git(seed, 'rev-parse', 'HEAD').trim();
    behindFeatureOids.set(key, featureOid);
    git(seed, 'checkout', '-q', 'main');
    if (squash) {
      git(seed, 'merge', '-q', '--squash', 'feat-4387-abandoned');
      git(seed, 'commit', '-q', '-m', 'squash feature work');
    } else {
      git(seed, 'merge', '-q', '--ff-only', 'feat-4387-abandoned');
    }
    git(seed, 'push', '-q', 'origin', 'main');
    if (squash) git(seed, 'push', '-q', 'origin', 'feat-4387-abandoned'); // the tip is no ancestor of main: ship it for root to fetch
    // A copy's FETCH_HEAD still names the template's origin path: harmless, since no code
    // under test reads it and any later fetch overwrites it.
    git(clone, 'fetch', '-q', 'origin', 'main'); // only origin/main advances; root stays on a behind main
    if (squash) git(clone, 'fetch', '-q', 'origin', 'feat-4387-abandoned:feat-4387-abandoned');
    else git(clone, 'branch', 'feat-4387-abandoned', featureOid); // the run's branch ref survives locally
  }, {
    origin: { prefix: 'archive-merged-origin-' },
    clone: { prefix: 'archive-merged-clone-', realpath: true },
  });
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-branch: main\n');

  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'interrupted', worktree: path.join(root, 'gone-4387'), pr: { branch: 'feat-4387-abandoned' },
  }));
  fs.writeFileSync(
    path.join(runDir, 'events.jsonl'),
    '{"skill":"claude-tweaks:build","ts":"2020-01-01T09:05:00.000Z","type":"skill_invoked"}\n',
  );
  return { root, runDir, archiveDir, featureOid: behindFeatureOids.get(key) };
}

// #3976: the run whose tracked header wrap-up moves to archive/ on the run branch.
const RUN_3976 = '2026-11-16T000000-record-7';
// Template key -> the merge commit its build recorded.
const header3976MergeShas = new Map();

// main with one commit; branch feat-3976 carries the live header and, when `moved`, the move.
// The branch is merged back with `--squash` or `--no-ff`; the main checkout keeps only the
// gitignored half of the run dir (run-state, console, decisions) the way a real one does.
// A template per (moved, merge) pair (#5772); the root is realpath'd.
function headerMergedRepo3976({ moved, merge }) {
  const key = `archive-merged:header-3976:${moved ? 'moved' : 'unmoved'}:${merge}`;
  const root = fromTemplate(key, (dir) => {
    seedFromMakeRepo(dir);
    addOriginRemote(dir, 'git@github.com:acme/w.git'); // archiveMerged needs a repo slug
    git(dir, 'checkout', '-q', '-b', 'feat-3976');
    commitPath(dir, `.claude-tweaks/pipelines/${RUN_3976}/work/7-spec.md`, 'spec header\n');
    if (moved) {
      const res = archiveRunHeader({ worktree: dir, runId: RUN_3976 });
      assert.equal(res.outcome, 'moved', JSON.stringify(res));
    }
    git(dir, 'checkout', '-q', 'main');
    if (merge === 'squash') {
      git(dir, 'merge', '--squash', 'feat-3976');
      git(dir, 'commit', '-q', '-m', 'Squashed feature (#7001)');
    } else {
      git(dir, 'merge', '-q', '--no-ff', '--no-edit', 'feat-3976');
    }
    header3976MergeShas.set(key, git(dir, 'rev-parse', 'HEAD').trim());
  }, { prefix: 'archive-merged-', realpath: true });
  return { root, mergeSha: header3976MergeShas.get(key) };
}

// Shape of one `closingIssuesReferences` entry from `gh pr view --json`.
function ref(n, owner = 'acme', name = 'w') {
  return { number: n, repository: { name, owner: { login: owner } } };
}

module.exports = {
  git,
  trackedFiles,
  makeRepo,
  commitPath,
  ghJsonHeredoc,
  installGhWrapper,
  mergedFeatureBranchRepo,
  fixtureCleanUnarchivedRun,
  fixtureAbandonedShippedRun,
  verdictOf,
  DEAD,
  mkDirWithMtime,
  seedStuckDir4180,
  fixtureActiveUnstampedMergedRun,
  fixtureOrdinaryMergedNoConsole,
  cloneOfSeededOrigin,
  fixtureAbandonedBehindOrigin,
  RUN_3976,
  headerMergedRepo3976,
  addOriginRemote,
  deletedBranchMergedRepo,
  reusedBranchLiveRepo,
  makeShell,
  shellRepo3975,
  ref,
};
