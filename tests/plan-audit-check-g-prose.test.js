// tests/plan-audit-check-g-prose.test.js — pins #4618's build wiring for
// plan-audit.js Check G and its --risk-proofs verb: plugin/skills/build/plan-audit.md
// documents the check, both result keys, the gating ruling, and the skip-gate
// exception; build/SKILL.md Common Step 1.5 names the verb on the skip path;
// every restated invocation names exactly the flags USAGE names. Reads the live
// skill files — this pins prose we just wrote, not a third-party fact
// (skill-prose-conformance-tests' live-vs-fixture distinction), mirroring
// tests/plan-audit-check-e-prose.test.js. Each pinned literal has a go-red
// control: the same assertion function runs against text with that literal removed.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { USAGE } = require('../plugin/bin/lib/plan-audit/args');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const LIVE = {
  planAudit: read('plugin/skills/build/plan-audit.md'),
  skill: read('plugin/skills/build/SKILL.md'),
  structure: read('docs/plugin-structure.md'),
};

function step15(skill) {
  const start = skill.indexOf('### Common Step 1.5: Plan Audit');
  const end = skill.indexOf('### Common Step 1.7');
  assert.ok(start !== -1 && end > start, 'Common Step 1.5 section not found');
  return skill.slice(start, end);
}

function bulletLine(text, label) {
  return text.split('\n').find((l) => l.startsWith(`- **${label}**`)) || '';
}

function flags(s) {
  return [...new Set(s.match(/--[a-z][a-z-]*/g))].sort();
}

