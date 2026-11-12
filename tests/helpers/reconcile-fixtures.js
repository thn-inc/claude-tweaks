// tests/helpers/reconcile-fixtures.js
// Shared fixtures and helpers for the tests/reconcile*.test.js family, split out of
// tests/reconcile.test.js so its parts can run on separate CI shards. Not a test file.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { localHasMerge } = require('../../plugin/bin/lib/reconcile/archive-merged');
const { installStub } = require('./path-stub');

const HOOKS =path.join(__dirname, '..', '..', 'plugin', 'bin', 'hooks.js');

// stderr is piped, not inherited: clone-of-an-empty-origin warnings and the
// expected failures asserted below would otherwise print into the test output.
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Two-repo fixture: `origin` (bare) + a clone that plays the role of the
// main checkout, both on `main`. Fully local — no network, no gh.
function pairedFixture() {
  const originDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-origin-'));
  git(['init', '-q', '--bare', '--initial-branch=main'], originDir);

  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-seed-'));
  git(['clone', '-q', originDir, seedDir]);
  git(['config', 'user.email', 'test@example.com'], seedDir);
  git(['config', 'user.name', 'Test'], seedDir);
  fs.writeFileSync(path.join(seedDir, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], seedDir);
  git(['commit', '-q', '-m', 'seed'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);

  const mainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-main-'));
  git(['clone', '-q', originDir, mainDir]);
  git(['config', 'user.email', 'test@example.com'], mainDir);
  git(['config', 'user.name', 'Test'], mainDir);

  return { originDir, seedDir, mainDir };
}

function bareRepoRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-orphan-')));
  git(['init', '-q', '--initial-branch=main'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test'], root);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  git(['add', 'a.txt'], root);
  git(['commit', '-q', '-m', 'seed'], root);
  return root;
}

function mintEmptyRunDir(root, runId, { ageMs = 0 } = {}) {
  const dir = path.join(root, '.claude-tweaks', 'pipelines', runId);
  fs.mkdirSync(dir, { recursive: true });
  if (ageMs) {
    const backdated = new Date(Date.now() - ageMs);
    fs.utimesSync(dir, backdated, backdated);
  }
  return dir;
}

// #3132: a fresh clone in a cloud/Routine sandbox has no local
// refs/remotes/origin/HEAD. A plain `git clone` normally sets it, so the
// fixture deletes it explicitly — a fixture that merely clones would pass
// vacuously.
function freshCloneWithoutOriginHead() {
  const { originDir, mainDir } = pairedFixture();
  git(['remote', 'set-head', 'origin', '--delete'], mainDir);
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  // local-merge + checks:['mirror'] keeps the pass fully offline once the
  // branch resolves (no gh preflight), while still proving resolution: a
  // resolved branch reaches the local-merge-model skip, an unresolved one
  // returns no-remote first.
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: local-merge\n');
  return { originDir, mainDir };
}

// #3630 behavioral scaffolding: origin's main is one commit (NEW) ahead of the
// clone's local main, as when GitHub merges a PR asynchronously. archive/
// release/reap are stubbed; the archive stub records what local main and
// localHasMerge looked like at the moment it was called.
// extra: { dryRun?, health? } — health is the gh preflight verdict (default ok).
async function reconcileWithAsyncMerge(checks, extra = {}) {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');
  fs.writeFileSync(path.join(seedDir, 'merged.txt'), 'merged\n');
  git(['add', 'merged.txt'], seedDir);
  git(['commit', '-q', '-m', 'async merge'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);
  const NEW = git(['rev-parse', 'HEAD'], seedDir).trim();

  const preflight = require('../../plugin/bin/lib/reconcile/preflight');
  const archiveMod = require('../../plugin/bin/lib/reconcile/archive-merged');
  const releaseMod = require('../../plugin/bin/lib/reconcile/release-merged');
  const reapMod = require('../../plugin/bin/lib/reconcile/reap-merged');
  const postMergeMod = require('../../plugin/bin/lib/reconcile/post-merge');
  const original = {
    health: preflight.ghHealthCheck,
    healthAsync: preflight.ghHealthCheckAsync,
    archive: archiveMod.archiveMerged,
    release: releaseMod.releaseMerged,
    reap: reapMod.reapMerged,
    postMerge: postMergeMod.postMerge,
    prefetchPostMerge: postMergeMod.prefetchPostMergePrStates,
  };
  // order: which stubbed checks ran, in call order (#4599); postMergeOpts: what post-merge was handed.
  const out = {
    NEW, mainDir, seenAtArchive: null, archiveCalled: false, reapCalled: false, r: null, fetchCalls: null, order: [], postMergeOpts: null, archiveOpts: null,
  };
  const health = extra.health || { ok: true, reason: null };
  preflight.ghHealthCheck = () => health;
  preflight.ghHealthCheckAsync = async () => health;
  // The PR-state warm-up (#4032) is its own step: record it, with the resolver it was handed.
  postMergeMod.prefetchPostMergePrStates = async (root, prStates) => { out.order.push('prefetch'); out.prefetchArgs = { root, prStates }; };
  postMergeMod.postMerge = async (opts) => {
    out.order.push('post-merge');
    out.postMergeOpts = opts;
    return { entries: [{ runDir: '/x', pr: 1, action: 'ran' }], deferred: extra.postMergeDeferred || [], ...(extra.postMergeFailure ? { failure: extra.postMergeFailure } : {}), ...(extra.postMergeDetail ? { detail: extra.postMergeDetail } : {}) };
  };
  archiveMod.archiveMerged = (opts) => {
    out.order.push('archive');
    out.archiveOpts = opts;
    out.archiveCalled = true;
    out.seenAtArchive = {
      localMain: git(['rev-parse', 'main'], mainDir).trim(),
      hasMerge: localHasMerge(mainDir, { oid: NEW }, 'main', { dryRun: !!extra.dryRun }),
    };
    return { archived: [], skipped: [] };
  };
  releaseMod.releaseMerged = () => { out.order.push('release'); return { released: [], skipped: [] }; };
  reapMod.reapMerged = () => {
    out.reapCalled = true;
    return { reaped: [], skipped: [], portsRelease: [] };
  };
  if (extra.afterStubs) extra.afterStubs(); // lets a test replace one of the stubs above
  const indexPath = require.resolve('../../plugin/bin/lib/reconcile/index');
  try {
    delete require.cache[indexPath];
    const { reconcile: reconcileFresh } = require(indexPath);
    out.fetchCalls = await withFetchArgvLog(async () => { out.r = await reconcileFresh({ cwd: mainDir, checks, dryRun: extra.dryRun }); });
  } finally {
    preflight.ghHealthCheck = original.health;
    preflight.ghHealthCheckAsync = original.healthAsync;
    archiveMod.archiveMerged = original.archive;
    releaseMod.releaseMerged = original.release;
    reapMod.reapMerged = original.reap;
    postMergeMod.postMerge = original.postMerge;
    postMergeMod.prefetchPostMergePrStates = original.prefetchPostMerge;
    delete require.cache[indexPath];
  }
  return out;
}

// An isolated `pr-first` repo with no remote — every check skips as
// `no-remote`, so the verb's output shape is exercised without any live
// state being reachable.
function noRemoteFixture(slug) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), slug));
  git(['init', '-q'], dir);
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');
  return dir;
}

