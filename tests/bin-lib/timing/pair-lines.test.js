'use strict';
// tests/bin-lib/timing/pair-lines.test.js — #5556: the review pair-line reader and its prose pin.
//
// Producers of the pair lines (git grep -n -F 'Reproduction: lens' -- plugin):
//   plugin/skills/review/step3-lens-dispatch.md  — the seven pair templates (pinned below)
//   plugin/skills/review/step3-tier-variants.md  — the single-read-coverage notice (pinned below)
//   plugin/bin/lib/tiebreak.js, plugin/bin/lib/console/resolve.js — the tiebreak forms,
//     owned by parseTiebreakLine (a pair-lines null, asserted below)
// Mention that is not a producer: release/SKILL.md (quotes one template).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('../../helpers/read-skill');
const { PAIR_FORMS, LEGACY_FORMS, ALL_FORMS, JUDGE_NONE, classifyPairLine, isReviewMarkedLine } = require('../../../plugin/bin/lib/timing/pair-lines');

const SKILL_DIR = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'review');
const SKILL = path.join(SKILL_DIR, 'step3-lens-dispatch.md');
const TIER = path.join(SKILL_DIR, 'step3-tier-variants.md');
const COVERAGE_PHRASES = ['session limit twice', 'unavailable', 'timed out'];
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
    'single-read-coverage': [0, 0, 0],
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

// --- Legacy wording (additive): every line below is a real line from an archived decisions.md. ---

