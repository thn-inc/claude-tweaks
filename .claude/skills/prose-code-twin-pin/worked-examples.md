# Prose-code-twin-pin — worked examples

Loaded from `SKILL.md`'s Worked examples pointer, when writing a new pin and looking for a precedent of its shape.

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
prose side by grep, as the closing-tally row in `SKILL.md`'s Anti-Patterns says: `grep -rn -F 'build-deviation-' plugin/skills/`
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

**Projected-twin instance (#4488):** the code side need not be a row-for-row copy of the table. It
can be a per-cell projection of it. `plugin/bin/lib/log-decision/review-routing.js`'s
`ALLOWED_SEVERITIES` maps each route (`auto`, `staged`, `kept-prompt`) to the severities that route
takes across all three ceiling columns of `plugin/skills/review/step3-routing.md`'s ceiling-keyed
routing table. No table row equals any map entry, so step 2's "parsed row-for-row" reading finds
nothing to compare. `tests/bin-lib/log-decision/review-routing.test.js`'s "the composer allows
exactly the route/severity pairings step3-routing.md's ceiling-keyed table produces" test
(`b5669aa6f`) builds the projection from the prose instead:

1. It parses the four severity rows.
2. It takes each cell's first word as the route. The Low row's `STAGED (unless …)` cell reads as
   `staged`.
3. It collects `{route → Set(severity)}`.
4. It `deepEqual`s that, sorted, against the imported map.

It went red under an `auto: ['low','medium','high']` mutant. When the code side is a projection,
apply the same projection to the prose, and compare at that level.

**Regex-constant and detector-over-composer instance (#4423):** two twin shapes that are neither a
table nor a vocabulary.

- *A validation regex that agents run from prose.* `plugin/bin/lib/issues/claim-store.js`'s
  `RUN_ID_SHAPE` was restated verbatim in three skill files, and on the gh-absent MCP path that prose
  copy was the implementation. Export the constant. Build the copy list by `grep -rlF` on a
  distinctive fragment, never by memory. Assert every copy `includes(RUN_ID_SHAPE.source)`.
  Since #4596 it is restated in one skill file, `flow/claim-targets.md`; the gh-absent MCP path and
  `/tidy` call `plugin/bin/stale-claim-pr.js` instead, so there is no prose copy left to drift.
  `tests/issue-claims-stale-open-pr-conformance.test.js`'s "the run-id shape is restated only in
  flow/claim-targets.md" test asserts the copy list both ways: the one copy matches, the two retired
  copies are absent.
- *A code detector whose input line is produced by a code composer.* `staleClaimInFlightPr` matches
  a run marker that `plugin/bin/lib/flow/pr-body.js` writes. It shipped pinned only against
  hand-typed markers, which agree with the detector by construction. Pin the detector to the
  composer instead: run `composePrEarlyBody`/`composeExpressBody` output through it, each marker
  form alone, including the body with every HTML comment stripped (what a gh-absent MCP read
  returns): `tests/bin-lib/claim-targets/claim-targets.test.js`'s "matches the run marker
  pr-body.js composes, in either form alone" test.

Both pins were proven red by mutation (a reworded prose copy; a reworded composer marker) before
they landed.

**Candidate instance (a live, currently-unpinned gap this check surfaces today):**
`plugin/bin/lib/compose-subject.js:69`'s `TYPE_PRECEDENCE = ['feature', 'bug', 'task']` is a
*third* copy of the same closed vocabulary `TYPES`/`TYPE_PREFIX` above already key off — used to
rank a bundle's aggregated Type (line 199) — with no conformance test pinning it against either.
Grepping `tests/**/*.js` for `TYPE_PRECEDENCE` returns nothing — fixing it is out of scope for
this skill (which only detects and names the pattern).

**Placeholder-shaped template instance (#4331):** some fenced templates use placeholders that
encode a shape the composer cannot emit. Those templates cannot take the whole-string
`strictEqual` that the composer row in `SKILL.md`'s Anti-Patterns prescribes.
`plugin/skills/dispatch/close-out-update.md`'s marker template writes
`update-method: {merge | gh pr update-branch}[, …]`, an alternation plus a repeat that
`plugin/bin/lib/dispatch/close-out-marker.js`'s `serializeMarker` takes no input for. So
`tests/close-out-pr-state-contract-conformance.test.js`'s `assertExplanationTwin` pins the template
line by line. It checks the explanatory paragraph byte-equal to the composer's and `deepEqual`s the
four field-key prefixes in order, and it has go-red controls for one reworded word, a renamed key
and a swapped pair. Pin every fixed line that way, not only the ones in view. As built, `fieldKeys`
starts at the third line (`.slice(2)`), so the template's status line `close-out-update: pending`
is compared against no code, though `PENDING_LINE` is what `parseMarker` matches. The first line is
selected by a `startsWith` literal the test retypes instead of importing `MARKER_LINE`. The Clear
step's hand-written `close-out-update: cleared ({reason})` line has the detector-twin shape of the
`consoleReplacedByAutoMerge` row in `SKILL.md`'s Anti-Patterns, since `CLEARED_RE` reads it. Walk the fence line by line,
and name the constant or regex each line must match before you call the pin complete.

**Behavior-twin instance (#4599, narrowed by #4603):** the code side can drive a whole prose
procedure, not one table. `plugin/bin/lib/issues/below-floor-parent-close.js` is the reconciler's
Step 4.0b driver (`_shared/pr-first-merge-post-merge.md`) for `wrap-up/verification-brief-parent-gate.md`,
from **Resolve the parent** through **Close the parent below the floor**. The gate's evaluation
(Resolve through Evaluate, and the idempotence check) is one shared module,
`plugin/bin/lib/issues/parent-gate.js`, that the prose's CLI (`bin/parent-gate.js`) and the reconciler
both run, so those parts cannot drift apart. What stays a twin is the close's composer, the comment text it
writes, and the marker line the prose writes and the reconciler reads. No vocabulary spans the
prose and those, so step 1's grep finds nothing. Split what is left into the parts that can drift, and pin each the way
its shape owes:

- *Fixed text* is a composer twin. `tests/bin-lib/issues/below-floor-parent-close.test.js` compares
  `composeCloseComment` with the prose's closing-comment fence, substituted, and does the same for
  the listing line, the bare listing line and the not-planned line.
- *A number the prose states* is an exported constant. `tests/below-floor-parent-close-conformance.test.js`
  pins the prose's "10 minutes" and asserts `MERGE_GRACE_MS` and `CLOSE_WINDOW_MS` equal it.
- *A string the shared module emits and the prose quotes* is a twin too, even though sharing the
  code already keeps the CLI and the reconciler together: sharing binds code to code, never the
  prose to either. The same suite's #4770 case pulls the backticked `identity probe failed …` note
  out of **Close the parent below the floor** step 1 and asserts it equals `parent-gate.js`'s
  exported `IDENTITY_PROBE_FAILED_NOTE`, with the note stripped from the prose as its go-red control.
- *A marker line the prose writes and the code reads* is the writer/reader row in Anti-Patterns. The
  same suite parses `--step` and `--text` out of Step 4.0b's summary command, runs them through
  `formatEntry`, and asserts `hasPostMergeMarker` reads the result, with a renamed `--step` as the
  go-red control. The `(skipped)` SKIP line, which the prose also calls the marker, reaches the
  reader only through a step string `tests/bin-lib/reconcile/post-merge.test.js` retypes.
- *A declared divergence* is stated on both sides: the prose's "except that it skips the
  **Self-inclusion rule**" clause, and the `selfInclude: false` the check passes, pinned by running it.
- *Skip rules* are pinned by the #4800 block of the same suite. A table classifies every Step 4.0b
  skip sentence, failing on a sentence no row matches and on a row no sentence matches; the gate's
  no-op states and close step 1's no-op values join the prose set. That set must equal
  `DELIBERATE_SKIP_REASONS`, and, less the gate's pass-through states (the module emits those as
  `verdict.state`, never as a literal), the quoted literals the module source names. A rule added
  as a clause inside a sentence a row already matches is the one shape it does not see.

Walk the procedure section by section, and name the shape each part takes, before you call the
mirror pinned.

**Driver-emitted line instance (#4812):** the code side can build a log line inline in a driver's
branches, with no composer to call with the prose's placeholders. `plugin/bin/lib/flow/pr-early-open.js`
writes four rebind lines (`rebound`/`rebind of` a reused/reopened PR) through one `log` closure, and
`_shared/pr-early-run-lifecycle.md` states them as backticked `AUTO {time} — …`/`SKIP {time} — …`
templates. Each side was pinned only against itself. `tests/bin-lib/flow/pr-early-open.test.js`'s
"the four rebind log lines pr-early-open.js writes equal pr-early-run-lifecycle.md's templates" test
runs the composer row's substitution in reverse:

1. It drives every emitting branch through the injected harness, one scripted run per branch.
2. It maps each run's concrete values back to placeholders (`#7` → `#{number}`, the run id →
   `{run-id}`, `HTTP 422` → `{error}`). Pick fixture values that occur nowhere else in the line, or
   the map rewrites text that is not a placeholder.
3. It extracts the templates with one regex over the whitespace-collapsed doc, asserts their exact
   count, and `deepEqual`s the two sorted lists, so a branch with no template and a template with
   no branch both fail.
4. Its go-red controls run through the same helper, each matched to its own message: a reworded
   template, and a dropped one.

The map also drops the `- ` bullet and `formatEntry`'s default `log-decision:` step, which the
templates leave out. Keep it to placeholders plus such known differences, so a real drift is not
normalized away.

**Prose-parser instance (#4940):** the prose side can restate a parser's acceptance rule for a
reader that has no code to run. The routine kernel in `_shared/routine-template-schema.md` reads
`declare-claude-tweaks` only on its empty-plugin-cache branch, where `bin/resolve-policy.js` is not
installed, so its clause (a top-level, unquoted `false`, optionally followed by a `# comment`) is a
hand copy of `parseFlatLines` in `plugin/bin/lib/policy-schema.js`. No word of the clause is a key,
case or array literal there, so step 1's grep finds nothing. The build shipped it unpinned; #4940's
review caught that, and accepted the prose parser because the resolver cannot run on that branch.
`tests/declare-claude-tweaks-opt-out.test.js` now pins it two ways: one `resolve-policy.js --values`
run per clause (a trailing comment, a quoted `"false"`, a commented-out line, an indented key), and
a byte-pin of the clause with a strip control per clause. The two halves sit in separate tests
joined only by a comment, so a parser change turns the resolver test red and leaves the clause pin
green. Keep each clause and its input on one table row, asserting both, so the red row names the
clause to edit.

**Template-with-placeholder-shapes instance (#4785):** `plugin/skills/build/stash-guard.md`
documents the restore line `plugin/bin/stash-guard.js` writes to `decisions.md`: the template
(`AUTO {time} — Stash guard: {who} removed stash entr{y,ies} {sha subject …}; …`) and, right
after it, the `{who}` forms in a parenthetical comma-run. The placeholders carry shapes
(`entr{y,ies}`, a variable subject list), so the composer row's whole-string `strictEqual` cannot
apply, and the `{who}` list is a closed vocabulary with no table rows to walk.
`tests/stash-guard.test.js`'s AC3.1 test pins both from the live CLI. It drives the real `run()`
once per dispatch-id shape (`--label` alone, `--task` with `--label`, `--task` alone) and collects
the `AUTO` lines from the `decisions.md` it wrote. It compiles the prose template into a regex,
each placeholder swapped for its shape and every fixed span escaped, and requires every emitted
line to match. It parses the `{who}` list out of the prose and compares it with the emitted `who`
values in both directions, after expanding `{k}` and `{role}`. Its go-red controls run through the
same helper: a reworded template span fails once per shape, and a dropped `{who}` form fails once.
When a prose template has placeholder shapes, compile it to a regex and run it over the real
writer's output for every input shape the writer takes; typed-in lines agree with the prose by
construction.
