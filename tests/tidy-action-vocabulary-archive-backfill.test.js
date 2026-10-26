// tests/tidy-action-vocabulary-archive-backfill.test.js
// Pins tidy/SKILL.md's Archive and Backfill Action Vocabulary rows (#3904) and their Step 7.5
// verification lines, and confirms the recipe sources those rows cite still exist.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const SKILL_REL = 'plugin/skills/tidy/SKILL.md';
const SKILL = readText(path.join(REPO_ROOT, SKILL_REL));

function vocabTable(text) {
  const start = text.indexOf('## Action Vocabulary');
  assert.ok(start >= 0, 'SKILL.md has an Action Vocabulary section');
  const next = text.indexOf('\n### ', start);
  return text.slice(start, next < 0 ? undefined : next);
}

function verificationBlock(text) {
  const start = text.indexOf('### Verification');
  assert.ok(start >= 0, 'SKILL.md has a Step 7.5 ### Verification block');
  const close = text.indexOf('\n```', start);
  assert.ok(close >= 0, 'Step 7.5 verification block is closed by a fence');
  return text.slice(start, close);
}

function rowFor(text, action) {
  return vocabTable(text).split('\n').find((l) => l.startsWith(`| **${action}** |`));
}

function assertArchiveBackfill(text) {
  const archive = rowFor(text, 'Archive');
  assert.ok(archive, 'Action Vocabulary has an Archive row');
  for (const s of ['kind: pipeline-run', 'wrap-up/cleanup-procedures-execution.md` Section B step 4', 'claude-tweaks: archived {run-id}', 'never moved','bin/hooks.js" archive-run --run "{run-dir}"','.claude-tweaks/pipelines/archive/', 'remedy: record', "step-6-auto.md`'s two **Archive** rows"]) {
    assert.ok(archive.includes(s), `Archive row names ${s}`);
  }
  const backfill = rowFor(text, 'Backfill');
  assert.ok(backfill, 'Action Vocabulary has a Backfill row');
  for (const s of ['kind: release', 'bin/lib/residue/probes/release.js', '## [X.Y.Z](compare-url) (date)', 'remedy: record', 'no tag is created or pushed', 'ran: false',"step-6-auto.md`'s two **Backfill** rows"]) {
    assert.ok(backfill.includes(s), `Backfill row names ${s}`);
  }
  for (const row of [archive, backfill]) {
    assert.doesNotMatch(row, /Auto-apply|Auto \(no-op|\bStage\b|\bconservative\b|\bmoderate\b|\baggressive\b/, 'row does not restate step-6-auto.md routing tiers');
  }
  const verify = verificationBlock(text);
  assert.match(verify, /^- \[x\] Archived: /m, 'Step 7.5 has an Archived verification line');
  assert.match(verify, /^- \[x\] Backfilled: /m, 'Step 7.5 has a Backfilled verification line');
}

function withoutLine(text, prefix) {
  return text.split('\n').filter((l) => !l.startsWith(prefix)).join('\n');
}

function assertMutantFails(mutated, expectedError) {
  assert.notEqual(mutated, SKILL, 'mutant differs from SKILL.md');
  assert.throws(() => assertArchiveBackfill(mutated), expectedError);
}

test('AC1.1: tidy/SKILL.md\'s Action Vocabulary has Archive and Backfill rows, and Step 7.5 a verification line for each', () => {
  assertArchiveBackfill(SKILL);
});

test('AC1.1: the recipes the rows cite exist', () => {
  const sectionB = readText(path.join(REPO_ROOT, 'plugin/skills/wrap-up/cleanup-procedures-execution.md'));
  assert.match(sectionB, /^## B\. Pipeline run directory/m, 'cleanup-procedures-execution.md has Section B');
  assert.match(sectionB, /archive-run --run/, 'Section B names the archive-run verb');
  assert.ok(fs.existsSync(path.join(REPO_ROOT, 'plugin/bin/lib/residue/probes/release.js')));
});

test('AC1.1 go-red: deleting the Archive row fails the assertion', () => {
  const mutated = withoutLine(SKILL, '| **Archive** |');
  assertMutantFails(mutated, /Archive row/);
});

test('AC1.1 go-red: deleting the Backfill row fails the assertion', () => {
  const mutated = withoutLine(SKILL, '| **Backfill** |');
  assertMutantFails(mutated, /Backfill row/);
});

test('AC1.1 go-red: restating a routing tier in the Archive row fails the assertion', () => {
  const mutated = SKILL.split('\n').map((l) => (l.startsWith('| **Archive** |') ? `${l} Auto-apply` : l)).join('\n');
  assertMutantFails(mutated, /routing tiers/);
});

test('AC1.1 go-red: deleting the Archived verification line fails the assertion', () => {
  const mutated = withoutLine(SKILL, '- [x] Archived: ');
  assertMutantFails(mutated, /Archived verification line/);
});

test('AC1.1 go-red: deleting the Backfilled verification line fails the assertion', () => {
  const mutated = withoutLine(SKILL, '- [x] Backfilled: ');
  assertMutantFails(mutated, /Backfilled verification line/);
});

test('AC1.1 go-red: dropping the stdout-success contract from the Archive row fails the assertion', () => {
  const mutated = SKILL.replace('claude-tweaks: archived {run-id}', 'archived');
  assertMutantFails(mutated, /Archive row names claude-tweaks: archived/);
});

test('AC1.1 go-red: dropping the unconfirmed-probe caveat from the Backfill row fails the assertion', () => {
  const mutated = SKILL.replace('`ran: false`', 'nothing');
  assertMutantFails(mutated, /Backfill row names ran: false/);
});
