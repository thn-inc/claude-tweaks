'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { collectClaims, checkCollisions, precheck } = require('../../../plugin/bin/lib/release/precheck.js');

// Lazily-evaluated canned git — a function per invocation, never an IIFE [IL-30].
function fakeGit(responses) {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(' '));
    const key = args.join(' ');
    for (const [prefix, respond] of responses) {
      if (key.startsWith(prefix)) return respond();
    }
    throw new Error(`unexpected git call: ${key}`);
  };
  git.calls = calls;
  return git;
}

const manifest = (v) => JSON.stringify({ name: 'claude-tweaks', version: v });

function baseDeps(overrides = {}) {
  return {
    git: fakeGit([
      ['fetch origin main', () => ''],
      ['show origin/main:plugin/.claude-plugin/plugin.json', () => manifest(overrides.origin || '6.70.1')],
      ['show main:plugin/.claude-plugin/plugin.json', () => manifest(overrides.local || '6.70.1')],
      ['worktree list --porcelain', () => overrides.worktrees || 'worktree /repo\nbranch refs/heads/main\n'],
      ['show wt-feature:plugin/.claude-plugin/plugin.json', () => manifest(overrides.wtVersion || '6.70.1')],
      ['show main:docs/shipped-versions.tsv', () => {
        if (overrides.tsv === undefined) throw new Error("fatal: path 'docs/shipped-versions.tsv' does not exist in 'main'");
        return overrides.tsv;
      }],
    ]),
    listPlanFiles: () => overrides.plans || [],
    readFile: (p) => (overrides.planText || {})[p] || '',
  };
}

test('clean state: candidate is next minor over origin, no conflicts', () => {
  const { candidate, result } = precheck(baseDeps(), 'minor');
  assert.strictEqual(candidate, '6.71.0');
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.conflicts, []);
});

test('a bump already on origin/main raises the base instead of colliding', () => {
  const { candidate, result } = precheck(baseDeps({ origin: '6.71.0' }), 'minor');
  assert.strictEqual(candidate, '6.72.0');
  assert.strictEqual(result.ok, true);
});

test('an executed bump on unpushed local main raises the base [IL-98]', () => {
  const { candidate, result } = precheck(baseDeps({ local: '6.71.0' }), 'minor');
  assert.strictEqual(candidate, '6.72.0');
  assert.strictEqual(result.ok, true);
});

test('a burned tsv tombstone above the manifest raises the base past it', () => {
  // A wip-never-shipped tsv line at manifest+1 (a reverted premature bump) is
  // documented in CHANGELOG/tsv but never reached the manifest — deriving the
  // candidate from the manifest alone lands exactly on the burned number and
  // compose's duplicate-heading guard wedges every future release. Observed
  // live after 6.75.0's revert.
  const { candidate, result } = precheck(baseDeps({
    tsv: '6.70.1\t2026-08-09\trelease\n6.71.0\t2026-08-09\twip-never-shipped\n',
  }), 'minor');
  assert.strictEqual(candidate, '6.72.0');
  assert.strictEqual(result.ok, true);
});

test('a missing shipped-versions.tsv contributes nothing to the base', () => {
  const { candidate, result } = precheck(baseDeps(), 'minor');
  assert.strictEqual(candidate, '6.71.0');
  assert.strictEqual(result.ok, true);
});

test('a committed-but-unmerged bump on a sibling worktree branch conflicts', () => {
  const deps = baseDeps({
    worktrees: 'worktree /repo\nbranch refs/heads/main\n\nworktree /repo/.claude/worktrees/f\nbranch refs/heads/wt-feature\n',
    wtVersion: '6.71.0',
  });
  const { result } = precheck(deps, 'minor');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.conflicts.length, 1);
  assert.strictEqual(result.conflicts[0].source, 'worktree-branch');
  assert.strictEqual(result.suggested, '6.72.0');
});

test('a plan document claiming the candidate number conflicts', () => {
  const deps = baseDeps({
    plans: ['docs/superpowers/plans/2026-08-08-x.md'],
    planText: { 'docs/superpowers/plans/2026-08-08-x.md': 'bump to v6.71.0 in this plan' },
  });
  const { result } = precheck(deps, 'minor');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.conflicts[0].source, 'plan-claim');
  assert.strictEqual(result.suggested, '6.72.0');
});

