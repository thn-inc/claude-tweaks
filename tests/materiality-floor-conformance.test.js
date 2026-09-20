// tests/materiality-floor-conformance.test.js
// Pins plugin/skills/_shared/materiality-floor.md's contract elements, its citation from
// deferral-gate.md, and the /tidy digest sweep's promotion/expiry procedures. No local-files
// runtime test double exists yet for the container branch — that branch is pinned as prose only
// until a local-files consumer lands.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { DEFER_REASONS } = require('../plugin/bin/lib/issues/record');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const FLOOR = read('plugin/skills/_shared/materiality-floor.md');
const GATE = read('plugin/skills/_shared/deferral-gate.md');
const SWEEP = read('plugin/skills/tidy/digest-sweep.md');
const TIDY_SKILL = read('plugin/skills/tidy/SKILL.md');
const TIDY_RECORDS = read('plugin/skills/tidy/step-1-records.md');
const TIDY_STEP6_AUTO = read('plugin/skills/tidy/step-6-auto.md');
const TIDY_SCAN_EXECUTION = read('plugin/skills/tidy/scan-execution.md');
const HEALTH_DIGEST = read('plugin/skills/_shared/health-filing-digest.md');
const REVIEW_ROUTING = read('plugin/skills/review/step3-routing.md');

const DIGEST_ACTIONS = [
  'Merge-close duplicate digest',
  'Propose digest cluster',
  'Expiry summary',
  'Rollover digest container',
];

test('SKILL.md\'s Action Vocabulary names every digest-sweep action, each with a step-6-auto.md tier row', () => {
  for (const action of DIGEST_ACTIONS) {
    assert.ok(TIDY_SKILL.includes(action), `SKILL.md Action Vocabulary is missing "${action}"`);
    assert.ok(TIDY_STEP6_AUTO.includes(action), `step-6-auto.md is missing a tier row for "${action}"`);
  }
});

test('SKILL.md\'s Scope Selection table dispatches Step 5.6 on both drivers', () => {
  assert.match(TIDY_SKILL, /\bbacklog\b[^\n|]*\|[^\n|]*\b1, 5\.6\b/);
  assert.match(TIDY_SKILL, /\bgithub\b[^\n|]*\|[^\n|]*\b4\.8, 5\.6\b/);
});

test('scan-execution.md\'s dispatch-agent list includes Step 5.6', () => {
  assert.match(TIDY_SCAN_EXECUTION, /Steps 1, 3, 4\.5, 4\.7, 4\.8, 5\.5, and 5\.6/);
});

test('SKILL.md\'s Routine Configuration degrade list includes Step 5.6', () => {
  assert.match(TIDY_SKILL, /Steps 1, 3, 4\.5, 4\.7, 4\.8, 5\.5, and 5\.6 degrade/);
});

test('materiality-floor.md states the floor definition (all three low axes, fail-toward-filing)', () => {
  assert.ok(/size:low/i.test(FLOOR));
  assert.ok(/priority:low/i.test(FLOOR));
  assert.ok(/risk:low/i.test(FLOOR));
  assert.ok(FLOOR.includes('fails toward filing'));
});

test('materiality-floor.md states both overrides', () => {
  assert.ok(/tangential/i.test(FLOOR));
  assert.ok(FLOOR.toLowerCase().includes('out of this contract') || FLOOR.toLowerCase().includes('/capture'));
});

test('materiality-floor.md states the entry format line', () => {
  assert.ok(FLOOR.includes('- [{area}] {one-line finding} — {file refs} — Defer-reason: {value} — {provenance}'));
});

test('materiality-floor.md\'s audit line uses the literal AUTO status and no invented status word', () => {
  assert.match(FLOOR, /^AUTO \{time\} — materiality-floor:/m);
  assert.ok(!/^DIGEST /m.test(FLOOR));
});

test('materiality-floor.md states both container shapes', () => {
  assert.ok(FLOOR.includes('work-backend: github-issues'));
  assert.ok(FLOOR.includes('work-backend: local-files'));
  assert.ok(FLOOR.includes('specs/digest.md'));
});

