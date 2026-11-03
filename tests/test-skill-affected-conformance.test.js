// tests/test-skill-affected-conformance.test.js
//
// Pins #1923's re-verify scoping contract in the prose that states it: the
// scoping table in test/verification.md (every site row named), the
// --changed-files redefinition of `affected` in test/SKILL.md, the QA skip
// literal, and multi-spec's single bookkeeping-only-delta statement. Reads
// live prose deliberately — the enumeration IS the declared contract whose
// update is the intended action (same house pattern as
// tests/manifesto-lever-conformance.test.js); do not generalize.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(REPO_ROOT, rel));

test('test/SKILL.md redefines `affected` onto verify.js --changed-files and drops the git-diff wording (#1923 AC3)', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  assert.ok(!skill.includes('uncommitted changes (uses git diff)'));
  const hits = skill.split('--changed-files').length - 1;
  assert.ok(hits >= 2, `expected --changed-files at least twice, got ${hits}`);
});

test('test/SKILL.md pipeline behavior carries the QA skip literal and always consults the Layer 3 sniff on zero matches (#2745)', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const list = skill.slice(skill.indexOf('**Pipeline behavior:**'), skill.indexOf('## Step 1: Resolve Scope and Execute'));
  assert.ok(list.includes('QA: skipped — no affected stories'));
  // #2745: a materialized `surface: web`/`mobile`/`desktop` no longer
  // short-circuits straight to the full story set on zero `source_files`
  // matches — every surface (including no header) goes through the same
  // Layer 3 sniff against the changed-file set first.
  assert.match(list, /Layer 3 sniff.*regardless of the record's materialized `surface:`/);
  // #808's original concern (a brand-new UI story with no `source_files`
  // yet must not be skipped) is preserved as a parenthetical, not as a
  // separate surface-gated branch that bypasses the sniff.
  assert.match(list, /#808/);
  assert.ok(
    !/`web`\/`mobile`\/`desktop` → run the full story set/.test(list),
    'the surface must no longer bypass the Layer 3 sniff on its own',
  );
});

test('verification.md holds the re-verify scoping table with every site row (#1923 AC1)', () => {
  const v = read('plugin/skills/test/verification.md');
  const table = v.slice(v.indexOf('### Re-verify scoping'));
  for (const row of [
    ['Build Common Step 5', '| full (impact-selected via'],
    ['Build Common Step 5', '(impact-selection.md)'],
    ["auto-inserted `test`", 'scoped against `fullSha`'],
    ['Polish re-verify', 'scoped'],
    ['Review-fix re-verify', 'scoped'],
    ['Multi-spec spec-N `test` step', 'scoped (`none` on a bookkeeping-only delta)'],
    ['Standalone `/claude-tweaks:test`', 'full'],
    ['`/claude-tweaks:test affected`', 'the shared changed-file set'],
  ]) {
    const line = table.split('\n').find((l) => l.startsWith('|') && l.includes(row[0]));
    assert.ok(line, `missing table row for ${row[0]}`);
    assert.ok(line.includes(row[1]), `row ${row[0]} must state mode ${row[1]}: ${line}`);
  }
  assert.ok(table.includes('Standalone is always full'));
});

test('flow/multi-spec.md states the bookkeeping-only delta exactly once; steps-and-gates cites the table (#1923 AC6)', () => {
  const ms = read('plugin/skills/flow/multi-spec.md');
  assert.strictEqual(ms.split('still-verified: bookkeeping-only delta').length - 1, 1);
  const sg = read('plugin/skills/flow/steps-and-gates.md');
  assert.ok(sg.includes('**Re-verify scoping:**'));
  assert.ok(sg.includes('test/verification.md'));
});

test('test/design-gate.md resolves <changed-files> via verify.js --changed-files, not a hand-rolled bare git diff --name-only, for the gate-input step (#2005)', () => {
  const gate = read('plugin/skills/test/design-gate.md');
  const invocation = gate.slice(gate.indexOf('## Invocation'), gate.indexOf('## Result handling'));
  assert.ok(
    !invocation.includes('Resolve `<changed-files>` from `git diff --name-only`'),
    'the gate-input resolution step must not hand-roll bare git diff --name-only',
  );
  assert.match(invocation, /verify\.js["'`]? --changed-files/);
  assert.ok(invocation.includes('--integration-branch'));
  // The exit-1 degrade path may still cite git diff --name-only in a ranged/working-tree
  // form — that's a documented fallback, not the primary resolution this test guards.
  assert.match(invocation, /exit 1.*git diff --name-only HEAD~1\.\.HEAD/s);
});

test('verification.md Skip-if-recent Mismatch re-stamps HEAD through the runner, never a hand-rolled skip (#3284)', () => {
  const v = read('plugin/skills/test/verification.md');
  const start = v.indexOf('- **Mismatch**');
  const end = v.indexOf('- **Signal absent**');
  assert.ok(start !== -1 && end > start, 'Mismatch bullet must precede the Signal absent bullet');
  const bullet = v.slice(start, end);
  assert.ok(!bullet.includes('skip this procedure entirely'), 'a moved HEAD must never skip without the runner — the stamp would stay at VERIFICATION_SHA');
  assert.ok(!bullet.includes('git diff --name-only'), 'the runner classifies the delta, not a hand-rolled git diff');
  assert.ok(bullet.includes('scoped invocation'), 'the Mismatch case runs the scoped invocation');
  assert.ok(bullet.includes('re-stamps HEAD'), 'the bullet states why: the runner re-stamps HEAD');
  assert.ok(bullet.includes('#3284'));
  assert.ok(bullet.includes('no declaration'), 'no-declaration projects fall back to the full procedure');
  const table = v.slice(v.indexOf('### Re-verify scoping'));
  const row = table.split('\n').find((l) => l.startsWith('|') && l.includes('`VERIFICATION_SHA` ≠ HEAD'));
  assert.ok(row, 'the scoping table names the build→test VERIFICATION_SHA mismatch site');
  assert.ok(row.includes('scoped (`none` on a bookkeeping-only delta)'), row);
});

test('test/fix-mode.md re-verifies a fix through the stamping runner, never a failed-checks-only re-run (#3284)', () => {
  const f = read('plugin/skills/test/fix-mode.md');
  assert.ok(f.includes('#3284'));
  assert.ok(f.includes('--no-stamp'), 'a narrowed iteration run must be named as never-stamping');
  assert.ok(f.includes('verification.md'), 'the stamped re-verification points at verification.md Step 2');
  // A failed-checks-only re-run is a partial set: it cannot stamp, so the fix
  // commit's HEAD would be left unstamped and the dispatched second call would
  // re-trigger /claude-tweaks:test.
  assert.doesNotMatch(f, /re-run the failed checks/i, 'no site may re-verify by re-running only the failed checks');
  // Auto-fix flow + the three Interactive fix bullets each point at the one statement.
  const pointers = f.split('re-verify per Re-verification above').length - 1;
  assert.ok(pointers >= 4, `expected >=4 pointers to the Re-verification paragraph, got ${pointers}`);
});

// #3048: pipeline QA selection and the design gate read the whole branch diff
// (`--ignore-stamp`); `affected` / `qa affected` keep the stamp anchor.
const IGNORE_STAMP_CMD = '--changed-files --ignore-stamp --integration-branch {ref}`';
function lineFrom(text, marker) {
  const start = text.indexOf(marker);
  assert.ok(start !== -1, `missing marker: ${marker}`);
  const end = text.indexOf('\n', start);
  return text.slice(start, end === -1 ? undefined : end);
}
function assertIgnoreStampSites(skill, gate) {
  const pipeline = lineFrom(skill, '- `VERIFICATION_PASSED=true` + stories exist');
  assert.ok(pipeline.includes(IGNORE_STAMP_CMD), 'the pipeline story-selection bullet must pass --ignore-stamp');
  assert.ok(gate.includes(IGNORE_STAMP_CMD), 'design-gate.md must resolve <changed-files> with --ignore-stamp');
  const affected = lineFrom(skill, '- **`affected`**');
  assert.ok(!affected.includes('--ignore-stamp'), 'the affected bullet keeps the stamp anchor');
  const qaStep1 = lineFrom(skill, '1. Read the changed-file set:');
  assert.ok(!qaStep1.includes('--ignore-stamp'), 'qa affected step 1 keeps the stamp anchor');
}

test('AC4.1/AC4.2: pipeline QA selection and design-gate.md name --ignore-stamp; affected and qa affected do not (#3048)', () => {
  assertIgnoreStampSites(read('plugin/skills/test/SKILL.md'), read('plugin/skills/test/design-gate.md'));
});

function mutateLine(text, marker, from, to) {
  const line = lineFrom(text, marker);
  const mutated = text.replace(line, line.replace(from, to));
  assert.notStrictEqual(mutated, text, 'the mutation must change the text');
  return mutated;
}

test('go-red: dropping --ignore-stamp from the pipeline story-selection bullet fails the AC4 pin', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const gate = read('plugin/skills/test/design-gate.md');
  const mutated = mutateLine(skill, '- `VERIFICATION_PASSED=true` + stories exist', '--changed-files --ignore-stamp', '--changed-files');
  assert.throws(() => assertIgnoreStampSites(mutated, gate), { message: /pipeline story-selection bullet must pass --ignore-stamp/ });
});

test('go-red: dropping --ignore-stamp from design-gate.md fails the AC4 pin', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const gate = read('plugin/skills/test/design-gate.md');
  const mutated = gate.replace('--changed-files --ignore-stamp', '--changed-files');
  assert.notStrictEqual(mutated, gate, 'the mutation must change the text');
  assert.throws(() => assertIgnoreStampSites(skill, mutated), { message: /design-gate\.md must resolve <changed-files> with --ignore-stamp/ });
});

test('go-red: adding --ignore-stamp to the affected bullet fails the AC4 pin', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const gate = read('plugin/skills/test/design-gate.md');
  const mutated = mutateLine(skill, '- **`affected`**', '--changed-files --integration-branch', '--changed-files --ignore-stamp --integration-branch');
  assert.throws(() => assertIgnoreStampSites(mutated, gate), { message: /the affected bullet keeps the stamp anchor/ });
});

