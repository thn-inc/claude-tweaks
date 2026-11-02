'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

// #4826: the post-fan-out untracked-file sweep moved out of review/step3-lens-dispatch.md
// into review/step3-fanout-sweep.md for Read-rail headroom. step3-lens-dispatch.md keeps
// the heading plus a read-condition stub; the other citers route to the sub-file by name.

const OLD_CITATIONS = [
  "`step3-lens-dispatch.md`'s Post-fan-out",
  "`step3-lens-dispatch.md`'s post-fan-out",
  'sweep (`step3-lens-dispatch.md`)',
  '`step3-lens-dispatch.md` defines the post-fan-out',
  'sweep callers check their subdir too (`step3-lens-dispatch.md`)',
];

function stubSection(dispatch) {
  const m = /^## Post-fan-out untracked-file sweep\n\n([^\n]*)/m.exec(dispatch);
  return m ? m[1] : '';
}

// Returns the list of failed facts; [] when the split is intact.
function missing({ dispatch, sweep, citers }) {
  const out = [];
  const fact = (name, ok) => { if (!ok) out.push(name); };
  const stub = stubSection(dispatch);
  fact('stub read condition',
    /Before returning to Step 3 Routing/.test(stub) &&
    /read `step3-fanout-sweep\.md` in this skill's directory/.test(stub));
  fact('checks left step3-lens-dispatch.md',
    !dispatch.includes('**Leftover-listener check.**') && !dispatch.includes('**Agent-scratch cleanup check.**'));
  fact('sweep moved',
    ['**Leftover-listener check.**', '**Agent-scratch cleanup check.**',
      'git status --porcelain --untracked-files=all',
      'STAGED {HH:MM:SS} — Review fan-out left {n} untracked file(s): {paths}. Not deleted. Reversibility: n/a.']
      .every((s) => sweep.includes(s)));
  for (const [name, text] of Object.entries(citers)) {
    fact(`${name} names step3-fanout-sweep.md`, text.includes('`step3-fanout-sweep.md`'));
    fact(`${name} has no old citation`, !OLD_CITATIONS.some((s) => text.includes(s)));
  }
  return out;
}

const load = () => ({
  dispatch: read('plugin/skills/review/step3-lens-dispatch.md'),
  sweep: read('plugin/skills/review/step3-fanout-sweep.md'),
  citers: {
    'step3-debate-and-refutation.md': read('plugin/skills/review/step3-debate-and-refutation.md'),
    'step3-tiebreak.md': read('plugin/skills/review/step3-tiebreak.md'),
    'step3-cross-lens-corroboration.md': read('plugin/skills/review/step3-cross-lens-corroboration.md'),
    'step3-routing.md': read('plugin/skills/review/step3-routing.md'),
    'review-summary-template.md': read('plugin/skills/review/review-summary-template.md'),
    'subagent-output-contract.md': read('plugin/skills/_shared/subagent-output-contract.md'),
  },
});

test('AC2.1: stub read condition; the sweep moved; citers name the sub-file', () => {
  assert.deepStrictEqual(missing(load()), []);
});

test('go-red (a): the stub without its read pointer fails', () => {
  const t = load();
  const phrase = "read `step3-fanout-sweep.md` in this skill's directory";
  assert.ok(t.dispatch.includes(phrase));
  const mutated = { ...t, dispatch: t.dispatch.replace(phrase, '') };
  assert.notStrictEqual(mutated.dispatch, t.dispatch);
  assert.ok(missing(mutated).length > 0);
});

test('go-red (b): the tiebreak citation reverted to step3-lens-dispatch.md fails', () => {
  const t = load();
  const phrase = "`step3-fanout-sweep.md`'s post-fan-out untracked-file sweep";
  const tb = t.citers['step3-tiebreak.md'];
  assert.ok(tb.includes(phrase));
  const reverted = tb.replace(phrase, "`step3-lens-dispatch.md`'s Post-fan-out untracked-file sweep");
  assert.notStrictEqual(reverted, tb);
  assert.ok(missing({ ...t, citers: { ...t.citers, 'step3-tiebreak.md': reverted } }).length > 0);
});

test('go-red (c): the output-contract scratch-rule citation reverted to step3-lens-dispatch.md fails', () => {
  const t = load();
  const name = 'subagent-output-contract.md';
  const phrase = 'sweep callers check their subdir too (`step3-fanout-sweep.md`)';
  const contract = t.citers[name];
  assert.ok(contract.includes(phrase));
  const reverted = contract.replace(phrase, 'sweep callers check their subdir too (`step3-lens-dispatch.md`)');
  assert.notStrictEqual(reverted, contract);
  assert.ok(missing({ ...t, citers: { ...t.citers, [name]: reverted } }).includes(`${name} has no old citation`));
});