test('materiality-floor.md states expiry is a logged retention decision, not skipped work', () => {
  assert.ok(FLOOR.includes('## Expiry is not skipped work'));
  assert.ok(FLOOR.includes('Archival is a logged retention decision reachable only'));
});

test('materiality-floor.md defines {area} as an exact-match grouping key', () => {
  const entryIdx = FLOOR.indexOf('## Entry format');
  const containerIdx = FLOOR.indexOf('## Container');
  const section = FLOOR.slice(entryIdx, containerIdx);
  assert.ok(entryIdx !== -1 && containerIdx > entryIdx, 'Entry format section must precede Container');
  assert.ok(/`\{area\}` is the subsystem/.test(section), '{area} must be defined, not just referenced');
  assert.ok(/exact match/i.test(section), 'the definition must state that clustering groups on it by exact match');
});

test('materiality-floor.md exempts the digest container from record-scoped sweeps', () => {
  assert.ok(FLOOR.includes('The digest issue is a container, not a work record.'));
  assert.ok(FLOOR.includes('isBacklog'), 'the exemption must name the predicate that would otherwise claim it');
  assert.ok(/never (?:shaped|scored|promoted|closed)/.test(FLOOR));
});

test('tidy Shape 1 carries the digest-container staleness exemption the contract promises', () => {
  const shape1 = TIDY_RECORDS.slice(
    TIDY_RECORDS.indexOf('### Shape 1'),
    TIDY_RECORDS.indexOf('### Shape 2'),
  );
  assert.ok(shape1.length > 0, 'Shape 1 section must exist');
  assert.match(shape1, /Digest containers are exempt/);
  assert.ok(shape1.includes('_shared/materiality-floor.md'));
  assert.match(shape1, /Keep — materiality-floor digest container/);
});

test('deferral-gate.md\'s bundling bullet cites materiality-floor.md by literal path', () => {
  const bullet = GATE.split('\n').find((l) => l.includes('"Bundle of small items"'));
  assert.ok(bullet, 'deferral-gate.md must still carry the "Bundle of small items" bad-reason bullet');
  assert.ok(
    bullet.includes('_shared/materiality-floor.md'),
    'the citation must sit on the bundling bullet itself, not merely somewhere else in the file',
  );
});

test('digest-sweep.md states the cluster-promotion threshold, per-line marker, and always-promotable rule', () => {
  assert.ok(SWEEP.includes('3 or more'));
  assert.ok(SWEEP.includes('→ #{n}'));
  assert.match(SWEEP.toLowerCase(), /remain manually promotable or\s+re-filable at any time/);
});

test('digest-sweep.md generalizes the promotion marker to {id}, with #{n} only as the github-issues instantiation', () => {
  assert.ok(SWEEP.includes('→ {id}'));
  assert.ok(SWEEP.includes('→ #{n}'));
  assert.ok(SWEEP.includes('→ {n}'));
});

test('digest-sweep.md defines a github-issues expiry marker so an expired entry is not re-summarized', () => {
  assert.ok(SWEEP.includes('→ expired'));
  assert.match(SWEEP, /never re-summarizes/);
});

test('digest-sweep.md states the expiry age, the 100-comment rollover, and the no-digest/two-digest edges', () => {
  assert.ok(SWEEP.includes('90 days'));
  assert.ok(SWEEP.includes('100 comments'));
  assert.ok(SWEEP.toLowerCase().includes('no-ops silently'));
  assert.ok(SWEEP.toLowerCase().includes('bootstrap-race repair'));
});

test('digest-sweep.md\'s real outputs each name an Action Vocabulary entry, no orphaned category', () => {
  assert.ok(SWEEP.includes('Merge-close duplicate digest'));
  assert.ok(SWEEP.includes('Propose digest cluster'));
  assert.ok(SWEEP.includes('Expiry summary'));
  assert.ok(SWEEP.includes('Rollover digest container'));
});

