'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');
const FRAGMENT = '_shared/integration-branch.md';
// Identifiers a real resolver uses, deliberately NOT the English phrase "default
// branch" — that appears as ordinary prose in eleven files that resolve nothing,
// and an allowlist padded with those would stop being evidence of anything.
//   `defaultBranchRef` is the gh JSON field this repo's own canonical fragment
//   teaches, so it is the single likeliest thing a future author copies.
//   `$DEFAULT_BRANCH` is the case variant that once shipped a stale reference past
//   a case-sensitive check, caught only because a human happened to read the line.
//   Bare `origin/HEAD` is the short form of the same derivation — `git rev-parse
//   --abbrev-ref origin/HEAD` resolves the default branch without ever spelling out
//   the full ref path, and passed this check silently until it was probed.
const RESOLVER = /default_branch|defaultBranchRef|\$DEFAULT_BRANCH|remote show origin|origin\/HEAD/;

// Any file naming the GitHub default branch is answering "which branch is this
// project's current state" — unless it is on this list, which states why not.
// This is the migration ratchet: an entry is removed as its site is migrated,
// and the remainder are the genuinely exempt cases.
const ALLOWLIST = new Map([
  ['_shared/integration-branch.md', 'this is the canonical fragment itself — it documents the literal git/gh resolution commands and per-consumer fallbacks that every other site cites; it cannot cite itself'],
  ['_shared/issue-claims.md', 'claim refs need any always-present base SHA; the default branch is arbitrary but reliable, not a statement about where work lands'],
  ['_shared/routine-template-schema.md', 'quotes the unresolved fallback wording verbatim as documentation of what gets substituted'],
]);

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

test('every file resolving the GitHub default branch cites the shared fragment or is allowlisted', () => {
  const offenders = [];
  for (const file of walk(SKILLS_DIR)) {
    const rel = path.relative(SKILLS_DIR, file);
    const text = fs.readFileSync(file, 'utf8');
    if (!RESOLVER.test(text)) continue;
    if (ALLOWLIST.has(rel)) continue;
    if (text.includes(FRAGMENT)) continue;
    offenders.push(rel);
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `these files resolve the GitHub default branch without citing ${FRAGMENT}: ${offenders.join(', ')}`
  );
});

test('the allowlist has no stale entries', () => {
  const stale = [];
  for (const rel of ALLOWLIST.keys()) {
    const full = path.join(SKILLS_DIR, rel);
    if (!fs.existsSync(full)) {
      stale.push(`${rel} (file no longer exists)`);
      continue;
    }
    const text = fs.readFileSync(full, 'utf8');
    if (!RESOLVER.test(text)) {
      stale.push(`${rel} (no longer resolves a default branch — drop the entry)`);
      continue;
    }
    if (text.includes(FRAGMENT)) {
      stale.push(`${rel} (cites ${FRAGMENT} — the entry is redundant, drop it)`);
    }
  }
  assert.deepStrictEqual(stale, [], `stale allowlist entries: ${stale.join(', ')}`);
});

test('every allowlist entry carries a justification', () => {
  for (const [rel, why] of ALLOWLIST) {
    assert.ok(why && why.length > 20, `${rel} needs a real justification, got: ${JSON.stringify(why)}`);
  }
});

// --- #193: rank-set markers, ratcheted --------------------------------------
//
// The citation check above only enforces that a resolver *cites* the shared
// fragment -- it says nothing about which ranks of the ladder that consumer
// actually uses. Widening a deliberate narrowing (e.g. routine/record-freshness.md
// regaining ranks 1-2, the #190 shape) passes that check and the full suite,
// and only produces a wrong branch on the dev->staging->main repo models that
// motivated the ladder. Every consumer with a genuine, deliberate rank
// exclusion carries an `<!-- integration-branch-ranks: excludes=N[,M...] -->`
// marker beside its narrowing prose; this section pins each one's current
// value the same way bin/lib/skill-audit/tests/anti-patterns.test.js pins row
// counts -- a change requires a deliberate edit here, not a silent pass.
//
// Scoped to the two consumers that carry the marker today (record #193's
// premise re-measured at build time, per [IL-71]: the record's original three
// named files -- flow/validation.md, build/worktree-setup.md,
// routine/record-freshness.md -- are down to one still-independent resolver;
// the other two were consolidated into _shared/worktree-setup.md's Pre-flight
// divergence check by a separate extraction, #193's own Gotchas anticipated
// this). The SessionStart reaper/run-integrity hooks' rank restriction is
// documented in integration-branch.md's own Per-consumer fallback table
// (unmarked, out of this record's Key Files list) rather than duplicated here.

const RANK_MARKER_RE = /<!-- integration-branch-ranks: excludes=([\d,]+) -->/;

const MARKED_CONSUMERS = [
  { rel: '_shared/worktree-setup.md', expectedExcludes: '5' },
  { rel: 'routine/record-freshness.md', expectedExcludes: '1,2' },
];

function readSkill(rel) {
  return fs.readFileSync(path.join(SKILLS_DIR, rel), 'utf8');
}

for (const { rel, expectedExcludes } of MARKED_CONSUMERS) {
  test(`${rel} carries an integration-branch-ranks marker matching its documented narrowing (ratchet)`, () => {
    const text = readSkill(rel);
    const match = RANK_MARKER_RE.exec(text);
    assert.ok(match, `${rel} must carry an <!-- integration-branch-ranks: excludes=N --> marker beside its narrowing`);
    assert.strictEqual(
      match[1],
      expectedExcludes,
      `${rel}'s declared rank exclusion changed from "${expectedExcludes}" to "${match[1]}" -- ` +
        'this ratchet only moves on a deliberate edit to this test, confirming the new exclusion set is intentional'
    );
  });
}

// Go-red proof: reproduces the #190-class defect concretely -- a consumer
// silently widening its excludes set (regaining a rank it deliberately
// dropped) must fail the ratchet, not pass silently.
test('go-red proof: a consumer that silently regains an excluded rank fails the ratchet', () => {
  const widened = 'Some prose.\n<!-- integration-branch-ranks: excludes=2 -->\nMore prose.';
  const match = RANK_MARKER_RE.exec(widened);
  assert.ok(match);
  assert.notStrictEqual(
    match[1],
    '1,2',
    'a widened marker (excludes=2, having silently dropped the "1," from "1,2") must not equal the pinned expectation'
  );
});

test('go-red proof: a consumer whose marker is removed entirely is caught, not silently treated as unrestricted', () => {
  const noMarker = 'Some prose with no marker at all.';
  const match = RANK_MARKER_RE.exec(noMarker);
  assert.strictEqual(match, null, 'no marker must parse to null, which the real test above asserts.ok()s against and fails on');
});
