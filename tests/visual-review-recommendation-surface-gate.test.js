'use strict';
// #2927: visual-review recommendation mode (SKILL.md Step 0.5) counts a journey
// as affected only when the run carries a frontend-surface signal, not on a
// files: overlap alone — #2769's review recommended a browser walk of a journey
// whose only overlapping file was a CLI-only module.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILL = readText(path.join(__dirname, '../plugin/skills/visual-review/SKILL.md'));
const SUMMARY = readText(path.join(__dirname, '../plugin/skills/review/review-summary-template.md'));
const MATERIALIZE = readText(path.join(__dirname, '../plugin/skills/flow/materialize.md'));

function step05() {
  const from = SKILL.indexOf('## Step 0.5: Mode — `recommendation`');
  assert.ok(from >= 0, 'SKILL.md must keep its Step 0.5 recommendation-mode heading');
  const to = SKILL.indexOf('\n## Step 1:', from);
  assert.ok(to > from, 'Step 0.5 must end at the "## Step 1:" heading');
  return SKILL.slice(from, to);
}

function noSurfaceParagraph() {
  const s = step05();
  const from = s.indexOf('If journeys overlap but step 3 found no frontend-surface signal');
  assert.ok(from >= 0, 'Step 0.5 must keep its no-surface paragraph');
  const to = s.indexOf('\n\n', from);
  assert.ok(to > from, 'the no-surface paragraph must end at a blank line');
  return s.slice(from, to);
}

test('AC1.1: a files: overlap alone no longer makes a journey affected', () => {
  const s = step05();
  assert.doesNotMatch(s, /A journey is \*\*affected\*\* when at least one of its `files:` entries appears/);
  assert.match(s, /A journey \*\*overlaps\*\* the diff when at least one of its `files:` entries appears/);
  assert.match(s, /an overlapping journey is \*\*affected\*\* only when this run carries a frontend-surface signal/);
});

test('AC1.1: the gate cites frontend-detection.md Layer 2 then Layer 3', () => {
  const s = step05();
  assert.match(s, /`design-wrapper\/frontend-detection\.md`'s Layer 2 → Layer 3 order/);
  assert.match(s, /`web`, `mobile`, or `desktop` is a signal/);
  assert.match(s, /any other declared value \(`backend`, `infra`, `terminal`\) is not, and Layer 3 does not run/);
});

test('AC1.1: no surface signal returns the suppressed-journeys line, never the follow-up', () => {
  const s = step05();
  assert.match(s, /If journeys overlap but step 3 found no frontend-surface signal, return this line instead of the table and the `Recommended follow-up` line/);
  assert.match(s, /No frontend surface in this run \(\{Surface: \{value\} \| no UI trigger file in the diff\}\) — visual review not recommended\. Journeys whose files: overlap the diff: \{journey-name\}, \{journey-name\}\./);
  assert.doesNotMatch(noSurfaceParagraph(), /Recommended follow-up:/);
});

test('AC1.1: the suppressed line maps to an existing review summary status', () => {
  const s = step05();
  assert.match(s, /The parent's summary records it as `Skipped — no UI changes`/);
  assert.match(SUMMARY, /\| Skipped — no UI changes \|/);
});

test('AC2.1: a run with a surface signal still renders the table and follow-up line', () => {
  const s = step05();
  assert.match(s, /\| Journey \| Severity \| Changed files in journey \|/);
  assert.match(s, /> Recommended follow-up: `\/claude-tweaks:visual-review journey:\{top-severity-journey-name\}`/);
  assert.match(s, /If no journeys overlap, return: `No documented journeys affected by the diff\. Visual review not recommended\.`/);
});

test('Layer 2 reads the materialized header from the checkout under review', () => {
  const s = step05();
  assert.match(s, /`work\/\{n\}-spec\.md` at `\$PIPELINE_RUN_DIR`'s path in the checkout under review/);
  assert.match(s, /`_shared\/pipeline-run-dir\.md`'s Anchoring section keeps `work\/` out of `\$RUN_ROOT`/);
});

test('Layer 3 runs standalone or when the header has no surface: field', () => {
  const s = step05();
  assert.match(s, /when no header resolves \(a standalone run\) or it carries no `surface:`, the signal is a UI trigger file among step 1's changed files/);
});

test('Layer 1, the design-integration flag, does not gate a recommendation', () => {
  assert.match(step05(), /Layer 1, the design-integration flag, does not apply/);
});

test('the surface gate sits after the journey match and before the recommendation is returned', () => {
  const s = step05();
  const match = s.indexOf('2. **Cross-reference with journeys**');
  const gate = s.indexOf('3. **Require a frontend surface**');
  const score = s.indexOf('4. **Score severity**');
  const ret = s.indexOf('5. **Return structured recommendation:**');
  const ctl = s.indexOf('6. **Return control**');
  assert.ok(match >= 0 && gate > match && score > gate && ret > score && ctl > ret,
    `expected steps 2-6 in order, got ${[match, gate, score, ret, ctl].join(', ')}`);
});

test('a declared web/mobile/desktop surface is enough without a Layer 3 match', () => {
  assert.match(step05(), /is a signal on its own — unlike the design wrapper's precedence, the Layer 3 sniff need not also match, because a web record's backend change can still break a page/);
});

test('the review summary carries the suppressed reason and journey names', () => {
  assert.match(noSurfaceParagraph(), /records it as `Skipped — no UI changes`, with the reason and the journey names/);
  assert.match(SUMMARY, /\{If skipped because `\/claude-tweaks:visual-review` found no frontend surface: its reason \(`Surface: \{value\}` or no UI trigger file in the diff\) and the journeys whose `files:` overlapped the diff, copied from its suppressed line\}/);
});

test('materialize.md names visual-review Step 0.5 as a surface reader', () => {
  const row = MATERIALIZE.split('\n').find((l) => l.startsWith('| `surface` |'));
  assert.ok(row, 'materialize.md must keep its `surface` reader-table row');
  assert.match(row, /`\/claude-tweaks:visual-review` Step 0\.5's recommendation-mode surface gate/);
});
