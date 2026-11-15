'use strict';
// Shared fixtures and helpers for the archive-merged*.test.js suites split out
// of tests/bin-lib/reconcile/archive-merged.test.js. Not a test file itself.
const cp = require('child_process');
// Destructured at require time, so this binding is a snapshot of the REAL
// implementation — it stays callable as the pass-through inside the
// compound-failure test's `t.mock.method(cp, 'execFileSync', ...)`.
const { execFileSync } = cp;
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  isOrphanedMint,
  archiveMerged,
  STRUCTURALLY_STUCK_TTL_MS,
} = require('../../../plugin/bin/lib/reconcile/archive-merged');
const { PROBE_ORDER } = require('../../../plugin/bin/lib/run-liveness');
const { serializeManifestYaml } = require('../../../plugin/bin/lib/flow/manifest');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function trackedFiles(root) {
  return git(root, 'ls-files').split('\n').filter(Boolean);
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-'));
  git(dir, 'init', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-m', 'init');
  return dir;
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
  const wrapperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-ghwrap-'));
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

// The "PR merged, worktree torn down" repo shape both fixtures below build
// on: a feature branch committed in its own worktree, merged into main, then
// the worktree removed (branch ref stays). The returned `featureSha` is that
// branch's real tip commit, which a test hands back as the PR's
// `mergeCommit.oid` — `git merge --no-edit` folds it into main, so
// `merge-base --is-ancestor` (localHasMerge) sees it as an ancestor, same as
// a genuine fast-forward/merge would. The root is realpath'd (unlike
// makeRepo()'s own return) because mainCheckoutRoot resolves through realpath
// internally (macOS's os.tmpdir() sits behind a /var -> /private/var
// symlink) — archiveMerged's `root` would otherwise differ from a fixture's
// own `runDir` string, and a plain string membership assertion against
// `result.archived` would spuriously fail.
function mergedFeatureBranchRepo(branch) {
  const root = fs.realpathSync(makeRepo());
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-featwt-'));
  git(root, 'worktree', 'add', '-q', wt, '-b', branch);
  fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
  execFileSync('git', ['add', 'feature.txt'], { cwd: wt, encoding: 'utf8' });
  execFileSync('git', ['commit', '-q', '-m', 'feature work'], { cwd: wt, encoding: 'utf8' });
  const featureSha = execFileSync('git', ['rev-parse', branch], { cwd: root, encoding: 'utf8' }).trim();
  git(root, 'merge', '-q', '--no-edit', branch);
  git(root, 'worktree', 'remove', '--force', wt);
  return { root, featureSha };
}

// #1544: a run dir close-run already marked `{status: 'clean', worktree:
// null}` whose archive-run step never followed — the worktree is torn down
// (or was never present in this fixture), so the only way to recover a
// branch name is run-state.json's own `pr.branch` stamp (run-integrity.js's
// fallbackBranch, same source #1672's own fixture uses).
// #3416: `prNumber`, when set, stamps the run's PR identity (pr.number).
function fixtureCleanUnarchivedRun({ runId, consoleResolved = true, prNumber, origin = false } = {}) {
  const { root, featureSha } = mergedFeatureBranchRepo('feat-clean-branch');
  if (origin) git(root, 'remote', 'add', 'origin', 'git@github.com:acme/w.git');
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
// `isAbandonedInterrupted` + `checkRunIntegrity` must recognize as
// auto-closeable. Mirrors tests/run-integrity.test.js's `fixtureTornDownRepo`
// (a merged feature branch whose worktree is later removed, `pr.branch`
// stamped on run-state.json as the #1672 fallback-evidence source) rather
// than inventing a new shape, plus this file's own `makeRepo()` for the base
// repo. `runId`'s ISO prefix (09:00:00) is before the feature commit's
// pinned date (10:00:00) so checkRunIntegrity's run-start corroboration
// passes. The one seed event is dated 2020 — far outside the 24h staleness
// window — so it satisfies checkRunIntegrity's "at least one skill_invoked,
// no wrap-up" evidence bar AND lastOwnEventMs' recency check in one line;
// `extraEventLines` lets a caller (case 3) append a second, recent,
// fallback-attributed line without disturbing that.
function fixtureAbandonedShippedRun({ runId, ownerSessionId, extraEventLines = [] } = {}) {
  // realpath'd (unlike makeRepo()'s own return) because mainCheckoutRoot
  // resolves through realpath internally (macOS's os.tmpdir() sits behind a
  // /var -> /private/var symlink) — archiveMerged's `root` would otherwise
  // differ from this fixture's own `runDir` string, and a plain string
  // membership assertion against `result.archived` would spuriously fail.
  const root = fs.realpathSync(makeRepo());
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-branch: main\n');

  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-wt-'));
  git(root, 'worktree', 'add', '-q', wt, '-b', 'feat-branch');
  fs.writeFileSync(path.join(wt, 'feature.txt'), 'feature\n');
  execFileSync('git', ['add', 'feature.txt'], { cwd: wt, encoding: 'utf8' });
  execFileSync('git', ['commit', '-q', '-m', 'feature work'], {
    cwd: wt,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-08-01T10:00:00Z' },
  });
  git(root, 'merge', '-q', '--no-edit', 'feat-branch');
  git(root, 'worktree', 'remove', '--force', wt); // branch ref stays, worktree gone

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-merged-stuck-'));
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
  if (origin) git(root, 'remote', 'add', 'origin', typeof origin === 'string' ? origin : 'git@github.com:acme/w.git');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'x: 1\n'); // adopted — keeps isOrphanedMint out of the way
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
  ref,
};
