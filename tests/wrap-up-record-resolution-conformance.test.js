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

test('Section C step 2 counts inputs.records only when sourced from a materialized header, not a manifest (Ruling R1)', () => {
  const block = step2Block();
  assert.match(block, /worktree-headers/);
});

test('Section E reads parked-at-shaping at the start of Phase 4 execution, before item 4 removes the worktree (Ruling R2)', () => {
  const flat = collapse(read('plugin/skills/wrap-up/cleanup-procedures-execution.md'));
  assert.match(flat, /parked-at-shaping: true`[\s\S]{0,120}?read at the start of Phase 4's execution step, before item 4 runs, from the worktree mirror/);
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

test('the current-branch Fixes issue set takes inputs.records only from header sources (Ruling R1)', () => {
  const flat = collapse(read('plugin/skills/wrap-up/execution-and-verification.md'));
  assert.match(flat, /`inputs\.records` when non-empty and its `sources\.records` is `headers` or `worktree-headers`/);
});

// #3395 — readers of the materialized header outside wrap-up/ must name the worktree mirror too.
// A block (paragraph or list item) that names a `work/*-spec.md` / `work/{n}-spec.md` header path
// without the mirror token reads the main-checkout run dir only, which holds no header until merge.
const HEADER_PATH = /work\/(?:\*|\{[^}]+\})-spec\.md/;
const MIRROR = '{worktree}/.claude-tweaks/pipelines/{run-id}/';
function blocks(text) {
  return text.split(/\n\s*\n|\n(?=\s*(?:\d+\.|-) )/).map(collapse);
}
function unmirroredHeaderReads(text) {
  return blocks(text).filter((b) => HEADER_PATH.test(b) && !b.includes(MIRROR));
}
const MULTISPEC_DIR = 'plugin/skills/flow';
const SCOPE_FILES = [
  ...fs.readdirSync(path.join(ROOT, MULTISPEC_DIR))
    .filter((f) => f.startsWith('multispec-') && f.endsWith('.md'))
    .map((f) => `${MULTISPEC_DIR}/${f}`),
  'plugin/skills/_shared/design-wrapper-handling.md',
  'plugin/skills/design-wrapper/modes/pre-build.md',
  'plugin/skills/design-wrapper/modes/review-seed-capture.md',
];

// Frozen pre-change excerpts (at d3c7fd26b) — the three directives #3395 retires.
const PRE_SURFACE = "- `--surface` — the record's materialized header `surface:` field (`flow/materialize.md`), when exactly one record is in scope (read from `$PIPELINE_RUN_DIR/work/*-spec.md`'s frontmatter).";
const PRE_STEP3 = 'For each `id` whose `spec-{id}/work/{id}-spec.md` exists (materialized from a record via `materialize.md`), read its header `record:` field to confirm the issue number. The materialized file is never deleted before this point — only archived once the run dir is archived — so it\'s read directly here; there is no separate pre-deletion capture.';
const PRE_PARKED = "AND that record's materialized header (`spec-{spec}/work/{issue}-spec.md` — read directly; per the release item above, the file is never deleted before this point) carries `parked-at-shaping: true`";

test('AC3.1: unmirroredHeaderReads flags each pre-change directive (the AC1 pin can go red)', () => {
  for (const pre of [PRE_SURFACE, PRE_STEP3, PRE_PARKED]) assert.equal(unmirroredHeaderReads(pre).length, 1, pre);
  assert.deepStrictEqual(unmirroredHeaderReads('read `{worktree}/.claude-tweaks/pipelines/{run-id}/work/*-spec.md`, else the run dir\'s own `work/*-spec.md`'), []);
});

test('the #3395 scope corpus is non-empty (the sweep below is not vacuous)', () => {
  assert.ok(SCOPE_FILES.length > 10, `only ${SCOPE_FILES.length} scope files`);
  assert.ok(SCOPE_FILES.includes('plugin/skills/_shared/design-wrapper-handling.md'));
});

for (const rel of SCOPE_FILES) {
  test(`AC1.1: ${rel} never reads a main-checkout work/*-spec.md as its only source`, () => {
    assert.deepStrictEqual(unmirroredHeaderReads(read(rel)), []);
  });
}

const REVIEW_CONSOLE = 'plugin/skills/flow/multispec-review-console.md';
const CAPTURE_ANCHOR = "**Before any step below — capture each spec's header fields.**";
function assertCaptureBeforeTeardown(text) {
  const start = text.indexOf('### Shared teardown');
  const end = text.indexOf('### Per-issue label cleanup', start);
  assert.ok(start !== -1 && end !== -1, 'Shared teardown section anchors vanished');
  const section = text.slice(start, end);
  const capture = section.indexOf(CAPTURE_ANCHOR);
  assert.ok(capture !== -1, 'no header capture paragraph in Shared teardown');
  const block = blocks(section.slice(capture)).find((b) => b.includes(collapse(CAPTURE_ANCHOR)));
  assert.ok(block, 'capture paragraph block not found after its anchor');
  assert.ok(block.includes('parked-at-shaping') && block.includes(MIRROR), 'capture must read parked-at-shaping from the worktree mirror');
  const finish = section.indexOf('2. **Finish the shared branch.**');
  const removal = section.indexOf('6. **Remove the shared worktree**');
  assert.ok(finish !== -1 && removal !== -1, 'step 2/6 anchors vanished');
  assert.ok(capture < finish && finish < removal, 'capture must precede step 2 (merge) and step 6 (worktree removal)');
}

test('AC2.1: the multi-spec teardown captures parked-at-shaping before the step that removes the shared worktree', () => {
  assertCaptureBeforeTeardown(read(REVIEW_CONSOLE));
});

test('AC3.2: assertCaptureBeforeTeardown goes red when the capture is removed or moved after step 6', () => {
  const live = read(REVIEW_CONSOLE).replace(/\r\n/g, '\n'); // the '\n\n' paragraph search below needs LF (core.autocrlf checkouts)
  const i = live.indexOf(CAPTURE_ANCHOR);
  const j = live.indexOf('\n\n', i);
  const para = live.slice(i, j);
  assert.throws(() => assertCaptureBeforeTeardown(live.replace(para, '')), /no header capture paragraph/);
  const removed = live.replace(para + '\n\n', '');
  const moved = removed.replace('7. **Branch + remote-ref cleanup', para + '\n\n7. **Branch + remote-ref cleanup');
  assert.notStrictEqual(moved, removed, 'step-7 anchor drifted — the moved control would degrade to the removed control');
  assert.throws(() => assertCaptureBeforeTeardown(moved), /capture must precede/);
});

test('Per-issue label cleanup uses the captured value, not a fresh header read', () => {
  const flat = collapse(read(REVIEW_CONSOLE));
  const at = flat.indexOf('### Per-issue label cleanup');
  assert.notStrictEqual(at, -1, 'Per-issue label cleanup heading vanished');
  const head = flat.slice(at, at + 1500);
  assert.match(head, /captured/);
  assert.doesNotMatch(head, /read directly/);
});
