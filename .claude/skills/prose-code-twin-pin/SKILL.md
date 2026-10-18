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

The first two instances below are the two records the originating reflect finding named — one
code-to-code, one prose-to-code. The instances after them add twin shapes those two do not show.

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

**Code-generates-its-prose instance (#3358):** here the prose side is a jq filter that skill prose
must paste, because a `gh --json comments --jq` pipeline cannot `require` the JavaScript rule it
restates. `plugin/bin/lib/issues/comment-trust.js` keeps the trusted set once
(`TRUSTED_AUTHOR_ASSOCIATIONS`) and builds the prose from it: `trustedJqSelect()` and
`untrustedJqNote()` return the exact jq text. `tests/comment-trust-conformance.test.js` pins each
prose copy (`_shared/pr-run-comments.md`'s `## Trusted authors` section, `tidy/scan-procedures.md`'s
tombstone row, and the needs-decision lookups in `backlog/grant-lane-decision.md` and
`specify/shaping-mode-stamping.md`) with `includes(trustedJqSelect())`. That is a real pin, not the
citation sweep the second anti-pattern row rejects, because the needle is derived from the set: a
fourth association changes the needle and every stale copy goes red (the suite proves it by
doctoring `"OWNER"` to `"OWNER2"`). This shape owes two more checks. The generated text runs in a
different interpreter from the code, so `tests/bin-lib/issues/comment-trust.test.js` runs
`untrustedJqNote()` through real `jq` over the same comments and asserts the output equals
`untrustedSkipNote()`'s, including a deleted author and a missing association (it skips where `jq`
is absent). And the copy list is hand-written, so derive it by grepping the generated string across
`plugin/skills/` (`grep -rlF 'select(.authorAssociation == "OWNER"' plugin/skills/` returns the same
four files today), not from the files the change touched.

