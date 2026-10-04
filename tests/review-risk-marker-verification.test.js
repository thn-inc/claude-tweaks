// tests/review-risk-marker-verification.test.js — #362: pins the Risk-Marker Verification
// sub-check added to /claude-tweaks:review Step 1 (Spec Compliance Check) — a spec's own
// self-flagged risk (a Gotchas bullet not marked "validated", a red-team inline
// `<!-- ambiguity: -->` marker, or an `## Open Questions` row) must be independently verified
// against the artifact's real external validator/schema/tool, not merely read as informational
// prose, and an unresolved one after that check routes the Gate to BLOCKED — the same tier as
// "Significant gaps". Also pins spec-template.md's cross-reference from the spec-authoring side.
//
// Frozen pre-change excerpts (the text `code-mode-steps.md` and `spec-template.md` carried
// immediately before #362's commits 61ea1f3f6 / fdeb5fd0d) prove each pattern can go red
// [IL-105] — a Step 1 / Empirical Premise-Check rewrite that drops the binding language fails
// this suite instead of silently shipping a mention-only version of the rule.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const read = (...p) => fs.readFileSync(path.join(SKILLS, ...p), 'utf8');

const REVIEW_STEPS = read('review', 'code-mode-steps.md');
// Empirical Premise-Check Deliverables moved to empirical-premise-check-deliverables.md
// (#2841's split) — concatenate so pins against moved text still resolve.
const SPEC_TEMPLATE = read('specify', 'spec-template.md') + '\n' + read('specify', 'empirical-premise-check-deliverables.md');

// Pre-#362 Step 1 (Spec Compliance Check) — no Risk-Marker Verification sub-check, no BLOCKED
// row for an unresolved marker. Frozen bytes, not a live read — see header comment.
const PRE_CHANGE_STEP_1 = `## Step 1: Spec Compliance Check (spec-based only)

Skip this step entirely under \`ceremony-profile: fast-lane\` (see "Ceremony-Aware Step Selection"
above) — proceed directly to Step 1.5.

If a spec number was provided, read the spec file and verify the implementation meets it:

> **Parallel execution:** Use parallel tool calls aggressively — all Grep/Glob/Read operations searching the codebase for each deliverable's implementation and each criterion's verifiability are independent and should run concurrently.

1. **Deliverables** — for each deliverable checkbox in the spec, search the codebase for the implementation. Mark each as \`done\`, \`partial\`, or \`missing\`.
2. **Acceptance Criteria** — for each criterion, determine whether it's verifiable from the code and tests. Mark as \`met\`, \`partially met\`, or \`not met\`.
3. **Non-Goals** — verify the implementation didn't accidentally include work scoped out by the spec's Non-Goals section.

### Gate:

| Result | Action |
|--------|--------|
| All deliverables done + all criteria met | Proceed to Step 1.5 |
| Minor gaps (1-2 partial items) | Flag gaps, proceed — they may be addressed in Implementation Hindsight |
| Significant gaps (missing deliverables or criteria) | **BLOCKED** — the spec isn't fully built yet. List what's missing so the user can resume \`/claude-tweaks:build\` |

If blocked, skip the rest of the review. Present the gap analysis so the user knows exactly what to finish.`;

// Pre-#362 Empirical Premise-Check Deliverables — no mention of Step 1's Risk-Marker
// Verification sub-check, or of Gotchas/ambiguity/Open Questions markers at all.
const PRE_CHANGE_SPEC_TEMPLATE = `## Empirical Premise-Check Deliverables

When a spec's technical approach rests on an assumption about how an external system, harness, or tool actually behaves — an undocumented payload shape, an unconfirmed API contract, an assumed invocation path — write a blocking first deliverable ("Task 0") that captures the real behavior before any other deliverable's fixtures are written. Word its scope as an enumeration, not a single check, and cover every path that reaches the feature, not just every shape the resulting payload can take:

- **Who initiates it** — a person typing the trigger directly (a slash command, a manual action), the model invoking it as part of its own reasoning, a Task-dispatched subagent invoking it on the model's behalf, and a headless/non-interactive run (\`claude -p\`, a scheduled Routine) invoking it with no one watching. These are different code paths through the harness and can diverge in whether an event fires at all, not just in what it contains.
- **Every shape the payload can take once it does fire** — qualified vs. bare identifiers, success vs. failure, nested vs. top-level invocation.

Enumerating only the second list and skipping the first is the failure mode to design against: it reads as thorough (every input shape is covered) while silently leaving out an entire initiation path that never produces an event to shape-check in the first place — a gap no fixture built from the captured shapes can catch, because the missing case never got captured. Name each initiator path explicitly in the Task 0 deliverable's own text; do not let "covers all invocation shapes" stand in for it.`;

