'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

// #4826: Spec Step 2.5's Manual Steps probe-and-triage procedure moved out of
// build/SKILL.md into build/manual-steps.md for Read-rail headroom. SKILL.md keeps
// the read condition and the skip line; the two readers of the triage (the stub and
// operational-checklist.md's Common Step 5.5) route to the sub-file by name.

function step25(skill) {
  const start = skill.indexOf('### Spec Step 2.5');
  const end = skill.indexOf('### Spec Step 3', start);
  return start === -1 || end === -1 ? '' : skill.slice(start, end);
}

// Returns the list of failed facts; [] when the split is intact.
function missing({ skill, steps, checklist, ledger }) {
  const out = [];
  const section = step25(skill);
  const fact = (name, ok) => { if (!ok) out.push(name); };
  fact('stub routes the Manual Steps case',
    /read `manual-steps\.md` in this skill's directory/.test(section) && /## Manual Steps/.test(section));
  fact('Step 5.5 cites manual-steps.md',
    /read `manual-steps\.md` in this skill's directory and apply its triage/.test(checklist) &&
    !checklist.includes('apply the Step 2.5 triage'));
  fact('stub routes the wholly operational case',
    /every `## Deliverables` item is operational/.test(section) && /\(#2554\)/.test(section));
  fact('skip line stays',
    /\*\*No Manual Steps section \(skip\):\*\* write one `SKIP` entry/.test(section));
  fact('triage left SKILL.md',
    !section.includes('**Auth-gap**') && !section.includes('**Truly manual**') &&
    !section.includes('**Anti-pattern:** Seeding the entire Manual Steps section'));
  fact('triage lives in manual-steps.md',
    ['**Auth-gap**', '**Truly manual**', '**Anti-pattern:** Seeding the entire Manual Steps section',
      '(reason-not-auto: user-declined)', '**`ops=confirm` token:**',
      "If the ledger doesn't exist, create it using the ledger skill's create operation."]
      .every((s) => steps.includes(s)));
  fact('ledger cites manual-steps.md',
    /`build\/manual-steps\.md`'s "If the ledger doesn't exist, create it"/.test(ledger));
  return out;
}

const load = () => ({
  skill: read('plugin/skills/build/SKILL.md'),
  steps: read('plugin/skills/build/manual-steps.md'),
  checklist: read('plugin/skills/build/operational-checklist.md'),
  ledger: read('plugin/skills/ledger/SKILL.md'),
});

test('AC2.1: stub routes the Manual Steps case; the split is intact', () => {
  assert.deepStrictEqual(missing(load()), []);
});

test('go-red (a): SKILL.md without the read pointer fails', () => {
  const t = load();
  const phrase = "read `manual-steps.md` in this skill's directory";
  assert.ok(t.skill.includes(phrase));
  const mutated = { ...t, skill: t.skill.replace(phrase, '') };
  assert.notDeepStrictEqual(mutated.skill, t.skill);
  assert.ok(missing(mutated).length > 0);
});

test('go-red (b): manual-steps.md without the Auth-gap bullet fails', () => {
  const t = load();
  const mutated = { ...t, steps: t.steps.replace('**Auth-gap**', 'Auth gap') };
  assert.notStrictEqual(mutated.steps, t.steps);
  assert.ok(missing(mutated).length > 0);
});

test('go-red (c): operational-checklist.md reverted to the Step 2.5 triage phrase fails', () => {
  const t = load();
  const phrase = "read `manual-steps.md` in this skill's directory and apply its triage";
  assert.ok(t.checklist.includes(phrase));
  const mutated = { ...t, checklist: t.checklist.replace(phrase, 'apply the Step 2.5 triage') };
  assert.notStrictEqual(mutated.checklist, t.checklist);
  assert.ok(missing(mutated).length > 0);
});
