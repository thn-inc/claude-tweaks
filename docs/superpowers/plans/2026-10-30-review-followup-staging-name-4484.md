# Review-followup Staging Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a confirmed review finding with no patch (a record proposal) one staging name that `/review` writes, `stage-item.js` accepts, the composer logs, and `/release`'s disposition roster routes: `staged/review-followup-{n}.md`.

**Architecture:** `review-followup-` already maps to the Review Console's Queue writes section (`plugin/bin/lib/console/resolve.js` SECTION_MAP, line 83), so no console code moves. Three things change. The composer from #4488 (`review-routing.js`'s `STAGE_PATH_RE`) learns the second stage-path shape. `review/step3-routing.md` names the shape. `release/disposition.md`'s roster gains the row and drops the unstageable `review-{n}.md` form. A two-way twin pin keeps the roster and SECTION_MAP's `review-*` slice from drifting.

**Tech Stack:** Node 18+ (CI Node 20), `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T172259-spec-4488-4484/spec-4484/work/4484-spec.md`

**Scope keywords:** review-followup, review-{n}.{md,patch}, STAGE_PATH_RE

## Global Constraints

- The staging name is exactly `staged/review-followup-{n}.md`, written via `stage-item.js`, carrying the `Title:`/`Type:`/`Labels:`/`Defer-reason:` header the console's queue-write step reads (spec Deliverable 1).
- Roster row: prefix `review-followup-`, route `proposal`, counted one finding per file. The `review-{n}` row's example becomes `staged/review-{n}.patch` (spec Deliverable 2).
- The new test pins every roster prefix whose route is not `not staged by review` against `stage-item.js`/SECTION_MAP (spec Deliverable 3).
- No `SECTION_MAP`/`CANONICAL_PREFIXES` change. `review-console-section-addition`'s registration set does not apply: its own text says "A new prefix in an existing section is a smaller change", and here not even the prefix is new.
- `gh-api-module-pattern`'s CLI wrapper contract governs `review-routing-line.js`. This plan keeps that CLI's exit codes (0 appended, 2 malformed, 3 run dir) and only widens one value check.
- Byte headroom against `RAIL_BYTES` (52,500): `review/step3-routing.md` is 32,262 B before this plan (about 1.5 KB added → about 33.8 KB, 18.7 KB headroom). `release/disposition.md` is 11,886 B (about 0.3 KB added).
- Commit style: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_017vXcAb5fMxywZSF1hPXTV2`. Never `git add -A`; stage named paths.

## Review Focus

1. A staged `review-followup-{n}.md` whose body carries a `**Category:**` line reroutes from Queue writes to Pending review (`resolve.js:255`'s non-tangential reroute), so the record would never file. The header+`specShapedBody` shape must classify Queue writes. Pinned in Task 2 with a real `specShapedBody` call.
2. `stage-item.js --allocate` can land a different `{n}` than requested. The STAGED line must name the path actually written. Pinned in Task 2's prose test (the paragraph says to take `{n}` from the printed path).
3. Near-miss stage paths the composer must still refuse: `staged/review-followup-x.md`, `staged/review-followup-3.patch`, `staged/review-3.md`. Pinned in Task 1.
4. A STAGED high record proposal must still read as `review: blocking` at the release gate, the same as a staged high patch. Pinned in Task 1's verdict table.
5. The roster's `{md,patch}` brace alternative is the bug's shape. The new pin must expand every alternative in an Example cell, not only the first (the existing `stagedNamesIn` keeps only the first). Pinned in Task 2's go-red.

---

### Task 1: The composer accepts a record-proposal stage path

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/log-decision/review-routing.js:20` (`STAGE_PATH_RE`) and `:58` (error message)
- Modify: `plugin/bin/review-routing-line.js:4` and `:14` (usage synopsis)
- Modify: `docs/plugin-structure.md:192` (the CLI's command line)
- Test: `tests/bin-lib/log-decision/review-routing.test.js`

**Interfaces:**
- Produces: `composeRoutingLine({ route: 'staged', stagePath: 'staged/review-followup-{n}.md', … })` returns `{ status: 'STAGED', text: '{sev}-severity finding {category} at {at}. Stage path: staged/review-followup-{n}.md', reversibility: 'high' }`. Task 2's prose command relies on this.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/log-decision/review-routing.test.js`
  - New test `'#4484: --route staged accepts a staged/review-followup-{n}.md stage path'`. It runs `['--run', runDir, '--route', 'staged', '--severity', 'medium', '--category', 'security', '--at', 'src/a.js:12', '--stage-path', 'staged/review-followup-2.md']`, expects exit 0, and asserts `decisionsOf(runDir)` equals `'## /review\n- STAGED 09:05:07 — Step 3 Routing: medium-severity finding security at src/a.js:12. Stage path: staged/review-followup-2.md. Reversibility: high.\n'`.
  - Add a row to the release-gate verdict table (the `{ label, argv, verdict }` list near line 69): `{ label: 'STAGED high record proposal', argv: ['--route', 'staged', '--severity', 'high', '--category', 'security', '--at', 'src/a.js:12', '--stage-path', 'staged/review-followup-1.md'], verdict: 'review: blocking' }`.
  - Add rows to the invalid table (near line 161): `'staged with a non-numeric review-followup --stage-path': staged/review-followup-x.md`, `'staged with a review-followup .patch --stage-path': staged/review-followup-3.patch`, `'staged with a review-{n}.md --stage-path': staged/review-3.md`. Each expects exit 2 and writes nothing, like the table's existing rows.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/log-decision/review-routing.test.js`
Expected: FAIL. The new accept test exits 2 with `--stage-path must match staged/review-{n}.patch`, and the verdict-table row fails. The three invalid rows already pass, which is expected: they guard the widened regex in Step 3.

- [ ] **Step 3: Widen `STAGE_PATH_RE`** to `/^staged\/(?:review-\d+\.patch|review-followup-\d+\.md)$/`. Change the error to `'--stage-path must match staged/review-{n}.patch or staged/review-followup-{n}.md with --route staged'`. Update the usage synopsis in `review-routing-line.js` (both lines) and `docs/plugin-structure.md:192` to `[--stage-path staged/review-{n}.patch|staged/review-followup-{n}.md]`. Add one comment line above `STAGE_PATH_RE` naming the two shapes: a patch, or a record proposal (#4484).

- [ ] **Step 4: Run to verify they pass, and prove the widening is load-bearing**

Run: `node --test tests/bin-lib/log-decision/review-routing.test.js tests/bin-lib/log-decision/cli.test.js tests/review-routing-line-prose-conformance.test.js`
Expected: PASS.

Mutant check: temporarily make the regex `/^staged\/review-[\w-]+\.(patch|md)$/`, re-run the first file, and expect the three new invalid rows to go red. Then restore it.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/log-decision/review-routing.js plugin/bin/review-routing-line.js docs/plugin-structure.md tests/bin-lib/log-decision/review-routing.test.js
git commit -m "Accept a review-followup record-proposal stage path in the routing composer — #4484 staging name" -m "Claude-Session: https://claude.ai/code/session_017vXcAb5fMxywZSF1hPXTV2"
```

---

### Task 2: Name the shape in review, route it in release, pin roster ↔ SECTION_MAP

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/review/step3-routing.md`. Add a new paragraph directly after the `**Staging a patch — validate first, describe the invariant.**` paragraph (line 67).
- Modify: `plugin/skills/release/disposition.md:36`. Narrow the `review-{n}` example. Add a `review-followup-` row after it.
- Modify: `tests/release-run-dir-lifecycle-conformance.test.js`:
  - `parseRoster` also returns `example: cells[1]`. Consumers checked: every caller reads `.prefix`/`.route`/`.stagedBy` or compares rows by identity, and no `deepEqual` runs over row objects.
  - The `DISPOSITION_SCOPE` pin at line 350 changes from `staged\/review-\{n\}\.\{md,patch\}` to `staged\/review-\{n\}\.patch`, and a sibling pin is added for `staged\/review-followup-\{n\}\.md`.
  - New twin-pin tests go in the roster section.
- Modify: `tests/review-routing-line-prose-conformance.test.js`. Execute the new paragraph's cited command.
- Modify: `tests/bin-lib/stage-item/cli.test.js`. Add the AC1.1 stage-item case.

**Interfaces:**
- Consumes: Task 1's widened composer.
- Consumes: `classifyStagedItem`, `stagingExemption` and `CANONICAL_PREFIXES` from `plugin/bin/lib/console/resolve.js`.
- Consumes: `specShapedBody` from `plugin/bin/lib/issues/record.js`.

**The step3-routing.md paragraph must state:**
1. Heading: `**Staging a record proposal — a confirmed finding with no patch.**`
2. When it applies: a finding the table routes AUTO or STAGED that fails `_shared/deferral-gate.md`'s fix-now criteria with a valid `Defer-reason:`. Its fix is a new work record (the Defer bullet below), not a diff. Critical keeps its KEPT-PROMPT row.
3. The file: the record composed exactly as the Defer bullet composes it (`specShapedBody` body, `recordPayload` labels). It is written as `Title:`/`Type:`/`Labels:`/`Defer-reason:` header lines, then a `Finding: {severity} {category} — {one line}` line (plan-review clarification: disposition's `proposal` row reads severity from it), a blank line, then the body. That is the header `wrap-up/review-console.md`'s "On approval" step 7 reads. `Finding:` is a bookkeeping key the console's header parser keeps out of the filed body (`plugin/bin/lib/console/backfill.js`'s `STAGED_BOOKKEEPING_KEYS`).
4. The stage call: write the proposal to a `.md` scratch path. stage-item.js takes the staged file's extension from `--file` (`plugin/bin/lib/stage-item/write.js`), so resolve the path with `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value review-followup-proposal.md`. Then run `node "${CLAUDE_PLUGIN_ROOT}/bin/stage-item.js" --run "$PIPELINE_RUN_DIR" --id review-followup-{n} --file {proposal} --allocate`, with `{n}` taken from the path its first stdout line prints. Never `review-{n}.md`: stage-item.js refuses that id (`unmapped-prefix`).
5. The log, as its own backticked command: `node "${CLAUDE_PLUGIN_ROOT}/bin/review-routing-line.js" --run "$PIPELINE_RUN_DIR" --route staged --severity {severity} --category '{category}' --at '{file:line}' --stage-path staged/review-followup-{n}.md`
6. The ledger row: the finding's open-items ledger row is written `deferred`, its Resolution naming `staged/review-followup-{n}.md`. This mirrors `_shared/ledger-format.md`'s `ledger-record-*` Defer ("Update ledger status to `deferred`, the Resolution naming the staged path"), so ledger resolve never re-fixes or re-defers a finding the console is already filing. It is the one exception to the "status `open` for staged" sentence below the paragraph.
7. Nothing is filed here. Work-record creation is never silenced in `auto` (`_shared/auto-mode-contract.md`), so the console files the record on approval.

**The disposition.md row** (5 columns): `` | `review-followup-` | `staged/review-followup-{n}.md` | `review/step3-routing.md` (Step 3; a confirmed finding whose fix is a new record, not a patch) | one finding per file, its severity read from the file's `Finding: {severity} {category} — …` line | `proposal` | ``. The `review-{n}` row's Example cell becomes `` `staged/review-{n}.patch` ``.

- [ ] **Step 1: Write the failing tests**

In `tests/release-run-dir-lifecycle-conformance.test.js`, add to the roster section:
- `exampleNames(cell)`: every `staged/{name}` literal in the cell, with each `{a,b}` brace group expanded into **every** alternative (unlike `stagedNamesIn`), and `{n}`/`{N}`/`{slug}` → `1`, `*` → `x`.
- `unstageableRosterNames(roster)`: for each row whose route is not `not staged by review`, every `exampleNames(row.example)` name where `stagingExemption(name) === null && classifyStagedItem(name).reason === 'unmapped-prefix'`.
- `reviewPrefixesWithoutRow(roster)`: `CANONICAL_PREFIXES.filter((p) => p.startsWith('review-') && !roster.some((r) => r.prefix === p))`.
- `assertRosterMatchesSectionMap(text)`: parses the roster, then `deepEqual`s both helper lists to `[]` with messages naming the offending names or prefixes. Both go-red tests below call this same function.
- `test('AC2.1: every roster example a review producer can name is stageable (no review-{n}.md)', …)`: calls `assertRosterMatchesSectionMap(readDisposition())`.
- `test('AC3.1: every review-* SECTION_MAP prefix has a roster row — deleting the review-followup- row goes red', …)`: asserts it passes on the real text and throws `/review-followup-/` on `withoutRosterRow(text, 'review-followup-')`.
- `test('AC2.1 go-red: restoring the review-{n}.{md,patch} example goes red on review-1.md', …)`: replaces the `review-{n}` row's Example cell with `` `staged/review-{n}.{md,patch}` `` and expects a throw matching `/review-1\.md/`. This proves the full brace expansion (Review Focus 5).
- `test('AC1.1: review-followup-1.md routes to the proposal row, which the Routing table defers', …)`: asserts `classify('review-followup-1.md', roster).route === 'proposal'` and `routingRowOf(text, 'proposal')` exists.
- Update `DISPOSITION_SCOPE` (line 350) as listed under Files.

In `tests/bin-lib/stage-item/cli.test.js`:
- `test('AC1.1: --id review-followup-1 (.md) stages with no refusal (#4484)', …)` in the shape of the `AC1.2: cli: a canonical id` test. It expects exit 0, `staged/review-followup-1.md` to exist under the realpath'd run dir, and empty stderr.
- `test('#4484: a header+specShapedBody record proposal classifies to Queue writes', …)`. Build the body with the real `specShapedBody({ currentState, deliverables, acceptanceCriteria: ['x'], releaseNote: 'No user-visible change.', filedBy: 'review', provenance: { origin: 'spec #1 review (3a)', deferReason: 'genuinely-larger' } })`. Prefix `Title: t\nType: task\nLabels: ready\nDefer-reason: genuinely-larger\nFinding: high security — x\n\n`. Assert `classifyStagedItem('review-followup-1.md', text)` deepEquals `{ section: 'Queue writes' }` (Review Focus 1).

In `tests/review-routing-line-prose-conformance.test.js`:
- `test('#4484: the record-proposal paragraph cites a composer command that stages a review-followup line', …)`. Find the line starting `**Staging a record proposal`. Take its backticked `review-routing-line.js` command, `instantiate(command, 'high', runDir)`, run it, and assert exit 0 and that the appended line contains `high-severity finding` and `Stage path: staged/review-followup-3.md`.
- In the same test, assert the paragraph contains each of these, so each item is pinned:
  - `--id review-followup-{n}`, `--allocate`, and `from the path its first stdout line prints` (Review Focus 2)
  - `Finding: {severity} {category}` (item 3)
  - `session-tmp-resolve.js" --value review-followup-proposal.md` (item 4)
  - `` written `deferred` `` (item 6)
- Go-red: one test runs the paragraph-clause assertions (factored into one function) against the paragraph with the `deferred` clause removed, and expects a throw.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/release-run-dir-lifecycle-conformance.test.js tests/bin-lib/stage-item/cli.test.js tests/review-routing-line-prose-conformance.test.js`
Expected: FAIL in four places:
- AC2.1 on `review-1.md`
- AC3.1 on `review-followup-`
- AC1.1 routing, because no row exists yet
- the prose test, because the paragraph is missing

The stage-item AC1.1 case and the classification case already pass. That is expected: they pin behavior this task depends on and must not regress.

- [ ] **Step 3: Edit the prose.** Edit `step3-routing.md` (the paragraph above) and `disposition.md` (the row and the narrowed example).

- [ ] **Step 4: Run to verify they pass, plus the neighboring pins**

Run: `node --test tests/release-run-dir-lifecycle-conformance.test.js tests/bin-lib/stage-item/cli.test.js tests/review-routing-line-prose-conformance.test.js tests/bin-lib/console/staged-id-producers.test.js tests/bin-lib/console/resolve.test.js tests/bin-lib/log-decision/review-routing.test.js`
Expected: PASS. `staged-id-producers` scans the new `--id review-followup-{n}` command line. `assertProven` needs step3-routing.md to name `staged/review-followup-{n}.md`.

- [ ] **Step 5: Re-check the staged #4488 patch still applies**

Run: `git apply --check "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-28T172259-spec-4488-4484/spec-4488/staged/review-1.patch"`
Expected: exit 0. If it fails, record the drift in the ledger as an observation. The console re-derives the change from the patch's `Invariant:`, so do not edit the staged file.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/review/step3-routing.md plugin/skills/release/disposition.md tests/release-run-dir-lifecycle-conformance.test.js tests/bin-lib/stage-item/cli.test.js tests/review-routing-line-prose-conformance.test.js
git commit -m "Name staged/review-followup-{n}.md for a record-routed review finding — roster row, review-{n} narrowed to .patch, roster↔SECTION_MAP pin (#4484)" -m "Claude-Session: https://claude.ai/code/session_017vXcAb5fMxywZSF1hPXTV2"
```

---

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (step3-routing.md names the shape, via stage-item.js, with the header) | Task 2 (prose) + Task 1 (the composer the prose logs through) |
| Deliverable 2 (roster row; `review-{n}` narrowed to `.patch`) | Task 2 |
| Deliverable 3 (roster vs SECTION_MAP test) | Task 2 (AC2.1, AC3.1 + go-red) |
| AC1.1 (stage-item succeeds; disposition routes via its Routing table) | Task 2 (stage-item AC1.1 test; AC1.1 routing test) |
| AC2.1 (no row whose example a producer cannot stage) | Task 2 |
| AC3.1 (test fails with the row deleted, passes with it) | Task 2 |
| AC4.1 (`npm test` passes) | `/build` Common Step 5 (full suite, run centrally) |