test('go-red: adding --ignore-stamp to qa affected step 1 fails the AC4 pin', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const gate = read('plugin/skills/test/design-gate.md');
  const mutated = mutateLine(skill, '1. Read the changed-file set:', '--changed-files --integration-branch', '--changed-files --ignore-stamp --integration-branch');
  assert.throws(() => assertIgnoreStampSites(mutated, gate), { message: /qa affected step 1 keeps the stamp anchor/ });
});

// Frozen pre-#4395 text (hand-built): the VERIFICATION_SHA row promised a re-run and the bullets skipped outright.
const PRE_4395_SKILL_EXCERPT = `| \`VERIFICATION_SHA\` | Set by \`/claude-tweaks:build\` Common Step 5, alongside \`VERIFICATION_PASSED\` | The commit build's verification ran against. Compared to current \`HEAD\` before honoring the skip (see \`verification.md\`'s "Skip-if-recent") — a mismatch means the tree changed since build passed, and verification re-runs instead of skipping. |

**Pipeline behavior:**`;

const PARAGRAPH_START = 'A `VERIFICATION_PASSED=true` bullet below applies its skip only when `VERIFICATION_SHA` equals `HEAD`';
const MISMATCH_FIRST = /A `VERIFICATION_PASSED=true` bullet below applies its skip only when `VERIFICATION_SHA` equals `HEAD`\. On a mismatch, run `verification\.md`'s Mismatch branch in place of that skip[^\n]*re-stamps `HEAD`/;
const TAIL_CLAUSE = 'once it passes, the rest of the bullet (QA selection, `skip-qa`, `TEST_PASSED=true`) applies as written';
const NOTE_CLAUSE = `, except that when suites re-ran the Mismatch branch's own note ("Verification re-run — tree changed since build's pass …") replaces a "passed in build" report.`;
const ROW_CLAUSE = 'so the Mismatch branch runs the scoped verify (the full procedure without a scope declaration) instead of skipping.';
const STALE_ROW = 'verification re-runs instead of skipping';
const PASSED_ROW_SKIP = 'Skip types/lint/tests when `VERIFICATION_SHA` equals `HEAD`';