const RH = 'Reversibility: high.';
const LEGACY_CASES = [
  // [label, line, expected]
  ['doubled Reversibility tail (log-decision label)',
    `- STAGED 00:23:59 — log-decision: Reproduction: lens "3f" finding plugin/bin/lib/issues/grouping.js:286 not reproduced. Staged to Review Console as low-confidence. ${RH} ${RH}`,
    { form: 'not-reproduced', lens: '3f', path: 'plugin/bin/lib/issues/grouping.js', line: 286 }],
  ['Stage path clause',
    `- STAGED 00:01:54 — log-decision: Reproduction: lens "3a" finding plugin/bin/lib/flow/preflight.js:278 not reproduced. Staged to Review Console as low-confidence. Stage path: staged/review-unconfirmed-1.md. ${RH}`,
    { form: 'not-reproduced', lens: '3a', path: 'plugin/bin/lib/flow/preflight.js', line: 278 }],
  ['label without a colon (Delta Reproduction:)',
    `- STAGED 22:32:38 — Delta Reproduction: lens "3a" finding plugin/skills/tidy/SKILL.md:130 not reproduced. Staged to Review Console as low-confidence. ${RH}`,
    { form: 'not-reproduced', lens: '3a', path: 'plugin/skills/tidy/SKILL.md', line: 130 }],
  ['Reproduction: delta: tag',
    `- STAGED 22:19:02 — Reproduction: delta: lens "3a" finding plugin/bin/lib/phase-exit/phase-exit.js:285 not reproduced. Staged to Review Console as low-confidence. ${RH}`,
    { form: 'not-reproduced', lens: '3a', path: 'plugin/bin/lib/phase-exit/phase-exit.js', line: 285 }],
  ['Reproduction: #4169: tag',
    `- AUTO 22:53:50 — Reproduction: #4169: lens "3a" finding plugin/bin/lib/issues/record-payload.js:104 reproduced. Confirmed. ${RH}`,
    { form: 'reproduced', lens: '3a', path: 'plugin/bin/lib/issues/record-payload.js', line: 104 }],
  ['unquoted lens',
    `- STAGED 00:55:31 — Reproduction: lens 3a finding tests/bin-lib/issues/local-store.test.js:46 not reproduced. Staged to Review Console as low-confidence. ${RH}`,
    { form: 'not-reproduced', lens: '3a', path: 'tests/bin-lib/issues/local-store.test.js', line: 46 }],
  ['parenthetical on the location',
    `- STAGED 00:55:31 — Reproduction: lens 3a finding plugin/bin/lib/release/subject.js:1 (agent B, zero-read) not reproduced. Staged to Review Console as low-confidence. ${RH}`,
    { form: 'not-reproduced', lens: '3a', path: 'plugin/bin/lib/release/subject.js', line: 1 }],
  ['Step label without a colon plus a note after the verb',
    `- AUTO 09:49:39 — Step 3 reproduction: Reproduction: lens "3b" finding plugin/bin/lib/issues/record-payload.js:107 reproduced (backtick-fence info string containing a backtick). Confirmed. ${RH}`,
    { form: 'reproduced', lens: '3b', path: 'plugin/bin/lib/issues/record-payload.js', line: 107 }],
  ['commentary after Confirmed',
    `- AUTO 22:28:46 — Step 3: Reproduction: lens "3a" finding plugin/bin/lib/reconcile/cache.js:220 reproduced (uncanonicalized root). Confirmed — duplicate of ledger row 6 (deferred, fails safe: stored run-dir paths share the root's derivation, so canonicalizing only the root would misjudge them); no new row. ${RH}`,
    { form: 'reproduced', lens: '3a', path: 'plugin/bin/lib/reconcile/cache.js', line: 220 }],
  ['parenthetical commentary after Confirmed',
    `- AUTO 16:58:47 — Step 3: Reproduction: lens "3c" finding plugin/bin/wrap-up-engine.js:215 reproduced. Confirmed (direct read: resolveRepoRoot returns --git-common-dir parent = main checkout, now fed to gatherFacts). ${RH}`,
    { form: 'reproduced', lens: '3c', path: 'plugin/bin/wrap-up-engine.js', line: 215 }],
  ['severity contested with a note inside the parenthesis',
    `- AUTO 00:58:59 — Reproduction: lens 3c finding plugin/bin/lib/compose-subject.js:176 reproduced, severity contested (took the lower of the two: medium). Confirmed. ${RH}`,
    { form: 'reproduced-severity-contested', lens: '3c', path: 'plugin/bin/lib/compose-subject.js', line: 176 }],
  ['not reproduced, then a parenthesis on the staging clause',
    `- STAGED 00:57:58 — log-decision: Reproduction: lens "3b" finding plugin/skills/build/adopted-branch-collision-check.md:44 not reproduced. Staged to Review Console as low-confidence (records parse of the owner field). ${RH}`,
    { form: 'not-reproduced', lens: '3b', path: 'plugin/skills/build/adopted-branch-collision-check.md', line: 44 }],
  ['not reproduced, handed to the tiebreak',
    `- STAGED 11:56:40 — Step 3 reproduction: Reproduction: lens "3e" finding plugin/bin/lib/hooks/run-dir-resolve.js:333 not reproduced; handed to the tiebreak. ${RH}`,
    { form: 'not-reproduced', lens: '3e', path: 'plugin/bin/lib/hooks/run-dir-resolve.js', line: 333 }],
  ['no status time (the earliest archived shape)',
    `- STAGED — Reproduction: lens "3b (Security)" finding skills/review/SKILL.md (Per-Candidate Refutation Pass template) not reproduced (1 of 2 agents). Staged to Review Console as low-confidence. ${RH}`,
    { form: 'not-reproduced', lens: '3b (Security)', path: 'skills/review/SKILL.md', line: null }],
  ['reproduced by both agents, then more findings in the same line',
    `- AUTO 23:18:14 — log-decision: Reproduction: lens 3b finding record.js:384 (lone CR / line separators pass the single-line guard) reproduced by both agents. Confirmed. Lens 3f findings harness-health.js:286 (repoRoot wiring untested) and record.test.js:1200 (non-discriminating test, severity contested - took lower) and conformance test AC6.1 precision reproduced. Confirmed. ${RH}`,
    { form: 'reproduced', lens: '3b', path: 'record.js', line: 384 }],
  ['direct-verification override',
    `- AUTO 18:38:30 — Step 3 reproduction: Reproduction: lens "3c" finding plugin/bin/lib/timing/transcript.js:250 elevated via direct-verification override (source read independently). Confirmed. ${RH}`,
    { form: 'direct-verification-elevated', lens: '3c', path: 'plugin/bin/lib/timing/transcript.js', line: 250 }],
  ['direct-verification override with no lens and a severity word',
    `- AUTO 22:53:51 — Reproduction: #4169: plugin/bin/lib/issues/record-payload.js:104 elevated via direct-verification override (executed probe / source read). Confirmed medium. ${RH}`,
    { form: 'direct-verification-elevated', lens: null, path: 'plugin/bin/lib/issues/record-payload.js', line: 104 }],
  ['no-findings notice, two lenses',
    '- AUTO 06:40:39 — log-decision: Reproduction: lens "3b" and lens "3c" both agents returned No findings. Reversibility: n/a.',
    { form: 'no-findings', lens: '3b', path: null, line: null }],
  ['no-findings notice with a dash',
    `- AUTO 20:33:18 — Reproduction: lens "3b" — both agents returned No findings. ${RH}`,
    { form: 'no-findings', lens: '3b', path: null, line: null }],
  ['console disposition of a staged finding',
    '- AUTO 20:08:06 — Review Console: Console item decision:STAGED 19:19:02 — log-decision: Reproduction: lens "3a" fi#46a4cb4a (Low-confidence findings): keep-staged — unconfirmed finding — no Approve-all default; never auto-applied. Reversibility: n/a.',
    { form: 'console-disposition', lens: null, path: null, line: null }],
];

for (const [label, line, want] of LEGACY_CASES) {
  test(`legacy wording: ${label}`, () => {
    assert.deepEqual(classifyPairLine(line), want);
  });
}

test('legacy wording: a console disposition is never read as the pair line it restates', () => {
  const restated = '- AUTO 20:08:06 — Review Console: Console item decision:STAGED 19:19:02 — Reproduction: lens "3a" finding plugin/x.js:12 not reproduced. Staged to Review Console as low-confidence. Reversibility: high.';
  assert.equal(classifyPairLine(restated), null, 'a label naming the Review Console is not a writer label');
});

