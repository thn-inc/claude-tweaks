'use strict';
// tests/release-routine-template.test.js (#2258) — the release train Routine: the template
// `/claude-tweaks:routine create release` instantiates, and the three places that register it
// (the routine skill's When to Use, the autonomy-ceiling Routine-firing row, the skill graph).
// The refusal / HELD / PARTIAL logic is the release skill's own (#2256); this template only
// schedules the invocation, so the pins here are about shape and registration, not behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseRoutineTemplate } = require('../plugin/bin/lib/routine-template-parser.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TEMPLATE = parseRoutineTemplate(read('plugin/skills/release/routine-template.yml'));

test('the template kicks off release --train — the skill directory first, the flag verbatim', () => {
  assert.equal(TEMPLATE.kickoff, 'release --train');
  assert.equal(TEMPLATE.routine_name, 'release-train-daily');
  assert.equal(TEMPLATE.template_version, 1);
});

test('the template carries Bash (every write is a CLI or git/gh call) and Task (Step 3 dispatches lenses), never Edit/Write', () => {
  for (const tool of ['Bash', 'Read', 'Task']) {
    assert.ok(TEMPLATE.allowed_tools.includes(tool), `allowed_tools lacks ${tool}`);
  }
  for (const tool of ['Edit', 'Write']) {
    assert.ok(!TEMPLATE.allowed_tools.includes(tool), `allowed_tools grants ${tool} to an unattended merge-capable firing that never uses it`);
  }
  assert.match(TEMPLATE.default_schedule.cron_expression, /^\S+ \S+ \* \* 1-5$/, 'daily on weekdays');
});

test('the template notes name the two policy levers and the three firing outcomes', () => {
  const notes = TEMPLATE.notes || '';
  for (const literal of ['release-train: true', 'autonomy: unattended', 'HELD', 'PARTIAL', 'release-held.md']) {
    assert.ok(notes.includes(literal), `notes lack ${literal}`);
  }
});

test('the routine skill names release as an instantiable template with its precondition', () => {
  const skill = read('plugin/skills/routine/SKILL.md');
  assert.ok(skill.includes('/claude-tweaks:routine create release'));
  assert.ok(skill.includes('skills/release/routine-template.yml'));
  assert.ok(skill.includes('release-train: true'));
});

test('autonomy-ceiling.md carries a Routine-firing row that defers to execute.md and names HELD and PARTIAL', () => {
  const ceiling = read('plugin/skills/_shared/autonomy-ceiling.md');
  const row = ceiling.split('\n').find((l) => l.startsWith('| `train (Routine firing)` |'));
  assert.ok(row, 'no `train (Routine firing)` row');
  for (const literal of ['release/execute.md', '`HELD`', '`PARTIAL`', 'release-train: true', 'refused']) {
    assert.ok(row.includes(literal), `row lacks ${literal}`);
  }
});

test('the skill graph states the edge once in each direction — routine → release, release → routine', () => {
  const graph = read('docs/skill-graph.md');
  const block = (name) => {
    const start = graph.indexOf(`\n## ${name}\n`);
    assert.ok(start >= 0, `no ## ${name} block`);
    const next = graph.indexOf('\n## ', start + 1);
    return graph.slice(start, next < 0 ? undefined : next);
  };
  const routineRow = block('routine').split('\n').find((l) => l.startsWith('| `/release` |'));
  assert.ok(routineRow && routineRow.includes('routine-template.yml'), 'no /release consumer row in ## routine');
  assert.ok(routineRow.includes('`failed`'), 'the consumer row must name the refused-firing outcome word `failed`, never "no-op"');
  assert.ok(!/refused no-op/.test(routineRow), 'the consumer row must not call the refused stop a no-op');
  assert.match(block('release'), /^\| `\/routine` \| .*routine-template\.yml/m);
});
