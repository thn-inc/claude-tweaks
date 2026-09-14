// tests/specify-premise-verification-prose.test.js
//
// Pins record #1769's prose wiring: record-creation-subissues.md must run
// _shared/premise-verification.md's check once per sub-issue, positioned
// before the Ceremony call; shaping-mode.md's existing human-filed-defect
// sanity check must cite the same shared file rather than restating the
// rule; spec-template.md must show the `ASSUMPTION — verify at build`
// marker's shape under both `## Gotchas` and its "No Placeholders"
// self-check; and build/SKILL.md's writing-plans handoff must name the
// marker and instruct re-verifying it against the worktree.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SUBISSUES = read('plugin/skills/specify/record-creation-subissues.md');
const SHAPING_MODE = read('plugin/skills/specify/shaping-mode.md');
const SPEC_TEMPLATE = read('plugin/skills/specify/spec-template.md');
const BUILD_SKILL = read('plugin/skills/build/SKILL.md');
const PREMISE_VERIFICATION = read('plugin/skills/_shared/premise-verification.md');

const MARKER = 'ASSUMPTION — verify at build';

test('premise-verification.md exists and states the probe forms, caps, and marker', () => {
  assert.match(PREMISE_VERIFICATION, /git ls-files/);
  assert.match(PREMISE_VERIFICATION, /git grep -n -F/);
  assert.match(PREMISE_VERIFICATION, /2 probes per claim/);
  assert.match(PREMISE_VERIFICATION, /12 probes per sub-issue/);
  assert.ok(PREMISE_VERIFICATION.includes(MARKER), 'must document the literal marker string');
});

test('docs/skill-graph.md has a row for _shared/premise-verification.md', () => {
  const graph = read('docs/skill-graph.md');
  assert.match(graph, /`_shared\/premise-verification\.md`/);
});

test('record-creation-subissues.md invokes the premise-verification check once per sub-issue, after Body composition and before Ceremony', () => {
  assert.match(SUBISSUES, /_shared\/premise-verification\.md/);
  const premiseIdx = SUBISSUES.indexOf('Premise verification');
  const ceremonyIdx = SUBISSUES.indexOf('**Ceremony**');
  assert.ok(premiseIdx !== -1, 'the premise-verification step must be documented');
  assert.ok(ceremonyIdx !== -1, 'the Ceremony step must still exist');
  assert.ok(premiseIdx < ceremonyIdx, 'premise verification must run before the Ceremony call');
});

test('record-creation-subissues.md says a contradicted claim is rewritten before filing', () => {
  const section = SUBISSUES.slice(SUBISSUES.indexOf('Premise verification'), SUBISSUES.indexOf('**Ceremony**'));
  assert.match(section, /rewritten/);
  assert.ok(section.includes(MARKER), 'the sub-issue loop must name the ASSUMPTION marker');
});

test('shaping-mode.md\'s sanity-check paragraph cites the shared file instead of restating the rule', () => {
  assert.match(SHAPING_MODE, /_shared\/premise-verification\.md/);
  // The defect-report-specific framing must survive the edit.
  assert.match(SHAPING_MODE, /human-filed defect report/);
});

test('spec-template.md shows the marker\'s shape under Gotchas and lists the missing-evidence-or-marker case under No Placeholders', () => {
  const gotchasIdx = SPEC_TEMPLATE.indexOf('## Gotchas');
  const decisionRationaleIdx = SPEC_TEMPLATE.indexOf('## Decision Rationale');
  assert.ok(gotchasIdx !== -1 && decisionRationaleIdx !== -1 && gotchasIdx < decisionRationaleIdx);
  const gotchasSection = SPEC_TEMPLATE.slice(gotchasIdx, decisionRationaleIdx);
  assert.ok(gotchasSection.includes(MARKER), 'Gotchas section must show the marker shape');

  const noPlaceholdersIdx = SPEC_TEMPLATE.indexOf('## No Placeholders');
  const deleteTombstoneIdx = SPEC_TEMPLATE.indexOf('## Delete + Tombstone');
  assert.ok(noPlaceholdersIdx !== -1 && deleteTombstoneIdx !== -1 && noPlaceholdersIdx < deleteTombstoneIdx);
  const noPlaceholdersSection = SPEC_TEMPLATE.slice(noPlaceholdersIdx, deleteTombstoneIdx);
  assert.ok(noPlaceholdersSection.includes(MARKER), 'No Placeholders self-check must name the marker');
  assert.match(noPlaceholdersSection, /neither an evidence citation nor/);
});

test('spec-template.md\'s Current State section requires a citation or the marker on every existing-code claim', () => {
  const currentStateIdx = SPEC_TEMPLATE.indexOf('## Current State');
  const deliverablesIdx = SPEC_TEMPLATE.indexOf('## Deliverables');
  assert.ok(currentStateIdx !== -1 && deliverablesIdx !== -1 && currentStateIdx < deliverablesIdx);
  const section = SPEC_TEMPLATE.slice(currentStateIdx, deliverablesIdx);
  assert.match(section, /_shared\/premise-verification\.md/);
  assert.ok(section.includes(MARKER));
});

test('build/SKILL.md\'s writing-plans handoff names the marker and verifies it before invocation', () => {
  const stepIdx = BUILD_SKILL.indexOf('### Spec Step 3: Create the Plan');
  assert.ok(stepIdx !== -1, 'Spec Step 3 must still exist');
  const nextStepIdx = BUILD_SKILL.indexOf('\n### ', stepIdx + 1);
  const section = BUILD_SKILL.slice(stepIdx, nextStepIdx === -1 ? undefined : nextStepIdx);
  assert.ok(section.includes(MARKER), 'writing-plans handoff must name the ASSUMPTION marker');
  assert.match(section, /_shared\/premise-verification\.md/);
  assert.match(section, /before invoking `\/superpowers:writing-plans`/);
  assert.match(section, /decisions\.md/);

  const invokeIdx = section.indexOf('Invoke the `/superpowers:writing-plans` skill');
  const assumptionIdx = section.indexOf('Assumption verification');
  assert.ok(assumptionIdx !== -1 && invokeIdx !== -1 && assumptionIdx < invokeIdx,
    'assumption verification must run before the writing-plans invocation');
});