test('a foreign-major version literal in a plan (a dependency version) is not a claim', () => {
  const deps = baseDeps({
    plans: ['docs/superpowers/plans/upstream-drift.md'],
    planText: { 'docs/superpowers/plans/upstream-drift.md': 'pin Impeccable at v20.12.0' },
  });
  const { result } = precheck(deps, 'minor');
  assert.strictEqual(result.ok, true);
});

test('plan versions at or below origin/main are not claims', () => {
  const deps = baseDeps({
    plans: ['docs/superpowers/plans/old.md'],
    planText: { 'docs/superpowers/plans/old.md': 'shipped back in v6.60.0' },
  });
  const { result } = precheck(deps, 'minor');
  assert.strictEqual(result.ok, true);
});

const SIBLING_WORKTREES = 'worktree /repo\nbranch refs/heads/main\n\nworktree /repo/.claude/worktrees/f\nbranch refs/heads/wt-feature\n';

test('a branch with no manifest is skipped silently — not a claim', () => {
  const deps = baseDeps();
  deps.git = fakeGit([
    ['fetch origin main', () => ''],
    ['show origin/main:plugin/.claude-plugin/plugin.json', () => manifest('6.70.1')],
    ['show main:plugin/.claude-plugin/plugin.json', () => manifest('6.70.1')],
    ['worktree list --porcelain', () => SIBLING_WORKTREES],
    ['show wt-feature:plugin/.claude-plugin/plugin.json', () => {
      throw new Error("fatal: path 'plugin/.claude-plugin/plugin.json' does not exist in 'wt-feature'");
    }],
    ['show wt-feature:.claude-plugin/plugin.json', () => {
      throw new Error("fatal: path '.claude-plugin/plugin.json' does not exist in 'wt-feature'");
    }],
    ['show main:docs/shipped-versions.tsv', () => {
      throw new Error("fatal: path 'docs/shipped-versions.tsv' does not exist in 'main'");
    }],
  ]);
  const { result } = precheck(deps, 'minor');
  assert.strictEqual(result.ok, true);
});

// The payload moved to plugin/ in #418. A sibling worktree branched before that
// cutover still carries its manifest at the repo root, and its committed bump is
// exactly the collision the pre-check exists to catch — reading only the new path
// would silently drop it and let the release land on the same number.
test('a pre-cutover branch whose manifest is at the OLD root path is still a claim', () => {
  const deps = baseDeps();
  deps.git = fakeGit([
    ['fetch origin main', () => ''],
    ['show origin/main:plugin/.claude-plugin/plugin.json', () => manifest('6.70.1')],
    ['show main:plugin/.claude-plugin/plugin.json', () => manifest('6.70.1')],
    ['worktree list --porcelain', () => SIBLING_WORKTREES],
    ['show wt-feature:plugin/.claude-plugin/plugin.json', () => {
      throw new Error("fatal: path 'plugin/.claude-plugin/plugin.json' does not exist in 'wt-feature'");
    }],
    ['show wt-feature:.claude-plugin/plugin.json', () => manifest('6.71.0')],
    ['show main:docs/shipped-versions.tsv', () => {
      throw new Error("fatal: path 'docs/shipped-versions.tsv' does not exist in 'main'");
    }],
  ]);
  const { result } = precheck(deps, 'minor');
  assert.strictEqual(result.ok, false, 'the legacy-path bump must still register as a collision');
  assert.strictEqual(result.conflicts[0].source, 'worktree-branch');
  assert.strictEqual(result.conflicts[0].version, '6.71.0');
  assert.strictEqual(result.suggested, '6.72.0');
});

// The other direction of the same boundary: origin/main may still be pre-cutover
// while this branch has already moved the payload. Deriving the base from the old
// path is what keeps the candidate ahead of what actually shipped.
test('a pre-cutover origin/main manifest still sets the base', () => {
  const deps = baseDeps();
  deps.git = fakeGit([
    ['fetch origin main', () => ''],
    ['show origin/main:plugin/.claude-plugin/plugin.json', () => {
      throw new Error("fatal: path 'plugin/.claude-plugin/plugin.json' does not exist in 'origin/main'");
    }],
    ['show origin/main:.claude-plugin/plugin.json', () => manifest('6.94.0')],
    ['show main:plugin/.claude-plugin/plugin.json', () => manifest('6.94.0')],
    ['worktree list --porcelain', () => 'worktree /repo\nbranch refs/heads/main\n'],
    ['show main:docs/shipped-versions.tsv', () => {
      throw new Error("fatal: path 'docs/shipped-versions.tsv' does not exist in 'main'");
    }],
  ]);
  const { candidate, result } = precheck(deps, 'minor');
  assert.strictEqual(candidate, '6.95.0');
  assert.strictEqual(result.ok, true);
});