// Each clause is its own assertion with its own message, so a go-red mutation that breaks one clause names that clause.
function assertMismatchRoute(text) {
  assert.match(text, MISMATCH_FIRST, 'the paragraph opens with the VERIFICATION_PASSED scope clause and routes a mismatch to the Mismatch branch');
  const at = text.indexOf(PARAGRAPH_START);
  assert.ok(at !== -1 && at < text.indexOf('**Pipeline behavior:**'), 'the paragraph precedes the Pipeline behavior bullets');
  const end = text.indexOf('\n\n', at);
  const para = text.slice(at, end === -1 ? text.length : end);
  const shaRow = text.split('\n').find(line => line.startsWith('| `VERIFICATION_SHA` |'));
  assert.ok(shaRow !== undefined && shaRow.includes(ROW_CLAUSE), 'the VERIFICATION_SHA row says the Mismatch branch runs the scoped verify');
  assert.ok(!text.includes(STALE_ROW), 'the stale VERIFICATION_SHA row text is absent');
  const passedRow = text.split('\n').find(line => line.startsWith('| `VERIFICATION_PASSED` |'));
  assert.ok(passedRow !== undefined && passedRow.includes(PASSED_ROW_SKIP), 'the VERIFICATION_PASSED row conditions its skip on the SHA check');
  assert.ok(para.includes(TAIL_CLAUSE), 'the tail clause keeps the rest of the bullet applying as written after the Mismatch branch passes');
  assert.ok(para.includes(NOTE_CLAUSE), 'the paragraph ends with the re-run note replacing a passed-in-build report');
}

