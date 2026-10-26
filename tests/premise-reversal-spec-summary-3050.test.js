// tests/premise-reversal-spec-summary-3050.test.js
//
// Pins the prose #3050 added so a pr-first PR's `### Spec summary` is
// re-composed after a build premise reversal:
// - build/SKILL.md names the canonical `premise reversed:` decisions.md line
//   for both an ASSUMPTION probe's reversed outcome and a Spec Step 3 plan
//   departure;
// - _shared/pr-checklist-refresh.md defines that line (its single home) and
//   runs bin/revise-pr-summary.js in the Phase-checklist update, with the
//   trigger, the `Revised during build:` note, the idempotency rule and the
//   best-effort posture;
// - _shared/pr-early-run-lifecycle.md says the template's Spec summary is not
//   frozen at run start.
// The literals are also pinned equal to pr-body.js's exported constants, so
// prose and parser cannot drift apart. Matching is whitespace-normalized
// ([IL-80]: this reads live prose because the wording asserted IS the
// contract).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { PREMISE_REVERSED_MARKER, REVISION_PREFIX } = require('../plugin/bin/lib/flow/pr-body');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const norm = (s) => s.replace(/\s+/g, ' ');
const BUILD = norm(read('plugin', 'skills', 'build', 'SKILL.md'));
const REFRESH = norm(read('plugin', 'skills', '_shared', 'pr-checklist-refresh.md'));
const LIFECYCLE = norm(read('plugin', 'skills', '_shared', 'pr-early-run-lifecycle.md'));

function section(text, start, end) {
  const s = text.split(start)[1];
  assert.ok(s, `section "${start}" must exist`);
  if (!end) return s;
  assert.ok(s.includes(end), `section "${start}" must be closed by "${end}"`);
  return s.split(end)[0];
}

// Go-red evidence: the bytes #3050 replaced, frozen from its merge base
// (2e10d142f). Every pin below must fail on these, so a pin that would pass
// with the change reverted is caught here rather than trusted.
const PRE_BUILD = norm('**Verify `ASSUMPTION — verify at build:` markers first (#1769).** Before invoking `/superpowers:writing-plans`, probe every `## Gotchas` bullet carrying that literal prefix (`_shared/premise-verification.md`) against this worktree — the same claim decomposition/shaping could not settle at spec time now has a real checkout to check. Log each outcome as one `decisions.md` line per `_shared/auto-decision-log.md` (`confirmed` or `reversed`, naming the probe). A reversed assumption is folded into the context handed to `/superpowers:writing-plans` as the corrected fact — never silently dropped, and never left for the plan to build on the original, now-disproven claim.');
const PRE_REFRESH = norm('Flip that phase\'s checklist row from `- [ ] {phase}` to `- [x] {phase}` inside whichever span was found, leaving everything else — including the *other* delimiter pair, which this read may not even show — untouched, then write back through the same transport that did the read, to `/tmp/pr-checklist-{run-id}-{n}.md` — scoped by `{run-id}`, same reason as `_shared/pr-early-run-lifecycle.md`\'s Step 3 path. Re-read that file\'s first line back before `gh pr edit` and confirm it still names this run\'s `{run-id}`; hard-stop this update on a mismatch rather than push a wrong body:');

test('the pins go red on the pre-#3050 text (frozen excerpts)', () => {
  const marker = /`premise reversed: \{original claim\} → \{implemented behavior\}`/;
  assert.match(BUILD, marker);
  assert.doesNotMatch(PRE_BUILD, marker);
  assert.doesNotMatch(PRE_BUILD, /Spec Step 3 plan that departs from a spec premise/);
  for (const pin of [/bin\/revise-pr-summary\.js/, /`Revised during build: \{original claim\} → \{implemented behavior\}`/, /byte-unchanged/, /never a phase-exit or merge blocker/]) {
    assert.match(REFRESH, pin);
    assert.doesNotMatch(PRE_REFRESH, pin);
  }
});

