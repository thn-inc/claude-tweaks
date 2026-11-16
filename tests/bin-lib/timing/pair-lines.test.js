'use strict';
// tests/bin-lib/timing/pair-lines.test.js — #5556: the review pair-line reader and its prose pin.
//
// Producers of the pair lines (git grep -n -F 'Reproduction: lens' -- plugin):
//   plugin/skills/review/step3-lens-dispatch.md  — the seven pair templates (pinned below)
//   plugin/bin/lib/tiebreak.js, plugin/bin/lib/console/resolve.js — the tiebreak forms,
//     owned by parseTiebreakLine (a pair-lines null, asserted below)
// Mentions that are not producers: release/SKILL.md (quotes one template), review/step3-tier-variants.md
// (a partner-died line, not a pair form — it is review-marked and lands in a caller's `unparsed`).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('../../helpers/read-skill');
const { PAIR_FORMS, JUDGE_NONE, classifyPairLine, isReviewMarkedLine } = require('../../../plugin/bin/lib/timing/pair-lines');

const SKILL = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'review', 'step3-lens-dispatch.md');
const RULE = 'pair-line patterns are additive: add a pattern for the new wording, never replace one, so archived runs keep parsing';

const L = (status, action) => `- ${status} 10:00:00 — ${action}`;
const R = 'Reversibility: high.';

const CASES = [
  ['reproduced', L('AUTO', `Reproduction: lens "3a" finding plugin/x.js:12 reproduced. Confirmed. ${R}`), { lens: '3a', path: 'plugin/x.js', line: 12 }],
  ['reproduced-severity-contested', L('AUTO', `Reproduction: lens "3b" finding plugin/x.js:12 reproduced, severity contested (took the lower of the two). Confirmed. ${R}`), { lens: '3b', path: 'plugin/x.js', line: 12 }],
  ['not-reproduced', L('STAGED', `Reproduction: lens "3c" finding plugin/x.js:12 not reproduced. Staged to Review Console as low-confidence. ${R}`), { lens: '3c', path: 'plugin/x.js', line: 12 }],
  ['absence-refuted', L('AUTO', `Reproduction: lens "3d" absence claim plugin/x.js:foo refuted by ground-truth check (grep -n foo plugin/x.js found it at plugin/x.js:40). Not staged. ${R}`), { lens: '3d', path: 'plugin/x.js', line: null }],
  ['vacuity-downgraded', L('STAGED', `Reproduction: lens "3f" vacuity finding plugin/x.js:12 downgraded to unconfirmed — reproduction agreement overridden, no execution evidence. Staged to Review Console as low-confidence. ${R}`), { lens: '3f', path: 'plugin/x.js', line: 12 }],
  ['vacuity-reconfirmed', L('AUTO', `Reproduction: lens "3f" vacuity finding plugin/x.js:12 re-confirmed by executed run: node --test x → 1 failing. Confirmed. ${R}`), { lens: '3f', path: 'plugin/x.js', line: 12 }],
  ['coincidence', L('STAGED', `Reproduction: lens "3e" findings plugin/x.js:12 / plugin/x.js:14 share a location but not substance; both staged unconfirmed. ${R}`), { lens: '3e', path: 'plugin/x.js', line: 12 }],
];

for (const [id, line, want] of CASES) {
  test(`AC3.2: pair form ${id} classifies its template`, () => {
    assert.deepEqual(classifyPairLine(line), { form: id, ...want });
    // The action text alone (what parseEntry returns) classifies the same.
    const action = line.replace(/^- \w+ \d{2}:\d{2}:\d{2} — /, '');
    assert.deepEqual(classifyPairLine(action), { form: id, ...want });
    // A writer-labelled line (`— log-decision: Reproduction: …`, the archived shape) classifies the same.
    const labelled = line.replace(' — Reproduction:', ' — log-decision: Reproduction:');
    assert.deepEqual(classifyPairLine(labelled), { form: id, ...want });
  });
}

test('AC3.2: a path containing a space still parses', () => {
  const r = classifyPairLine(L('AUTO', `Reproduction: lens "3a" finding docs/a b.md:4 reproduced. Confirmed. ${R}`));
  assert.deepEqual(r, { form: 'reproduced', lens: '3a', path: 'docs/a b.md', line: 4 });
});

test('AC3.2: a coincidence whose second path differs is not a pair line', () => {
  assert.equal(classifyPairLine(L('STAGED', `Reproduction: lens "3e" findings a.js:1 / b.js:2 share a location but not substance; both staged unconfirmed. ${R}`)), null);
});

