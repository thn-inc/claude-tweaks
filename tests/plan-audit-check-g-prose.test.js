// tests/plan-audit-check-g-prose.test.js — pins #4618's build wiring for
// plan-audit.js Check G and its --risk-proofs verb: plugin/skills/build/plan-audit.md
// documents the check, both result keys, the gating ruling, and the skip-gate
// exception; build/SKILL.md Common Step 1.5 names the verb on the skip path;
// every restated invocation names exactly the flags USAGE names. Reads the live
// skill files — this pins prose we just wrote, not a third-party fact
// (skill-prose-conformance-tests' live-vs-fixture distinction), mirroring
// tests/plan-audit-check-e-prose.test.js. Every pinned literal and every other
// check in failures() has a go-red control: the same assertion function runs
// against text (or a USAGE) with that one thing removed. A pin scoped to a
// bullet, paragraph or step also has a scoping control: the literal moved out of
// its region, to the end of the file, must still fail.
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

function lineStarting(text, prefix) {
  return text.split('\n').find((l) => l.startsWith(prefix)) || '';
}

function bulletLine(text, label) {
  return lineStarting(text, `- **${label}**`);
}

// The paragraph build/SKILL.md's Common Step 1.5 skip gate lives in, scoped as
// tests/plan-audit-skip-sentence-bytes-prose.test.js scopes it for --bytes.
function skipParagraph(skill) {
  return lineStarting(step15(skill), '**Skip this step entirely when**');
}

// The paragraph holding plan-audit.md's skip-gate rulings.
function skipGateRuling(planAudit) {
  return lineStarting(planAudit, 'Check A/B/C and the headroom check all share');
}

function flags(s) {
  return [...new Set(s.match(/--[a-z][a-z-]*/g))].sort();
}

