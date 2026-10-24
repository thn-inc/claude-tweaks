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
`plugin/skills/` (`grep -rlF '(.authorAssociation // .author_association) == "OWNER"' plugin/skills/`
returns five files today; `tests/comment-trust-conformance.test.js`'s AC2.1 sweep pins the same set),
not from the files the change touched. The pins do not all live in one suite either:
the fifth copy, `tidy/digest-sweep.md`'s Cluster promotion filters (#3766), is pinned by
`tests/materiality-floor-conformance.test.js` with the same `includes(trustedJqSelect())` and
`includes(untrustedJqNote())` needles. So answer step 2 for each copy by grepping `tests/` for the
generator's name (`grep -rln 'trustedJqSelect' tests/`), not by reading the one suite named above.
Per-site `includes(generated)` pins also cannot catch a hand-edited copy in a file nobody listed, so
the AC2.1 sweep (#3823) closes that: it deletes every generator-output copy from each
`plugin/skills/` file and fails when a stale or edited predicate survives in the remainder, with exact
copy counts and go-red controls for a stale copy and a broken new-form copy.

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

**Emitted-status instance (#2986, #3013):** a status-as-data CLI's `state` vocabulary is closed,
but left alone its code side is no constant: each value is a string literal in one
`report(deps, { state: … })` call, so a test that types the state names into itself pins nothing.
`plugin/bin/pr-merge-state.js` emits seven (`conflicting`, `no-conflict`, `unknown`, `not-open`,
`no-pr`, `read-failed`, `gh-absent`) and now exports them as a frozen `STATES`, which its own
`USAGE` is built from. `tests/bin-lib/pr-merge-state/cli.test.js` asserts the states its cases
emit cover that list exactly, and `tests/git-discipline-merge-state-conformance.test.js`
`deepEqual`s the list against the state words parsed from the routing bullets of
`_shared/git-discipline.md`'s Post-push merge-state check (and the prose `--phase` list against
`PHASE_SECTIONS`'s keys). `plugin/bin/pr-checks.js` and `_shared/pr-check-gate.md` have the
pre-fix shape and stay unpinned (`tests/pr-check-gate-conformance.test.js` checks its fail-open
bullet with `includes`). Step 1's key/case/array-literal grep misses this twin; grep each term as
a property value (`grep -rn "state: 'no-pr'" plugin/bin/`). The fix is the one above: export a
frozen list from the CLI and `deepEqual` it against the words parsed from the prose.

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
| Writing a pinning test that only checks one direction (code has every prose row, but not the reverse) when the two sides name the same closed vocabulary | Assert set equality both ways — a prose row with no code twin drifts as much as the reverse. **Exception: a code side routing a superset of producers** (`resolve.js`'s SECTION_MAP) — pin containment per producer, deriving the producers live (`tests/bin-lib/console/resolve.test.js` iterates `REGISTRY`, #2773) |
| Guarding a self-filtering scan with a loose floor (`checked >= N`, N below the live match count) | A scan that skips inputs it finds nothing in can lose them silently when a regex or the prose drifts; a floor only catches total collapse. Pin the exact matched set (`assert.deepStrictEqual(checkedIds.sort(), [...])`, as `resolve.test.js`'s registry audit does, #2773) — `parse-signal-discipline`'s "couldn't parse" vs "doesn't apply" rule applied to a test's own scan |
| Scoping the prose side of a twin to the one file whose table the code was modeled on, when the code keys on a shared prefix | A prefix-gated classifier sees every file's lines under that prefix. `plugin/bin/lib/closing-tally/closing-tally.js` (#2729) hardcodes two other files' `Backlog refine:` lines in `IGNORED_PATTERNS`, so rewording either falls back to `unclassified`. Grep the key repo-wide (`grep -rn 'Backlog refine: ' plugin/skills/`) and pin the live templates |
| Searching for the code twin only among object keys, `switch` cases, and array literals | A regex alternation is a closed vocabulary too, and can be born out of sync: `plugin/skills/harness-health/dream-pass.md`'s credential-word list against `plugin/bin/lib/dream/scan.js`'s `SECRET_NAME` (#2968), pinned both ways by `tests/bin-lib/dream/scan.test.js`. When step 1 greps for a twin, also grep each term inside regex source strings (`grep -rn 'PASSWD' plugin/bin/`) |
| Reading "table or enumerated list" so literally that a fenced template block is skipped, or looking for the code twin only among data literals | A composer function's output is a twin too, and its prose side is usually a fenced example, not a table — e.g. `plugin/bin/lib/flow/pr-body.js`'s `composePrEarlyBody` against the `markdown`-tagged "Composed shape" fence in `plugin/skills/_shared/pr-early-run-lifecycle.md` Step 3 (#2997). A test asserting each side's literals separately, never one against the other, is the citation-sweep shape the second row above rejects: a changed phase row or delimiter on either side leaves both suites green. Extract the fence by structure (the only `markdown`-tagged fence under the heading), call the composer with the fence's own placeholders as its arguments, and `assert.strictEqual` the two strings. Also grep each fixed line of a fenced template against `plugin/bin/` — it can surface a second code copy (e.g. `plugin/bin/lib/flow/preflight.js`'s `parseChecklist` retypes two of the markers) |
| Accepting a code constant as the twin because a test pins it to the prose and another test calls it load-bearing, without checking that the constant is what drives the behavior | The constant can be a decoy: a hand-kept display list beside the real twin. #3080 added `GATE_COVERAGE.bashRedirections` (`['>', '>>', '>\|', '&>', '&>>']`) to `plugin/bin/lib/hooks/pre-tool-use.js`. `tests/hooks-gate-coverage.test.js` pins it against the `Bash redirections` line in `_shared/policy-schema-coverage.md`'s coverage block, and its "every GATE_COVERAGE field is load-bearing, not a parallel hand-kept list" test passes on a `src.includes('GATE_COVERAGE.bashRedirections')` hit. But the only read is the deny-message string. The operators the gate actually resolves live in `git-command.js`'s `REDIRECT_OP_RE`/`AMP_REDIRECT_OP_RE` alternations, which nothing pins against the list in the reverse direction, so an operator added to the regex leaves the list, the prose, and the deny message all under-claiming with every suite green (the forward direction is covered: each listed operator is run through the real parser). Step 2's question is answered only when the test reaches the constant that makes the decision. A `src.includes` read check is satisfied by a message interpolation, so trace the read to a branch or a parser before accepting it |
| Skipping the composer check because the prose side is one quoted line beside the command that writes it, not a fenced template | That line is the same twin as the fenced example in the composer row above, and it is easier to type from memory. #3224's `plugin/skills/dispatch/task-prompt.md` Context pack tells the reader to run `log-decision.js --status AUTO --step "Dispatch group {group}" ... --reversibility n/a`, then quotes the `decisions.md` line that call "produces". The record's first draft of that line ended `Reversibility: n/a (informational).`, which `plugin/bin/lib/log-decision/append.js`'s `formatEntry` can never emit. The plan pinned the draft in a test without running the CLI, and only the whole-branch review caught it. The shipped `tests/dispatch-model-profile-conformance.test.js` still pins the corrected line as a literal checked only against the prose, so a format change in `formatEntry` leaves the prose stale and every suite green. The fix is one assertion: call the exported composer with the invocation's own placeholders (`formatEntry({ status: 'AUTO', now, step: 'Dispatch group {group}', text: 'first-call model resolved to {model} (source: {source})', reversibility: 'n/a' })`), replace its `HH:MM:SS` with the prose's `{time}`, and `assert.strictEqual` the two. When step 1 greps for a twin, treat any "which produces" or "writes" sentence followed by a quoted line as a template too |
| Pinning a prose rule about what a composer emits by its wording, or skipping it under step 1's "only in prose, no twin" exit | A rule that says the composed output omits or adds something has a twin: the composer the rule describes. If the composer has no input that could trigger the rule, the rule has no implementation, and a wording pin makes that look shipped. #1712's creation rule (omit the `polish` row only when every record in the run has `surface: backend`) is restated in `_shared/pr-early-run-lifecycle.md`, `flow/steps-and-gates.md`, and `flow/multispec-pr-checklist.md`. `tests/pr-early-run-lifecycle.test.js` has five `#1712` tests that match the wording, and none of them calls `composePrEarlyBody`. Neither that composer nor `plugin/bin/compose-pr-body.js` takes a `surface:` value, so every body they compose includes the `polish` row. #2877's ledger found this after it removed the composer's unused `phases` parameter, which no caller had ever used to omit the row. The check is to call the composer with the rule's triggering input and assert the shape the rule promises. If there is no argument to pass that input through, report the rule as unimplemented and file it. Don't add another wording assertion |
| Retyping a module constant as a literal inside a `node -e` fence that already `require`s that module | The fence becomes a third copy of the value, beside the code and the prose sentence, and a pin on the fence's literal stays green when the constant moves. #3366's refusal fence in `plugin/skills/specify/shaping-mode.md` prefilters which candidates get claim and linked-PR reads. It first shipped `h.signals.length >= 2` beside `shapingRefusal`'s `MIN_REFUSAL_SCORE` check, pinned by `code.includes('h.signals.length >= 2')`. `buildShapingState` builds state only for the prefiltered numbers, so a change that lowers the constant to 1 and updates its own pin and the prose would leave the fence skipping the reads for score-1 candidates, and `shapingRefusal` would never refuse them, while the fence's literal pin stays green. The final review (`1b86a3afd`) destructured `MIN_REFUSAL_SCORE` from the fence's existing `require` and retargeted the pin to `h.signals.length >= MIN_REFUSAL_SCORE`. When the fence can `require` the module, which #3358's jq filter above cannot, import the constant rather than generating or pinning its text. Keep the prose sentence's number a literal pin plus a `strictEqual` on the constant, as `tests/specify-near-duplicate-prose.test.js` does. When step 1 greps for a twin, also grep the `node -e` fences under `plugin/skills/` that `require` the module for the constant's literal value |
| Pinning a prose command string only by executing it through the CLI it names | Running the prose through the real `run()` proves one direction: every key the prose names is one the CLI accepts. A key *dropped* from the prose still passes, because a shorter batch writes fine. #3350's Manifesto `--set` batch is the prose twin of `MANIFESTO_LEVERS` plus `RUN_PINS`; the first `tests/flow-manifesto-integration-model-pin.test.js` executed it with a value per key, and removing `merge-authorization={v}` from `plugin/skills/flow/manifesto.md` left it green. The wrap-up fix added the reverse direction, `assert.deepEqual(keys.filter((k) => !RUN_PINS.includes(k)), [...MANIFESTO_LEVERS])`, and removing the pair then fails it. An executing pin and a set-equality pin cover opposite halves of the same twin: write both |
| Treating a code-side test of an emitted free-text label as a pin on the prose that restates it | `plugin/bin/lib/reconcile/console-execute.js`'s `resolveConsoleExecution` hardcodes `note: 'declined, no reason given'` for any item named in neither list, and `tests/resolve-console.test.js` asserts that string through the CLI. `_shared/console-execution.md` restates the label as fact (its unticked-at-Resolve rule, and since #3513 the accelerator note that a `--decline` id is recorded `declined`), and no test compares the prose to the literal, so a reworded note leaves the prose wrong with every suite green. The label is neither a table row nor a status word, so step 1's key/case/array-literal grep misses it. Grep the quoted phrase across both trees (`grep -rn 'no reason given' plugin/bin/ plugin/skills/`) and, when a twin turns up, export the label from the module and `includes()` it against the prose. Pinned since #3636: `console-execute.js` exports `DECLINED_NOTE`/`REVERSED_LABEL`/`REVERSE_FAILED_NOTE`, and `tests/build-sdd-ledger-residue-carryforward.test.js` `includes()` each against the prose |
| Writing a detector regex in `plugin/bin/` over a log line that skill prose tells the agent to type, and treating it as code-only because no composer produces the line | The detector is the code twin, and the prose template is the line's only producer, so a reworded template switches the detector off with every suite green. #3668's `consoleReplacedByAutoMergeShortCircuit` (`plugin/bin/lib/reconcile/archive-merged.js`) hand-copies `(?:Fast-lane\|Manifesto-authorized) auto-merge: issue #\d+, assess-agent-autonomy verdict auto-merge` from the `AUTO {time} — …` templates in `wrap-up/auto-merge-short-circuit.md` (two) and `wrap-up/manifesto-authorized-merge.md` (one). It was first written unpinned, and only the review fixes added the pin. `tests/bin-lib/reconcile/archive-merged.test.js` now extracts every backticked template from the live prose, collapses whitespace, fills `{n}`, runs each through the real detector, asserts the exact template count per file so an added producer fails too, and goes red on a mutated template through the same helper. Two things that pin needs. Agents reuse the bare phrase in free-form text, so the regex anchors on the template's canonical continuation and the suite carries a free-form negative fixture. And the template's code span must be one line: the Manifesto one was first hard-wrapped between `verdict` and `auto-merge`, which the test's whitespace collapse hides while an agent copying it across lines writes a line the literal-space regex misses (the guard then stays off and the run archives unguarded). Unwrap the span rather than relying on the collapse |
| Taking step 1's no-code-twin exit when one skill's prose tells the agent to write a log line and another skill's prose tells it which lines to select | Both sides are prose, so the `plugin/bin/` grep finds nothing, yet a reworded marker, prefix, or heading on either side makes the reader select nothing with every suite green. Parse the reader's selector parameters out of its prose, build fixture lines from the writer's template (every shape it can emit, plus near-miss negatives under the same and other headings), and assert the selection equals the writer lines. Prove go-red by rewording each selector parameter in turn, not only the marker (`tests/review-build-not-run-conformance.test.js`, #3767) |
| Accepting an extract-and-run test of a reference snippet as its pin when a `bin/` function implements the same rule | Running the snippet proves it executes, not that it agrees with the code, so a rule changed on one side leaves both suites green. `_shared/run-dir-resolution.md`'s "Bash snippet (resolution)" is the reference implementation that `bin/lib/hooks/run-dir-resolve.js` mirrors. #3865 narrowed `newestMatch` from a substring to a whole-segment slug match (`hasSegment`), and the snippet's Step-2 `find -name "*${SPEC_SLUG}*"` glob stayed a substring match with every suite green. The build deferred the snippet to its ledger, and `/claude-tweaks:review` then fixed it and found `wrap-up/merge-mode.md` still calling `--spec-slug` a substring match. The pair is still unpinned: `tests/pipeline-run-dir-adoption-anchoring.test.js` runs the extracted snippet and `tests/hooks-run-dir-resolve.test.js` calls `resolve()`, each over its own fixtures. The pin is one table of directory names and slugs run through both (`runResolutionWith(extractSnippet(), …)` and `resolve(…)`), asserting the same basename. Leave out of the table the cases where the code diverges on purpose (the dead-candidate skip, #1962) and name them in the test. When either side changes, also grep the flag or function name across `plugin/skills/` and `docs/` for sentences that restate the old rule |
| Taking step 1's no-twin exit because the prose table lives in a maintainer doc (`docs/*.md`), not a skill | A procedure doc that every editor of a module must read before changing it is the same twin: the next editor follows the doc's table, not the code. #3630 added a Check / Prerequisite / Satisfied by table to `docs/reconcile-checks.md`'s "expanded with its prerequisites" bullet, restating `plugin/bin/lib/reconcile/index.js`'s `PREREQUISITES`, and step 2 of that doc's add-a-check procedure now tells the editor to add an entry, so the two sides are edited together by design. It first merged with `tests/reconcile.test.js` importing `PREREQUISITES` but never reading the doc, so a third entry or a changed `satisfiedBy` would have left the doc table wrong with every suite green. Answer step 2 for a docs table the same way as for skill prose: parse the rows out of the doc and `deepEqual` the check, prerequisite and satisfied-by columns against the imported object. Pinned since #3630 that way, and shown red by changing a column and by removing a row |
