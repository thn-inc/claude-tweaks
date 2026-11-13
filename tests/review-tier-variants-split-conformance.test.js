'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

// #4826: the paragraphs of review/step3-lens-dispatch.md that a `medium`/`high` review whose
// lens agents all return never reads — the `low`-tier skip and single-read dispatch, the
// `xhigh`/`max` effortLine append, the partner-died degrade, and the run-level no-Agent note —
// moved to review/step3-tier-variants.md for Read-rail headroom. Each pointer left behind reads
// the sub-file on its condition only, never at every tier (docs/skill-authoring.md forbids a
// "read X now" split that every run follows).

const lineStartingWith = (text, prefix) => text.split('\n').find((line) => line.startsWith(prefix)) || '';

const POINTERS = [
  ['**Tier variants (`low`, `xhigh`, `max`).**',
    [/When the resolved tier is `low`, `xhigh` or `max`, read `step3-tier-variants\.md`/, /At `medium` and `high`, neither applies/]],
  ['> **Partner death or unavailable lens agent.**',
    [/read `step3-tier-variants\.md`'s partner-died paragraph/, /A pair whose two agents both return never reads it/]],
  ['> **No-`Agent` probe (run-level, #4555).**',
    [/None found → read `step3-tier-variants\.md`'s run-level no-`Agent` note/, /found → skip it/]],
];

const MOVED = [
  '**No executable content (`low` only).**',
  '**Low-tier single-read dispatch (`low` only).**',
  "At `xhigh` and `max`, append the resolver's `effortLine` output",
  '> **Reproduction-pair partner dies or is unavailable.**',
  'single-read coverage. Reversibility: high.',
  '> **No `Agent` tool in this host (run-level, #4555).**',
  '--step "Step 3 lens dispatch (degraded)"',
];

// [file, phrase it must carry, old-location phrase it must not carry]
const CITERS = [
  ['plugin/skills/review/step3-routing.md', '`step3-tier-variants.md`\'s "Low-tier single-read dispatch"', '`step3-lens-dispatch.md`\'s "Low-tier single-read dispatch"'],
  ['plugin/skills/review/review-summary-template.md', "`step3-tier-variants.md`'s partner-died paragraph:}", "`step3-lens-dispatch.md`'s partner-died"],
  ['plugin/skills/review/review-summary-template.md', "`step3-tier-variants.md`'s run-level no-Agent note:}", "`step3-lens-dispatch.md`'s run-level"],
  ['plugin/skills/dispatch/task-prompt.md', "`review/step3-tier-variants.md`'s partner-died", "`review/step3-lens-dispatch.md`'s partner-died"],
  ['plugin/skills/flow/context-handoff.md', "`review/step3-tier-variants.md`'s partner-died", "`review/step3-lens-dispatch.md`'s partner-died"],
  ['plugin/skills/_shared/subagent-dispatch-core.md', "`review/step3-tier-variants.md`'s partner-died paragraph", "`review/step3-lens-dispatch.md`'s reproduction-pair section"],
  ['plugin/skills/assess-agent-autonomy/merge-check.md', "`review/step3-tier-variants.md`'s run-level note", "`review/step3-lens-dispatch.md`'s run-level note"],
];

// Deictics in step3-lens-dispatch.md that pointed at a moved paragraph.
const STALE_DEICTICS = [
  'partner-death case above',
  'plus the per-finding line above',
  'single-read treatment below',
  'the Low-tier single-read rule above',
  'The per-lens single-read lines below',
];

// Returns the list of failed facts; [] when the split is intact.
function missing({ dispatch, variants, citers, structure }) {
  const out = [];
  const fact = (name, ok) => { if (!ok) out.push(name); };
  for (const [prefix, patterns] of POINTERS) {
    const line = lineStartingWith(dispatch, prefix);
    fact(`pointer ${prefix} is conditional`,
      line !== '' && patterns.every((p) => p.test(line)) && !/every tier/i.test(line));
  }
  for (const s of MOVED) {
    fact(`moved: ${s} in step3-tier-variants.md`, variants.includes(s));
    fact(`moved: ${s} left step3-lens-dispatch.md`, !dispatch.includes(s));
  }
  fact('header names the read conditions',
    /^Read from `step3-lens-dispatch\.md` only when/m.test(variants) &&
    /A `medium` or `high` review whose lens agents all return never reads it\./.test(variants));
  for (const [file, cite, old] of CITERS) {
    fact(`${file} cites step3-tier-variants.md`, citers[file].includes(cite) && !citers[file].includes(old));
  }
  for (const d of STALE_DEICTICS) fact(`no stale deictic: ${d}`, !dispatch.includes(d));
  const reviewRow = lineStartingWith(structure, '| review |');
  fact('plugin-structure review row lists step3-tier-variants.md',
    reviewRow.includes('step3-lens-dispatch.md, step3-tier-variants.md,') && /step3-tier-variants\.md holds/.test(reviewRow));
  return out;
}

const load = () => ({
  dispatch: read('plugin/skills/review/step3-lens-dispatch.md'),
  variants: read('plugin/skills/review/step3-tier-variants.md'),
  citers: Object.fromEntries([...new Set(CITERS.map(([file]) => file))].map((file) => [file, read(file)])),
  structure: read('docs/plugin-structure.md'),
});

test('AC1: the pointers read step3-tier-variants.md conditionally; the split is intact', () => {
  assert.deepStrictEqual(missing(load()), []);
});

test('go-red (a): a tier pointer that reads the sub-file at every tier fails', () => {
  const t = load();
  const phrase = 'When the resolved tier is `low`, `xhigh` or `max`, read';
  assert.ok(t.dispatch.includes(phrase));
  const mutated = { ...t, dispatch: t.dispatch.replace(phrase, 'At every tier, read') };
  assert.notStrictEqual(mutated.dispatch, t.dispatch);
  assert.ok(missing(mutated).length > 0);
});

test('go-red (b): the partner-died paragraph re-inlined into step3-lens-dispatch.md fails', () => {
  const t = load();
  const paragraph = lineStartingWith(t.variants, '> **Reproduction-pair partner dies or is unavailable.**');
  assert.notStrictEqual(paragraph, '');
  const mutated = { ...t, dispatch: `${t.dispatch}\n${paragraph}\n` };
  assert.deepStrictEqual(missing(mutated), [
    'moved: > **Reproduction-pair partner dies or is unavailable.** left step3-lens-dispatch.md',
    'moved: single-read coverage. Reversibility: high. left step3-lens-dispatch.md',
  ]);
});

test('go-red (c): step3-tier-variants.md without the low-tier dispatch paragraph fails', () => {
  const t = load();
  const lead = '**Low-tier single-read dispatch (`low` only).**';
  const mutated = { ...t, variants: t.variants.split('\n').filter((line) => !line.startsWith(lead)).join('\n') };
  assert.notStrictEqual(mutated.variants, t.variants);
  assert.ok(missing(mutated).includes(`moved: ${lead} in step3-tier-variants.md`));
});

test('go-red (d): a citer reverted to the old location fails', () => {
  const t = load();
  const file = 'plugin/skills/dispatch/task-prompt.md';
  const mutated = {
    ...t,
    citers: { ...t.citers, [file]: t.citers[file].replace('review/step3-tier-variants.md', 'review/step3-lens-dispatch.md') },
  };
  assert.notStrictEqual(mutated.citers[file], t.citers[file]);
  assert.deepStrictEqual(missing(mutated), [`${file} cites step3-tier-variants.md`]);
});
