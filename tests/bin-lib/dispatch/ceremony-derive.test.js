'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { computeDiffFacts, deriveCeremonyProfile, isDocsPath, isPromptProsePath, PROMPT_PROSE_DIRS, shouldDerive } = require('../../../plugin/bin/lib/dispatch/ceremony-derive');

// #1545 evidence shape: a +75/-2 test file plus its own materialized
// work/{n}-spec.md doc — a mix of test + docs files, zero production files.
const EVIDENCE_DIFF = [
  { path: 'tests/wrap-up-registry-pin.test.js', additions: 75, deletions: 2 },
  { path: '.claude-tweaks/pipelines/2026-08-26T000000-spec-1/work/1-spec.md', additions: 40, deletions: 0 },
];

test('AC1: the #1545 evidence diff (test file + materialized spec doc, zero production files) is assigned fast-lane, not standard', () => {
  assert.equal(deriveCeremonyProfile(EVIDENCE_DIFF, 'standard'), 'fast-lane');
});

test('computeDiffFacts: the evidence diff is lowSurface but strictly neither testOnly nor docsOnly (a mix)', () => {
  const facts = computeDiffFacts(EVIDENCE_DIFF);
  assert.equal(facts.lowSurface, true);
  assert.equal(facts.testOnly, false);
  assert.equal(facts.docsOnly, false);
  assert.equal(facts.implFiles, 0);
});

test('computeDiffFacts: a pure test-only diff classifies as testOnly and lowSurface', () => {
  const facts = computeDiffFacts([{ path: 'tests/foo.test.js', additions: 10, deletions: 1 }]);
  assert.equal(facts.testOnly, true);
  assert.equal(facts.lowSurface, true);
});

test('computeDiffFacts: a pure docs-only diff classifies as docsOnly and lowSurface', () => {
  const facts = computeDiffFacts([{ path: 'docs/plugin-structure.md', additions: 5, deletions: 0 }]);
  assert.equal(facts.docsOnly, true);
  assert.equal(facts.lowSurface, true);
});

// The Gotcha this issue names explicitly: a test file plus a SMALL amount of
// production code must NOT be misclassified as low-surface — a real
// behavioral change riding along with its own regression test must still
// default to standard.
test('AC2 (gotcha): a test file plus one line of production code is disqualified — never fast-lane', () => {
  const files = [
    { path: 'plugin/bin/lib/foo.js', additions: 1, deletions: 0 },
    { path: 'tests/foo.test.js', additions: 20, deletions: 0 },
  ];
  const facts = computeDiffFacts(files);
  assert.equal(facts.lowSurface, false, `a diff touching production code must never be lowSurface: ${JSON.stringify(facts)}`);
  assert.equal(deriveCeremonyProfile(files, 'standard'), 'standard');
});

test('deriveCeremonyProfile: a purely backend/production diff stays standard', () => {
  const files = [{ path: 'plugin/bin/lib/reconcile/archive-merged.js', additions: 40, deletions: 5 }];
  assert.equal(deriveCeremonyProfile(files, 'standard'), 'standard');
});

// #3034: QA story YAML files (the shape /claude-tweaks:stories writes) count
// as test surface via blast-radius.js's isTestPath, so a story-only diff
// discriminates the same way the #1545 evidence shape (test file + docs)
// does, and a story file riding alongside real production code stays
// disqualified — the same discrimination AC2 above pins for a test file.
test('computeDiffFacts: a story file plus a docs file is lowSurface and derives fast-lane', () => {
  const files = [
    { path: 'stories/app-customer.yaml', additions: 50, deletions: 0 },
    { path: 'docs/plan.md', additions: 5, deletions: 0 },
  ];
  const facts = computeDiffFacts(files);
  assert.equal(facts.testFiles, 1);
  assert.equal(facts.implFiles, 0);
  assert.equal(facts.lowSurface, true);
  assert.equal(deriveCeremonyProfile(files, 'standard'), 'fast-lane');
});

test('computeDiffFacts: a story file plus one production file is disqualified — never fast-lane', () => {
  const files = [
    { path: 'stories/app-customer.yaml', additions: 50, deletions: 0 },
    { path: 'plugin/bin/lib/foo.js', additions: 1, deletions: 0 },
  ];
  const facts = computeDiffFacts(files);
  assert.equal(facts.implFiles, 1);
  assert.equal(facts.lowSurface, false, `a diff touching production code must never be lowSurface: ${JSON.stringify(facts)}`);
  assert.equal(deriveCeremonyProfile(files, 'standard'), 'standard');
});

// The other half of the gotcha: never downgrade a profile already set to
// standard by an upstream decision -- but an already-fast-lane current value
// is passed through untouched (nothing to narrow further), never re-derived
// downward to standard by this function.
test('deriveCeremonyProfile: an already-fast-lane current value is never touched, regardless of diff content', () => {
  const bigProductionDiff = [{ path: 'plugin/bin/lib/reconcile/archive-merged.js', additions: 500, deletions: 200 }];
  assert.equal(deriveCeremonyProfile(bigProductionDiff, 'fast-lane'), 'fast-lane');
});