test('tidy/SKILL.md cites digest-sweep.md instead of restating its procedures', () => {
  assert.ok(TIDY_SKILL.includes('digest-sweep.md'));
  assert.ok(!TIDY_SKILL.includes('90 days'));
  assert.ok(!TIDY_SKILL.includes('100 comments'));
});

// Per-file 40 KB pin on tidy/SKILL.md retired by #1997 — the per-file tier is
// a warning since #1990 and this file has no compose call site; removal
// condition in docs/incident-log.md [IL-153].

const ADOPTERS = [
  'plugin/skills/review/step3-routing.md',
  'plugin/skills/wrap-up/residue-sweep.md',
  'plugin/skills/wrap-up/leftover-routing.md',
  'plugin/skills/reflect/full-mode.md',
  'plugin/skills/reflect/hindsight-mode.md',
  'plugin/skills/visual-review/browser-review.md',
  'plugin/skills/code-health/filing.md',
  'plugin/skills/docs-health/SKILL.md',
  'plugin/skills/harness-health/filing.md',
  'plugin/skills/journey-health/SKILL.md',
];

for (const rel of ADOPTERS) {
  test(`${rel} cites materiality-floor.md at its filing point`, () => {
    assert.match(read(rel), /_shared\/materiality-floor\.md/);
  });
}

test('no adopter file restates the floor\'s three-axis definition', () => {
  for (const rel of ADOPTERS) {
    assert.doesNotMatch(
      read(rel),
      // `[\s\S]` (not `.`) so a restatement that wraps across lines — the shape the contract's
      // own canonical sentence takes — cannot slip past this guard.
      /size:low[\s\S]{0,150}priority:low[\s\S]{0,150}risk:low/i,
      `${rel} appears to restate the floor's definition instead of citing it`,
    );
  }
});

test('the four health sweeps state materiality-floor-before-cap-digest ordering', () => {
  const HEALTH_FILES = [
    'plugin/skills/code-health/filing.md',
    'plugin/skills/docs-health/SKILL.md',
    'plugin/skills/harness-health/filing.md',
    'plugin/skills/journey-health/SKILL.md',
  ];
  for (const rel of HEALTH_FILES) {
    assert.match(
      read(rel),
      /[Bb]efore the (drain-rate cap check|cap check)/,
      `${rel} should state the floor is consulted before its own cap digest check`,
    );
  }
});

test('reflect\'s and visual-review\'s recommend-only Defer bullets state accept-time (not recommendation-time) digest write', () => {
  const RECOMMEND_ONLY = {
    'plugin/skills/reflect/full-mode.md': /digest entry is written only when the human approves that row/,
    'plugin/skills/visual-review/browser-review.md': /writes the digest entry once the human approves that row/,
  };
  for (const [rel, pattern] of Object.entries(RECOMMEND_ONLY)) {
    assert.match(
      read(rel),
      pattern,
      `${rel} should state the digest entry is written only once a human approves the recommendation`,
    );
  }
});

test('multi-branch adopter files cite materiality-floor.md at each of their filing branches', () => {
  const MULTI_BRANCH = [
    'plugin/skills/review/step3-routing.md',
    'plugin/skills/reflect/full-mode.md',
    'plugin/skills/visual-review/browser-review.md',
  ];
  for (const rel of MULTI_BRANCH) {
    const count = (read(rel).match(/_shared\/materiality-floor\.md/g) || []).length;
    assert.ok(
      count >= 2,
      `${rel} should cite _shared/materiality-floor.md at every one of its filing branches (found ${count})`,
    );
  }
});

// --- #1279: Defer-reason vocabulary for direct-filing producers ---

