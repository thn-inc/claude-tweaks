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
  assert.ok(r.includes('A non-zero exit is a refused read'));
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
  assert.ok(SWEEP.includes('classifyRolloverResume'));
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
  assert.ok(!TIDY_RECORDS.includes('(continues #{old})'));
});

// --- Fix round 1 (#4848): the rollover procedure's wording, fences and consumers ---

const stepText = (n) => {
  const r = rollover();
  const start = r.indexOf(`\n${n}. **`);
  const end = n === 6 ? r.length : r.indexOf(`\n${n + 1}. **`);
  assert.ok(start !== -1 && end !== -1 && start < end, `rollover step ${n} not found: ${start}, ${end}`);
  return r.slice(start, end);
};
const VERDICT_FENCE = /^node -e "const fs=require\('fs'\);const \[root,o,\.\.\.cs\][^\n]*$/m;
const fenceOf = (src, pattern, label) => {
  const m = pattern.exec(src);
  assert.ok(m, `${label}: fence not found`);
  return m[0];
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

// Each reader of the verdict owns its temp names: Steps 1 and 5.6 run as parallel agents, and the bare drain
// runs beside them, so two readers sharing a name would overwrite each other's candidates.
const VERDICT_READERS = {
  'digest-sweep.md': { src: SWEEP, old: 'RESUME_OLD', cand: 'RESUME_CANDS', prefix: 'digest-resume-' },
  'step-1-records.md': { src: TIDY_RECORDS, old: 'TIDY_ROLLOVER_OLD', cand: 'TIDY_ROLLOVER_CAND', prefix: 'tidy-step1-rollover-' },
  'next-mode.md': { src: NEXT_MODE, old: 'SPECIFY_ROLLOVER_OLD', cand: 'SPECIFY_ROLLOVER_CAND', prefix: 'specify-next-rollover-' },
};
const verdictBody = (line) => line.slice(0, line.indexOf('" "${CLAUDE_PLUGIN_ROOT}"'));

test('the Resume verdict fence has one script body in digest-sweep.md, tidy Shape 1 and the bare drain, each with its own temp names', () => {
  const lines = Object.entries(VERDICT_READERS).map(([name, v]) => fenceOf(v.src, VERDICT_FENCE, name));
  assert.ok(lines.every((l) => verdictBody(l) === verdictBody(lines[0])), 'the three script bodies drifted apart');
  assert.ok(verdictBody(lines[0]).length > 100, 'the body split found nothing');
  const names = [];
  for (const [name, v] of Object.entries(VERDICT_READERS)) {
    const line = fenceOf(v.src, VERDICT_FENCE, name);
    assert.ok(line.endsWith(`"\${CLAUDE_PLUGIN_ROOT}" "$${v.old}" "$${v.cand}"`), `${name}: root, then the old issue, then the candidates`);
    const block = blockHolding(v.src, line, name);
    const mine = [...block.matchAll(/--value (\S+)\)/g)].map((m) => m[1]);
    assert.ok(mine.length >= 2 && mine.every((n) => n.startsWith(v.prefix)), `${name}: names ${mine}`);
    names.push(...mine.map((n) => n.replace(/\{[^}]*\}/g, '')));
  }
  assert.strictEqual(new Set(names).size, names.length, `a temp name is shared between readers: ${names}`);
  for (const [name, v] of [['step-1-records.md', VERDICT_READERS['step-1-records.md']], ['next-mode.md', VERDICT_READERS['next-mode.md']]]) {
    assert.ok(v.src.includes('`classifyRolloverResume`'), name);
    assert.ok(v.src.includes("require(root+'/bin/lib/health-core/materiality-digest.js')"), `${name}: the fence's require path`);
    assert.ok(!v.src.includes('digest-resume-'), `${name}: the sweep's temp names`);
  }
  assert.ok(!/`classifyRolloverResume`\s*\(`digest-sweep\.md`\)/.test(TIDY_RECORDS), 'the Work Records agent cannot read digest-sweep.md');
  assert.ok(!NEXT_MODE.includes("tidy/digest-sweep.md`'s Resume"), 'the bare drain cannot be pointed at a sibling for the reads');
});

