'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #679: session-evaluation watermark — pins the prose/doc deliverables that
// ship no runtime code of their own (plugin/bin/lib/transcript-judge/
// watermark.js already has its own unit tests in tests/bin-lib/
// transcript-judge/watermark.test.js — not duplicated here).
//
// #856 moved the transcript-resolution/dispatch/degradation/watermark
// mechanics out of session-evaluation.md into plugin/skills/_shared/
// transcript-judge.md (pinned by tests/transcript-judge-prose.test.js).
// This file keeps only feedback-specific prose: the --full flag surface
// and the gitignore suggestion for the (now per-consumer) watermark cache.
//
// Read live, not frozen fixtures: this is just-shipped feature prose that is
// expected to keep evolving in place (more flags, more prompt items) rather
// than content a future migration is scheduled to delete — the same posture
// tests/pr-first-merge.test.js takes for its own recently-landed sections.
// See skill-prose-conformance-tests's Decision Framework: the
// registry-restates-code carve-out ([IL-80]) doesn't apply here either —
// none of this is a table mirroring a code structure.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const SESSION_EVAL = read('plugin', 'skills', 'feedback', 'session-evaluation.md');
const SKILL = read('plugin', 'skills', 'feedback', 'SKILL.md');
// #2697 moved Step 0's Gather 2 paragraph verbatim into bare-invocation.md.
const BARE_INVOCATION = read('plugin', 'skills', 'feedback', 'bare-invocation.md');
const GITIGNORE = read('.gitignore');
const STEP04 = read('plugin', 'skills', 'init', 'bootstrap', 'step-04-gitignore-suggestions.md');
const PLUGIN_STRUCTURE = read('docs', 'plugin-structure.md');

// step-04's fenced ```gitignore suggestion block. Both gitignore tests below
// need it, and both need the same "the block exists and is closed" guard —
// asserting that here keeps the guard from drifting between them.
function gitignoreSuggestionBlock() {
  const fenceStart = STEP04.indexOf('```gitignore');
  assert.ok(fenceStart >= 0, 'fenced gitignore block must exist');
  const fenceEnd = STEP04.indexOf('```', fenceStart + 3);
  assert.ok(fenceEnd > fenceStart, 'fenced gitignore block must be closed');
  return STEP04.slice(fenceStart, fenceEnd);
}

// --- 1. session-evaluation.md cites the shared transcript-judge contract, doesn't restate it ---

test('session-evaluation.md cites _shared/transcript-judge.md for the moved dispatch mechanics', () => {
  assert.match(SESSION_EVAL, /_shared\/transcript-judge\.md/);
});

