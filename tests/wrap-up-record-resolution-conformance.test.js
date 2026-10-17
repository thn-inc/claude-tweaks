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
