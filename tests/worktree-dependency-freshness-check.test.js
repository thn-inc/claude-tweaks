'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #2348: the Adopt-or-create gate's adopt branch had no check for a missing/stale local
// `node_modules` — an adopted worktree with none at all silently walks up to the main
// checkout's own (potentially stale) copy, producing misleading `ERR_MODULE_NOT_FOUND`
// cascades that read as a code regression rather than a dependency gap. This spec pins the
// "Dependency freshness check (adopt path only)" section's structural contracts — the same
// pattern tests/worktree-adopt-or-create-consolidation.test.js already uses for the
// Adopt-or-create section as a whole — so a future edit can't silently drop a safety
// property (the no-lockfile applicability gate, the never-auto-install rule, the
// warning-not-HARD-GATE posture) without a test going red.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const SHARED_WORKTREE_SETUP = read('plugin', 'skills', '_shared', 'worktree-setup.md');
const BUILD_WORKTREE_SETUP = read('plugin', 'skills', 'build', 'worktree-setup.md');

function dependencyFreshnessRegion() {
  const start = SHARED_WORKTREE_SETUP.indexOf('**Dependency freshness check (adopt path only).**');
  assert.notStrictEqual(start, -1, '"Dependency freshness check (adopt path only)" heading missing from _shared/worktree-setup.md');
  const end = SHARED_WORKTREE_SETUP.indexOf('**Not isolated:**', start);
  assert.notStrictEqual(end, -1, '"Not isolated:" boundary missing — this test has lost its anchor');
  return SHARED_WORKTREE_SETUP.slice(start, end);
}

test('_shared/worktree-setup.md: Dependency freshness check is positioned inside Adopt-or-create, before "Not isolated"', () => {
  const adoptIdx = SHARED_WORKTREE_SETUP.indexOf('## Adopt-or-create');
  const freshnessIdx = SHARED_WORKTREE_SETUP.indexOf('**Dependency freshness check (adopt path only).**');
  const notIsolatedIdx = SHARED_WORKTREE_SETUP.indexOf('**Not isolated:**');

  assert.notStrictEqual(adoptIdx, -1, '## Adopt-or-create heading missing');
  assert.notStrictEqual(freshnessIdx, -1, 'Dependency freshness check heading missing');
  assert.notStrictEqual(notIsolatedIdx, -1, 'Not isolated boundary missing');
  assert.ok(adoptIdx < freshnessIdx, 'Dependency freshness check must be inside Adopt-or-create');
  assert.ok(freshnessIdx < notIsolatedIdx, 'Dependency freshness check must run before the Not isolated branch');
});

test('_shared/worktree-setup.md: Dependency freshness check states all four numbered steps', () => {
  const region = dependencyFreshnessRegion();

  assert.match(region, /\*\*Applicability\.\*\*/, 'must name the Applicability step');
  assert.match(region, /\*\*Presence\.\*\*/, 'must name the Presence step');
  assert.match(region, /\*\*Staleness \(cheap signal only\)\.\*\*/, 'must name the Staleness step');
  assert.match(region, /\*\*Report\.\*\*/, 'must name the Report step');
});

test('_shared/worktree-setup.md: Dependency freshness check gates on lockfile presence before ever looking at node_modules', () => {
  const region = dependencyFreshnessRegion();

  assert.match(
    region,
    /No lockfile found at the worktree root/,
    'must state the no-lockfile applicability gate — a project with no installable Node dependency surface must never be flagged for a "missing" node_modules',
  );
  assert.match(
    region,
    /claude-tweaks.{0,20}own.{0,20}package\.json/s,
    'must name this repo\'s own no-lockfile/no-node_modules case as a concrete example of the applicability gate, not a hypothetical',
  );
});

test('_shared/worktree-setup.md: Dependency freshness check never silently auto-installs', () => {
  const region = dependencyFreshnessRegion();

  assert.match(
    region,
    /never a\s*\n?\s*silent auto-install/,
    'must state the never-auto-install rule explicitly — a wrong unattended install can leave the worktree worse off than the gap it was trying to fix',
  );
  assert.match(
    region,
    /warning, not (a\s*\n?\s*)?HARD-GATE/,
    'must state that this check degrades to a warning, never a HARD-GATE stop',
  );
});

test('_shared/worktree-setup.md: Dependency freshness check cross-references _shared/dev-url-detection.md with the file\'s own citation convention', () => {
  const region = dependencyFreshnessRegion();

  assert.match(
    region,
    /`_shared\/dev-url-detection\.md`/,
    'lockfile-driven command detection must cite `_shared/dev-url-detection.md` (with the `_shared/` prefix this file uses for its other same-directory citations) rather than a bare filename',
  );
});

test('build/worktree-setup.md: cross-references the Dependency freshness check instead of restating it', () => {
  assert.match(
    BUILD_WORKTREE_SETUP,
    /Dependency freshness check/,
    'build/worktree-setup.md must name the Dependency freshness check so a reader following the fresh-creation skip path knows the adopt path\'s equivalent safety net exists',
  );
});