test('AC1.1: test/SKILL.md routes a moved HEAD through the runner before any VERIFICATION_PASSED skip (#4395)', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  assertMismatchRoute(skill);
  assert.doesNotMatch(PRE_4395_SKILL_EXCERPT, MISMATCH_FIRST);
  assert.throws(() => assertMismatchRoute(PRE_4395_SKILL_EXCERPT), /the paragraph opens with the VERIFICATION_PASSED scope clause/);
});

test('go-red: a scope clause that drops the VERIFICATION_PASSED anchor fails the route assertion', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const mutated = skill.replace('A `VERIFICATION_PASSED=true` bullet below applies', 'The first `VERIFICATION_PASSED=true` bullet below applies');
  assert.notEqual(mutated, skill);
  assert.throws(() => assertMismatchRoute(mutated), /the paragraph opens with the VERIFICATION_PASSED scope clause/);
});

test('go-red: moving the paragraph below the Pipeline behavior label fails the position assertion', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const start = skill.indexOf(PARAGRAPH_START);
  const end = skill.indexOf('\n\n', start) + 2;
  const para = skill.slice(start, end);
  const without = skill.slice(0, start) + skill.slice(end);
  const label = '**Pipeline behavior:**\n\n';
  const at = without.indexOf(label) + label.length;
  const mutated = without.slice(0, at) + para + without.slice(at);
  assert.notEqual(mutated, skill);
  assert.throws(() => assertMismatchRoute(mutated), /the paragraph precedes the Pipeline behavior bullets/);
});

