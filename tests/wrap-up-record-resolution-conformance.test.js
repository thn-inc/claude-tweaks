'use strict';
// tests/wrap-up-record-resolution-conformance.test.js — #3365: wrap-up readers
// resolve a run's records through wrap-up-pack.json's inputs.records (pack.js's
// resolveRecords, which reads the worktree mirror), never by globbing the
// main-checkout run dir's work/, which is empty before merge in a worktree run.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
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

test('Section C step 2 takes its issue set from wrap-up-pack.json inputs.closingRecords, with the worktree mirror as fallback', () => {
  const block = step2Block();
  assert.match(block, /`\{run-dir\}\/wrap-up-pack\.json`'s `inputs\.closingRecords`/);
  assert.match(block, /const c=p\.inputs&&p\.inputs\.closingRecords;if\(!Array\.isArray\(c\)\)process\.exit\(1\);console\.log\(c\.join\(" "\)\)/);
  assert.match(block, /if \[ -f "\$PACK" \] && CLOSING=\$\(node -e .* "\$PACK" 2>\/dev\/null\); then ISSUES=\(\$CLOSING\) else/);
  assert.match(block, /\{worktree\}\/\.claude-tweaks\/pipelines\/\{run-id\}\/work\/\*-spec\.md/);
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

test('Review Console step 11 always records issues from inputs.closingRecords (Ruling R3)', () => {
  const flat = collapse(read('plugin/skills/wrap-up/review-console.md'));
  const start = flat.indexOf('11. Write `verify-expectations.json`');
  assert.ok(start !== -1, 'step 11 anchor vanished');
  const step11 = flat.slice(start, start + 2500);
  assert.match(step11, /`issues` array of this run's record number\(s\) — `\{run-dir\}\/wrap-up-pack\.json`'s `inputs\.closingRecords`/);
  assert.doesNotMatch(step11, /omit `issues` entirely/);
  assert.match(step11, /Under Approve all: `printf '%s' '\{"memory":\[\.\.\.\],"upstream":\[\.\.\.\],"issues":\[\.\.\.\],"ledger":\[\.\.\.\]\}'/);
  const approveStart = step11.indexOf('Under Approve all:');
  const approveEnd = step11.indexOf('On any other resolution path');
  assert.ok(approveStart !== -1, 'Approve-all anchor vanished');
  assert.ok(approveEnd > approveStart, 'other-resolution-path anchor vanished');
  const approveSentence = step11.slice(approveStart, approveEnd);
  assert.match(approveSentence, /`issues` .*sourced exactly as/);
  assert.match(approveSentence, /omitted when no record resolves/);
});

test('the auto-merge short-circuit applicability reads inputs.records', () => {
  assert.match(collapse(read('plugin/skills/wrap-up/auto-merge-short-circuit.md')), /wrap-up-pack\.json`'s `inputs\.records` is non-empty/);
});

test('the current-branch Fixes issue set takes inputs.closingRecords (Ruling R1)', () => {
  const flat = collapse(read('plugin/skills/wrap-up/execution-and-verification.md'));
  assert.match(flat, /`inputs\.closingRecords` when non-empty/);
});

// The one sentence allowed to name the header-source rungs: Section C step 2's field definition.
const DEFINITION_START = 'That field is the one place wrap-up decides which records a run may close';
const DEFINITION_END = 'rather than restating the rule.';
function assertNoGateRestatement(name, text) {
  const flat = collapse(text);
  const s = flat.indexOf(DEFINITION_START);
  const e = s === -1 ? -1 : flat.indexOf(DEFINITION_END, s);
  const outside = s === -1 ? flat : flat.slice(0, s) + flat.slice(e + DEFINITION_END.length);
  assert.doesNotMatch(outside, /worktree-headers|sources\.records|HEADER_SOURCES/, `${name} restates the header-source gate`);
}
const PRE_CHANGE_SNIPPET = `ISSUES=($(node -e 'const p=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const s=(p.inputs&&p.inputs.sources&&p.inputs.sources.records)||"";if(["headers","worktree-headers"].includes(s))console.log((p.inputs.records||[]).join(" "))' "$PACK"))`;
const PRE_CHANGE_CURRENT_BRANCH = "`inputs.records` when non-empty and its `sources.records` is\n`headers` or `worktree-headers` (a multi-spec current-branch run can resolve more than one;";

test('AC2.1 go-red: the gate-restatement check fails on the pre-change readers', () => {
  assert.throws(() => assertNoGateRestatement('pre-change step 2', PRE_CHANGE_SNIPPET));
  assert.throws(() => assertNoGateRestatement('pre-change current-branch', PRE_CHANGE_CURRENT_BRANCH));
});
for (const name of WRAPUP_FILES) {
  test(`AC2.1: ${WRAPUP_DIR}/${name} does not restate the header-source gate`, () => assertNoGateRestatement(name, read(`${WRAPUP_DIR}/${name}`)));
}
test('AC2.1: the field definition exists, once, in Section C step 2', () => {
  const corpus = WRAPUP_FILES.map((n) => collapse(read(`${WRAPUP_DIR}/${n}`))).join('\n');
  assert.strictEqual(corpus.split(DEFINITION_START).length - 1, 1);
  assert.ok(step2Block().includes(DEFINITION_START));
  assert.match(step2Block(), /`headers` or `worktree-headers`/);
});
test('engine-verify.js derives its issue set from pack.js closingRecords, with no local header-source set (#3399 Deliverable 2)', () => {
  const src = read('plugin/bin/lib/wrap-up/engine-verify.js');
  assert.doesNotMatch(src, /HEADER_SOURCES|'worktree-headers'/);
  assert.match(src, /closingRecords\(resolveRecords\(/);
});

// Section E (AC3)
function sectionEStep7(text) {
  const flat = collapse(text);
  const s = flat.indexOf('7. **Remove `bot:in-progress`; restore `parked` if applicable.**');
  const e = flat.indexOf(' 8. The CLI logs the release', s);
  assert.ok(s !== -1 && e !== -1, 'Section E step 7 anchors vanished');
  return flat.slice(s, e);
}
function assertRestoreReadsPack(step7) {
  assert.match(step7, /`inputs\.parkedAtShaping\["\{issue\}"\]` is `true`/);
  assert.doesNotMatch(step7, /\{worktree\}|-spec\.md/, 'Section E step 7 reads a header file under a worktree path');
}
const PRE_CHANGE_STEP_7 = '7. **Remove `bot:in-progress`; restore `parked` if applicable.** AND the materialized header carries `parked-at-shaping: true` (read from the worktree mirror, `{worktree}/.claude-tweaks/pipelines/{run-id}/work/{issue}-spec.md`) 8. The CLI logs the release';

test('AC3.1: Section E\'s restore reads inputs.parkedAtShaping and no file under a worktree path', () => {
  assertRestoreReadsPack(sectionEStep7(read('plugin/skills/wrap-up/cleanup-procedures-execution.md')));
});
test('AC3.1 go-red: the restore check fails on the pre-change step 7, and on a worktree path re-inserted into today\'s', () => {
  assert.throws(() => assertRestoreReadsPack(sectionEStep7(PRE_CHANGE_STEP_7)));
  const current = sectionEStep7(read('plugin/skills/wrap-up/cleanup-procedures-execution.md'));
  const mutated = current.replace('reads no header file itself', 'reads {worktree}/.claude-tweaks/pipelines/{run-id}/work/{issue}-spec.md');
  assert.notStrictEqual(mutated, current, 'mutation anchor vanished — the control would be vacuous');
  assert.throws(() => assertRestoreReadsPack(mutated));
});
test('the cleanup ordering rule names inputs.closingRecords for the carrier-commit check (#3399)', () => {
  assert.match(collapse(read('plugin/skills/wrap-up/cleanup-procedures.md')), /carrier-commit check reads the run's records from `\$\{RUN_DIR\}\/wrap-up-pack\.json` \(`inputs\.closingRecords`\)/);
});
test('Section E produces the pack before item 4 whenever it is absent, with the claim probe (Review Focus 4)', () => {
  const flat = collapse(read('plugin/skills/wrap-up/cleanup-procedures-execution.md'));
  assert.match(flat, /A `cleanup-only` run skips Phase 3, and Phase 3's pack run can fail: whenever `\{run-dir\}\/wrap-up-pack\.json` is absent at the start of this execution step, produce it before item 4 removes the worktree — `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/wrap-up-pack\.js" --run "\$PIPELINE_RUN_DIR" --only claim`/);
  assert.doesNotMatch(flat, /--only ledger/);
});
test('Section C step 2 no longer calls the pack absent on every cleanup-only run', () => {
  assert.doesNotMatch(step2Block(), /a `cleanup-only` run skips Phase 3/);
});
test('Section E step 7 logs a SKIP when the pack is absent or lacks parkedAtShaping, never a silent skip', () => {
  const step7 = sectionEStep7(read('plugin/skills/wrap-up/cleanup-procedures-execution.md'));
  assert.match(step7, /When the pack is still absent after the preamble's production step, or lacks `inputs\.parkedAtShaping`, do not skip silently/);
  assert.match(step7, /log-decision\.js" --run "\$PIPELINE_RUN_DIR" --status SKIP --section "\/wrap-up" --step "Section E" --text "condition: wrap-up-pack\.json absent or lacks inputs\.parkedAtShaping → fallback: parked restore unverified for #\{issue\}; \/tidy Step 4\.7's backstop re-checks" --reversibility n\/a/);
  assert.match(step7, /Skip restoration silently when the pack holds no `true` entry/);
  assertRestoreReadsPack(step7);
});
// dispatch/two-call-gate.md item 4's record resolution (#3399 final review)
const PRE_FIX_TWO_CALL_GATE = "it resolves the run's records (`wrap-up-pack.json`'s `inputs.records`, or the worktree mirror's `work/*-spec.md` when the pack is absent, as it is in a `cleanup-only` run) and treats";
function assertTwoCallGateNamesClosingRecords(text) {
  assertNoGateRestatement('two-call-gate.md', text);
  const flat = collapse(text);
  assert.match(flat, /resolves the run's records \(`wrap-up-pack\.json`'s `inputs\.closingRecords`/);
  assert.doesNotMatch(flat, /`inputs\.records`/);
  assert.doesNotMatch(flat, /as it is in a `cleanup-only` run/);
}
test('two-call-gate.md names inputs.closingRecords for item 4 and does not call the pack absent in cleanup-only', () => {
  assertTwoCallGateNamesClosingRecords(read('plugin/skills/dispatch/two-call-gate.md'));
});
test('two-call-gate go-red: the check fails on the pre-fix inputs.records text', () => {
  assert.throws(() => assertTwoCallGateNamesClosingRecords(PRE_FIX_TWO_CALL_GATE));
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
  for (const fallback of ['worktreeAtClose', '`current-branch` run', 'SKIP']) {
    assert.ok(block.includes(fallback), `capture paragraph lost its ${fallback} fallback`);
  }
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