test('session-evaluation.md no longer restates transcript resolution mechanics (moved, not duplicated)', () => {
  assert.doesNotMatch(SESSION_EVAL, /derived from the session's absolute working-directory path/);
});

test('session-evaluation.md documents its four consumer parameters (rubric, template, profile, watermark key)', () => {
  assert.match(SESSION_EVAL, /\*\*Rubric\*\*/);
  assert.match(SESSION_EVAL, /\*\*Output template\*\*/);
  assert.match(SESSION_EVAL, /\*\*Model profile\*\*/);
  assert.match(SESSION_EVAL, /\*\*Watermark consumer key\*\*.*`feedback`/);
});

// --- 2. session-evaluation.md: feedback's own watermark payload shape survives the migration ---

test('session-evaluation.md still documents the filedRecords/dismissedSubjects watermark payload', () => {
  assert.match(SESSION_EVAL, /filedRecords,\s*\/\/ the record numbers this run actually filed/);
  assert.match(
    SESSION_EVAL,
    /dismissedSubjects,\s*\/\/ bin\/lib\/declined-learning\/store\.js's listDeclined\(\{ source: 'feedback' \}\)/,
  );
  assert.match(
    SESSION_EVAL,
    /Filtered to source: 'feedback' so a reflect-sourced decline\s*\/\/ never suppresses a feedback finding/,
  );
});

// #1033: dismissedSubjects must be documented as a LIVE read at offset-clause composition time,
// never sourced from the previously written watermark object (the fix for the one-run lag).
test('session-evaluation.md documents dismissedSubjects is computed live, never read off a written watermark', () => {
  assert.match(SESSION_EVAL, /\*\*`dismissedSubjects` is computed live, immediately before composing/);
  assert.match(SESSION_EVAL, /never read off a previously\s*\nwritten watermark/);
});

// --- 2b. #701: skip-before-dispatch check + the sessionId/findingsFiled/issueUrls payload fields ---

test('session-evaluation.md documents the #701 Skip check section', () => {
  assert.match(SESSION_EVAL, /## Skip check \(before dispatch\) — #701/);
  assert.match(SESSION_EVAL, /isTranscriptUnchanged\(watermark, currentBytes\)/);
});

// #1119: the Skip check's mechanic (including the self-assessment exemption)
// moved to _shared/transcript-judge.md — session-evaluation.md now cites it
// rather than restating the exemption paragraph.
test('session-evaluation.md cites the shared self-assessment exemption instead of restating it', () => {
  assert.match(SESSION_EVAL, /Self-assessment\s*\nis exempted from the shared procedure's own check/);
  assert.doesNotMatch(SESSION_EVAL, /Self-assessment is exempted, explicitly \(not an oversight\)/);
});

test('session-evaluation.md watermark payload documents sessionId/findingsFiled/issueUrls', () => {
  assert.match(SESSION_EVAL, /sessionId,\s*\/\/ \$CLAUDE_CODE_SESSION_ID at dispatch time/);
  assert.match(SESSION_EVAL, /findingsFiled,\s*\/\/ count of Gather-2-sourced findings/);
  assert.match(SESSION_EVAL, /issueUrls,\s*\/\/ the URLs Step 8's `gh issue create` calls produced/);
});

test('bare-invocation.md Gather 2 paragraph points to the Skip check before describing dispatch', () => {
  assert.match(BARE_INVOCATION, /its \*\*Skip check\*\* runs first/);
});

// --- 3. SKILL.md: --full at all three sites (table row, argument-hint frontmatter, $ARGUMENTS intro line) ---

test('SKILL.md frontmatter argument-hint includes --full', () => {
  assert.match(
    SKILL,
    /^argument-hint: "\[<learning text>\] \[--kind=defect\|gap\] \[--upstream <owner\/name>\] \[--dry-run\] \[--queue\] \[--full\] \[--pre-confirmed\]"$/m,
  );
});

test('SKILL.md "$ARGUMENTS is parsed as" intro line includes --full', () => {
  assert.match(
    SKILL,
    /`\$ARGUMENTS` is parsed as `\[<learning text>\] \[--kind=<value>\] \[--upstream <owner\/name>\] \[--dry-run\] \[--queue\] \[--full\] \[--pre-confirmed\]`:/,
  );
});

test('SKILL.md Input table has a --full row', () => {
  assert.match(
    SKILL,
    /\| `--full` \| Presence-only, meaningful only for bare\/`--queue` invocation \(Step 0's session-evaluation gather\): ignore any existing watermark/,
  );
});

// session-evaluation.md's Skip check cites "SKILL.md's Input table" as the
// authority for --full bypassing it; pin that the table actually says so, so
// the citation can't point at text that never makes the claim.
test('SKILL.md --full row states it bypasses the Skip check', () => {
  assert.match(SKILL, /bypasses `session-evaluation\.md`'s Skip check/);
  assert.match(SESSION_EVAL, /`--full` bypasses this check entirely \(SKILL\.md's Input\s+table\)/);
});

// A prior agent caught and fixed a gap where the Input table had --full but
// the frontmatter/intro line did not: pin all three sites together, not just
// independently, so a future edit that touches only the table (or only the
// frontmatter) can't silently reintroduce that class of partial drift.
test('SKILL.md: --full is present at all three sites together (frontmatter, intro line, table)', () => {
  const sites = {
    'argument-hint frontmatter': /argument-hint: ".*\[--full\].*"/,
    '$ARGUMENTS intro line': /\$ARGUMENTS` is parsed as `.*\[--full\].*`:/,
    'Input table row': /\| `--full` \|/,
  };
  const missing = Object.entries(sites)
    .filter(([, re]) => !re.test(SKILL))
    .map(([name]) => name);
  assert.deepStrictEqual(missing, [], `--full missing at: ${missing.join(', ')}`);
});

// --- 4. .gitignore keeps its feedback-specific blanket line; step-04's suggestion is generalized ---

test('.gitignore contains the literal line .claude-tweaks/feedback/', () => {
  assert.match(GITIGNORE, /^\.claude-tweaks\/feedback\/$/m);
});

test("step-04-gitignore-suggestions.md's fenced suggestion block contains the generalized per-consumer watermark line", () => {
  assert.match(gitignoreSuggestionBlock(), /^\.claude-tweaks\/\*\/watermarks\/\*\.json$/m);
});

// #1561: this repo's own root .gitignore has ignored the wrap-up outcome
// telemetry file since before this template line existed — a consumer
// project seeded from an out-of-date template never got it, so `close-run`/
// wrap-up telemetry can end up tracked and, under `worktree-always`,
// permanently uncommittable. Pin both the template line itself and its
// presence in the .gitignore/step-04 parity this file already checks above.
test("step-04-gitignore-suggestions.md's fenced suggestion block contains the wrap-up-outcomes.tsv line (#1561)", () => {
  assert.match(gitignoreSuggestionBlock(), /^\.claude-tweaks\/wrap-up-outcomes\.tsv$/m);
});

test('.gitignore contains the literal line .claude-tweaks/wrap-up-outcomes.tsv', () => {
  assert.match(GITIGNORE, /^\.claude-tweaks\/wrap-up-outcomes\.tsv$/m);
});

// #856 deliberately makes these two lines diverge: root .gitignore keeps the
// feedback-specific blanket line (existing on-disk state, unmigrated), while
// step-04's suggestion for *new* projects is generalized to cover every
// consumer's watermark cache. The pre-#856 byte-identical assumption no
// longer holds — this test pins the divergence itself, not a coincidence.
test('.gitignore and step-04 intentionally diverge post-#856 (feedback-specific vs generalized)', () => {
  const gitignoreLine = GITIGNORE.split('\n').find((l) => l.includes('.claude-tweaks/feedback'));
  const stepLine = gitignoreSuggestionBlock().split('\n').find((l) => l.includes('watermarks'));
  assert.strictEqual(gitignoreLine, '.claude-tweaks/feedback/');
  assert.strictEqual(stepLine, '.claude-tweaks/*/watermarks/*.json');
  assert.notStrictEqual(gitignoreLine, stepLine);
});

// --- 5. docs/plugin-structure.md: bin/lib/transcript-judge/ family line names the module ---

test('docs/plugin-structure.md: a bin/lib/transcript-judge/ family line names watermark.js', () => {
  const match = PLUGIN_STRUCTURE.match(/^plugin\/bin\/lib\/transcript-judge\/\s+→.*$/m);
  assert.ok(match, 'plugin/bin/lib/transcript-judge/ family line must exist');
  assert.match(match[0], /watermark\.js/, 'family line must mention watermark.js');
});

test('docs/plugin-structure.md: no stale bin/lib/feedback/ watermark.js reference remains', () => {
  assert.doesNotMatch(PLUGIN_STRUCTURE, /bin\/lib\/feedback\/watermark\.js/);
});

// --- 6. #1033: SKILL.md Step 4 Prior-decline annotation (the reachable half of the fix —
// lookupDecline wired into feedback's own dedup step, not just the judge-dispatch offset clause) ---

const UPSTREAM_FEEDBACK_BATCH = read('plugin', 'skills', '_shared', 'upstream-feedback-batch.md');

test('SKILL.md Step 4 documents the Prior-decline annotation computing a fingerprint and calling lookupDecline', () => {
  assert.match(SKILL, /\*\*Prior-decline annotation \(#1033\)\.\*\*/);
  assert.match(SKILL, /look it up via `bin\/lib\/declined-learning\/store\.js`'s `lookupDecline\(fingerprint\)`/);
});

test('SKILL.md Step 4 carries priorDecline: { declinedAt, reason } on the drafted item for rendering', () => {
  assert.match(SKILL, /carry `priorDecline:\s*\{ declinedAt, reason \}` on the drafted item/);
});

test('upstream-feedback-batch.md renders the priorDecline annotation on the drafted item', () => {
  assert.match(UPSTREAM_FEEDBACK_BATCH, /\*\*Prior-decline annotation \(#1033\)\.\*\*/);
  assert.match(UPSTREAM_FEEDBACK_BATCH, /_\(previously declined \{declinedAt date\}: \{reason\}\)_/);
});

test('upstream-feedback-batch.md chunking step also surfaces priorDecline in the AskUserQuestion option description', () => {
  assert.match(
    UPSTREAM_FEEDBACK_BATCH,
    /\*\*previously\s*\ndeclined:\*\* \{declinedAt date\}: \{reason\}` on its own line within the same description/,
  );
});

test('upstream-feedback-batch.md passes subject through on decline (fingerprintBasis.summary)', () => {
  assert.match(
    UPSTREAM_FEEDBACK_BATCH,
    /recordDecline\(fingerprint, \{ reason, source: 'feedback',\s*\nsubject: draft\.fingerprintBasis\.summary \}\)/,
  );
});
