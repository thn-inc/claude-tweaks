// tests/plan-audit-check-e-prose.test.js — pins #3099's build wiring for
// plan-audit.js Check E: plugin/skills/build/plan-audit.md documents the
// coverage rule, the waiver line, the Result-interpretation handling, and the
// skip-gate ruling; build/SKILL.md Common Step 1.5 passes --spec. Reads the
// live skill files — this pins prose we just wrote, not a third-party fact
// (skill-prose-conformance-tests' live-vs-fixture distinction), mirroring
// tests/plan-audit-skip-sentence-bytes-prose.test.js. The flag-mirror test
// reads args.js's USAGE as the code twin the three invocation lines restate.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const PLAN_AUDIT = read('plugin/skills/build/plan-audit.md');
const SKILL = read('plugin/skills/build/SKILL.md');
const { USAGE } = require('../plugin/bin/lib/plan-audit/args');

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

function flags(s) {
  return [...new Set(s.match(/--[a-z][a-z-]*/g))].sort();
}

test('AC6.1 (#3099): plan-audit.md "What each check covers" states Check E\'s coverage rule and waiver line', () => {
  const line = bullet(PLAN_AUDIT, 'Check E');
  assert.match(line, /`AC\{item\}\.\{clause\}`/);
  assert.match(line, /test step/);
  assert.match(line, /`Waived AC\{item\}\.\{clause\}: \{reason\}`/);
  assert.match(line, /warn-only/);
  assert.match(line, /`unparsed`, never in `covered`/);
});

test('AC6.1 (#3099): plan-audit.md Result interpretation handles checkE.uncovered and checkE.unparsed', () => {
  const uncovered = bullet(PLAN_AUDIT, '`checkE.uncovered`');
  assert.match(uncovered, /amends the plan before dispatch/);
  assert.match(uncovered, /`Waived \{id\}: \{reason\}`/);
  assert.match(uncovered, /log-decision\.js" --run "\$PIPELINE_RUN_DIR" --status AUTO/);
  const unparsed = bullet(PLAN_AUDIT, '`checkE.unparsed`');
  assert.match(unparsed, /Never treat it as covered/);
  assert.match(unparsed, /--status SCANNED/);
});

test('#3099: plan-audit.md records the skip-gate ruling — Check E shares the A/B/C/headroom gate', () => {
  assert.match(PLAN_AUDIT, /\*\*Check E shares that gate too\*\* \(#3099's ruling\)/);
});

test('AC6.2 (#3099): build/SKILL.md Common Step 1.5 passes --spec when a materialized spec exists', () => {
  const section = step15();
  assert.match(section, /\[--spec \{spec-file\}\]/);
  assert.match(section, /When a materialized spec exists \(record mode\), pass it as `--spec \{spec-file\}`/);
  assert.match(section, /Check E/);
});

function invocationFence(md) {
  const fence = md.match(/## Invocation\s+```bash\n([^\n]+)\n```/);
  assert.ok(fence, 'plan-audit.md Invocation fence not found');
  return fence[1];
}

test('#3099: every restated plan-audit.js invocation names exactly the flags USAGE names', () => {
  const usageFlags = flags(USAGE);
  assert.ok(usageFlags.includes('--spec'), 'USAGE lost --spec');
  assert.deepStrictEqual(flags(invocationFence(PLAN_AUDIT)), usageFlags);
  const skillLine = step15().split('\n').find((l) => l.startsWith('Audit the plan against the actual repo'));
  assert.ok(skillLine, 'Common Step 1.5 invocation line not found');
  assert.deepStrictEqual(flags(skillLine.match(/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/plan-audit\.js"[^`]*`/)[0]), usageFlags);
  const structure = read('docs/plugin-structure.md').split('\n').find((l) => l.startsWith('node plugin/bin/plan-audit.js'));
  assert.ok(structure, 'docs/plugin-structure.md plan-audit.js line not found');
  assert.deepStrictEqual(flags(structure.split('#')[0]), usageFlags);
});

test('CRLF control (#3670): plan-audit-check-e-prose extracts the same result after a CRLF round-trip through readText()', (t) => {
  const docPath = path.join(ROOT, 'plugin/skills/build/plan-audit.md');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-audit-e-crlf-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const lf = readText(docPath);
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.ok(crlf.includes('\r\n'), 'CRLF build must contain \\r\\n');
  assert.ok(!crlf.includes('\r\r\n'), 'CRLF build must not contain \\r\\r\\n');
  const file = path.join(tmp, path.basename(docPath));
  fs.writeFileSync(file, crlf);
  assert.deepStrictEqual(invocationFence(readText(file)), invocationFence(lf));
});