// One claim per call: the pattern must match the shipped prose AND fail against the pre-change
// text, so a green result proves the regex can actually go red [IL-105].
function assertPinnedInStep1(pattern, message) {
  assert.match(REVIEW_STEPS, pattern, message);
  assert.doesNotMatch(PRE_CHANGE_STEP_1, pattern, `${message} (must NOT match pre-change Step 1 text — proves the pattern can go red)`);
}

function assertPinnedInSpecTemplate(pattern, message) {
  assert.match(SPEC_TEMPLATE, pattern, message);
  assert.doesNotMatch(PRE_CHANGE_SPEC_TEMPLATE, pattern, `${message} (must NOT match pre-change Empirical Premise-Check text — proves the pattern can go red)`);
}

test('Step 1 names the Risk-Marker Verification sub-check', () => {
  assertPinnedInStep1(/\*\*Risk-Marker Verification\*\*/, 'sub-check is named');
});

test('Step 1 scans for all three marker vocabularies, matching the real syntax shipped elsewhere', () => {
  assertPinnedInStep1(/unvalidated[\s\S]{0,20}assumed[\s\S]{0,20}unconfirmed/, 'Gotchas validation-status vocabulary (unvalidated/assumed/unconfirmed)');
  assertPinnedInStep1(/<!-- ambiguity: \.\.\. -->/, "red-team's inline ambiguity marker syntax");
  assertPinnedInStep1(/## Open Questions/, 'Open Questions row vocabulary');
});

test('Step 1 requires independent verification against the real artifact, not a structural check alone', () => {
  assertPinnedInStep1(
    /structural or syntax check alone[\s\S]{0,80}necessary but not sufficient/,
    'necessary-but-not-sufficient framing for structural/syntax checks',
  );
  assertPinnedInStep1(
    /independently verify it against the artifact's\s+real external validator\/schema\/tool/,
    'independent-verification-against-real-artifact instruction',
  );
});

test("Step 1's Gate table routes an unresolved risk marker to BLOCKED, same tier as Significant gaps", () => {
  assertPinnedInStep1(
    /Any risk marker `unresolved`[\s\S]{0,60}\*\*BLOCKED\*\*[\s\S]{0,40}same tier as Significant gaps/,
    'unresolved risk marker Gate row routes to BLOCKED at the Significant-gaps tier',
  );
});

test('Step 1 marks each risk marker verified or unresolved (a forced disposition, not a mention)', () => {
  assertPinnedInStep1(/Mark each as `verified` or `unresolved`/, 'forced verified/unresolved disposition per marker');
});

test("spec-template.md's Empirical Premise-Check Deliverables cross-references Step 1's Risk-Marker Verification sub-check", () => {
  assertPinnedInSpecTemplate(/Risk-Marker Verification/, 'names the Step 1 sub-check by name');
  assertPinnedInSpecTemplate(/code-mode-steps\.md/, 'cites the real current file, not a stale SKILL.md path');
  assertPinnedInSpecTemplate(/routes an\s+unresolved one to `BLOCKED`/, 'states the BLOCKED consequence from the spec-authoring side too');
});

// #606: two Deliverables-authoring guidance additions surfaced by a single flow run — a
// lever-adding record's Deliverables should cite the lever-addition checklist by reference
// rather than restating or omitting it, and a Deliverable encoding third-party CLI/API
// behavior should get a named blocking-empirical-Task-0 option instead of the shape being
// rediscovered per-record.

test("spec-template.md's Deliverables section cites the lever-addition checklist by reference for lever-adding records", () => {
  assert.match(SPEC_TEMPLATE, /Adding a new policy lever/, 'names the checklist heading');
  assert.match(SPEC_TEMPLATE, /auto-mode-contract\.md/, "cites the checklist's home file");
});

test('spec-template.md names the third-party CLI/API behavior Task 0 as a deliberate option, with its three constituent parts', () => {
  assert.match(SPEC_TEMPLATE, /third-party CLI\/API/i, 'names the third-party CLI/API behavior case');
  assert.match(SPEC_TEMPLATE, /safe probe target/i, 'names the safe-probe-target part');
  assert.match(SPEC_TEMPLATE, /mandatory teardown/i, 'names the mandatory-teardown part');
  assert.match(SPEC_TEMPLATE, /literal-capture rule/i, 'names the literal-capture-rule part');
});
