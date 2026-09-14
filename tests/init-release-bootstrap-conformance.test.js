'use strict';
// Pins #2253's /init Step 21 — a prose test per skill-prose-conformance-tests:
// each assertion pins a literal substring or ordering that would go red if
// the corresponding content were reverted, plus the prose stack table's
// agreement with its code twin.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RELEASE_STACK_TABLE } = require('../plugin/bin/lib/init/release-bootstrap');

function read(relPath) { return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8'); }

const SKILL = read('plugin/skills/init/SKILL.md');
const STEP = read('plugin/skills/init/bootstrap/step-21-release.md');
const GRAMMAR = read('plugin/skills/init/input-grammar.md');
const INDEX = read('plugin/skills/init/bootstrap-steps.md');
const DETECT = read('plugin/skills/init/detection-tables.md');
const TEMPLATE = read('plugin/skills/init/claude-md-template.md');
const FINALIZATION = read('plugin/skills/init/worktree-policy-finalization.md');

test('init/SKILL.md has a Step 21 stub after Step 20 and before the finalization section, citing its sub-file and the integration-model fragment', () => {
  const step20 = SKILL.indexOf('### Step 20: Integration Model');
  const step21 = SKILL.indexOf('### Step 21: Release Bootstrap');
  const fin = SKILL.indexOf('### Finalizing the worktree-always Decision');
  assert.ok(step20 !== -1 && step21 !== -1 && fin !== -1, 'all three headings must exist');
  assert.ok(step20 < step21 && step21 < fin, 'Step 21 must sit between Step 20 and the finalization section');
  const body = SKILL.slice(step21, fin);
  assert.ok(body.includes('bootstrap/step-21-release.md'), 'the stub must cite its sub-file');
  assert.ok(body.includes('_shared/integration-model.md'), 'the stub routes on integration-model and must cite the fragment');
  assert.ok(body.split('\n').filter((l) => l.trim() && !l.startsWith('---')).length <= 4, 'the stub must stay <= 4 lines');
});

test('the release Enhancement filter token is registered in SKILL.md and input-grammar.md, and the index lists step 21', () => {
  assert.match(SKILL, /Enhancement filter tokens\*\* — one per Optional Enhancement step:[^\n]*`release`/);
  assert.match(GRAMMAR, /^\| `release` \| Step 21 — /m);
  assert.match(INDEX, /^\| 21 \| `step-21-release\.md` \|/m);
});

test('step-21-release.md carries the gate, the three verdicts, the CLI, the deferred policy write, and the citations', () => {
  assert.ok(STEP.startsWith('# Step 21 — '));
  assert.ok(STEP.includes('*Optional Enhancement step — see `SKILL.md`'), 'standard step preamble');
  for (const word of ['`fresh`', '`already-bootstrapped`', '`conflict`']) assert.ok(STEP.includes(word), `verdict ${word}`);
  assert.ok(STEP.includes('release: skipped — integration-model unresolved'));
  assert.ok(STEP.includes('release: conflict — {tool}'));
  assert.ok(STEP.includes('bin/release-bootstrap.js'));
  assert.ok(STEP.includes('_shared/integration-model.md'));
  assert.ok(STEP.includes('_shared/integration-branch.md'));
  assert.ok(STEP.includes('worktree-policy-finalization.md'));
  assert.ok(STEP.includes('# release-hook:') && STEP.includes('# release-train: false'));
  assert.ok(STEP.includes('`v*` tags are not conflict evidence') || STEP.includes('never conflict evidence'));
});

test('step-21-release.md envelope line and fresh row cover tagsFailure (ledger row 38)', () => {
  assert.ok(STEP.includes('tagsFailure?'), 'the envelope line must list the optional tagsFailure field');
  assert.ok(STEP.includes('tagsFailure'), 'the fresh row must explain when tagsFailure appears');
});

test('the prose stack table matches RELEASE_STACK_TABLE row for row, in order', () => {
  const start = STEP.indexOf('## Stack table');
  assert.notEqual(start, -1, 'step-21-release.md has no "## Stack table" section');
  const section = STEP.slice(start, STEP.indexOf('\n## ', start + 1) === -1 ? STEP.length : STEP.indexOf('\n## ', start + 1));
  const rows = [...section.matchAll(/^\| `([a-z]+)` \| ([^|]+) \|/gm)].map((m) => ({ releaseType: m[1], markers: m[2].split(',').map((s) => s.trim().replace(/`/g, '')) }));
  assert.deepEqual(rows.map((r) => r.releaseType), RELEASE_STACK_TABLE.map((r) => r.releaseType));
  for (let i = 0; i < rows.length; i += 1) assert.deepEqual(rows[i].markers, RELEASE_STACK_TABLE[i].markers, `markers for ${rows[i].releaseType}`);
  assert.ok(section.includes('`simple`'), 'the fall-through row is named');
});

test('worktree-policy-finalization.md flushes Step 21\'s release rows (AC 5)', () => {
  assert.ok(FINALIZATION.includes('release-hook'), 'must name release-hook');
  assert.ok(FINALIZATION.includes('release-train'), 'must name release-train');
  assert.ok(FINALIZATION.includes('step-21-release.md'), 'must cite Step 21\'s sub-file');
  assert.ok(FINALIZATION.includes('skip a line whose key already appears'), 'must state the skip-existing-key rule');
});

test('detection-tables.md routes the release-process finding to Step 21, and the CLAUDE.md template gains a Releasing section', () => {
  assert.match(DETECT, /Release process \(semantic-release, changesets, manual tags\)[^\n]*step-21-release\.md/);
  const tmplStart = TEMPLATE.indexOf('## Initial Mode Template');
  const tmplEnd = TEMPLATE.indexOf('## Update Mode');
  const initial = TEMPLATE.slice(tmplStart, tmplEnd);
  assert.ok(initial.includes('\n## Releasing\n'), 'the initial template has a ## Releasing section');
  assert.ok(initial.includes('/claude-tweaks:release'), 'names the one-line invocation');
});