test('any other branch-manifest read failure aborts naming the branch — never silently weakens the check', () => {
  const deps = baseDeps();
  deps.git = fakeGit([
    ['fetch origin main', () => ''],
    ['show origin/main:plugin/.claude-plugin/plugin.json', () => manifest('6.70.1')],
    ['show main:plugin/.claude-plugin/plugin.json', () => manifest('6.70.1')],
    ['worktree list --porcelain', () => SIBLING_WORKTREES],
    ['show wt-feature:plugin/.claude-plugin/plugin.json', () => 'not valid json'],
  ]);
  assert.throws(() => precheck(deps, 'minor'), /wt-feature/);
});

// AC 8: the same module serves release.js ('tsv') and release-local.js ('tags')
// without either caller's collision detection changing under the other.
function tagDeps({ tags, local = '1.2.0', origin = '1.2.0', hasOrigin = true, worktrees = 'worktree /repo\nbranch refs/heads/main\n', wtVersion = '1.2.0' } = {}) {
  const versions = { main: local, 'origin/main': origin, 'wt-feature': wtVersion };
  const git = fakeGit([
    ['fetch origin main', () => ''],
    ['worktree list --porcelain', () => worktrees],
    ['tag -l v*', () => tags],
  ]);
  return { git, listPlanFiles: () => [], readFile: () => '', versionAtRef: (ref) => versions[ref] };
}

test('keySource tags: the highest v* tag raises the base past a stale manifest; no tsv read', () => {
  const deps = tagDeps({ tags: 'v1.0.0\nv1.2.0\nv1.2.1\nv2.0.0-rc.1\n', local: '1.2.0', origin: '1.2.0' });
  const { candidate, claims, result } = precheck(deps, 'minor', { keySource: 'tags', versionAtRef: deps.versionAtRef });
  assert.strictEqual(claims.tagTip, '1.2.1');
  assert.strictEqual(claims.tsvTip, null);
  assert.strictEqual(candidate, '1.3.0');
  assert.strictEqual(result.ok, true);
  assert.ok(!deps.git.calls.some((c) => c.includes('shipped-versions.tsv')));
});

test('keySource tags without an origin: no fetch, no origin read, base from the tag', () => {
  const deps = tagDeps({ tags: 'v1.2.0\n' });
  const { candidate } = precheck(deps, 'major', { keySource: 'tags', hasOrigin: false, versionAtRef: (ref) => (ref === 'main' ? '1.2.0' : assert.fail(`unexpected ref ${ref}`)) });
  assert.strictEqual(candidate, '2.0.0');
  assert.ok(!deps.git.calls.some((c) => c.startsWith('fetch')));
});

test('keySource tags: a sibling worktree bump still collides; the renumber follows the requested part', () => {
  const deps = tagDeps({ tags: 'v1.2.0\n', worktrees: SIBLING_WORKTREES, wtVersion: '1.3.0' });
  const { result } = precheck(deps, 'minor', { keySource: 'tags', versionAtRef: deps.versionAtRef });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.conflicts[0].source, 'worktree-branch');
  assert.strictEqual(result.suggested, '1.4.0');
});

test('keySource tags: a stack with no manifest at all (go) bases on the tag alone', () => {
  const deps = tagDeps({ tags: 'v0.4.0\n' });
  const { candidate } = precheck(deps, 'patch', { keySource: 'tags', versionAtRef: () => null });
  assert.strictEqual(candidate, '0.4.1');
});

test('keySource tsv is byte-for-byte the pre-#2254 path (default when opts are omitted)', () => {
  const a = precheck(baseDeps({ tsv: '6.70.1\t2026-08-09\trelease\n6.71.0\t2026-08-09\twip-never-shipped\n' }), 'minor');
  const b = precheck(baseDeps({ tsv: '6.70.1\t2026-08-09\trelease\n6.71.0\t2026-08-09\twip-never-shipped\n' }), 'minor', { keySource: 'tsv' });
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.claims.tagTip, null);
  assert.throws(() => precheck(baseDeps(), 'minor', { keySource: 'labels' }), /keySource/);
});
