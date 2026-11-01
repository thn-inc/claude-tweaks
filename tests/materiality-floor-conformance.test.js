// tests/materiality-floor-conformance.test.js
// Pins plugin/skills/_shared/materiality-floor.md's contract elements, its citation from
// deferral-gate.md, and the /tidy digest sweep's promotion/expiry procedures. No local-files
// runtime test double exists yet for the container branch — that branch is pinned as prose only
// until a local-files consumer lands.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const { DEFER_REASONS } = require('../plugin/bin/lib/issues/record');
const { trustedJqSelect, untrustedJqNote } = require('../plugin/bin/lib/issues/comment-trust');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(REPO_ROOT, rel));

const FLOOR = read('plugin/skills/_shared/materiality-floor.md');
const GATE = read('plugin/skills/_shared/deferral-gate.md');
const SWEEP = read('plugin/skills/tidy/digest-sweep.md');
const TIDY_SKILL = read('plugin/skills/tidy/SKILL.md');
const TIDY_RECORDS = read('plugin/skills/tidy/step-1-records.md');
const TIDY_STEP6_AUTO = read('plugin/skills/tidy/step-6-auto.md');
const TIDY_SCAN_EXECUTION = read('plugin/skills/tidy/scan-execution.md');
const HEALTH_DIGEST = read('plugin/skills/_shared/health-filing-digest.md');
const REVIEW_ROUTING = read('plugin/skills/review/step3-routing.md');
const NEXT_MODE = read('plugin/skills/specify/next-mode.md');

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