test('each copy of the Resume verdict fence runs: it takes every issue naming {old}, trusts only an owner, and reads an earlier generation as none', (t) => {
  const dir = scratch(t);
  const marker = (n) => `<!-- digest-rollover-of: ${n} -->`;
  const issue = (number, over = {}) => ({ number, state: 'open', author_association: 'MEMBER', labels: [], body: '', ...over });
  const labeled = { labels: [{ name: 'digest' }] };
  const none = { state: 'none', replacement: null, extras: [] };
  const cases = [
    { name: 'resume', cands: [[issue(20, { body: marker(10) })]], old: issue(10, labeled), want: { state: 'resume', replacement: 20, extras: [] } },
    { name: 'planted', cands: [[issue(21, { body: marker(10), author_association: 'NONE' })]], old: issue(10, labeled), want: none },
    { name: 'earlier generation', cands: [[issue(20, { state: 'closed', body: marker(10) })]], old: issue(10, { state: 'closed' }), want: none },
    // A planted #15 numbered below the real #20, each in its own file, and again as one flat array:
    { name: 'planted below real', cands: [[issue(15, { body: marker(10), author_association: 'NONE' })], [issue(20, { body: marker(10) })]], old: issue(10, labeled), want: { state: 'resume', replacement: 20, extras: [] } },
    { name: 'one flat array', cands: [[issue(15, { body: marker(10), author_association: 'NONE' }), issue(20, { body: marker(10) })]], old: issue(10, labeled), want: { state: 'resume', replacement: 20, extras: [] } },
    { name: 'two trusted', cands: [[issue(25, { body: marker(10) })], [issue(20, { body: marker(10) })]], old: issue(10, labeled), want: { state: 'resume', replacement: 20, extras: [25] } },
  ];
  for (const [name, v] of Object.entries(VERDICT_READERS)) {
    const line = fenceOf(v.src, VERDICT_FENCE, name);
    for (const c of cases) {
      const oldFile = path.join(dir, `${v.cand}-${c.name}-old.json`);
      fs.writeFileSync(oldFile, JSON.stringify(c.old));
      const files = c.cands.map((cand, i) => {
        const f = path.join(dir, `${v.cand}-${c.name}-cand-${i}.json`);
        fs.writeFileSync(f, JSON.stringify(cand));
        return fwd(f);
      });
      const env = { [v.old]: fwd(oldFile), [v.cand]: files[0], EXTRA: files[1] || '' };
      const r = runFence(files.length > 1 ? `${line} "$EXTRA"` : line, env);
      assert.strictEqual(r.status, 0, `${name} ${c.name}: ${r.stderr}`);
      assert.deepStrictEqual(JSON.parse(r.stdout), c.want, `${name} ${c.name}`);
    }
    const absent = fwd(path.join(dir, 'absent.json'));
    const r = runFence(line, { [v.old]: absent, [v.cand]: absent });
    assert.notStrictEqual(r.status, 0, `${name}: an unreadable pair exits non-zero rather than printing a verdict`);
  }
});

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
  assert.ok(SWEEP.includes('"${CLAUDE_PLUGIN_ROOT}" "$CARRY_OLD" "$CARRY_NEW" "{count}" "$CARRY_DIR"'));
});

test('a stalled move needs an open old issue, and an earlier generation reads none', () => {
  const resume = SWEEP.slice(SWEEP.indexOf('**Resume an unfinished rollover.**'), SWEEP.indexOf('No-ops silently'));
  assert.ok(resume.includes('while the old issue is still open'));
  assert.ok(resume.includes('an earlier generation'));
  assert.ok(resume.includes('a replacement keeps its marker for good'));
});

test('step 1 re-lists through the trust gate: the Resume fence decides the replacement, and none means create', () => {
  const s = stepText(1);
  assert.ok(s.includes('run the **Resume an unfinished rollover** list'));
  assert.ok(s.includes('run its fence over every candidate naming `{old}`'));
  assert.ok(s.includes('Take the printed `replacement` and `extras`'));
  assert.ok(s.includes('a `none` verdict means create one'));
  assert.ok(!s.includes('the same list and filter'), 'a bare body-line filter is no trust gate');
});