// Writes .claude-tweaks/policy.yml via `seedDir` (commit + push), then pulls
// it into `mainDir` — so mainDir ends up both carrying the policy file AND
// clean/current with origin (classifyMirror reports 'dirty' over 'current'
// for ANY uncommitted change, tracked or not, which a direct writeFileSync
// straight into mainDir's working tree would trigger and mask mirror's real
// result under test).
function writePolicyViaSeedAndPull(seedDir, mainDir, contents) {
  fs.mkdirSync(path.join(seedDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, '.claude-tweaks', 'policy.yml'), contents);
  git(['add', '.claude-tweaks'], seedDir);
  git(['commit', '-q', '-m', 'policy'], seedDir);
  git(['push', '-q', 'origin', 'main'], seedDir);
  git(['pull', '-q', 'origin', 'main'], mainDir);
}

// Installs a `git` shim first on PATH that appends every `git fetch`
// invocation's full argv to a log file, then execs the real git. Counting at
// the process-spawn boundary rather than stubbing `runGit` is load-bearing
// here for the same reason the D2 test in tests/reconcile-preflight-fetch.test.js documents: classify.js,
// prune-remote.js, and shared-fetch.js each destructure `runGit` at module
// load, so a module-property stub would never be observed.
// Async so a caller may await real work inside the PATH swap: restoring PATH
// while an in-flight reconcile() still has fetches to issue would silently
// stop logging them, and the count assertion would pass for the wrong reason.
async function withFetchArgvLog(fn) {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-recon-fetchargv-'));
  const logFile = path.join(logDir, 'fetch-argv.log');
  fs.writeFileSync(logFile, '');
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const restore = installStub(
    'git',
    `#!/bin/sh\nif [ "$3" = "fetch" ]; then\n  echo "$*" >> "${logFile}"\nfi\nexec "${realGit}" "$@"\n`,
  );
  try {
    await fn();
  } finally {
    restore();
  }
  return fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
}

module.exports = {
  HOOKS,
  git,
  pairedFixture,
  bareRepoRoot,
  mintEmptyRunDir,
  freshCloneWithoutOriginHead,
  reconcileWithAsyncMerge,
  noRemoteFixture,
  writePolicyViaSeedAndPull,
  withFetchArgvLog,
};