test('legacy wording: lines carrying no recognised verdict stay unparsed', () => {
  for (const line of [
    '- AUTO 03:54:33 — Step 3 reproduction: Reproduction: lens "3a" findings plugin/bin/dispatch-resume.js:494 and plugin/bin/lib/wrap-up/engine-verify.js:398 name files this diff does not touch (git diff --stat over both paths is empty); out of the reviewed scope, dropped without a tiebreak. Reversibility: high. Reversibility: high.',
    '- AUTO 03:54:33 — Step 3 reproduction: Reproduction: lens "3f" finding for AC8 (no hook event path reads a transcript) is evidence-only per the build plan; still routed through tiebreak below. Reversibility: n/a. Reversibility: high.',
    '- STAGED 11:11:23 — Reproduction: 5 unconfirmed findings staged to Review Console as low-confidence. Stage path: staged/review-unconfirmed-3.md. Reversibility: high.',
  ]) assert.equal(classifyPairLine(line), null, line);
});

test('legacy wording: the free-commentary patterns still refuse a bare truncation and a bare tail', () => {
  assert.equal(classifyPairLine('- AUTO 10:00:00 — Reproduction: lens "3a" finding plugin/x.js:12 reproduced. Confirmed.'), null);
  assert.equal(classifyPairLine('- AUTO 10:00:00 — Reproduction: lens "3a" finding plugin/x.js:12 reproduced. Confirmed. Reversibility: high. extra'), null);
  assert.equal(classifyPairLine('- STAGED 10:00:00 — Reproduction: lens "3a" finding plugin/x.js:12 not reproduced.'), null);
});

test('legacy forms: ids are distinct from the prose-pinned forms, counts follow Decision 3', () => {
  assert.deepEqual(ALL_FORMS.map((f) => f.id), [...PAIR_FORMS, ...LEGACY_FORMS].map((f) => f.id));
  assert.equal(new Set(ALL_FORMS.map((f) => f.id)).size, ALL_FORMS.length);
  assert.deepEqual(Object.fromEntries(LEGACY_FORMS.map((f) => [f.id, [f.counts.both, f.counts.one, f.counts.relabel]])), {
    'direct-verification-elevated': [0, 1, 0],
    'no-findings': [0, 0, 0],
    'console-disposition': [0, 0, 0],
  });
  assert.ok(Object.isFrozen(LEGACY_FORMS) && Object.isFrozen(ALL_FORMS));
});

// --- Prose pin: the live templates are the only producer of the pair lines. ---

const FILL = [
  ['{observed output}', '1 failing'], ['{command}', 'grep -n foo plugin/x.js'], ['{symbol}', 'foo'],
  ['{lineA}', '12'], ['{lineB}', '14'], ['{line}', '12'], ['{path}', 'plugin/x.js'], ['{lens}', '3a'],
];

function liveTemplates(file = SKILL) {
  const text = readText(file);
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
  const tier = liveTemplates(TIER);
  assert.equal(tier.length, 1, `step3-tier-variants.md holds ${tier.length} pair templates, expected 1 — ${RULE}`);
  const templates = [...liveTemplates(SKILL), ...tier];
  assert.equal(templates.length, PAIR_FORMS.length, `step3-lens-dispatch.md holds ${templates.length} pair templates, PAIR_FORMS has ${PAIR_FORMS.length} — ${RULE}`);
  const matched = [];
  for (const t of templates) {
    const filled = fill(t.replace(/\{session limit twice \| unavailable \| timed out\}/, COVERAGE_PHRASES[0]));
    assert.ok(!/[{}]/.test(filled), `a placeholder survived filling: ${filled}`);
    const forms = matchingForms(filled);
    assert.equal(forms.length, 1, `template "${t}" matches forms [${forms.join(', ')}], expected exactly one — ${RULE}`);
    assert.equal(PAIR_FORMS.find((f) => f.id === forms[0]).template, t, `form ${forms[0]} template text drifted from the prose — ${RULE}`);
    matched.push(forms[0]);
  }
  assert.deepEqual(matched.sort(), PAIR_FORMS.map((f) => f.id).sort());
});

test('AC3.3: each single-read-coverage alternation filling matches that form', () => {
  const [t] = liveTemplates(TIER);
  for (const phrase of COVERAGE_PHRASES) {
    const filled = fill(t.replace(/\{session limit twice \| unavailable \| timed out\}/, phrase));
    assert.ok(!/[{}]/.test(filled), filled);
    assert.deepEqual(matchingForms(filled), ['single-read-coverage'], phrase);
    assert.deepEqual(classifyPairLine(`- STAGED 10:00:00 — ${filled}`), { form: 'single-read-coverage', lens: '3a', path: null, line: null });
  }
  assert.equal(matchingForms(fill(t.replace(/\{[^}]*\|[^}]*\}/, 'exploded'))).length, 0);
});

test('AC3.3: a reworded template matches no form (go-red control)', () => {
  const [first] = liveTemplates();
  assert.ok(first.includes('reproduced.'));
  const mutated = fill(first).replace('reproduced.', 'was reproduced.');
  assert.deepEqual(matchingForms(mutated), []);
  assert.equal(classifyPairLine(mutated), null);
});