test('AC3.2: a tiebreak confirmation line is not a pair line (parseTiebreakLine owns it)', () => {
  assert.equal(classifyPairLine(`- AUTO 10:00:00 — Reproduction: lens "3a" finding x.js:3 confirmed by tiebreak:0123456789ab. Confirmed. ${R}`), null);
  assert.equal(classifyPairLine('- AUTO 10:00:00 — Reproduction: lens "3a" finding x.js:3 confirmed by tiebreak:0123456789ab. Confirmed.'), null);
});

test('AC3.2: a truncated reproduced line returns null (whole-input anchoring)', () => {
  assert.equal(classifyPairLine('- AUTO 10:00:00 — Reproduction: lens "3a" finding plugin/x.js:12 reproduced.'), null);
  assert.equal(classifyPairLine('- AUTO 10:00:00 — Reproduction: lens "3a" finding plugin/x.js:12 reproduced. Confirmed.'), null);
});

test('AC3.2: a reproduced line with trailing junk returns null (whole-input anchoring)', () => {
  assert.equal(classifyPairLine(L('AUTO', `Reproduction: lens "3a" finding plugin/x.js:12 reproduced. Confirmed. ${R} extra`)), null);
});

test('AC3.2: counters match Decision 3', () => {
  const got = Object.fromEntries(PAIR_FORMS.map((f) => [f.id, [f.counts.both, f.counts.one, f.counts.relabel]]));
  assert.deepEqual(got, {
    reproduced: [1, 0, 0],
    'reproduced-severity-contested': [1, 0, 0],
    'not-reproduced': [0, 1, 0],
    'absence-refuted': [0, 1, 0],
    'vacuity-downgraded': [0, 0, 1],
    'vacuity-reconfirmed': [0, 1, 0],
    coincidence: [0, 2, 0],
  });
  assert.ok(Object.isFrozen(PAIR_FORMS));
});

test('isReviewMarkedLine and JUDGE_NONE', () => {
  assert.equal(isReviewMarkedLine('- AUTO 10:00:00 — Reproduction: lens "3a" x'), true);
  assert.equal(isReviewMarkedLine('- AUTO 10:00:00 — Tiebreak tiebreak:0123456789ab: lens "3a"'), true);
  assert.equal(isReviewMarkedLine('- AUTO 10:00:00 — build: wrote the file'), false);
  assert.equal(JUDGE_NONE, 'judge: none');
});

// --- Prose pin: the live templates are the only producer of the pair lines. ---

const FILL = [
  ['{observed output}', '1 failing'], ['{command}', 'grep -n foo plugin/x.js'], ['{symbol}', 'foo'],
  ['{lineA}', '12'], ['{lineB}', '14'], ['{line}', '12'], ['{path}', 'plugin/x.js'], ['{lens}', '3a'],
];

function liveTemplates() {
  const text = readText(SKILL);
  const spans = [];
  for (const m of text.matchAll(/`([^`\n]*— Reproduction:[^`\n]*)`/g)) spans.push(m[1]);
  return spans.map((s) => s.replace(/^\{?\w+\}? \{HH:MM:SS\} — /, ''));
}

function fill(template) {
  let out = template;
  for (const [k, v] of FILL) out = out.split(k).join(v);
  return out;
}

function matchingForms(action) {
  return PAIR_FORMS.filter((f) => f.pattern.some((re) => re.test(action))).map((f) => f.id);
}

test('AC3.3: every pair-line template in step3-lens-dispatch.md matches its pattern', () => {
  const templates = liveTemplates();
  assert.equal(templates.length, PAIR_FORMS.length, `step3-lens-dispatch.md holds ${templates.length} pair templates, PAIR_FORMS has ${PAIR_FORMS.length} — ${RULE}`);
  const matched = [];
  for (const t of templates) {
    const filled = fill(t);
    assert.ok(!/[{}]/.test(filled), `a placeholder survived filling: ${filled}`);
    const forms = matchingForms(filled);
    assert.equal(forms.length, 1, `template "${t}" matches forms [${forms.join(', ')}], expected exactly one — ${RULE}`);
    assert.equal(PAIR_FORMS.find((f) => f.id === forms[0]).template, t, `form ${forms[0]} template text drifted from the prose — ${RULE}`);
    matched.push(forms[0]);
  }
  assert.deepEqual(matched.sort(), PAIR_FORMS.map((f) => f.id).sort());
});

test('AC3.3: a reworded template matches no form (go-red control)', () => {
  const [first] = liveTemplates();
  assert.ok(first.includes('reproduced.'));
  const mutated = fill(first).replace('reproduced.', 'was reproduced.');
  assert.deepEqual(matchingForms(mutated), []);
  assert.equal(classifyPairLine(mutated), null);
});