test('materiality-floor.md states the severity override: a high or critical finding always clears the floor', () => {
  assert.ok(FLOOR.includes('A finding carrying severity `high` or `critical` always clears the floor'));
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

// Per-file 40 KB pin on tidy/SKILL.md retired by #1997 — the per-file tier
// was a warning from #1990 until #3311 deleted the ceiling model entirely,
// and this file has no compose call site; removal condition in
// docs/incident-log.md [IL-153].

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

test('materiality-floor.md Dedup passes comment objects and counts only trusted-author markers (#3766)', () => {
  const dedup = FLOOR.slice(FLOOR.indexOf('### Dedup'), FLOOR.indexOf('### Direct-filing producers'));
  assert.ok(dedup.includes('isMaterialityDuplicate(existingComments, candidate)'));
  assert.ok(dedup.includes('authorAssociation'));
  assert.ok(dedup.includes('bin/lib/issues/comment-trust.js'));
  assert.ok(dedup.includes('Trusted authors'));
  assert.ok(!dedup.includes('existingCommentBodies'));
});

test('materiality-floor.md race repair and digest-sweep.md read only trusted digest comments (#3766)', () => {
  assert.ok(FLOOR.includes("merge the newer issue's trusted comments into the older"));
  assert.ok(SWEEP.includes("merge the newer issue's trusted comments into the older"));
  assert.ok(SWEEP.includes('trustedMaterialityTexts'));
  assert.ok(SWEEP.includes('Trusted authors'));
});

test('digest-sweep.md reads trusted comment objects with the Trusted-authors jq pasted verbatim (#3766)', () => {
  const promotion = SWEEP.slice(SWEEP.indexOf('### Cluster promotion'), SWEEP.indexOf('### Expiry'));
  assert.ok(promotion.includes(trustedJqSelect()), 'inlined jq select must match comment-trust.js');
  assert.ok(promotion.includes(untrustedJqNote()), 'inlined skip-note jq must match comment-trust.js');
  assert.ok(promotion.includes('never reduce\nthem to bare bodies first'));
  assert.ok(promotion.includes('`url`/`id`'));
  assert.ok(promotion.includes('`createdAt`'));
});

test('digest-sweep.md Expiry operates on the trusted active set (#3766)', () => {
  const expiry = SWEEP.slice(SWEEP.indexOf('### Expiry'), SWEEP.indexOf('### Container rollover'));
  assert.ok(expiry.includes('operates on the same trusted active set as Cluster promotion'));
  assert.ok(expiry.includes('never expired and never marked `→ expired`'));
});

test('materiality-floor.md Dedup says the local-files body string is trusted (#3766)', () => {
  const dedup = FLOOR.slice(FLOOR.indexOf('### Dedup'), FLOOR.indexOf('### Direct-filing producers'));
  assert.ok(dedup.includes('the current file body, a single-writer string that is trusted'));
});

test('tidy/SKILL.md Merge-close row and step-6-auto.md merge only trusted comments, not untrusted ones (#3766)', () => {
  const row = TIDY_SKILL.split('\n').find((l) => l.startsWith('| **Merge-close duplicate digest**'));
  assert.ok(row, 'Action Vocabulary row must exist');
  assert.ok(row.includes("merge only the newer's trusted comments"));
  assert.ok(row.includes('`OWNER`/`MEMBER`/`COLLABORATOR`'));
  assert.ok(!row.includes("merge the newer's comments"));
  const tier = TIDY_STEP6_AUTO.split('\n').find((l) => l.startsWith('| **Merge-close duplicate digest**'));
  assert.ok(tier, 'step-6-auto.md tier row must exist');
  assert.ok(tier.includes("merges the newer issue's trusted comments into the surviving issue"));
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

const rollover = () => SWEEP.slice(SWEEP.indexOf('### Container rollover'));

test('AC4.1: digest-sweep.md names the ordering, the count verification before the close, and the threshold rationale', () => {
  const r = rollover();
  const order = [
    'without the `digest` label',
    'post each printed `paths` file',
    'Verify the count',
    'Move the label',
    'Close the old issue',
  ].map((s) => r.indexOf(s));
  assert.ok(order.every((i) => i !== -1), `missing a step: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, `steps out of order: ${order}`);
  assert.ok(r.includes('Continue only when `verified` is `true`'));
  assert.ok(r.includes('A mismatch stops here'));
  assert.ok(r.includes('compacts promoted and expired lines out of every sweep'));
  assert.ok(r.includes('truncates'));
});

test('digest-sweep.md verifies both counts, carries tombstones, and refuses a bad read', () => {
  const r = rollover();
  assert.ok(r.includes('both the live-entry count and the tombstone count'));
  assert.ok(r.includes('fingerprint-only tombstone'));
  assert.ok(r.includes('consolebackfill-item'));
  assert.ok(r.includes('Any other non-zero exit is a refused read'));
  const removal = r.indexOf('Remove `digest` from the old issue');
  const add = r.indexOf('add it to the replacement');
  assert.ok(removal !== -1 && add !== -1, `label removal and add must both be named: ${removal}, ${add}`);
  assert.ok(removal < add, 'label removal must precede the add');
});

test('digest-sweep.md reads the true count and paginates every digest read', () => {
  const r = rollover();
  assert.ok(r.includes('gh api repos/{owner}/{repo}/issues/{n} --jq .comments'));
  assert.ok(r.includes('gh issue view {n} --json comments --jq .comments'));
  assert.ok(r.includes('`get_comments`'));
  assert.ok(r.includes('Never `gh issue list --json comments`'));
});

test('digest-sweep.md resumes an unfinished rollover before its no-op, by trusted body marker, never by title', () => {
  const start = SWEEP.indexOf('**Resume an unfinished rollover.**');
  assert.ok(start !== -1, 'resume paragraph must exist');
  assert.ok(start < SWEEP.indexOf('No-ops silently'), 'resume must run before the no-op that would otherwise skip it');
  assert.ok(SWEEP.includes('<!-- digest-rollover-of: {old} -->'));
  assert.ok(SWEEP.includes('/bin/digest-rollover.js" verdict --old {old} --candidates {n},{n}'));
  assert.ok(SWEEP.includes('no `--search`'));
  assert.ok(SWEEP.includes('A title alone never identifies a replacement'));
  assert.ok(SWEEP.includes('`stalled`'), 'the interrupted label move must be named');
  assert.ok(SWEEP.includes('list open `digest` issues first'), 'a stalled move must look for a bootstrapped issue before naming the add');
  assert.ok(SWEEP.includes('`finished`') && SWEEP.includes('propose finishing when `verified` is `false` or `extras` is non-empty'), 'a closed old issue must be re-checked, not ignored');
});

test('digest-sweep.md re-lists before creating, picks the lowest-numbered, and closes the others after carrying', () => {
  const r = rollover();
  assert.ok(r.includes('Re-list immediately before creating'));
  assert.ok(r.includes('lowest-numbered'));
  assert.ok(r.includes('`extras`'));
});

test('digest-sweep.md skips the carry for a zero-comment issue and re-reads the count after the close', () => {
  const r = rollover();
  assert.ok(r.includes('A digest issue with zero comments has nothing to carry'));
  const close = r.indexOf('Close the old issue');
  const recount = r.indexOf('Re-read its true comment count');
  assert.ok(close !== -1 && recount !== -1 && close < recount, `the post-close recount must follow the close: ${close}, ${recount}`);
  assert.ok(r.includes('name any gap that remains in the report'));
});

test('digest-sweep.md Expiry dates a github-issues line through materialityEntryDate and leaves local-files alone', () => {
  const expiry = SWEEP.slice(SWEEP.indexOf('### Expiry'), SWEEP.indexOf('### Container rollover'));
  assert.ok(expiry.includes('materialityEntryDate'));
  assert.ok(expiry.includes('materiality-first-seen'));
  assert.ok(expiry.includes('On `local-files`, the age comes from'));
  assert.ok(expiry.includes('materialityEntryDate(line, comment.createdAt || comment.created_at)'), 'both comment-date spellings, as the fence reads them');
});

test('a re-run reaches a mark made on the old issue, and a later approval marks the carried copy', () => {
  const r = rollover();
  assert.ok(r.includes('apply each printed `edits` entry'));
  assert.ok(r.includes('marks the carried copy in the current container'));
});

test('every rollover restatement carries the carry-over, not a bare bootstrap', () => {
  const row = TIDY_SKILL.split('\n').find((l) => l.startsWith('| **Rollover digest container**'));
  assert.ok(row.includes('carry every trusted live entry and a tombstone per promoted or expired entry'));
  assert.ok(!row.includes('bootstrap a fresh issue'));
  assert.ok(!FLOOR.includes('it bootstraps the\nreplacement in the same move'));
  assert.ok(!TIDY_RECORDS.includes('it bootstraps the replacement in the same move'));
  assert.ok(FLOOR.includes('materiality-first-seen'));
  assert.ok(FLOOR.includes('fingerprint-only tombstone'));
  const tier = TIDY_STEP6_AUTO.split('\n').find((l) => l.startsWith('| **Rollover digest container**'));
  assert.match(tier, /\| Stage \| Stage \| Stage — /);
});

test('both rollover trigger cells name an unfinished rollover to resume, not only the comment cap', () => {
  const row = TIDY_SKILL.split('\n').find((l) => l.startsWith('| **Rollover digest container**'));
  assert.ok(row.includes('or an unfinished rollover to resume'), 'tidy/SKILL.md trigger cell');
  const tier = TIDY_STEP6_AUTO.split('\n').find((l) => l.startsWith('| **Rollover digest container**'));
  assert.ok(tier.includes('or an unfinished rollover to resume'), 'step-6-auto.md trigger cell');
});

test('tidy Shape 1 keeps an unfinished rollover replacement by its trusted body marker', () => {
  assert.ok(TIDY_RECORDS.includes('`<!-- digest-rollover-of: {old} -->`'));
  assert.ok(TIDY_RECORDS.includes('`classifyRolloverResume`'));
  assert.ok(TIDY_RECORDS.includes('/bin/digest-rollover.js" verdict --old {old} --candidates {n},{n}'));
  assert.ok(!TIDY_RECORDS.includes('(continues #{old})'));
});

test('an orphaned replacement is named for a human only when no open digest issue exists, and never re-labeled', () => {
  const resume = SWEEP.slice(SWEEP.indexOf('**Resume an unfinished rollover.**'), SWEEP.indexOf('No-ops silently'));
  const at = resume.indexOf('A `none` printing `orphan: {n}`');
  assert.ok(at !== -1, 'the orphan branch is missing');
  const branch = resume.slice(at);
  assert.ok(branch.includes('Skip an orphan that another pair reports as `stalled` or `resume`'), 'a second-generation stall is not also hand-orphaned');
  assert.ok(branch.includes('when none exists name `{n}` and `{old}` in the sweep report for a human'));
  assert.ok(branch.includes('Never re-label it here, since a later generation looks the same otherwise'));
  assert.ok(!branch.includes('--add-label'), 'no labeling command belongs to this branch');
});

test('an interrupted rollover over the threshold makes one row, and the threshold rationale owns up to the finished re-check', () => {
  const resume = SWEEP.slice(SWEEP.indexOf('**Resume an unfinished rollover.**'), SWEEP.indexOf('No-ops silently'));
  assert.ok(resume.includes('the two make one `Rollover digest container` row'));
  const threshold = rollover().split('\n').find((l) => l.startsWith('`github-issues` only — a file has no analogous limit'));
  assert.ok(threshold, 'the threshold paragraph moved');
  assert.ok(threshold.includes('the `finished` re-check above still reads the closed issue once per sweep'));
  assert.ok(resume.includes('re-run step 2\'s `carry` against the closed issue'), 'the check itself stays');
});

test('step 4 handles known extras before the label comes off, and only a newly appeared issue inside the window', () => {
  const s = stepText(4);
  const order = [
    'Handle every `extras` issue from step 1 first',
    'Remove `digest` from the old issue next',
    'list open `digest` issues and handle any that appeared while the label was off',
    'Unpin the old issue',
  ].map((m) => s.indexOf(m));
  assert.ok(order.every((i) => i !== -1), `step 4 lost a marker: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, `step 4 out of order: ${order}`);
  assert.ok(s.indexOf('add it to the replacement') > order[1], 'the add follows the removal');
});

test('step 6 takes the count before the summary comment and allows for it', () => {
  const s = stepText(6);
  const order = [
    'Take `{C}` from the `count` that step 5\'s last `carry` printed',
    'Post a summary comment',
    'adding 1 to `{C}` when this pass posts it',
    'Re-read its true comment count: if it rose above `{C}`',
  ].map((m) => s.indexOf(m));
  assert.ok(order.every((i) => i !== -1), `step 6 lost a marker: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, `step 6 out of order: ${order}`);
});

// --- Fix round 1 (#4848): the rollover procedure's wording, fences and consumers ---

const stepText = (n) => {
  const r = rollover();
  const start = r.indexOf(`\n${n}. **`);
  const end = n === 6 ? r.length : r.indexOf(`\n${n + 1}. **`);
  assert.ok(start !== -1 && end !== -1 && start < end, `rollover step ${n} not found: ${start}, ${end}`);
  return r.slice(start, end);
};
const fwd = (p) => p.split(path.sep).join('/');
const scratch = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rollover-fence-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const PLUGIN_ROOT = fwd(path.join(REPO_ROOT, 'plugin'));
const runFence = (line, env) => spawnSync('bash', ['-c', line], { env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...env }, encoding: 'utf8' });
// The ```bash block holding a line that starts with `lead`, so a fence runs with its own resolve lines.
const blockHolding = (src, lead, label) => {
  const at = src.indexOf(lead);
  assert.ok(at !== -1, `${label}: no line starts with ${lead}`);
  const open = src.lastIndexOf('```bash\n', at);
  const close = src.indexOf('\n```', at);
  assert.ok(open !== -1 && close !== -1 && open < at && at < close, `${label}: the fence around ${lead.slice(0, 30)} is not a bash block`);
  return src.slice(open + '```bash\n'.length, close);
};
// A session env that makes session-tmp-resolve.js land under a scratch dir, and the path it prints for a file name.
const sessionEnv = (dir) => ({ CLAUDE_CODE_SESSION_ID: 'rollover-fence-test', TMPDIR: dir, TEMP: dir, TMP: dir });
const resolvedPath = (dir, name) => spawnSync(process.execPath, [path.join(REPO_ROOT, 'plugin/bin/session-tmp-resolve.js'), '--value', name], { env: { ...process.env, ...sessionEnv(dir) }, encoding: 'utf8' }).stdout.trim();

test('the Resume list prints numbers only, resolves every path through session-tmp-resolve, and takes no action on an unreadable {old}', () => {
  const filter = `--jq '.[] | select(.body | test("(?m)^<!-- digest-rollover-of: [0-9]+ -->\\\\s*$")) | .number'`;
  assert.ok(SWEEP.includes(filter), 'the documented list filter');
  assert.ok(SWEEP.includes('`list_issues`') && SWEEP.includes('`perPage: {window}`'), 'the MCP form');
  assert.ok(SWEEP.includes('that pair gets no action'));
  assert.ok(SWEEP.includes('`bin/session-tmp-resolve.js --value`'));
  assert.ok(SWEEP.includes('distinct from `/claude-tweaks:specify`\'s `$CANDIDATES`'));
  for (const stale of ['{CANDIDATES}', '{OLDISSUE}', '{OLD}', '{NEW}', '{COUNT}', '{CARRYDIR}', '{plugin-root}']) {
    assert.ok(!SWEEP.includes(stale), `${stale} has no location`);
  }
});

test('a stalled move needs an open old issue, and an earlier generation reads none', () => {
  const resume = SWEEP.slice(SWEEP.indexOf('**Resume an unfinished rollover.**'), SWEEP.indexOf('No-ops silently'));
  assert.ok(resume.includes('while the old issue is still open'));
  assert.ok(resume.includes('an earlier generation'));
  assert.ok(resume.includes('a replacement keeps its marker for good'));
});

test('step 1 re-lists through the trust gate: the verdict decides the replacement, and none means create', () => {
  const s = stepText(1);
  assert.ok(s.includes('run the **Resume an unfinished rollover** list and its `verdict` over every issue naming `{old}`'));
  assert.ok(s.includes('Take the printed `replacement` and `extras`'));
  assert.ok(s.includes('no issue naming `{old}` or a `none` verdict means create one'));
  assert.ok(!s.includes('the same list and filter'), 'a bare body-line filter is no trust gate');
});

test('step 1 stops when the running identity is untrusted, before a second replacement can appear', () => {
  const s = stepText(1);
  const create = s.indexOf('Its body\'s first line is exactly');
  const check = s.indexOf('`gh api repos/{owner}/{repo}/issues/{replacement} --jq .author_association`');
  assert.ok(create !== -1 && check !== -1 && create < check, `the check follows the create: ${create}, ${check}`);
  assert.ok(s.includes('On anything but `OWNER`, `MEMBER` or `COLLABORATOR`, stop here and say so in the report'));
});

test('the steps stay re-runnable from every caller: zero count, mismatch, pointer and summary comments, close', () => {
  const r = rollover();
  assert.ok(stepText(2).includes('a true count of 0 prints `empty: true` and `verified: true` with nothing to post'));
  assert.ok(!r.includes('go to step 4'), 'step 5 and step 6 call steps 2 and 3 too');
  const s3 = stepText(3);
  assert.ok(s3.includes('A mismatch stops here'));
  assert.ok(s3.includes('the issue being carried keeps every entry and nothing closes'));
  assert.ok(!s3.includes('still holds `digest`'), 'false when steps 2 and 3 re-run from step 4, 5 or 6');
  for (const n of [4, 6]) assert.ok(stepText(n).includes('<!-- digest-rollover-to: {replacement} -->'), `step ${n} comment marker`);
  assert.ok(stepText(4).includes('unless it is already closed'));
  assert.ok(stepText(6).includes('skip the close and go to the recount'));
  const preamble = r.slice(r.indexOf('Each step below is safe to re-run'), r.indexOf('\n1. **'));
  assert.ok(preamble.includes('post only when the issue\'s trusted comments'));
  assert.ok(preamble.includes('a close is skipped on an issue already closed'));
});

test('Shape 1 keeps a rollover pair on any line that says so, never overrides a label, and gates on github-issues', () => {
  assert.ok(TIDY_RECORDS.includes('On `github-issues` (`local-files` has no rollover), two unlabeled shapes'));
  assert.ok(TIDY_RECORDS.includes('and `{old}` itself, which loses its `digest` label before the rollover closes it'));
  assert.ok(TIDY_RECORDS.includes('A `resume` or `stalled` verdict `Keep`s `{old}`, the printed `replacement` and every printed `extras` issue'));
  assert.ok(TIDY_RECORDS.includes('A printed `extras` issue is `Keep` whatever the verdict, `finished` included'));
  assert.ok(TIDY_RECORDS.includes('A record is kept when ANY line it appears on gives that verdict'));
  assert.ok(TIDY_RECORDS.includes('Beyond the `extras` rule, any other verdict adds no exemption and never overrides one'));
  assert.ok(TIDY_RECORDS.includes('stays `Keep` by the rule above whatever the verdict (`finished` included)'));
  assert.ok(!TIDY_RECORDS.includes('leaves both ordinary records'), 'a live labeled container is not ordinary on `finished`');
  assert.ok(TIDY_RECORDS.includes('`Keep` every issue on it for this run and name the line in the report'));
  assert.ok(TIDY_RECORDS.includes('over every issue naming `{old}` at once'));
});

test('Shape 1 pair-listing fence sets its own $TIDY_RECORDS and prints one line per {old} with every open issue naming it', (t) => {
  const dir = scratch(t);
  const records = [
    { number: 20, state: 'OPEN', body: 'x\n<!-- digest-rollover-of: 10 -->\n' },
    { number: 15, state: 'OPEN', body: 'planted\n<!-- digest-rollover-of: 10 -->' },
    { number: 21, state: 'CLOSED', body: '<!-- digest-rollover-of: 10 -->' },
    { number: 22, state: 'OPEN', body: 'inline <!-- digest-rollover-of: 10 --> text' },
    { number: 23, state: 'OPEN', body: null },
    { number: 30, state: 'OPEN', body: '<!-- digest-rollover-of: 20 -->\r\n' },
  ];
  fs.writeFileSync(resolvedPath(dir, 'tidy-records.json'), JSON.stringify(records));
  const block = blockHolding(TIDY_RECORDS, 'node -e "const m=/^<!-- digest-rollover-of', 'Shape 1 pair listing');
  assert.ok(block.startsWith('TIDY_RECORDS="$(node'), 'the fence sets $TIDY_RECORDS like its siblings');
  assert.ok(!('TIDY_RECORDS' in process.env), 'the run must not inject the variable it is proving the fence sets');
  const r = runFence(block, sessionEnv(dir));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(r.stdout.trim().split('\n'), ['10 15 20', '20 30']);
});

// A stub `gh` that prints a fixture for the one argv the Expiry fence documents, and fails like gh for any other.
const ghExpiryStub = (dir, fixture) => {
  const bin = path.join(dir, 'ghbin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify(fixture));
  const stub = path.join(bin, 'gh');
  fs.writeFileSync(stub, `#!${process.execPath}
const key = process.argv.slice(2).join(' ');
if (key !== 'issue view 10 --json comments --jq .comments') { process.stderr.write('unexpected gh ' + key + '\\n'); process.exit(1); }
process.stdout.write(require('fs').readFileSync(${JSON.stringify(path.join(dir, 'fixture.json'))}, 'utf8'));
`);
  fs.chmodSync(stub, 0o755); // root-safe: makes the stub runnable, simulates no denial
  return { PATH:`${bin}${path.delimiter}${process.env.PATH}` };
};

test('Expiry\'s date fence runs: a run-id, a stamped line, the comment date, and null when nothing parses', { skip: process.platform === 'win32' ? 'a bare executable stub is not a launchable gh on win32' : false }, (t) => {
  const { materialityEntryLine } = require('../plugin/bin/lib/health-core/materiality-digest');
  const base = { area: 'tidy', fileRefs: 'a.js', deferReason: 'direct-filing-sweep' };
  const runId = materialityEntryLine({ ...base, finding: 'one', provenance: '2026-08-24T183516-tidy-standalone' });
  const skill = materialityEntryLine({ ...base, finding: 'two', provenance: 'harness-health' });
  const stamped = `${materialityEntryLine({ ...base, finding: 'three', provenance: 'harness-health' })} <!-- materiality-first-seen: 2026-02-02T00:00:00Z -->`;
  const mcpSkill = materialityEntryLine({ ...base, finding: 'four', provenance: 'harness-health' });
  const comments = [
    { url: 'https://example.test/c#issuecomment-1', createdAt: '2026-11-01T00:00:00Z', authorAssociation: 'MEMBER', body: `a note\n${runId}\n${skill}\n${stamped}` },
    { url: 'https://example.test/c#issuecomment-2', authorAssociation: 'OWNER', body: skill },
    // MCP spells the comment date created_at; an unstamped skill-provenance line takes it
    { html_url: 'https://example.test/c#issuecomment-3', created_at: '2026-10-01T00:00:00Z', author_association: 'COLLABORATOR', body: mcpSkill },
    // a planted line in an untrusted comment is never dated
    { url: 'https://example.test/c#issuecomment-4', createdAt: '2026-11-01T00:00:00Z', authorAssociation: 'NONE', body: runId },
  ];
  const dir = scratch(t);
  const documented = blockHolding(SWEEP, 'node -e "const fs=require(\'fs\');const {materialityEntryDate}', 'Expiry');
  assert.ok(documented.startsWith('EXPIRY_COMMENTS="$(node'), 'the fence sets its own variable');
  assert.ok(documented.includes('gh issue view {n} --json comments --jq .comments > "$EXPIRY_COMMENTS" && node -e'), 'the fence saves its own read');
  const block = documented.replace('{n}', '10');
  assert.ok(!('EXPIRY_COMMENTS' in process.env));
  const r = runFence(block, { ...sessionEnv(dir), ...ghExpiryStub(dir, comments) });
  assert.strictEqual(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split('\n').map((l) => l.split('\t'));
  assert.deepStrictEqual(rows.map((x) => x[0]), ['2026-08-24T18:35:16.000Z', '2026-11-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z', 'null', '2026-10-01T00:00:00.000Z']);
  assert.deepStrictEqual(rows.map((x) => x[2]), [runId, skill, stamped, skill, mcpSkill]);
  assert.ok(rows[3][1].endsWith('issuecomment-2'));
  assert.ok(rows[4][1].endsWith('issuecomment-3'));
  assert.strictEqual(rows.length, 5, 'the untrusted comment\'s line is not dated');
  // a failed read stops the fence before the dating runs, never an empty set
  const failed = runFence(documented.replace('{n}', '11'), { ...sessionEnv(dir), ...ghExpiryStub(dir, comments) });
  assert.notStrictEqual(failed.status, 0, 'a failed gh read must fail the fence');
  assert.strictEqual(failed.stdout, '');
});