test('materiality-floor.md documents a Defer-reason value for direct-filing producers (the four health sweeps)', () => {
  assert.ok(FLOOR.includes('direct-filing-sweep'));
  assert.match(FLOOR, /### Direct-filing producers' `Defer-reason:` value/);
});

test('the direct-filing-sweep value is a deliberate contract-stated exception, not a member of the closed deferral-gate vocabulary', () => {
  assert.ok(
    !DEFER_REASONS.includes('direct-filing-sweep'),
    'direct-filing-sweep must NOT be added to record.js\'s DEFER_REASONS — it is not a fix-now-failure reason',
  );
  assert.ok(FLOOR.includes("Deliberately **not** added to `bin/lib/issues/record.js`'s\n`DEFER_REASONS`") || FLOOR.includes('Deliberately **not** added'));
});

// --- #1279: dedup mechanism ---

test('materiality-floor.md documents the dedup mechanism and the fingerprint marker in the Entry format', () => {
  assert.match(FLOOR, /### Dedup/);
  assert.ok(FLOOR.includes('materiality-fingerprint'));
  assert.ok(FLOOR.includes('isMaterialityDuplicate'));
  assert.ok(FLOOR.includes('bin/lib/health-core/materiality-digest.js'));
});

test('digest-sweep.md\'s cluster promotion notes the dedup-at-routing-time guarantee', () => {
  assert.ok(SWEEP.includes('isMaterialityDuplicate'));
});

test('review/step3-routing.md checks isMaterialityDuplicate before appending a digest entry', () => {
  assert.ok(REVIEW_ROUTING.includes('isMaterialityDuplicate'));
});

// --- #1279: digest URL and count surfacing ---

test('materiality-floor.md documents the digest URL and count surfacing convention', () => {
  assert.match(FLOOR, /### Digest URL and count surfacing/);
});

test('at least one adopter (review/step3-routing.md) surfaces the digest comment URL in its own summary', () => {
  assert.ok(REVIEW_ROUTING.includes('Digest URL and count surfacing'));
  assert.match(REVIEW_ROUTING, /digest comment URL and the count routed/);
});

test('materiality-floor.md\'s Digest URL and count surfacing section mandates the zero-routing case', () => {
  const idx = FLOOR.indexOf('### Digest URL and count surfacing');
  assert.ok(idx !== -1, 'section must exist');
  const section = FLOOR.slice(idx, idx + 800);
  assert.match(section, /routes none still states the count, as `0`/);
});

// --- #1611: Summary surfacing wired into the remaining adopters ---

const SUMMARY_SURFACING_ADOPTERS = [
  'plugin/skills/review/step3-routing.md',
  'plugin/skills/wrap-up/residue-sweep.md',
  'plugin/skills/wrap-up/leftover-routing.md',
  'plugin/skills/reflect/full-mode.md',
  'plugin/skills/visual-review/browser-review.md',
];

for (const rel of SUMMARY_SURFACING_ADOPTERS) {
  test(`${rel} states the digest comment URL and count routed in its own summary`, () => {
    // Hard-wrapped prose files (leftover-routing.md) may break this phrase across a
    // line — collapse all whitespace before matching so wrap point never matters.
    const collapsed = read(rel).replace(/\s+/g, ' ');
    assert.match(
      collapsed,
      /digest comment URL and the count routed/,
      `${rel} should state the digest URL and count in its own summary, per materiality-floor.md's Digest URL and count surfacing section`,
    );
  });
}

test('reflect/hindsight-mode.md inherits digest URL/count surfacing from full-mode.md by explicit reference, not a restatement', () => {
  const HINDSIGHT = read('plugin/skills/reflect/hindsight-mode.md');
  assert.match(HINDSIGHT, /digest-comment-URL-and-count summary surfacing/);
  assert.match(HINDSIGHT, /this mode's own end-of-run summary states the same digest comment URL and count/);
});

test('the four health sweeps report a materiality-digest count distinct from the cap-digest count in the throttle line', () => {
  assert.match(HEALTH_DIGEST, /filed: N, digested: M, cap: \{CAP\}, materiality: K/);
  const HEALTH_SKILLS = [
    'plugin/skills/code-health/SKILL.md',
    'plugin/skills/docs-health/SKILL.md',
    'plugin/skills/harness-health/SKILL.md',
    'plugin/skills/journey-health/SKILL.md',
  ];
  for (const rel of HEALTH_SKILLS) {
    assert.match(
      read(rel),
      /filed: N, digested: M, cap: \{CAP\}, materiality: K/,
      `${rel} should cite the updated throttle line carrying the materiality: K field`,
    );
  }
});