test('deriveCeremonyProfile: an empty diff leaves the current value unchanged', () => {
  assert.equal(deriveCeremonyProfile([], 'standard'), 'standard');
  assert.equal(deriveCeremonyProfile([], 'fast-lane'), 'fast-lane');
});

test('shouldDerive: only an auto-mode run whose profile is still standard derives (#1932 AC1)', () => {
  assert.strictEqual(shouldDerive({ mode: 'auto', ceremonyProfile: 'standard' }), true);
  for (const mode of ['confirm', 'hybrid', 'interactive', undefined, null, '']) {
    assert.strictEqual(shouldDerive({ mode, ceremonyProfile: 'standard' }), false, `mode ${mode} never derives`);
  }
  assert.strictEqual(shouldDerive({ mode: 'auto', ceremonyProfile: 'fast-lane' }), false, 'already fast-lane: nothing to narrow');
  assert.strictEqual(shouldDerive({}), false, 'no config at all (standalone wrap-up) never derives');
});

// #3477: shipped prompt prose (skills/agents/commands markdown) is production.
test('AC1.1: a plugin-prose diff (plugin/skills/test/qa-prompts.md + a test file) does not derive fast-lane', () => {
  const files = [
    { path: 'plugin/skills/test/qa-prompts.md', additions: 18, deletions: 1 },
    { path: 'tests/qa-prompts-step-origin.test.js', additions: 183, deletions: 0 },
  ];
  const facts = computeDiffFacts(files);
  assert.equal(facts.implFiles, 1);
  assert.equal(facts.lowSurface, false);
  assert.equal(deriveCeremonyProfile(files, 'standard'), 'standard');
});

test('computeDiffFacts: a prompt-prose file outside any test directory plus a test file is not lowSurface (#3477)', () => {
  const files = [
    { path: 'plugin/skills/foo/SKILL.md', additions: 4, deletions: 1 },
    { path: 'tests/foo.test.js', additions: 10, deletions: 0 },
  ];
  const facts = computeDiffFacts(files);
  assert.equal(facts.implFiles, 1);
  assert.equal(facts.lowSurface, false);
  assert.equal(deriveCeremonyProfile(files, 'standard'), 'standard');
});

test('AC2.1: a docs/**/*.md-only diff still derives fast-lane', () => {
  const files = [
    { path: 'docs/plugin-structure.md', additions: 5, deletions: 0 },
    { path: 'docs/reference/claude-quality-levers.md', additions: 3, deletions: 1 },
  ];
  assert.equal(computeDiffFacts(files).lowSurface, true);
  assert.equal(deriveCeremonyProfile(files, 'standard'), 'fast-lane');
});

test('isPromptProsePath: markdown under skills/, agents/, commands/ at any prefix is prompt prose', () => {
  for (const p of ['plugin/skills/test/qa-prompts.md', 'plugin/skills/_shared/work-record.md', 'plugin/agents/qa-agent.md',
    '.claude/skills/upstream-drift/SKILL.md', 'skills/foo/SKILL.md', '.claude/commands/ship.md', 'plugin/skills/foo/SKILL.MD']) {
    assert.equal(isPromptProsePath(p), true, p);
    assert.equal(isDocsPath(p), false, p);
  }
});

test('isPromptProsePath: other markdown stays docs, including basenames that merely contain the word', () => {
  for (const p of ['docs/skill-authoring.md', 'docs/agents.md', 'README.md', 'CLAUDE.md',
    '.claude-tweaks/pipelines/2026-08-26T000000-spec-1/work/1-spec.md', 'docs/superpowers/plans/2026-10-20-x.md']) {
    assert.equal(isPromptProsePath(p), false, p);
    assert.equal(isDocsPath(p), true, p);
  }
  assert.equal(isPromptProsePath('plugin/skills/foo/helper.js'), false, 'non-markdown is never prompt prose');
});

// #3477: two prose twins restate the directory set isPromptProsePath keys on.
// Pinned against PROMPT_PROSE_DIRS (which builds the regex), so adding or
// dropping a directory in the code fails here until both twins are updated.
test('the prose twins name exactly the directories PROMPT_PROSE_DIRS lists', () => {
  const ticked = PROMPT_PROSE_DIRS.map((d) => `\`${d}/\``);
  const list = `${ticked.slice(0, -1).join(', ')}, or ${ticked[ticked.length - 1]}`;
  const root = path.join(__dirname, '..', '..', '..', 'plugin', 'skills');
  for (const rel of ['build/micro-plan.md', 'wrap-up/ceremony-derivation.md']) {
    const prose = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.ok(prose.includes(list), `${rel} must contain the phrase: ${list}`);
  }
  for (const d of PROMPT_PROSE_DIRS) {
    assert.equal(isPromptProsePath(`x/${d}/a.md`), true, `${d}/ is prompt prose`);
  }
});
