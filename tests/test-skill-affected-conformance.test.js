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
    ['Build Common Step 5', 'always full'],
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
