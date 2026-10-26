// Reconcile time bounds budget (#820) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// reconcile() must degrade fast: a failed gh-health preflight resolves in under 2.5 s instead of summing
// every check's own 5-10 s timeout, and a pre-exhausted budget skips every check in under 1 s. Both do no
// real work, so the margins are generous. Lives outside tests/ because a wall-clock assertion flakes under
// sibling-suite load; the functional halves (the preflight skip entry, the budget-exceeded skip entry) stay
// in tests/reconcile.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { reconcile } = require('../plugin/bin/lib/reconcile');

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
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

// AC1: reconcile() degrades within ~2s via the preflight when GitHub is
// unreachable, instead of accumulating every check's own 5-10s timeout.
test('AC1: a preflight failure resolves in well under the old per-check-timeout sum', async () => {
  const { seedDir, mainDir } = pairedFixture();
  writePolicyViaSeedAndPull(seedDir, mainDir, 'integration-model: pr-first\n');
  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const original = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: false, reason: 'github-unreachable' });
  const start = Date.now();
  let r;
  try {
    r = await reconcile({ cwd: mainDir, checks: ['mirror', 'release', 'remote-prune', 'console'] });
  } finally {
    preflight.ghHealthCheck = original;
  }
  const elapsed = Date.now() - start;
  // Functional assertion: preflight gate produces exactly the expected skip
  // entry — mirror is excluded (pure git, no `gh` dependency) and still runs.
  assert.deepEqual(r.skipped, [{ check: 'release,remote-prune,console', reason: 'preflight-github-unreachable' }]);
  assert.deepEqual(r.mirror, { state: 'current', action: 'none' });
  // Secondary timing assertion: the preflight-gated failure resolves quickly
  assert.ok(elapsed < 2500, `preflight-gated failure took ${elapsed}ms, expected well under 2.5s`);
});

// AC2: total wall-clock time is bounded by the explicit budget regardless
// of how much stale state exists.
test('AC2: an exhausted budget bounds total reconcile() time regardless of remaining check count', async () => {
  const { mainDir } = pairedFixture();
  fs.mkdirSync(path.join(mainDir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(mainDir, '.claude-tweaks', 'policy.yml'), 'integration-model: pr-first\n');

  // Must clear the preflight gate before the budget guard is even reached
  const preflight = require('../plugin/bin/lib/reconcile/preflight');
  const originalHealth = preflight.ghHealthCheck;
  preflight.ghHealthCheck = () => ({ ok: true, reason: null });

  const budgetMod = require('../plugin/bin/lib/reconcile/budget');
  const original = budgetMod.createBudget;
  budgetMod.createBudget = () => ({ exceeded: () => true, remainingMs: () => 0 });
  const start = Date.now();
  try {
    await reconcile({ cwd: mainDir, checks: require('../plugin/bin/lib/reconcile').ALL_CHECKS });
  } finally {
    budgetMod.createBudget = original;
    preflight.ghHealthCheck = originalHealth;
  }
  assert.ok(Date.now() - start < 1000, 'a pre-exhausted budget must skip every check near-instantly');
});