function invocationFence(md) {
  const fence = md.match(/## Invocation\s+```bash\n([^\n]+)\n```/);
  return fence ? fence[1] : '';
}

// One row per pinned literal: a label, where it must appear (a function returning the region),
// the literal, and whether the region is narrower than the file. A region that cannot be found
// yields '' so its literals fail by name.
const AMEND_ONCE = 'amend the plan once and re-run';
const PINS = [
  ['plan-audit.md', (t) => t.planAudit, 'Check G', false],
  ['plan-audit.md', (t) => t.planAudit, '`checkG.missing`', false],
  ['plan-audit.md', (t) => t.planAudit, '`checkG.couldNotParse`', false],
  ['plan-audit.md', (t) => t.planAudit, '`--risk-proofs {plan-file} --spec {spec-file}`', false],
  ['checkG.missing bullet', (t) => bulletLine(t.planAudit, '`checkG.missing`'), 'Proof(<slug>)', true],
  ['checkG.missing bullet', (t) => bulletLine(t.planAudit, '`checkG.missing`'), 'HARD-GATE', true],
  ['checkG.missing bullet', (t) => bulletLine(t.planAudit, '`checkG.missing`'), '--step "Common Step 1.5 (Check G)"', true],
  ['checkG.missing bullet', (t) => bulletLine(t.planAudit, '`checkG.missing`'), 'never routed through the `scope-creep` policy', true],
  ['checkG.missing bullet', (t) => bulletLine(t.planAudit, '`checkG.missing`'), 'the skip path\'s `--risk-proofs` call gets the same one', true],
  ['checkG.couldNotParse bullet', (t) => bulletLine(t.planAudit, '`checkG.couldNotParse`'), 'Name each `source` and `raw`', true],
  ['checkG.couldNotParse bullet', (t) => bulletLine(t.planAudit, '`checkG.couldNotParse`'), 'could not read the input', true],
  ['Check G coverage bullet', (t) => bulletLine(t.planAudit, 'Check G'), '**gating**', true],
  ['Check G coverage bullet', (t) => bulletLine(t.planAudit, 'Check G'), '`Proof(<slug>): {text}`', true],
  ['Check G coverage bullet', (t) => bulletLine(t.planAudit, 'Check G'), 'a fenced example never satisfies it', true],
  ['Check G coverage bullet', (t) => bulletLine(t.planAudit, 'Check G'), '`couldNotParse`', true],
  ['Check G coverage bullet', (t) => bulletLine(t.planAudit, 'Check G'), '`could-not-parse`', true],
  ['plan-audit.md skip-gate ruling', (t) => skipGateRuling(t.planAudit), '**Check G does not share that gate**', true],
  ['plan-audit.md skip-gate ruling', (t) => skipGateRuling(t.planAudit), 'also runs `--risk-proofs --spec {spec-file}`', true],
  ['plan-audit.md skip-gate ruling', (t) => skipGateRuling(t.planAudit), `${AMEND_ONCE} on \`checkG.missing\`, stop on \`checkG.couldNotParse\``, true],
  ['plan-audit.md skip-gate ruling', (t) => skipGateRuling(t.planAudit), 'so `--bytes` and, with a materialized spec, `--risk-proofs` still run on it', true],
  ['SKILL.md Step 1.5 Check G bullet', (t) => lineStarting(step15(t.skill), '- **Check G (`--spec` only):**'), 'Proof(<slug>)', true],
  ['SKILL.md Step 1.5 Check G bullet', (t) => lineStarting(step15(t.skill), '- **Check G (`--spec` only):**'), `on \`checkG.missing\` ${AMEND_ONCE}`, true],
  ['SKILL.md Step 1.5 Check G bullet', (t) => lineStarting(step15(t.skill), '- **Check G (`--spec` only):**'), 'on `checkG.couldNotParse` stop', true],
  ['SKILL.md skip paragraph', (t) => skipParagraph(t.skill), '--risk-proofs --spec {spec-file}', true],
  ['SKILL.md skip paragraph', (t) => skipParagraph(t.skill), 'on `checkG.missing` amend the plan once, log it, and re-run', true],
  ['SKILL.md skip paragraph', (t) => skipParagraph(t.skill), 'on `checkG.couldNotParse` or a second `checkG.missing` stop', true],
  ['SKILL.md skip paragraph', (t) => skipParagraph(t.skill), 'a second `checkG.missing`', true],
  ['SKILL.md skip paragraph', (t) => skipParagraph(t.skill), 'log it', true],
];

// Returns the labels of every pin or flag-mirror check that fails against `texts`. `usage` is
// injected so a control can hand it a USAGE that lacks the flag.
function failures(texts, usage = USAGE) {
  const out = [];
  for (const [where, region, literal] of PINS) {
    let text;
    try { text = region(texts); } catch { text = ''; }
    if (!text.includes(literal)) out.push(`${where}: ${literal}`);
  }
  const skip = skipParagraph(texts.skill);
  const bytesAt = skip.indexOf('--bytes');
  if (bytesAt === -1 || skip.indexOf('--risk-proofs') <= bytesAt) out.push('SKILL.md skip paragraph: --risk-proofs after --bytes');
  const usageFlags = flags(usage);
  if (!usageFlags.includes('--risk-proofs')) out.push('USAGE: --risk-proofs');
  const sameFlags = (label, line) => {
    if (JSON.stringify(flags(line)) !== JSON.stringify(usageFlags)) out.push(`flags: ${label}`);
  };
  sameFlags('plan-audit.md Invocation fence', invocationFence(texts.planAudit));
  let skillLine = '';
  try {
    skillLine = lineStarting(step15(texts.skill), 'Audit the plan against the actual repo')
      .match(/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/plan-audit\.js"[^`]*`/)?.[0] || '';
  } catch { /* leaves skillLine empty, which fails the flag comparison by name */ }
  sameFlags('build/SKILL.md Step 1.5 invocation', skillLine);
  const structure = lineStarting(texts.structure, 'node plugin/bin/plan-audit.js');
  sameFlags('docs/plugin-structure.md usage line', structure.split('#')[0]);
  if (!structure.includes('checkF, checkG}')) out.push('docs/plugin-structure.md: envelope key checkG');
  if (!/Exit 0 iff Checks A\/B\/C\/D, headroom, premiseRefs, and Check G are all ok/.test(structure)) out.push('docs/plugin-structure.md: exit clause names Check G');
  if (!lineStarting(texts.structure, '| build |').includes('Check G')) out.push('docs/plugin-structure.md: build row names Check G');
  return out;
}

function assertG(texts, usage) {
  const failed = failures(texts, usage);
  assert.deepStrictEqual(failed, [], `Check G prose is missing: ${failed.join('; ')}`);
}

const names = (label) => (err) => err.message.includes(label);

test('#4618: plan-audit.md, build/SKILL.md and docs/plugin-structure.md carry every Check G pin and restate exactly USAGE\'s flags', () => {
  assertG(LIVE);
});

for (const [where, , literal, scoped] of PINS) {
  test(`#4618 go-red: removing "${literal}" from ${where} fails the same assertion, naming it`, () => {
    const mutated = {
      planAudit: LIVE.planAudit.split(literal).join(''),
      skill: LIVE.skill.split(literal).join(''),
      structure: LIVE.structure,
    };
    assert.throws(() => assertG(mutated), names(`${where}: ${literal}`));
  });
  if (scoped) {
    test(`#4618 go-red: "${literal}" moved out of ${where} to the end of the file still fails`, () => {
      const moved = (text) => `${text.split(literal).join('')}\n\n${literal}\n`;
      const mutated = { planAudit: moved(LIVE.planAudit), skill: moved(LIVE.skill), structure: LIVE.structure };
      assert.throws(() => assertG(mutated), names(`${where}: ${literal}`));
    });
  }
}

test('#4618 go-red: the --risk-proofs call placed before --bytes in the skip paragraph fails the order check', () => {
  const call = '--risk-proofs --spec {spec-file}';
  const skip = skipParagraph(LIVE.skill);
  const reordered = `**Skip this step entirely when** ${call}${skip.slice('**Skip this step entirely when**'.length).replace(call, '')}`;
  const mutated = { ...LIVE, skill: LIVE.skill.replace(skip, reordered) };
  assert.notStrictEqual(mutated.skill, LIVE.skill);
  assert.throws(() => assertG(mutated), names('SKILL.md skip paragraph: --risk-proofs after --bytes'));
});

test('#4618 go-red: dropping --risk-proofs from each restated invocation fails the flag mirror, naming that site', () => {
  const cases = [
    ['flags: plan-audit.md Invocation fence', { ...LIVE, planAudit: LIVE.planAudit.replace('[--task-markers] [--risk-proofs]\n```', '[--task-markers]\n```') }],
    ['flags: build/SKILL.md Step 1.5 invocation', { ...LIVE, skill: LIVE.skill.replace('[--task-markers] [--risk-proofs]`', '[--task-markers]`') }],
    ['flags: docs/plugin-structure.md usage line', { ...LIVE, structure: LIVE.structure.replace('[--task-markers] [--risk-proofs]   #', '[--task-markers]   #') }],
  ];
  for (const [label, texts] of cases) {
    assert.notStrictEqual(JSON.stringify(texts), JSON.stringify(LIVE), `${label}: the mutation must change the text`);
    assert.throws(() => assertG(texts), names(label));
  }
});

test('#4618 go-red: a USAGE without --risk-proofs fails the USAGE check', () => {
  const noFlag = USAGE.replace(' [--risk-proofs]', '');
  assert.notStrictEqual(noFlag, USAGE);
  assert.throws(() => assertG(LIVE, noFlag), names('USAGE: --risk-proofs'));
});

test('#4618 go-red: each docs/plugin-structure.md Check G check fails when its text is removed', () => {
  const cases = [
    ['docs/plugin-structure.md: envelope key checkG', LIVE.structure.replace('checkF, checkG}', 'checkF}')],
    ['docs/plugin-structure.md: exit clause names Check G', LIVE.structure.replace('premiseRefs, and Check G are all ok', 'and premiseRefs are all ok')],
    ['docs/plugin-structure.md: build row names Check G', LIVE.structure.split('\n').map((l) => (l.startsWith('| build |') ? l.split('Check G').join('Check') : l)).join('\n')],
  ];
  for (const [label, structure] of cases) {
    assert.notStrictEqual(structure, LIVE.structure, `${label}: the mutation must change the text`);
    assert.throws(() => assertG({ ...LIVE, structure }), names(label));
  }
});