test('build/SKILL.md names the marker for an ASSUMPTION reversal and a Spec Step 3 departure', () => {
  const para = section(BUILD, '**Verify `ASSUMPTION — verify at build:` markers first (#1769).**', 'The plan will be written to');
  assert.match(para, /`premise reversed: \{original claim\} → \{implemented behavior\}`/);
  assert.match(para, /_shared\/pr-checklist-refresh\.md/);
  assert.match(para, /Spec Step 3 plan that departs from a spec premise/);
});

test('pr-checklist-refresh.md defines the one premise-reversal entry shape and its reader', () => {
  const para = section(REFRESH, '**Premise-reversal decisions (#3050).**', '## Pre-merge title/description refresh');
  assert.match(para, /`premise reversed: \{original claim\} → \{implemented behavior\}`/);
  assert.match(para, /bin\/log-decision\.js/);
  assert.match(para, /spec-\{id\}\/decisions\.md/);
  assert.match(para, /parsePremiseReversals/);
});

test('the Phase-checklist update runs the Spec-summary refresh with trigger, note, idempotency and posture', () => {
  const update = section(REFRESH, '## Phase-checklist update (every phase exit)', '## Pre-merge title/description refresh');
  const step = section(update, '**Refresh the Spec summary after a premise reversal (#3050).**', 'Compose-then-write-once');
  assert.match(step, /bin\/revise-pr-summary\.js/);
  assert.match(step, /`premise reversed:`/);
  assert.match(step, /`Revised during build: \{original claim\} → \{implemented behavior\}`/);
  assert.match(step, /byte-unchanged/);
  assert.match(step, /already noted/);
  assert.match(step, /`### Spec summary` heading/);
  assert.match(step, /never a phase-exit or merge blocker/);
  assert.match(step, /nothing it does not show/);
  assert.match(step, /`uncovered`/);
  assert.match(step, /`reason`/);
  assert.match(step, /--summary-file/);
  assert.match(step, /bin\/pr-checklist\.js/);
});

test('the Refresh paragraph precedes the MCP write it feeds (M1)', () => {
  const update = section(REFRESH, '## Phase-checklist update (every phase exit)', '## Pre-merge title/description refresh');
  const refreshIdx = update.indexOf('**Refresh the Spec summary after a premise reversal (#3050).**');
  const writeIdx = update.indexOf('mcp__github__update_pull_request');
  assert.ok(refreshIdx !== -1, 'Refresh paragraph must exist');
  assert.ok(writeIdx !== -1, 'MCP write must exist');
  assert.ok(refreshIdx < writeIdx, `Refresh paragraph (${refreshIdx}) must precede the MCP write (${writeIdx})`);
});

test('the pre-merge refresh step 1 still re-runs the whole update, Spec summary included', () => {
  const pre = section(REFRESH, '## Pre-merge title/description refresh', '## Merge-time gh-absent degrade');
  assert.match(pre, /Re-run the Phase-checklist update procedure above once more, unconditionally/);
  assert.match(pre, /its Spec-summary refresh included/);
});

test('pr-early-run-lifecycle.md says the Spec summary is rewritten after a reversal', () => {
  const step3 = section(LIFECYCLE, '### Step 3: Compose the body and create the draft PR', '### Step 4: Record the PR');
  assert.match(step3, /`### Spec summary` paragraph is not frozen here/);
  assert.match(step3, /_shared\/pr-checklist-refresh\.md/);
  assert.match(step3, /`Revised during build:`/);
});

test('prose literals equal pr-body.js\'s exported constants', () => {
  assert.equal(PREMISE_REVERSED_MARKER, 'premise reversed:');
  assert.equal(REVISION_PREFIX, 'Revised during build:');
  assert.ok(REFRESH.includes(`\`${PREMISE_REVERSED_MARKER} {original claim} → {implemented behavior}\``));
  assert.ok(REFRESH.includes(`\`${REVISION_PREFIX} {original claim} → {implemented behavior}\``));
  assert.ok(BUILD.includes(`\`${PREMISE_REVERSED_MARKER} {original claim} → {implemented behavior}\``));
});
