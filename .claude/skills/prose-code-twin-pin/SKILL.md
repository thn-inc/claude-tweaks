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

**Prose-to-code instance (#2980/#2981):** `plugin/skills/design-wrapper/impeccable-plugin.md`'s
`## Degradation` table (one row per `plugin/bin/lib/impeccable-engine/index.js`'s `FAILURE_REASONS`)
must name every reason the module can return, each with a fix or a stated reason there isn't one.
`tests/impeccable-engine-skip-reasons.test.js` pins it three ways: `FAILURE_REASONS` itself is
asserted against a frozen sorted array (so a rename or addition is caught at the source), the
Degradation section is parsed and checked for a backtick-quoted mention of every reason, and each
reason's own table row is checked for a non-empty Fix cell matching the right vocabulary (`module`
for a canned `fix` string, `detail` for the two reasons that carry only `detail`) — a reason added,
renamed, or moved to the other fix-shape bucket fails loudly instead of leaving the doc stale.

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
| Writing a pinning test that only checks one direction (code has every prose row, but not the reverse) when the two sides name the same closed vocabulary | A pinning test must assert set equality both ways when both sides are meant to name the same set. A prose row with no code twin drifts just as much as a code case with no prose row. **Exception: the code side is a router over a superset of producers.** `resolve.js`'s SECTION_MAP routes staged files from producers well beyond the wrap-up registry, so equality against any one producer's vocabulary is wrong. Pin containment per producer instead, and derive the producer list live (`tests/bin-lib/console/resolve.test.js`'s registry-audit test iterates `REGISTRY` and reads each row's own judge file, #2773) |
| Guarding a self-filtering scan with a loose floor (`checked >= N`, N below the live match count) | A scan that skips inputs it finds nothing in can lose inputs silently when a regex or the prose drifts. A floor only catches total collapse. `resolve.test.js`'s registry audit first shipped with `assert.ok(checked >= 3, ...)` while 5 rows matched — either of the two rows #2773 itself added could have dropped out with the test still green. Caught in the same run's wrap-up and fixed before merge, in its own commit: pin the exact set of matched ids (`assert.deepStrictEqual(checkedIds.sort(), [...])`) so a row that leaves the scan fails as loudly as a row that is mis-routed. This is `parse-signal-discipline`'s "couldn't parse" vs "doesn't apply" rule applied to a test's own scan |
| Scoping the prose side of a twin to the one file whose table the code was modeled on, when the code keys on a shared prefix | A classifier gated on a prefix sees every line any file emits under that prefix. `plugin/bin/lib/closing-tally/closing-tally.js` (#2729) gates on `Backlog refine:` and enumerates only `refine-closing-summary.md`'s templates, but `refine-lanes.md`'s unattended `batch auto-applied` line and `merge-lane-reset.md`'s breaker-RESET line share the prefix, so both land in `unclassified` on a real run; its tests pin a hand-written fixture, which cannot see either. Grep the match key repo-wide (`grep -rn 'Backlog refine: ' plugin/skills/`) to derive the prose side, and pin against the templates read live, not a fixture |
| Searching for the code twin only among object keys, `switch` cases, and array literals | A regex alternation is a closed vocabulary too, and it can be born out of sync, not only drift later. #2968's `plugin/skills/harness-health/dream-pass.md` lists the credential words its redaction matches, while `plugin/bin/lib/dream/scan.js`'s `SECRET_NAME` holds the same words as a regex alternation (`TOKEN\|SECRET\|PASSWORD\|PASSWD\|...`). The list shipped without `PASSWD` in the same change that wrote both. Only task review caught it, as a Minor, and `60ccb618a` fixed it by hand. The same run's wrap-up then pinned it both ways (`tests/bin-lib/dream/scan.test.js` parses the doc's list and `SECRET_NAME`'s alternation, asserts set equality, and checks that each word redacts). When step 1 greps for a twin, also grep each term inside regex source strings (`grep -rn 'PASSWD' plugin/bin/`) |
| Reading "table or enumerated list" so literally that a fenced template block is skipped, or looking for the code twin only among data literals | A composer function's output is a twin too, and its prose side is usually a fenced example, not a table. #2997 moved the PR-early run body into `plugin/bin/lib/flow/pr-body.js`'s `composePrEarlyBody` and kept the template in `plugin/skills/_shared/pr-early-run-lifecycle.md` Step 3 as a `markdown`-tagged "Composed shape" fence, beside the Dual-marker scheme table that names the same five markers in both forms. As built (`9bc3483d5`), `tests/pr-early-run-lifecycle.test.js` and `tests/bin-lib/flow/pr-body.test.js` asserted the marker literals and the two-line head on each side separately, never one side against the other. That is the citation-sweep shape the second row above rejects: a sixth phase row or a renamed delimiter on either side leaves both suites green. The two were byte-equal at that commit, so the pin is one assertion. Extract the fence by structure (the only `markdown`-tagged fence under the `### Step 3` heading), call the composer with the fence's own placeholders as its arguments (`runId: '{run-id}'`, `specSummary: '{one-paragraph summary}'`, `target: '{target}'`, `nextStep: '{next-step}'`, `fixesLines: ['Fixes #{n}']`, `runDir: '{run-dir}'`), and `assert.strictEqual` the two strings. When step 1 greps for a twin, also grep each fixed line of a fenced template against `plugin/bin/` (`grep -rn -F 'phases-start' plugin/bin/`). That grep also turns up a second code copy: `plugin/bin/lib/flow/preflight.js`'s `parseChecklist` retypes two of the markers |
