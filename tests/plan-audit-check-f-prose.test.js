// tests/plan-audit-check-f-prose.test.js — pins #3602's build wiring for
// plan-audit.js Check F: plugin/skills/build/plan-audit.md documents the
// path-coverage rule, the waiver line, the Result-interpretation handling, and
// the skip-gate ruling; plan-authoring-checks.md carries the verify-then-maybe-
// change paragraph; build/SKILL.md Common Step 1.5 and docs/plugin-structure.md
// name Check F. Reads the live skill files — this pins prose we just wrote, not
// a third-party fact (skill-prose-conformance-tests' live-vs-fixture
// distinction), mirroring tests/plan-audit-check-e-prose.test.js and
// tests/plan-authoring-ac-clause-ids-prose.test.js.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PLAN_AUDIT = read('plugin/skills/build/plan-audit.md');
const SKILL = read('plugin/skills/build/SKILL.md');
const AUTHORING = read('plugin/skills/build/plan-authoring-checks.md');
const STRUCTURE = read('docs/plugin-structure.md');

function step15() {
  const start = SKILL.indexOf('### Common Step 1.5: Plan Audit');
  const end = SKILL.indexOf('### Common Step 1.7');
  assert.ok(start !== -1 && end > start, 'Common Step 1.5 section not found');
  return SKILL.slice(start, end);
}

function bullet(text, label) {
  const line = text.split('\n').find((l) => l.startsWith(`- **${label}**`));
  assert.ok(line, `bullet "- **${label}**" not found`);
  return line;
}

function verifyParagraph() {
  const hits = AUTHORING.split(/\r?\n\r?\n/).filter((p) => p.startsWith('**Verify-then-maybe-change check:**'));
  assert.strictEqual(hits.length, 1, 'expected exactly one Verify-then-maybe-change check paragraph');
  return hits[0];
}

test('AC5.1 (#3602): plan-audit.md\'s opening enumeration names Check F', () => {
  const opening = PLAN_AUDIT.split(/\r?\n\r?\n/).find((p) => !p.startsWith('# Common Step 1.5'));
  assert.ok(opening, 'opening paragraph not found');
  assert.match(opening, /warn-only Check E \(acceptance-criterion clause coverage, #3099\) and Check F \(spec-named path coverage, #3602\)/);
});

test('AC5.1 (#3602): the Invocation envelope list and --spec paragraph name checkF', () => {
  assert.ok(PLAN_AUDIT.includes('`{checkA, checkB, checkC, checkD, headroom, premiseRefs, checkE, checkF}`'));
  assert.match(PLAN_AUDIT, /`checkE` and `checkF` are each `\{ok: true, skipped: 'no-spec'\}`/);
});

test('AC5.1 (#3602): Result interpretation documents every checkF result key', () => {
  const unlisted = bullet(PLAN_AUDIT, '`checkF.unlisted`');
  assert.match(unlisted, /amends the plan before dispatch/);
  assert.match(unlisted, /`Waived \{path\}: \{reason\}`/);
  assert.match(unlisted, /--step "Common Step 1\.5 \(Check F\)"/);
  const unparsed = bullet(PLAN_AUDIT, '`checkF.unparsed`');
  assert.match(unparsed, /Never treat it as covered/);
  assert.match(unparsed, /--status SCANNED/);
  const waived = bullet(PLAN_AUDIT, '`checkF.waived`');
  assert.match(waived, /`checkF\.listed`/);
  assert.match(waived, /`suffix`/);
  bullet(PLAN_AUDIT, '`checkF.orphanWaivers`');
});

test('AC5.1 (#3602): What each check covers states Check F\'s sections, waiver, read-only rule, and warn-only status', () => {
  const line = bullet(PLAN_AUDIT, 'Check F');
  assert.match(line, /warn-only/);
  assert.match(line, /`## Technical Approach`/);
  assert.match(line, /`### Key Files`/);
  assert.match(line, /`## Gotchas`/);
  assert.match(line, /never `## Acceptance Criteria` or `## Deliverables`/);
  assert.match(line, /`Waived \{path\}: \{reason\}`/);
  assert.match(line, /no quoted-text fallback/);
  assert.match(line, /only reads is exactly what this check exists to catch/);
  assert.match(line, /`unparsed`, never in `listed`/);
});

test('#3602: plan-audit.md records the skip-gate ruling — Check F shares the gate', () => {
  assert.match(PLAN_AUDIT, /\*\*Check F shares that gate too\*\* \(#3602's ruling\)/);
});

test('AC5.1 (#3602): plan-authoring-checks.md holds the verify-then-maybe-change check', () => {
  const p = verifyParagraph();
  assert.match(p, /`## Technical Approach`/);
  assert.match(p, /`## Gotchas`/);
  assert.match(p, /verify something, read something back, or change something only if a condition holds/);
  assert.match(p, /`Files:` block names each file the sentence reads/);
  assert.match(p, /`Waived \{path\}: \{reason\}`/);
  assert.match(p, /`checkF\.unlisted`/);
  assert.ok(Buffer.byteLength(p, 'utf8') <= 1000, `paragraph is ${Buffer.byteLength(p, 'utf8')} B, over the 1000 B cap`);
});

test('#3602: build/SKILL.md Common Step 1.5 and docs/plugin-structure.md name Check F', () => {
  assert.match(step15(), /Check F \(spec-named path coverage\)/);
  const usage = STRUCTURE.split('\n').find((l) => l.startsWith('node plugin/bin/plan-audit.js'));
  assert.ok(usage, 'docs/plugin-structure.md plan-audit.js line not found');
  assert.ok(usage.includes('checkE, checkF}'));
  assert.ok(usage.includes('Check F (#3602'));
  const row = STRUCTURE.split('\n').find((l) => l.startsWith('| build |'));
  assert.ok(row, 'docs/plugin-structure.md build row not found');
  assert.ok(row.includes('Check F (spec-named path coverage, #3602)'));
});
