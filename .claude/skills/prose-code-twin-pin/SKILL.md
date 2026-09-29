---
name: prose-code-twin-pin
description: Use when reviewing a project skill, or authoring one, that restates a table which also exists as executable code (an enum, a switch, a lookup table) — checks whether a conformance test pins the two equal, the same way this repo already pins `record.js`'s TYPES against `subject.js`'s TYPE_PREFIX. Keywords - prose table, code twin, conformance test, drift, pinning test, one source of truth, vocabulary equality, review checklist.
---

# Prose-code-twin-pin

A project skill's markdown prose sometimes restates a table that also exists as executable code:
an enum, a `switch`, a lookup object, a closed vocabulary. The two copies can drift apart —
someone adds a fourth case to the code and forgets the prose row, or renames a prose column with
no code changed to match — and nothing catches it, because the prose is never executed and the
code is never read as documentation. Two review lenses independently flagged an instance of this
during the #2251-2258 multi-spec build (`docs/skill-graph.md`'s release-skill units), which is
the evidence this pattern is real and recurring, not hypothetical.

## The check

For any project skill (`.claude/skills/**/SKILL.md`) or shipped skill (`plugin/skills/**/*.md`)
whose prose contains a table or enumerated list that names a **closed vocabulary** — a fixed set
of type names, outcome words, status labels, facet values — ask two questions:

1. **Does an executable code twin exist?** Grep the vocabulary's own terms (each row/word) against
   `plugin/bin/lib/**/*.js` for a matching object key, `switch` case, or array literal. If nothing
   turns up there, also grep `plugin/skills/**/*.md` — a driver skill's own numbered steps are the
   executable logic for a vocabulary it produces (this repo's skill-as-code model), so a step file
   that reads a tool's exit code and names one of the vocabulary's words is a twin exactly as much
   as a `.js` lookup table is; a passing mention of the same word elsewhere in prose is not. A
   vocabulary that exists only as a description with nothing — code or skill steps — reading or
   producing it is not this pattern — there's no twin to drift from.
2. **If a twin exists, does a conformance test pin the two equal?** Grep `tests/**/*.js` for a test
   that imports both sides and asserts their key/value sets match (`assert.deepEqual(Object.keys(A).sort(), B.slice().sort())` or equivalent) — not merely a test asserting individual literal strings are *present* somewhere (a citation sweep proves nothing about the fourth case someone adds later).

No such test → flag it: either the vocabulary needs a pinning test (model it on the fixed worked
example below), or the "table" isn't actually a closed vocabulary and the prose should say so
plainly instead of reading like one.

## Worked examples

**Fixed instance (what pinning looks like):** `plugin/bin/lib/issues/record.js`'s `TYPES`
must stay in sync with `plugin/bin/lib/release/subject.js`'s `TYPE_PREFIX` — both key off the same
closed vocabulary of record types. `tests/bin-lib/compose-subject.test.js`'s `'Type vocabulary has
one source of truth: TYPE_PREFIX and record.TYPES name the same set'` test pins them:
`assert.deepEqual(Object.keys(TYPE_PREFIX).sort(), TYPES.slice().sort())` — a fourth type must gain
a `TYPE_PREFIX` entry in the same change that adds it to `TYPES`, or this test fails loudly instead
of `typeOf` silently returning `null` for the new type.

**Candidate instance (what this check catches today):** `.claude/skills/driver-skill-outcome-taxonomy/SKILL.md`'s
four-outcome-word table (`HELD` / `failed` / `PARTIAL` / `released`) — itself born from a review
finding on #2256 ("Every review finding on #2256 that survived refutation was a taxonomy or a
provenance confusion") — has no conformance test asserting that the release skill's actual code
(`plugin/bin/lib/release/*.js`, `plugin/skills/release/execute.md`) only ever produces one of
these four words. `tests/release-routine-template.test.js` asserts that the literal strings
`'HELD'` and `'PARTIAL'` are *present* in specific files — a citation sweep, not a vocabulary-equality
assertion — so a fifth outcome word introduced later in the release skill's code would not make
this test fail. This is a real, currently-open gap this check surfaces; fixing it is out of scope
for this skill (which only detects and names the pattern) and is tracked separately if pursued.

## Existing coverage, checked

`shared-contract-extraction` governs *extracting* a recurring cross-skill rule into a new
`plugin/skills/_shared/*.md` contract and migrating consumers to cite it — a different problem
from this skill's: a prose table restating a code enum was never meant to be a shared *contract*
between skills, it's a single skill's own documentation drifting from its own dependency's code.
Nothing else in `.claude/skills/` covers vocabulary-equality pinning as its own topic.

## Anti-Patterns

| Pattern | Why It Fails |
|---|---|
| Flagging every markdown table as a candidate | Most tables are prose (comparisons, option matrices) with no code twin at all — check for an actual code-side enum/switch/lookup first |
| Accepting a citation-sweep test (`includes('HELD')`) as equivalent to a vocabulary-equality pin | A citation sweep never fails when a new case is added to one side and not the other — only `assert.deepEqual` on the full key/value sets catches that |
| Treating this skill's scope as "extract a shared contract" | That's `shared-contract-extraction`'s job; this skill only detects and names an existing prose/code drift risk, it doesn't prescribe extracting anything |
| Writing a pinning test that only checks one direction (code has every prose row, but not the reverse) | A pinning test must assert set equality both ways — a prose row with no code twin is exactly as much a drift as a code case with no prose row |