function invocationFence(md) {
  const fence = md.match(/## Invocation\s+```bash\n([^\n]+)\n```/);
  return fence ? fence[1] : '';
}

// One row per pinned literal: where it must appear (a function returning the region), and the
// literal. A region that cannot be found yields '' so its literals fail by name.
const PINS = [
  ['plan-audit.md', (t) => t.planAudit, 'Check G'],
  ['plan-audit.md', (t) => t.planAudit, '`checkG.missing`'],
  ['plan-audit.md', (t) => t.planAudit, '`checkG.couldNotParse`'],
  ['plan-audit.md', (t) => t.planAudit, '`--risk-proofs {plan-file} --spec {spec-file}`'],
  ['plan-audit.md', (t) => t.planAudit, '**Check G does not share that gate**'],
  ['checkG.missing bullet', (t) => bulletLine(t.planAudit, '`checkG.missing`'), 'Proof(<slug>)'],
  ['checkG.missing bullet', (t) => bulletLine(t.planAudit, '`checkG.missing`'), 'HARD-GATE'],
  ['checkG.missing bullet', (t) => bulletLine(t.planAudit, '`checkG.missing`'), '--step "Common Step 1.5 (Check G)"'],
  ['checkG.missing bullet', (t) => bulletLine(t.planAudit, '`checkG.missing`'), 'never routed through the `scope-creep` policy'],
  ['checkG.couldNotParse bullet', (t) => bulletLine(t.planAudit, '`checkG.couldNotParse`'), 'Name each `source` and `raw`'],
  ['checkG.couldNotParse bullet', (t) => bulletLine(t.planAudit, '`checkG.couldNotParse`'), 'could not read the input'],
  ['Check G coverage bullet', (t) => bulletLine(t.planAudit, 'Check G'), '**gating**'],
  ['Check G coverage bullet', (t) => bulletLine(t.planAudit, 'Check G'), '`Proof(<slug>): {text}`'],
  ['Check G coverage bullet', (t) => bulletLine(t.planAudit, 'Check G'), 'a fenced example never satisfies it'],
  ['Check G coverage bullet', (t) => bulletLine(t.planAudit, 'Check G'), '`couldNotParse`'],
  ['Check G coverage bullet', (t) => bulletLine(t.planAudit, 'Check G'), '`could-not-parse`'],
  ['skip-gate ruling', (t) => t.planAudit, 'also runs `--risk-proofs --spec {spec-file}`'],
  ['SKILL.md Step 1.5', (t) => step15(t.skill), '--risk-proofs --spec {spec-file}'],
  ['SKILL.md Step 1.5', (t) => step15(t.skill), '`checkG.ok === false`'],
  ['SKILL.md Step 1.5', (t) => step15(t.skill), 'Proof(<slug>)'],
];

// Returns the labels of every pin or flag-mirror check that fails against `texts`.
function failures(texts) {
  const out = [];
  for (const [where, region, literal] of PINS) {
    let text;
    try { text = region(texts); } catch { text = ''; }
    if (!text.includes(literal)) out.push(`${where}: ${literal}`);
  }
  const usageFlags = flags(USAGE);
  if (!usageFlags.includes('--risk-proofs')) out.push('USAGE: --risk-proofs');
  const sameFlags = (label, line) => {
    if (JSON.stringify(flags(line)) !== JSON.stringify(usageFlags)) out.push(`flags: ${label}`);
  };
  sameFlags('plan-audit.md Invocation fence', invocationFence(texts.planAudit));
  let skillLine = '';
  try {
    skillLine = (step15(texts.skill).split('\n').find((l) => l.startsWith('Audit the plan against the actual repo')) || '')
      .match(/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/plan-audit\.js"[^`]*`/)?.[0] || '';
  } catch { /* leaves skillLine empty, which fails the flag comparison by name */ }
  sameFlags('build/SKILL.md Step 1.5 invocation', skillLine);
  const structure = texts.structure.split('\n').find((l) => l.startsWith('node plugin/bin/plan-audit.js')) || '';
  sameFlags('docs/plugin-structure.md usage line', structure.split('#')[0]);
  if (!structure.includes('checkF, checkG}')) out.push('docs/plugin-structure.md: envelope key checkG');
  if (!/Exit 0 iff Checks A\/B\/C\/D, headroom, premiseRefs, and Check G are all ok/.test(structure)) out.push('docs/plugin-structure.md: exit clause names Check G');
  if (!texts.structure.split('\n').find((l) => l.startsWith('| build |'))?.includes('Check G')) out.push('docs/plugin-structure.md: build row names Check G');
  return out;
}

function assertG(texts) {
  const failed = failures(texts);
  assert.deepStrictEqual(failed, [], `Check G prose is missing: ${failed.join('; ')}`);
}

test('#4618: plan-audit.md, build/SKILL.md and docs/plugin-structure.md carry every Check G pin and restate exactly USAGE\'s flags', () => {
  assertG(LIVE);
});

for (const [where, , literal] of PINS) {
  test(`#4618 go-red: removing "${literal}" from ${where} fails the same assertion, naming it`, () => {
    const mutated = {
      planAudit: LIVE.planAudit.split(literal).join(''),
      skill: LIVE.skill.split(literal).join(''),
      structure: LIVE.structure,
    };
    assert.throws(() => assertG(mutated), (err) => err.message.includes(`${where}: ${literal}`));
  });
}

test('#4618 go-red: dropping --risk-proofs from each restated invocation fails the flag mirror, naming that site', () => {
  const drop = (text, from, to) => text.replace(from, to);
  const cases = [
    ['flags: plan-audit.md Invocation fence', { ...LIVE, planAudit: drop(LIVE.planAudit, '[--task-markers] [--risk-proofs]\n```', '[--task-markers]\n```') }],
    ['flags: build/SKILL.md Step 1.5 invocation', { ...LIVE, skill: drop(LIVE.skill, '[--task-markers] [--risk-proofs]`', '[--task-markers]`') }],
    ['flags: docs/plugin-structure.md usage line', { ...LIVE, structure: drop(LIVE.structure, '[--task-markers] [--risk-proofs]   #', '[--task-markers]   #') }],
  ];
  for (const [label, texts] of cases) {
    assert.notStrictEqual(JSON.stringify(texts), JSON.stringify(LIVE), `${label}: the mutation must change the text`);
    assert.throws(() => assertG(texts), (err) => err.message.includes(label));
  }
});

test('#4618 go-red: a structure doc whose exit clause omits Check G fails', () => {
  const mutated = { ...LIVE, structure: LIVE.structure.replace('premiseRefs, and Check G are all ok', 'and premiseRefs are all ok') };
  assert.notStrictEqual(mutated.structure, LIVE.structure);
  assert.throws(() => assertG(mutated), (err) => err.message.includes('exit clause names Check G'));
});