**Regex-alternation-to-prose-list instance on a router (#3401):** `plugin/bin/lib/console/resolve.js`'s
`SECTION_MAP` routes staged `.md` proposals to Pending review through one prefix alternation
(`/^(polish-suggestion|visual-review|design-decision|build-deviation|simplify|deepen|sdd-ruling)-/`),
and `plugin/skills/wrap-up/review-console-appendix.md`'s "`apply` on a **Pending review** item"
bullet lists the same prefixes in parentheses as `` `{prefix}-*` ``. `SECTION_MAP` is the
superset router that the one-direction Anti-Patterns row exempts from equality, but that exemption
covers pinning the router against one *producer's* vocabulary. This prose list documents the router
row itself, so it is pinned equal both ways. `tests/bin-lib/console/resolve.test.js` splits the pin
into two extractors and one assertion. `pendingMdPrefixesFromCode(map = SECTION_MAP)` keeps the
Pending-review rows whose source has the `^(...)-` shape, asserts there is exactly one, and splits
its alternation. `pendingMdPrefixesFromProse(text = APPENDIX)` locates the bullet, asserts it was
found and that its list is non-empty, and collects the backticked prefixes.
`assertPendingPrefixTwin` then `deepStrictEqual`s the two sorted arrays. Each go-red control removes
`sdd-ruling` from one side only (a `RegExp` rebuilt from the mutated `source`, or the appendix text
minus `` `sdd-ruling-*` ``) and passes that input through the same extractor and the same
assertion, through the default parameter. The control therefore proves the pin the positive test
runs, not a retyped copy of it. The extractors' own found-exactly-one and found-the-bullet
assertions stop a reworded bullet or a split alternation from producing two empty arrays that
compare equal, which is `parse-signal-discipline`'s couldn't-parse case inside a test. Derive the
prose side by grep, as the closing-tally row below says: `grep -rn -F 'build-deviation-' plugin/skills/`
finds the full list only in the appendix. The other hits name the single `build-deviation-{N}` id
while staging it.
**Command-to-argv instance (#3405, unpinned today):** the prose side can be a shell command a skill
tells the reader to run, and the code twin the argv array a `bin/` CLI hands its runner for the same
call. `_shared/pr-first-merge.md` Step 2.5's head-run read (`gh run list --repo {owner}/{repo}
--commit {headRefOid} --limit 100 --json name,workflowName,status,conclusion,url`, restated in
`release/execute.md`'s PR-check gate) and `plugin/bin/pr-checks.js`'s `deps.gh(['run', 'list',
'--commit', headRefOid, '--limit', '100', '--json', 'name,workflowName,status,conclusion,url'])` are
one call, and each side is pinned only against itself: `tests/merge-verification-gate-conformance.test.js`
needle-pins the prose (`'--commit {headRefOid}'`, `'--limit 100'`), and
`tests/bin-lib/pr-checks/cli.test.js` deep-equals the captured argv against a hand-typed literal. A
field added to either `--json` list, or a changed `--limit`, leaves both suites green. The pin is one
assertion: take the `bash` fence under `## Step 2.5` whose single line starts `gh run list`, tokenize
it, drop `gh` and the `--repo {owner}/{repo}` pair (the CLI runs inside the checkout and names no
repo, a deliberate difference to state in the test), substitute the test's head sha for
`{headRefOid}`, and `assert.deepEqual` the result with the argv the fake runner captured. Scope it to
that fence: the bounded watch's `0)` arm runs a second `gh run list` with `--json status` on
purpose, so sweeping every `gh run list` in the section would be wrong. The rest of the head-run
rule needs no equality pin: its closed vocabulary is `FAILING_CONCLUSIONS`, which head runs reuse
and `tests/pr-check-gate-conformance.test.js` already deep-equals against the prose list, and the
pending/green clauses are behavior, which `tests/bin-lib/pr-checks/classify.test.js` exercises.

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
| Scoping the prose side of a twin to the one file whose table the code was modeled on, when the code keys on a shared prefix | A classifier gated on a prefix sees every line any file emits under that prefix. `plugin/bin/lib/closing-tally/closing-tally.js` (#2729) gates on `Backlog refine:` and enumerates only `refine-closing-summary.md`'s templates, but `refine-lanes.md`'s unattended `batch auto-applied` line and `merge-lane-reset.md`'s breaker-RESET line share the prefix. The shipped fix (`IGNORED_PATTERNS` in `closing-tally.js`) hardcodes both phrases rather than deriving them from the prose, so its test pins a hand-written fixture matching that hardcoded regex instead of the live template text — a future reword of either line in `refine-lanes.md`/`merge-lane-reset.md` would silently fall back to `unclassified` with no test catching the drift. Grep the match key repo-wide (`grep -rn 'Backlog refine: ' plugin/skills/`) to derive the prose side, and pin against the templates read live, not a fixture |
| Searching for the code twin only among object keys, `switch` cases, and array literals | A regex alternation is a closed vocabulary too, and it can be born out of sync, not only drift later. #2968's `plugin/skills/harness-health/dream-pass.md` lists the credential words its redaction matches, while `plugin/bin/lib/dream/scan.js`'s `SECRET_NAME` holds the same words as a regex alternation (`TOKEN\|SECRET\|PASSWORD\|PASSWD\|...`). The list shipped without `PASSWD` in the same change that wrote both. Only task review caught it, as a Minor, and `60ccb618a` fixed it by hand. The same run's wrap-up then pinned it both ways (`tests/bin-lib/dream/scan.test.js` parses the doc's list and `SECRET_NAME`'s alternation, asserts set equality, and checks that each word redacts). When step 1 greps for a twin, also grep each term inside regex source strings (`grep -rn 'PASSWD' plugin/bin/`) |
| Reading "table or enumerated list" so literally that a fenced template block is skipped, or looking for the code twin only among data literals | A composer function's output is a twin too, and its prose side is usually a fenced example, not a table. #2997 moved the PR-early run body into `plugin/bin/lib/flow/pr-body.js`'s `composePrEarlyBody` and kept the template in `plugin/skills/_shared/pr-early-run-lifecycle.md` Step 3 as a `markdown`-tagged "Composed shape" fence, beside the Dual-marker scheme table that names the same five markers in both forms. As built (`9bc3483d5`), `tests/pr-early-run-lifecycle.test.js` and `tests/bin-lib/flow/pr-body.test.js` asserted the marker literals and the two-line head on each side separately, never one side against the other. That is the citation-sweep shape the second row above rejects: a sixth phase row or a renamed delimiter on either side leaves both suites green. The two were byte-equal at that commit, so the pin is one assertion. Extract the fence by structure (the only `markdown`-tagged fence under the `### Step 3` heading), call the composer with the fence's own placeholders as its arguments (`runId: '{run-id}'`, `specSummary: '{one-paragraph summary}'`, `target: '{target}'`, `nextStep: '{next-step}'`, `fixesLines: ['Fixes #{n}']`, `runDir: '{run-dir}'`), and `assert.strictEqual` the two strings. When step 1 greps for a twin, also grep each fixed line of a fenced template against `plugin/bin/` (`grep -rn -F 'phases-start' plugin/bin/`). That grep also turns up a second code copy: `plugin/bin/lib/flow/preflight.js`'s `parseChecklist` retypes two of the markers |
| Accepting a code constant as the twin because a test pins it to the prose and another test calls it load-bearing, without checking that the constant is what drives the behavior | The constant can be a decoy: a hand-kept display list beside the real twin. #3080 added `GATE_COVERAGE.bashRedirections` (`['>', '>>', '>\|', '&>', '&>>']`) to `plugin/bin/lib/hooks/pre-tool-use.js`. `tests/hooks-gate-coverage.test.js` pins it against the `Bash redirections` line in `_shared/policy-schema-coverage.md`'s coverage block, and its "every GATE_COVERAGE field is load-bearing, not a parallel hand-kept list" test passes on a `src.includes('GATE_COVERAGE.bashRedirections')` hit. But the only read is the deny-message string. The operators the gate actually resolves live in `git-command.js`'s `REDIRECT_OP_RE`/`AMP_REDIRECT_OP_RE` alternations, which nothing pins against the list in the reverse direction, so an operator added to the regex leaves the list, the prose, and the deny message all under-claiming with every suite green (the forward direction is covered: each listed operator is run through the real parser). Step 2's question is answered only when the test reaches the constant that makes the decision. A `src.includes` read check is satisfied by a message interpolation, so trace the read to a branch or a parser before accepting it |
| Skipping the composer check because the prose side is one quoted line beside the command that writes it, not a fenced template | That line is the same twin as the fenced example in the composer row above, and it is easier to type from memory. #3224's `plugin/skills/dispatch/task-prompt.md` Context pack tells the reader to run `log-decision.js --status AUTO --step "Dispatch group {group}" ... --reversibility n/a`, then quotes the `decisions.md` line that call "produces". The record's first draft of that line ended `Reversibility: n/a (informational).`, which `plugin/bin/lib/log-decision/append.js`'s `formatEntry` can never emit. The plan pinned the draft in a test without running the CLI, and only the whole-branch review caught it. The shipped `tests/dispatch-model-profile-conformance.test.js` still pins the corrected line as a literal checked only against the prose, so a format change in `formatEntry` leaves the prose stale and every suite green. The fix is one assertion: call the exported composer with the invocation's own placeholders (`formatEntry({ status: 'AUTO', now, step: 'Dispatch group {group}', text: 'first-call model resolved to {model} (source: {source})', reversibility: 'n/a' })`), replace its `HH:MM:SS` with the prose's `{time}`, and `assert.strictEqual` the two. When step 1 greps for a twin, treat any "which produces" or "writes" sentence followed by a quoted line as a template too |
| Pinning a prose rule about what a composer emits by its wording, or skipping it under step 1's "only in prose, no twin" exit | A rule that says the composed output omits or adds something has a twin: the composer the rule describes. If the composer has no input that could trigger the rule, the rule has no implementation, and a wording pin makes that look shipped. #1712's creation rule (omit the `polish` row only when every record in the run has `surface: backend`) is restated in `_shared/pr-early-run-lifecycle.md`, `flow/steps-and-gates.md`, and `flow/multispec-pr-checklist.md`. `tests/pr-early-run-lifecycle.test.js` has five `#1712` tests that match the wording, and none of them calls `composePrEarlyBody`. Neither that composer nor `plugin/bin/compose-pr-body.js` takes a `surface:` value, so every body they compose includes the `polish` row. #2877's ledger found this after it removed the composer's unused `phases` parameter, which no caller had ever used to omit the row. The check is to call the composer with the rule's triggering input and assert the shape the rule promises. If there is no argument to pass that input through, report the rule as unimplemented and file it. Don't add another wording assertion |
| Retyping a module constant as a literal inside a `node -e` fence that already `require`s that module | The fence becomes a third copy of the value, beside the code and the prose sentence, and a pin on the fence's literal stays green when the constant moves. #3366's refusal fence in `plugin/skills/specify/shaping-mode.md` prefilters which candidates get claim and linked-PR reads. It first shipped `h.signals.length >= 2` beside `shapingRefusal`'s `MIN_REFUSAL_SCORE` check, pinned by `code.includes('h.signals.length >= 2')`. `buildShapingState` builds state only for the prefiltered numbers, so a change that lowers the constant to 1 and updates its own pin and the prose would leave the fence skipping the reads for score-1 candidates, and `shapingRefusal` would never refuse them, while the fence's literal pin stays green. The final review (`1b86a3afd`) destructured `MIN_REFUSAL_SCORE` from the fence's existing `require` and retargeted the pin to `h.signals.length >= MIN_REFUSAL_SCORE`. When the fence can `require` the module, which #3358's jq filter above cannot, import the constant rather than generating or pinning its text. Keep the prose sentence's number a literal pin plus a `strictEqual` on the constant, as `tests/specify-near-duplicate-prose.test.js` does. When step 1 greps for a twin, also grep the `node -e` fences under `plugin/skills/` that `require` the module for the constant's literal value |
