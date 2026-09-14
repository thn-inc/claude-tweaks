// tests/flow-release-row-680-gating-prose.test.js
//
// #2257 AC1/AC2: pins that flow/summary-template.md, flow/multispec-summary.md,
// and wrap-up/SKILL.md all gate their `/claude-tweaks:release` recommendation
// on the release-preflight pack's `unreleased` field (unit 5), covering all
// three suppression cases named by AC1 — an empty `commits` array, a wholly
// absent pack, and a degraded `{ok: false, error: ...}` field — and that the
// retired `release.js status`-shaped fallback paragraph is fully gone.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SUMMARY = read('plugin/skills/flow/summary-template.md');
const MULTISPEC_SUMMARY = read('plugin/skills/flow/multispec-summary.md');
const WRAP_UP = read('plugin/skills/wrap-up/SKILL.md');

test('AC2: the release.js status-shaped fallback paragraph is fully deleted from summary-template.md', () => {
  // Distinguishing text from the retired paragraph — a grep for it must
  // return zero matches.
  assert.doesNotMatch(SUMMARY, /no `plugin\/bin\/release\.js status`-shaped subcommand/);
  assert.doesNotMatch(SUMMARY, /git merge-base --is-ancestor/);
});

test('summary-template.md renders /claude-tweaks:release, never node plugin/bin/release.js, in its Next Actions', () => {
  const nextActionsIdx = SUMMARY.indexOf('### Next Actions');
  assert.ok(nextActionsIdx !== -1);
  const section = SUMMARY.slice(nextActionsIdx);
  assert.match(section, /`\/claude-tweaks:release`/);
  assert.doesNotMatch(section, /node plugin\/bin\/release\.js \{minor\|patch\}/);
});

test('AC1: summary-template.md\'s Release row gates on the preflight pack\'s unreleased field, naming all three suppression cases', () => {
  const rowIdx = SUMMARY.indexOf('**Release row (#680).**');
  assert.ok(rowIdx !== -1, 'the #680-tagged Release row section must exist');
  const section = SUMMARY.slice(rowIdx, rowIdx + 1500);
  assert.match(section, /release-preflight\.js/);
  assert.match(section, /unreleased/);
  // Case 1: empty commits array
  assert.match(section, /commits.* is empty/);
  // Case 2: degraded field ({ok: false, ...})
  assert.match(section, /ok.*false/);
  // Case 3: absent pack entirely
  assert.match(section, /absent entirely|no pack produced/);
});

test('AC1: multispec-summary.md carries the same #680 gate by reference, not a restated copy', () => {
  assert.match(MULTISPEC_SUMMARY, /`\/claude-tweaks:release`/);
  assert.match(MULTISPEC_SUMMARY, /#680/);
  assert.match(MULTISPEC_SUMMARY, /unreleased/);
});

test('AC9: wrap-up/SKILL.md renders the release row on the standalone path too, gated the same way', () => {
  assert.match(WRAP_UP, /`\/claude-tweaks:release`/);
  assert.match(WRAP_UP, /release-preflight\.js/);
  assert.match(WRAP_UP, /#680/);
});

test('AC7: docs/skill-graph.md carries both the wrap-up -> release and flow -> release edge rows, each citing the specific step', () => {
  const graph = read('docs/skill-graph.md');
  const flowSection = graph.slice(graph.indexOf('\n## flow\n'), graph.indexOf('\n## harness-health\n'));
  const wrapUpSection = graph.slice(graph.indexOf('\n## wrap-up\n'), graph.length);
  assert.match(flowSection, /\| `\/release` \|/, 'flow section must carry a /release row');
  assert.match(flowSection, /Pipeline Summary/, 'the flow->release row must cite the specific rendering site');
  assert.match(wrapUpSection, /\| `\/release` \|/, 'wrap-up section must carry a /release row');
  assert.match(wrapUpSection, /Next Actions/, 'the wrap-up->release row must cite the specific rendering site');
});

test('AC8: README.md\'s lifecycle diagram and /help\'s workflow surfaces both list /claude-tweaks:release', () => {
  const readme = read('README.md');
  const helpSkill = read('plugin/skills/help/SKILL.md');
  const referenceCard = read('plugin/skills/help/reference-card.md');
  assert.match(readme, /\/claude-tweaks:release/, 'README.md lifecycle diagram must list /claude-tweaks:release');
  assert.match(helpSkill, /`\/claude-tweaks:release`/, "help/SKILL.md's workflow diagram note must list /claude-tweaks:release");
  assert.match(referenceCard, /`\/claude-tweaks:release`/, 'help/reference-card.md must list /claude-tweaks:release');
});

test('no shipped skill file still stages or reads a release-backfill file', () => {
  for (const [name, text] of [['summary-template.md', SUMMARY], ['multispec-summary.md', MULTISPEC_SUMMARY], ['wrap-up/SKILL.md', WRAP_UP]]) {
    assert.doesNotMatch(text, /release-backfill/, `${name} must not reference the retired release-backfill staging file`);
  }
});
