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
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

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