test('go-red: a VERIFICATION_SHA row without the scoped-verify wording fails the row assertion', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const mutated = skill.replace('runs the scoped verify (the full procedure without a scope declaration) instead of skipping', 'runs the scoped verify instead of skipping');
  assert.notEqual(mutated, skill);
  assert.throws(() => assertMismatchRoute(mutated), /the VERIFICATION_SHA row says the Mismatch branch runs the scoped verify/);
});

test('go-red: the scoped-verify clause moved out of the VERIFICATION_SHA row fails the row assertion', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const mutated = skill.replace(` ${ROW_CLAUSE}`, '') + `\n${ROW_CLAUSE}\n`;
  assert.notEqual(mutated, skill);
  assert.ok(mutated.includes(ROW_CLAUSE), 'the clause is still present, only outside its row');
  assert.throws(() => assertMismatchRoute(mutated), /the VERIFICATION_SHA row says the Mismatch branch runs the scoped verify/);
});

test('go-red: re-adding the stale re-runs wording to the row fails the stale-text assertion', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const mutated = skill.replace('so the Mismatch branch runs', 'verification re-runs instead of skipping; so the Mismatch branch runs');
  assert.notEqual(mutated, skill);
  assert.throws(() => assertMismatchRoute(mutated), /the stale VERIFICATION_SHA row text is absent/);
});

test('go-red: an unconditional VERIFICATION_PASSED row skip fails the row-condition assertion', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const mutated = skill.replace('Skip types/lint/tests when `VERIFICATION_SHA` equals `HEAD` — they already passed', 'Skip types/lint/tests — they already passed');
  assert.notEqual(mutated, skill);
  assert.throws(() => assertMismatchRoute(mutated), /the VERIFICATION_PASSED row conditions its skip on the SHA check/);
});

test('go-red: an unconditional VERIFICATION_PASSED row with the phrase elsewhere in the file fails the row-condition assertion', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const unconditional = skill.replace('Skip types/lint/tests when `VERIFICATION_SHA` equals `HEAD` — they already passed', 'Skip types/lint/tests — they already passed');
  const mutated = unconditional + `\n${PASSED_ROW_SKIP}\n`;
  assert.notEqual(mutated, skill);
  assert.throws(() => assertMismatchRoute(mutated), /the VERIFICATION_PASSED row conditions its skip on the SHA check/);
});

test('go-red: dropping the tail clause fails the tail assertion', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const mutated = skill.replace('once it passes, the rest of the bullet', 'once it passes, the other parts of the bullet');
  assert.notEqual(mutated, skill);
  assert.throws(() => assertMismatchRoute(mutated), /the tail clause keeps the rest of the bullet/);
});

test('go-red: changing the re-run note clause fails the note assertion', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const mutated = skill.replace('replaces a "passed in build" report.', 'replaces a "passed in build" line.');
  assert.notEqual(mutated, skill);
  assert.throws(() => assertMismatchRoute(mutated), /the paragraph ends with the re-run note/);
});

test('go-red: moving the tail clause out of the paragraph to the end of the file fails the tail assertion', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const mutated = skill.replace(TAIL_CLAUSE, 'once it passes, the QA selection applies') + '\n' + TAIL_CLAUSE + '\n';
  assert.notEqual(mutated, skill);
  assert.throws(() => assertMismatchRoute(mutated), /the tail clause keeps the rest of the bullet/);
});

test('go-red: moving the note clause out of the paragraph to the end of the file fails the note assertion', () => {
  const skill = read('plugin/skills/test/SKILL.md');
  const mutated = skill.replace(NOTE_CLAUSE, '.') + '\n' + NOTE_CLAUSE + '\n';
  assert.notEqual(mutated, skill);
  assert.throws(() => assertMismatchRoute(mutated), /the paragraph ends with the re-run note/);
});
