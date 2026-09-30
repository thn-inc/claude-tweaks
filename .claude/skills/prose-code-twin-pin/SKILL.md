---
name: prose-code-twin-pin
description: Use when reviewing a project skill, or authoring one, that restates a table which also exists as executable code (an enum, a switch, a lookup table) — checks whether a conformance test pins the two equal, the same way this repo already pins `record.js`'s TYPES against `subject.js`'s TYPE_PREFIX and `step-21-release.md`'s stack table against `RELEASE_STACK_TABLE`. Keywords - prose table, code twin, conformance test, drift, pinning test, one source of truth, vocabulary equality, review checklist.
---

# Prose-code-twin-pin

A project skill's markdown prose sometimes restates a table that also exists as executable code:
an enum, a `switch`, a lookup object, a closed vocabulary. The two copies can drift apart: someone
adds a fourth case to the code and forgets the prose row, or renames a prose column with no code
changed to match. Nothing catches it, because the prose is never executed and the code is never
read as documentation. A `/claude-tweaks:reflect` hindsight finding on #2253 (this skill's own
originating issue, #2792) named exactly this pattern from two records built in the same run —
#2251's `TYPE_PREFIX` pin and #2253's stack-table pin — which is the evidence this pattern is
real and recurring, not hypothetical.

## The check

For any project skill (`.claude/skills/**/SKILL.md`) or shipped skill (`plugin/skills/**/*.md`)
whose prose contains a table or enumerated list that names a **closed vocabulary** — a fixed set
of type names, outcome words, status labels, facet values — ask two questions:

1. **Does an executable code twin exist?** Grep the vocabulary's own terms (each row/word) against
   `plugin/bin/**/*.js` for a matching object key, `switch` case, or array literal. A vocabulary
   that exists only in prose, with nothing in code reading or producing it, is not this pattern —
   there's no twin to drift from.
2. **If a twin exists, does a conformance test pin the two equal?** Grep `tests/**/*.js` for a test
   that asserts full equality between the two sides — either two imported constants
   (`assert.deepEqual(Object.keys(A).sort(), B.slice().sort())`) when both sides are code, or the
   prose table parsed row-for-row against the imported constant when the vocabulary's canonical
   form lives in the prose itself. Either shape is a real pin; a test only asserting that
   individual literal strings are *present* somewhere is not — a citation sweep proves nothing
   about the fourth case someone adds later.

No such test → flag it: either the vocabulary needs a pinning test (model it on the two worked
examples below), or the "table" isn't actually a closed vocabulary and the prose should say so
plainly instead of reading like one.

## Worked examples

Both instances below are the two records the originating reflect finding named — one code-to-code,
one prose-to-code, so the check above covers both shapes.

**Code-to-code instance (#2251):** `plugin/bin/lib/issues/record.js`'s `TYPES`
(`['bug', 'feature', 'task']`, line 11) must stay in sync with `plugin/bin/lib/release/subject.js`'s
`TYPE_PREFIX` — both key off the same closed vocabulary of record types.
`tests/bin-lib/compose-subject.test.js`'s `'Type vocabulary has one source of truth: TYPE_PREFIX
and record.TYPES name the same set'` test pins them: `assert.deepEqual(Object.keys(TYPE_PREFIX).sort(), TYPES.slice().sort())`
— a fourth type must gain a `TYPE_PREFIX` entry in the same change that adds it to `TYPES`, or
`composeSubject` refuses the new type at merge time (exit 1) instead of silently mis-composing a
merge subject.

**Prose-to-code instance (#2253):** `plugin/skills/init/bootstrap/step-21-release.md`'s
`## Stack table` (the release-type → root-marker mapping) must stay in sync with
`plugin/bin/lib/init/release-bootstrap.js`'s `RELEASE_STACK_TABLE`.
`tests/init-release-bootstrap-conformance.test.js`'s `'the prose stack table matches
RELEASE_STACK_TABLE row for row, in order'` test parses the markdown table straight out of the
prose and pins it: `assert.deepEqual(rows.map(r => r.releaseType), RELEASE_STACK_TABLE.map(r =>
r.releaseType))`, then each row's markers in turn — a dropped, reordered, or edited prose row
fails loudly instead of silently drifting from the code it once matched.

**Candidate instance (a live, currently-unpinned gap this check surfaces today):**
`plugin/bin/lib/compose-subject.js:69`'s `TYPE_PRECEDENCE = ['feature', 'bug', 'task']` is a
*third* copy of the same closed vocabulary `TYPES`/`TYPE_PREFIX` above already key off — used to
rank a bundle's aggregated Type (line 199) — with no conformance test pinning it against either.
Grepping `tests/**/*.js` for `TYPE_PRECEDENCE` returns nothing — fixing it is out of scope for
this skill (which only detects and names the pattern).

## Existing coverage, checked

`skill-prose-conformance-tests` is the closest sibling, but covers the other half of the problem.
That skill's Decision Framework already names this exact case ("a table or list that restates a
data structure living in code → read it live and pin it against that structure") and tells you
*how* to write the pin once you know one is needed — the live-read carve-out, the go-red
discrimination proof. This skill covers *detecting* that a prose table restating a code twin has
no such pin in the first place, so a reviewer or skill-author knows to reach for
`skill-prose-conformance-tests` next. `shared-contract-extraction` is a more distant neighbor: it
governs extracting a recurring cross-skill rule into a new shared contract and migrating
consumers to cite it — a different problem from a single skill's own prose drifting from its own
dependency's code.

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Flagging every markdown table as a candidate | Most tables are prose (comparisons, option matrices) with no code twin at all — check for an actual code-side enum/switch/lookup first |
| Accepting a citation-sweep test (a plain string `includes()`) as equivalent to a vocabulary-equality pin | A citation sweep never fails when a new case is added to one side and not the other — only a full `assert.deepEqual` over both sides (imported, or parsed from prose) catches that |
| Treating this skill's scope as "extract a shared contract" | That's `shared-contract-extraction`'s job; this skill only detects and names an existing prose/code drift risk, it doesn't prescribe extracting anything |
| Writing a pinning test that only checks one direction (code has every prose row, but not the reverse) | A pinning test must assert set equality both ways — a prose row with no code twin is exactly as much a drift as a code case with no prose row |