test('the steps stay re-runnable from every caller: zero count, mismatch, pointer and summary comments, close', () => {
  const r = rollover();
  assert.ok(stepText(2).includes('continue with step 4 on a first pass, or with the step that re-ran them'));
  assert.ok(!stepText(2).includes('the step that called them'), 'step 2 has no caller on the first pass');
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
  assert.ok(TIDY_RECORDS.includes('A record is kept when ANY line it appears on gives that verdict'));
  assert.ok(TIDY_RECORDS.includes('Any other verdict adds no exemption and never overrides one'));
  assert.ok(TIDY_RECORDS.includes('stays `Keep` by the rule above whatever the verdict (`finished` included)'));
  assert.ok(!TIDY_RECORDS.includes('leaves both ordinary records'), 'a live labeled container is not ordinary on `finished`');
  assert.ok(TIDY_RECORDS.includes('`Keep` every issue on it for this run and name the line in the report'));
  assert.ok(TIDY_RECORDS.includes('over every issue naming `{old}` at once'));
});

test('the snapshot note names the one direct reader of {tmp-records-file}, and the floor\'s Dedup lines stay hard-wrapped', () => {
  const queueFetch = read('plugin/skills/_shared/record-queue-fetch.md').replace(/\s+/g, ' ');
  assert.ok(!queueFetch.includes('(none do today)'), 'step-1-records.md reads {tmp-records-file} directly now');
  assert.ok(queueFetch.includes("(only `tidy/step-1-records.md`'s Shape 1 digest-rollover pair listing does today"));
  const wrapped = FLOOR.split('\n').find((l) => l.includes('`OWNER`, `MEMBER`, or `COLLABORATOR` counts (`_shared/pr-run-comments.md`'));
  assert.ok(wrapped, 'the Dedup trust sentence moved');
  assert.ok(wrapped.length <= 100, `${wrapped.length} characters against the section's width`);
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

test('Expiry\'s date fence runs: a run-id, a stamped line, the comment date, and null when nothing parses', (t) => {
  const { materialityEntryLine } = require('../plugin/bin/lib/health-core/materiality-digest');
  const base = { area: 'tidy', fileRefs: 'a.js', deferReason: 'direct-filing-sweep' };
  const runId = materialityEntryLine({ ...base, finding: 'one', provenance: '2026-08-24T183516-tidy-standalone' });
  const skill = materialityEntryLine({ ...base, finding: 'two', provenance: 'harness-health' });
  const stamped = `${materialityEntryLine({ ...base, finding: 'three', provenance: 'harness-health' })} <!-- materiality-first-seen: 2026-02-02T00:00:00Z -->`;
  const mcpSkill = materialityEntryLine({ ...base, finding: 'four', provenance: 'harness-health' });
  const comments = [
    { url: 'https://example.test/c#issuecomment-1', createdAt: '2026-11-01T00:00:00Z', body: `a note\n${runId}\n${skill}\n${stamped}` },
    { url: 'https://example.test/c#issuecomment-2', body: skill },
    // MCP spells the comment date created_at; an unstamped skill-provenance line takes it
    { html_url: 'https://example.test/c#issuecomment-3', created_at: '2026-10-01T00:00:00Z', body: mcpSkill },
  ];
  const dir = scratch(t);
  fs.writeFileSync(resolvedPath(dir, 'digest-expiry-comments.json'), JSON.stringify(comments));
  const block = blockHolding(SWEEP, 'node -e "const fs=require(\'fs\');const {materialityEntryDate}', 'Expiry');
  assert.ok(block.startsWith('EXPIRY_COMMENTS="$(node'), 'the fence sets its own variable');
  assert.ok(!('EXPIRY_COMMENTS' in process.env));
  const r = runFence(block, sessionEnv(dir));
  assert.strictEqual(r.status, 0, r.stderr);
  const rows = r.stdout.trim().split('\n').map((l) => l.split('\t'));
  assert.deepStrictEqual(rows.map((x) => x[0]), ['2026-08-24T18:35:16.000Z', '2026-11-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z', 'null', '2026-10-01T00:00:00.000Z']);
  assert.deepStrictEqual(rows.map((x) => x[2]), [runId, skill, stamped, skill, mcpSkill]);
  assert.ok(rows[3][1].endsWith('issuecomment-2'));
  assert.ok(rows[4][1].endsWith('issuecomment-3'));
});
