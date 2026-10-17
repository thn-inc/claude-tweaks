'use strict';
// tests/wrap-up-record-resolution-conformance.test.js — #3365: wrap-up readers
// resolve a run's records through wrap-up-pack.json's inputs.records (pack.js's
// resolveRecords, which reads the worktree mirror), never by globbing the
// main-checkout run dir's work/, which is empty before merge in a worktree run.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const collapse = (s) => s.replace(/\s+/g, ' ');

// Every spelling of a main-checkout run-dir work/ read this repo has used.
const RETIRED = ['${RUN_DIR}/work/', '"${RUN_DIR}"/work/', '{run-dir}/work/*-spec.md'];
function globHits(text) {
  const flat = collapse(text);
  return RETIRED.filter((needle) => flat.includes(needle));
}

// Frozen pre-change excerpts (cleanup-procedures-execution.md Section C step 2
// at 691ecd15a). The second is line-wrapped mid-token-run to prove collapse()
// is what catches it.
const PRE_CHANGE_STEP_2 = 'reference. Otherwise, check for a materialized header — glob `${RUN_DIR}/work/*-spec.md`\n   (the file `skills/flow/materialize.md` writes and never deletes)';
const PRE_CHANGE_LOOP = '   for f in "${RUN_DIR}"/work/*-spec.md; do\n     [ -e "$f" ] || continue';

test('globHits catches the pre-change step 2 glob and loop (proves the absence pin can go red)', () => {
  assert.deepStrictEqual(globHits(PRE_CHANGE_STEP_2), ['${RUN_DIR}/work/']);
  assert.deepStrictEqual(globHits(PRE_CHANGE_LOOP), ['"${RUN_DIR}"/work/']);
  assert.deepStrictEqual(globHits('glob `${RUN_DIR}/work/`\n*-spec.md'), ['${RUN_DIR}/work/']);
  assert.deepStrictEqual(globHits('the mirror `{worktree}/.claude-tweaks/pipelines/{run-id}/work/*-spec.md`'), []);
});

const TASK2_FILES = [
  'plugin/skills/wrap-up/cleanup-procedures-execution.md',
  'plugin/skills/wrap-up/cleanup-procedures.md',
  'plugin/skills/dispatch/two-call-gate.md',
];
for (const rel of TASK2_FILES) {
  test(`${rel} no longer reads the main-checkout run dir's work/`, () => {
    assert.deepStrictEqual(globHits(read(rel)), []);
  });
}

function step2Block() {
  const text = read('plugin/skills/wrap-up/cleanup-procedures-execution.md');
  const start = text.indexOf('2. **Stamp the closing-keyword carrier commit');
  const end = text.indexOf('\n3. **', start);
  assert.ok(start !== -1 && end !== -1, 'Section C step 2 anchor vanished — the claims below would be vacuous');
  return collapse(text.slice(start, end));
}

test('Section C step 2 is skipped under integration-model: pr-first', () => {
  assert.match(step2Block(), /\*\*`integration-model: pr-first` \(`_shared\/integration-model\.md`\): skip this step entirely\*\*/);
});

test('Section C step 2 takes its issue set from wrap-up-pack.json inputs.records, with the worktree mirror as fallback', () => {
  const block = step2Block();
  assert.match(block, /`\{run-dir\}\/wrap-up-pack\.json`'s `inputs\.records`/);
  assert.match(block, /\{worktree\}\/\.claude-tweaks\/pipelines\/\{run-id\}\/work\/\*-spec\.md/);
});

test('Section E reads parked-at-shaping at cleanup planning, before item 4 removes the worktree (Ruling R2)', () => {
  const flat = collapse(read('plugin/skills/wrap-up/cleanup-procedures-execution.md'));
  assert.match(flat, /parked-at-shaping: true`[\s\S]{0,120}?read during cleanup planning from the worktree mirror/);
});

test('Section E names the current-branch header read (no worktree, item 4 never runs)', () => {
  const flat = collapse(read('plugin/skills/wrap-up/cleanup-procedures-execution.md'));
  assert.match(flat, /`current-branch` run has no worktree and item 4 never runs, so the run dir's own `work\/\{issue\}-spec\.md` holds the header/);
});

// Corpus-wide: no file under plugin/skills/wrap-up/ reads the main-checkout run dir's work/.
const WRAPUP_DIR = 'plugin/skills/wrap-up';
const WRAPUP_FILES = fs.readdirSync(path.join(ROOT, WRAPUP_DIR)).filter((f) => f.endsWith('.md'));

test('the wrap-up corpus is non-empty (the sweep below is not vacuous)', () => {
  assert.ok(WRAPUP_FILES.length > 10, `only ${WRAPUP_FILES.length} files found under ${WRAPUP_DIR}`);
});

for (const name of WRAPUP_FILES) {
  test(`${WRAPUP_DIR}/${name} has no main-checkout work/ read`, () => {
    assert.deepStrictEqual(globHits(read(`${WRAPUP_DIR}/${name}`)), []);
  });
}

test('Review Console step 11 always records issues from inputs.records (Ruling R3)', () => {
  const flat = collapse(read('plugin/skills/wrap-up/review-console.md'));
  const start = flat.indexOf('11. Write `verify-expectations.json`');
  assert.ok(start !== -1, 'step 11 anchor vanished');
  const step11 = flat.slice(start, start + 2500);
  assert.match(step11, /`issues` array of this run's record number\(s\) — `\{run-dir\}\/wrap-up-pack\.json`'s `inputs\.records`/);
  assert.doesNotMatch(step11, /omit `issues` entirely/);
});

test('the auto-merge short-circuit applicability reads inputs.records', () => {
  assert.match(collapse(read('plugin/skills/wrap-up/auto-merge-short-circuit.md')), /wrap-up-pack\.json`'s `inputs\.records` is non-empty/);
});
