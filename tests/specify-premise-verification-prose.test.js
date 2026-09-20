// tests/specify-premise-verification-prose.test.js
//
// Pins record #1769's prose wiring: record-creation-subissues.md and
// shaping-mode.md must both cite _shared/premise-verification.md before
// composing/filing a record's Current State/Key Files content, spec-template.md
// must show the ASSUMPTION marker's shape and reject its absence, and
// build/SKILL.md's writing-plans handoff must verify every marker bullet
// against the worktree first. Sized like tests/specify-decomposition-crossref-prose.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const PREMISE_CHECK = read('plugin/skills/_shared/premise-verification.md');
const SUBISSUES = read('plugin/skills/specify/record-creation-subissues.md');
const SHAPING_MODE = read('plugin/skills/specify/shaping-mode.md');
const SPEC_TEMPLATE = read('plugin/skills/specify/spec-template.md');
const BUILD_SKILL = read('plugin/skills/build/SKILL.md');
const SKILL_GRAPH = read('docs/skill-graph.md');

const MARKER = 'ASSUMPTION — verify at build:';

test('_shared/premise-verification.md exists and states the probe forms, caps, citation form, and the marker', () => {
  assert.match(PREMISE_CHECK, /git ls-files/);
  assert.match(PREMISE_CHECK, /git grep -n -F/);
  assert.match(PREMISE_CHECK, /at most 2 probes\s+per claim, at most 12/);
  assert.match(PREMISE_CHECK, new RegExp(MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('docs/skill-graph.md has a row for _shared/premise-verification.md, owned by /specify', () => {
  const headingIdx = SKILL_GRAPH.search(/^## specify$/m);
  assert.notStrictEqual(headingIdx, -1, 'the ## specify section heading must exist');
  const specifySection = SKILL_GRAPH.slice(headingIdx, headingIdx + 4000);
  assert.match(specifySection, /_shared\/premise-verification\.md/);
});

test('record-creation-subissues.md invokes the premise-verification check once per sub-issue, after Scoring and before Ceremony', () => {
  assert.match(SUBISSUES, /_shared\/premise-verification\.md/);
  const scoringIdx = SUBISSUES.indexOf('**Scoring**');
  const premiseIdx = SUBISSUES.indexOf('Premise verification (#1769)');
  const ceremonyIdx = SUBISSUES.indexOf('**Ceremony**');
  assert.ok(scoringIdx !== -1 && premiseIdx !== -1 && ceremonyIdx !== -1, 'all three sections must exist');
  assert.ok(scoringIdx < premiseIdx, 'premise verification must run after body/scoring compose the content');
  assert.ok(premiseIdx < ceremonyIdx, 'premise verification must run before the Ceremony call');
});

test('record-creation-subissues.md says a contradicted claim is rewritten before the record is filed', () => {
  const section = SUBISSUES.slice(SUBISSUES.indexOf('Premise verification (#1769)'));
  assert.match(section, /rewritten to what the tree shows/);
  assert.match(section, /before `gh issue create` \/ `writeRecord`/);
});

test('shaping-mode.md\'s sanity-check paragraph cites the shared file instead of restating the general rule', () => {
  assert.match(SHAPING_MODE, /_shared\/premise-verification\.md/);
  // The human-filed-defect-report-specific delta must survive the edit.
  assert.match(SHAPING_MODE, /human-filed defect report names a specific affected file, function, or exact error string/);
});

test('spec-template.md\'s Gotchas section shows the ASSUMPTION marker\'s shape', () => {
  const gotchasSection = SPEC_TEMPLATE.slice(SPEC_TEMPLATE.indexOf('## Gotchas'), SPEC_TEMPLATE.indexOf('## Decision Rationale'));
  assert.match(gotchasSection, new RegExp(MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(gotchasSection, /_shared\/premise-verification\.md/);
});

test('spec-template.md\'s No Placeholders list rejects a Current-State/Key-Files claim with neither a citation nor the marker', () => {
  const noPlaceholders = SPEC_TEMPLATE.slice(SPEC_TEMPLATE.indexOf('## No Placeholders'), SPEC_TEMPLATE.indexOf('## Delete + Tombstone'));
  assert.match(noPlaceholders, new RegExp(MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(noPlaceholders, /neither an inline evidence citation nor the/);
});

test('build/SKILL.md\'s writing-plans handoff names the marker and instructs verifying it against the worktree before planning', () => {
  const spec3 = BUILD_SKILL.slice(BUILD_SKILL.indexOf('Context to provide to `/superpowers:writing-plans`'), BUILD_SKILL.indexOf('Context to provide to `/superpowers:writing-plans`') + 1500);
  assert.match(spec3, new RegExp(MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(spec3, /before invoking `\/superpowers:writing-plans`/i);
  assert.match(spec3, /decisions\.md/);
});

test('the premise-verification check states its boundary with dependency-narration-check.md — planned sibling work is out of scope here', () => {
  assert.match(PREMISE_CHECK, /_shared\/dependency-narration-check\.md/);
  assert.match(PREMISE_CHECK, /never another record's planned or in-flight changes/);
});
