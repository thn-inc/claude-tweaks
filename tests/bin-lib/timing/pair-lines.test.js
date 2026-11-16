'use strict';
// tests/bin-lib/timing/pair-lines.test.js — #5556: the review pair-line reader and its producer pin.
//
// Producers of the pair lines (git grep -n -F 'Reproduction: lens' -- plugin):
//   plugin/bin/lib/reproduction-log.js           — the seven pair forms (#5595; pinned below to PAIR_FORMS)
//   plugin/skills/review/step3-tier-variants.md  — the single-read-coverage notice (pinned below)
//   plugin/bin/lib/tiebreak.js, plugin/bin/lib/console/resolve.js — the tiebreak forms,
//     owned by parseTiebreakLine (a pair-lines null, asserted below)
// Mention that is not a producer: release/SKILL.md (quotes form 1, naming the composer; pinned below to rl.reproduced).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('../../helpers/read-skill');
const { PAIR_FORMS, LEGACY_FORMS, ALL_FORMS, JUDGE_NONE, classifyPairLine, isReviewMarkedLine, entryLine, isJudgeNone } = require('../../../plugin/bin/lib/timing/pair-lines');
const rl = require('../../../plugin/bin/lib/reproduction-log');
const { formatEntry } = require('../../../plugin/bin/lib/log-decision/append');

const SKILL_DIR = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'review');
const TIER = path.join(SKILL_DIR, 'step3-tier-variants.md');
const RELEASE = path.join(SKILL_DIR, '..', 'release', 'SKILL.md');
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

test('#5595: an unlocated not-reproduced line (no :line) classifies with line null; a located one keeps its line', () => {
  const unlocated = L('STAGED', `Reproduction: lens "3c" finding plugin/x.js not reproduced. Staged to Review Console as low-confidence. ${R}`);
  assert.deepEqual(classifyPairLine(unlocated), { form: 'not-reproduced', lens: '3c', path: 'plugin/x.js', line: null });
  assert.deepEqual(classifyPairLine(unlocated.replace('plugin/x.js', 'docs/a b.md')), { form: 'not-reproduced', lens: '3c', path: 'docs/a b.md', line: null });
  assert.deepEqual(classifyPairLine(unlocated.replace('plugin/x.js', 'plugin/x.js:12')), { form: 'not-reproduced', lens: '3c', path: 'plugin/x.js', line: 12 });
});

// A located line carrying a note keeps its path and line: the unlocated pattern, tried first among the strict
// ones, must not read the note as part of a path. (Archived line, verbatim: archive/2026-10-20T124340-record-3048.)
test('#5595: a located not-reproduced line with a note keeps its line (the unlocated pattern never takes it)', () => {
  const noted = '- STAGED 18:13:35 — Reproduction: lens "3c" finding plugin/bin/lib/verify/changed-files.js:78 (exit-1 message says "no usable stamp anchor" under --ignore-stamp) not reproduced. Staged to Review Console as low-confidence. Reversibility: high.';
  assert.deepEqual(classifyPairLine(noted), { form: 'not-reproduced', lens: '3c', path: 'plugin/bin/lib/verify/changed-files.js', line: 78 });
  // A line range: no strict located pattern reads it, so the loose one must, not the unlocated strict one.
  assert.deepEqual(classifyPairLine(L('STAGED', `Reproduction: lens "3c" finding plugin/x.js:12-14 not reproduced. Staged to Review Console as low-confidence. ${R}`)),
    { form: 'not-reproduced', lens: '3c', path: 'plugin/x.js', line: 12 });
  // A dash-led note after an unlocated path is no pair line either: the unlocated path never holds ` — `.
  assert.equal(classifyPairLine(L('STAGED', `Reproduction: lens "3c" finding tests/x.test.js — no test for the guard not reproduced. Staged to Review Console as low-confidence. ${R}`)), null);
  // A path holding ` (` is read by the located pattern but not unlocated (it cannot be told from a note); the
  // composer's unlocated form 3 for such a path is therefore no pair line (#5595).
  assert.equal(classifyPairLine(L('STAGED', `Reproduction: lens "3c" finding docs/a (b).md not reproduced. Staged to Review Console as low-confidence. ${R}`)), null);
  assert.deepEqual(classifyPairLine(L('STAGED', `Reproduction: lens "3c" finding docs/a (b).md:4 not reproduced. Staged to Review Console as low-confidence. ${R}`)),
    { form: 'not-reproduced', lens: '3c', path: 'docs/a (b).md', line: 4 });
  // A noted line with no location is no pair line (as before #5595).
  assert.equal(classifyPairLine(L('STAGED', `Reproduction: lens "3c" finding tests/x.test.js (no test for the guard) not reproduced. Staged to Review Console as low-confidence. ${R}`)), null);
});

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

test('AC3.2: each pair form counts the both / one / relabel totals the docs table names', () => {
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

test('entryLine: a line that starts with the dash is returned as is, a dash-less status line gains one', () => {
  assert.equal(entryLine('- AUTO 10:00:00 — x'), '- AUTO 10:00:00 — x');
  assert.equal(entryLine('AUTO 10:00:00 — x'), '- AUTO 10:00:00 — x');
  assert.equal(entryLine('-AUTO 10:00:00 — x'), '- -AUTO 10:00:00 — x');
});

test('isJudgeNone: the marker counts before the first Evidence clause, never inside the quoted evidence', () => {
  assert.equal(isJudgeNone(`- AUTO 10:00:00 — Tiebreak tiebreak:0123456789ab: lens "3b" finding a.js:3 dropped: ${JUDGE_NONE}. Severity: low.`), true);
  assert.equal(isJudgeNone(`- AUTO 10:00:00 — x ${JUDGE_NONE} y Evidence: a.js:3 "${JUDGE_NONE}"`), true, 'before the delimiter');
  assert.equal(isJudgeNone(`- AUTO 10:00:00 — x dropped. Evidence: a.js:3 "${JUDGE_NONE}". Severity: low.`), false, 'only inside the quoted evidence');
  assert.equal(isJudgeNone('- AUTO 10:00:00 — x dropped. Evidence: a.js:3 "y".'), false);
});

// A line that repeats a delimiter must be read in time linear in its length: three unanchored groups
// in a strict pattern made a 22 KB line take seconds (a strict pattern is also tried on a line past
// the loose-pattern cap). The clock lives in perf/pair-lines-linearity.test.js (a wall-clock budget
// flakes under load in tests/); this test pins the verdicts.
test('repeated-delimiter lines of a strict pattern read as no pair line, and the real lines still parse', () => {
  const lines = [
    `Reproduction: lens "3a" absence claim ${'a:b refuted by ground-truth check (x found it at y:1). '.repeat(400)}`,
    `Reproduction: lens "3a" absence claim a:b refuted by ground-truth check (${'x found it at y:1). '.repeat(400)}`,
    `Reproduction: lens "3a" findings ${'a:1 / a:1 '.repeat(400)}`,
    `Reproduction: lens "3a" findings ${'a:1 / '.repeat(400)}share a location but not substance; both staged unconfirmed.`,
    `Reproduction: lens "3f" vacuity finding ${'a:1 re-confirmed by executed run: x → y. Confirmed. '.repeat(400)}`,
  ];
  for (const line of lines) assert.equal(classifyPairLine(line), null, `${line.slice(0, 60)}… (${line.length} chars)`);
  // The tightened groups still read the real line.
  assert.deepEqual(classifyPairLine('- AUTO 10:00:00 — Reproduction: lens "3d" absence claim a b/x.js:foo refuted by ground-truth check (grep -n foo "a b/x.js" found it at a b/x.js:40). Not staged. Reversibility: high.'),
    { form: 'absence-refuted', lens: '3d', path: 'a b/x.js', line: null });
  assert.deepEqual(classifyPairLine('- AUTO 10:00:00 — Reproduction: lens "3f" vacuity finding plugin/x.js:12 re-confirmed by executed run: node a → b → 1 failing. Confirmed. Reversibility: high.'),
    { form: 'vacuity-reconfirmed', lens: '3f', path: 'plugin/x.js', line: 12 });
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
  ['no status time (the earliest archived shape), with a location',
    `- STAGED — Reproduction: lens "3b (Security)" finding skills/review/SKILL.md:53 (Per-Candidate Refutation Pass template) not reproduced (1 of 2 agents). Staged to Review Console as low-confidence. ${RH}`,
    { form: 'not-reproduced', lens: '3b', path: 'skills/review/SKILL.md', line: 53 }],
  ['a lens label is dropped and the leading id keys the lens',
    `- AUTO 00:04:18 — spec #1921 — Reproduction: lens "3b Security" finding plugin/bin/verify.js:53 reproduced. Confirmed. ${RH}`,
    { form: 'reproduced', lens: '3b', path: 'plugin/bin/verify.js', line: 53 }],
  ['reproduced by both agents',
    `- AUTO 23:50:57 — log-decision: Reproduction: lens 3a finding plugin/skills/flow/x.md:9 (SKIP-instruction restated across consumer skills) reproduced by both agents. Confirmed, then accepted as intentional. ${RH}`,
    { form: 'reproduced', lens: '3a', path: 'plugin/skills/flow/x.md', line: 9 }],
  ['not reproduced, staged, then controller commentary before the tail',
    '- STAGED 13:40:15 — spec #3278 — Step 3 reproduction: Reproduction: lens "3a" finding plugin/skills/flow/claim-targets.md:371 not reproduced. Staged to Review Console as low-confidence. Controller read: the prose quotes the persisted ABORT_REASON literal (never-started: file-overlap group partial claim) accurately; renaming the literal is a contract change, out of scope. Reversibility: high.',
    { form: 'not-reproduced', lens: '3a', path: 'plugin/skills/flow/claim-targets.md', line: 371 }],
  ['not reproduced, staged, no Reversibility tail',
    '- STAGED 13:40:20 — spec #3278 — Step 3 reproduction: Reproduction: lens "3f" finding tests/bin-lib/dispatch/in-flight-neighbours.test.js:84 not reproduced. Staged to Review Console as low-confidence.',
    { form: 'not-reproduced', lens: '3f', path: 'tests/bin-lib/dispatch/in-flight-neighbours.test.js', line: 84 }],
  ['severity contested, then a dash and commentary',
    `- AUTO 14:38:09 — Step 3: Reproduction: lens "3f" finding tests/specify-near-duplicate-prose.test.js:263 reproduced, severity contested (took the lower of the two). Confirmed — vacuity-type claim carries execution evidence from both agents (guard deleted in scratch copy, test stayed green; assert-message echo probe). ${RH}`,
    { form: 'reproduced-severity-contested', lens: '3f', path: 'tests/specify-near-duplicate-prose.test.js', line: 263 }],
  ['direct-verification override',
    `- AUTO 18:38:30 — Step 3 reproduction: Reproduction: lens "3c" finding plugin/bin/lib/timing/transcript.js:250 elevated via direct-verification override (source read independently). Confirmed. ${RH}`,
    { form: 'direct-verification-elevated', lens: '3c', path: 'plugin/bin/lib/timing/transcript.js', line: 250 }],
  ['direct-verification override with no lens and a severity word',
    `- AUTO 22:53:51 — Reproduction: #4169: plugin/bin/lib/issues/record-payload.js:104 elevated via direct-verification override (executed probe / source read). Confirmed medium. ${RH}`,
    { form: 'direct-verification-elevated', lens: null, path: 'plugin/bin/lib/issues/record-payload.js', line: 104 }],
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

// Fix round 1 (#5556): each commentary-bearing body is whole-input anchored on one location and one verdict.
const A = '- AUTO 10:00:00 — Reproduction: lens "3a" finding a.js:1';
const NEGATIVES = [
  // [label, line] — a truncated copy of a free body, or a compound line naming a second finding or verdict
  ['reproduced, note then bare Confirmed (truncated)', `${A} (x) reproduced. Confirmed`],
  ['reproduced, note then Confirmed. (truncated)', `${A} (B) reproduced. Confirmed.`],
  ['reproduced with a delimiter and nothing after it', `${A} reproduced. Confirmed;`],
  ['reproduced by both agents (truncated)', `${A} reproduced by both agents. Confirmed`],
  ['reproduced by both agents, Confirmed. only', `${A} reproduced by both agents. Confirmed.`],
  ['severity contested with a note (truncated)', `${A} reproduced, severity contested (x). Confirmed`],
  ['not reproduced; (truncated)', `${A} not reproduced;`],
  ['not reproduced with a note (truncated)', `${A} not reproduced (1 of 2 agents)`],
  ['not reproduced, staged, then a parenthesis (truncated)', `${A} not reproduced. Staged to Review Console as low-confidence (x)`],
  ['severity contested, dash, nothing after (truncated)', `${A} reproduced, severity contested (x). Confirmed —`],
  ['not reproduced, staged, commentary naming a second verdict', `${A} not reproduced. Staged to Review Console as low-confidence. Also b.js:2 reproduced. ${RH}`],
  ['elevated (truncated)', `${A} elevated via direct-verification override`],
  ['elevated, note only (truncated)', `${A} elevated via direct-verification override (source read)`],
  ['two findings, a not-reproduced then a reproduced one', `${A} not reproduced; lens "3b" finding b.js:2 reproduced. Confirmed. ${RH}`],
  ['a location that is not a location', `${A.replace('a.js:1', 'unrelated prose with no location')} not reproduced (n/a). ${RH}`],
  ['was not reproduced; reproduced by agent B', `${A} was not reproduced; reproduced by agent B. Confirmed. ${RH}`],
  ['reproduced note then a second finding', `${A} reproduced; lens "3b" finding b.js:2 not reproduced; both noted. Confirmed; ${RH}`],
  ['commentary after Confirmed naming another finding', `${A} reproduced. Confirmed; also finding b.js:2 reproduced. ${RH}`],
  ['elevated naming a count of findings', '- AUTO 10:00:00 — Reproduction: lens "3a" 3 findings a.js:1, b.js:2 and c.js:3 elevated via direct-verification override (source read). Confirmed.'],
  ['elevated with a second verdict', `${A} elevated via direct-verification override (x); b.js:2 not reproduced. ${RH}`],
  ['two lenses in one label', '- AUTO 10:00:00 — Reproduction: lens "3a and 3b" finding a.js:1 reproduced. Confirmed; both ran. Reversibility: high.'],
];
for (const [label, line] of NEGATIVES) {
  test(`legacy wording: refused — ${label}`, () => {
    assert.equal(classifyPairLine(line), null, line);
  });
}

test('legacy wording: a review-marked line over 2000 characters is read only by the pinned templates', () => {
  const pad = ' x'.repeat(1100);
  const legacyLine = `- AUTO 10:00:00 — Step 3: Reproduction: lens "3a" finding a.js:1 reproduced (note${pad}). Confirmed. Reversibility: high.`;
  assert.ok(legacyLine.length > 2000);
  assert.equal(classifyPairLine(legacyLine), null);
  assert.deepEqual(classifyPairLine(`- AUTO 10:00:00 — Reproduction: lens "3a" finding a.js:1 reproduced. Confirmed. ${R}`), { form: 'reproduced', lens: '3a', path: 'a.js', line: 1 });
});

// Fix wave (#5556): the label before `Reproduction:` is one of the writer labels measured in the archive.
const GOOD = 'finding a.js:1 reproduced. Confirmed. Reversibility: high.';
const WRITER_LABELS = [
  '', 'log-decision: ', 'Step 3: ', 'Step 3 ', 'Step 3 reproduction: ', 'Step 3 (reproduction): ', 'Step 3 (Reproduction): ',
  'Step 3 lens 3f: ', 'Delta ', 'Delta-2 ', 'Delta review ', 'spec #4466 — ', 'spec #4466: ', 'spec #4466 — Step 3 ',
  'spec #4466 — Step 3: ', 'spec #4466 — Step 3 reproduction: ', 'Reproduction: ',
];
for (const label of WRITER_LABELS) {
  test(`writer label ${JSON.stringify(label)} is read as a pair line`, () => {
    const r = classifyPairLine(`- AUTO 10:00:00 — ${label}Reproduction: lens "3a" ${GOOD}`);
    assert.ok(r && r.form === 'reproduced', label);
  });
}

const CARRIED_LABELS = [
  'wrap-up: carried forward from review ',
  'Routing: quoting ',
  'Step 3 Routing: ',
  'log-decision: Step 3 lenses 3b/3c dispatched as 4 reproduction pairs in parallel (18 files). ',
  'Step 3: Delta review 7ca1b5df0..3267fd7e5 (#3418): combined-lens reproduction pair. ',
  'Review Console: Console item decision:STAGED 19:19:02 — ',
];
for (const label of CARRIED_LABELS) {
  test(`carried or quoted label ${JSON.stringify(label.slice(0, 40))} is not a pair line`, () => {
    // both tiers: the strict wording and a loose one
    assert.equal(classifyPairLine(`- AUTO 10:00:00 — ${label}Reproduction: lens "3a" ${GOOD}`), null);
    assert.equal(classifyPairLine(`- AUTO 10:00:00 — ${label}Reproduction: lens 3a finding a.js:1 reproduced (x). Confirmed. Reversibility: high.`), null);
    assert.equal(classifyPairLine(`- STAGED 10:00:00 — ${label}Reproduction: lens "3a" finding a.js:1 not reproduced. Staged to Review Console as low-confidence. Reversibility: high.`), null);
  });
}

test('writer label: the reviewer\'s carried-forward example is unparsed, not a new finding', () => {
  const line = '- AUTO 10:00:00 — wrap-up: carried forward from review Reproduction: lens "3a" finding x.js:1 reproduced. Confirmed.';
  assert.equal(classifyPairLine(line), null);
  assert.equal(isReviewMarkedLine(line), true);
});

test('status head: a time without seconds, a hyphen separator and a bare date are the writer\'s own head', () => {
  for (const head of ['- AUTO 23:56 — ', 'STAGED 14:20:10 - ', 'AUTO 2026-08-09 — ']) {
    const r = classifyPairLine(`${head}Reproduction: lens "3a" ${GOOD}`);
    assert.ok(r && r.form === 'reproduced', head);
  }
});

test('legacy wording: the 2000-character cap does not skip the strict templates', () => {
  const longPath = `plugin/${'d/'.repeat(1000)}x.js`;
  const longLine = `- AUTO 10:00:00 — Reproduction: lens "3a" finding ${longPath}:12 reproduced. Confirmed. Reversibility: high.`;
  assert.ok(longLine.length > 2000);
  const got = classifyPairLine(longLine);
  assert.equal(got && got.form, 'reproduced', 'a >2000-char line is still read by the strict template');
  assert.equal(got && got.line, 12);
});

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

test('legacy forms: ids are distinct from the prose-pinned forms, and an elevation or a notice adds to no finding count', () => {
  assert.deepEqual(ALL_FORMS.map((f) => f.id), [...PAIR_FORMS, ...LEGACY_FORMS].map((f) => f.id));
  assert.equal(new Set(ALL_FORMS.map((f) => f.id)).size, ALL_FORMS.length);
  assert.deepEqual(Object.fromEntries(LEGACY_FORMS.map((f) => [f.id, [f.counts.both, f.counts.one, f.counts.relabel]])), {
    'direct-verification-elevated': [0, 0, 1],
    'no-findings': [0, 0, 0],
    'console-disposition': [0, 0, 0],
  });
  assert.ok(Object.isFrozen(LEGACY_FORMS) && Object.isFrozen(ALL_FORMS));
});

// --- Producer pin: the composer writes seven pair forms, step3-tier-variants.md's template the eighth. ---
// Since #5595 plugin/bin/lib/reproduction-log.js is the only home of the seven forms (that step3-lens-dispatch.md
// carries no template is tests/review-reproduction-call-conformance.test.js's AC10.1). Each composed line must match exactly one PAIR_FORMS pattern, and
// its action must equal that form's `template` filled with the same values: the composer↔PAIR_FORMS twin pin.

const FILL = [
  ['{observed output}', '1 failing'], ['{command}', 'grep -n foo plugin/x.js'], ['{symbol}', 'foo'],
  ['{lineA}', '12'], ['{lineB}', '14'], ['{line}', '12'], ['{path}', 'plugin/x.js'], ['{lens}', '3a'],
];
// Form 5's second location (after `found it at `) is foundAt, in another file, so a template that filled it
// from `{path}` cannot pass.
const FOUND_AT = { path: 'plugin/y.js', line: 40 };

const COMPOSED = [
  rl.reproduced({ lens: '3a', path: 'plugin/x.js', line: 12 }),
  rl.reproduced({ lens: '3a', path: 'plugin/x.js', line: 12, severityContested: true }),
  rl.notReproduced({ lens: '3a', path: 'plugin/x.js', line: 12 }),
  rl.absenceRefuted({ lens: '3a', path: 'plugin/x.js', symbol: 'foo', command: 'grep -n foo plugin/x.js', foundAt: FOUND_AT }),
  rl.vacuityDowngraded({ path: 'plugin/x.js', line: 12 }),
  rl.vacuityReconfirmed({ path: 'plugin/x.js', line: 12, command: 'grep -n foo plugin/x.js', output: '1 failing' }),
  rl.coincidence({ lens: '3a', path: 'plugin/x.js', lineA: 12, lineB: 14 }),
];
const NOW = new Date(2026, 10, 16, 10, 0, 0);
const composedLine = (entry) => formatEntry({ ...entry, now: NOW });
const actionOf = (line) => line.replace(/^- \w+ \d{2}:\d{2}:\d{2} — /, '');

function liveTemplates(file) {
  const text = readText(file);
  const spans = [];
  for (const m of text.matchAll(/`([^`\n]*— Reproduction:[^`\n]*)`/g)) spans.push(m[1]);
  return spans.map((s) => s.replace(/^\{?\w+\}? \{HH:MM:SS\} — /, ''));
}

function fill(template) {
  let out = template.split('found it at {path}:{line}').join(`found it at ${FOUND_AT.path}:${FOUND_AT.line}`);
  for (const [k, v] of FILL) out = out.split(k).join(v);
  return out;
}

function matchingForms(action) {
  return PAIR_FORMS.filter((f) => f.pattern.some((re) => re.test(action))).map((f) => f.id);
}

test('AC3.3: every composed pair line matches exactly one form and equals its PAIR_FORMS template', () => {
  const matched = [];
  for (const entry of COMPOSED) {
    const line = composedLine(entry);
    const forms = matchingForms(line);
    assert.equal(forms.length, 1, `composed line "${line}" matches forms [${forms.join(', ')}], expected exactly one — ${RULE}`);
    const filled = fill(PAIR_FORMS.find((f) => f.id === forms[0]).template);
    assert.ok(!/[{}]/.test(filled), `a placeholder survived filling: ${filled}`);
    assert.equal(actionOf(line), filled, `form ${forms[0]}: the composer and its PAIR_FORMS template drifted apart — ${RULE}`);
    matched.push(forms[0]);
  }
  assert.deepEqual(matched.sort(), PAIR_FORMS.map((f) => f.id).filter((id) => id !== 'single-read-coverage').sort());
});

test('AC3.3: step3-tier-variants.md carries the eighth pair template', () => {
  const tier = liveTemplates(TIER);
  assert.equal(tier.length, 1, `step3-tier-variants.md holds ${tier.length} pair templates, expected 1 (single-read-coverage) — ${RULE}`);
  assert.equal(PAIR_FORMS.find((f) => f.id === 'single-read-coverage').template, tier[0], `form single-read-coverage template text drifted from the prose — ${RULE}`);
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

test('AC3.3: a reworded composed line matches no form, and a drifted template fails the twin pin (go-red controls)', () => {
  const first = composedLine(COMPOSED[0]);
  assert.ok(first.includes('reproduced.'));
  const mutated = first.replace('reproduced.', 'was reproduced.');
  assert.deepEqual(matchingForms(mutated), []);
  assert.equal(classifyPairLine(mutated), null);
  // Form 5's template filled with `{path}` in both locations differs from the composed line.
  const absence = PAIR_FORMS.find((f) => f.id === 'absence-refuted');
  let naive = absence.template;
  for (const [k, v] of FILL) naive = naive.split(k).join(v);
  assert.notEqual(actionOf(composedLine(COMPOSED[3])), naive);
  assert.equal(actionOf(composedLine(COMPOSED[3])), fill(absence.template));
});

// release/SKILL.md quotes form 1; the quote is the composer's output with the quote's own placeholders.
function releaseQuoteProblem(text) {
  const m = /`(AUTO \{time\} — Reproduction: [^`\n]*)`/.exec(text);
  if (!m) return 'release/SKILL.md quotes no Reproduction line';
  // location() drops a non-integer line, so compose with a sentinel line and put the quote's `{line}` back.
  const composed = composedLine(rl.reproduced({ lens: '{lens}', path: '{path}', line: 987 }))
    .replace(/^- (\w+) \d{2}:\d{2}:\d{2} /, '$1 {time} ').replace('{path}:987', '{path}:{line}');
  return m[1] === composed ? null : `release/SKILL.md quote drifted from rl.reproduced: ${m[1]} vs ${composed}`;
}

test('#5595: release/SKILL.md\'s quoted form 1 line equals rl.reproduced composed with its placeholders', () => {
  assert.equal(releaseQuoteProblem(readText(RELEASE)), null);
});

test('#5595 go-red: a drifted release/SKILL.md quote is caught', () => {
  const live = readText(RELEASE);
  const drifted = live.replace('reproduced. Confirmed. Reversibility: high.`', 'reproduced. Confirmed. …`');
  assert.notEqual(drifted, live);
  assert.match(releaseQuoteProblem(drifted), /drifted/);
});
