# Record #4647 — Settle 4 Below-Floor Test Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the four `tests`-area digest findings promoted into #4647: fix three and close one with a stated rationale.

**Architecture:** Four independent test-file edits, plus one sentence of skill prose that Task 1 pins. There is no runtime code change: the hooks gate and the console resolver stay as they are, and `plugin/bin/lib/console/resolve.js` is touched only temporarily, inside Task 4's go-red proof, then restored.

**Tech Stack:** Node 18+, `node --test`, `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T124928-record-4647/work/4647-spec.md`

## Global Constraints

- AC: "Each Deliverables bullet is either fixed (with a test where behaviour changes) or closed out with a one-line rationale in the PR body."
- AC: "Every promoted digest line in #1426 carries `→ #{this record}`." This is already satisfied: all four lines (materiality-d5dd7165, -48074aca, -20896ace, -a171c179) end `→ #4647`. No task is needed.
- Release Note: "No user-visible change."
- Governing skill `skill-prose-conformance-tests` (verbatim): "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** … preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
- Go-red controls run the same assertion function the positive test runs (build plan-authoring "Go-red control check").
- Commit subjects use `{Verb} {what} — {detail}`, with `refs #4647` in the body. Never "closes" or "fixes".
- `plugin/skills/release/disposition.md` is 12,568 B against `RAIL_BYTES` 52,500. Task 1 adds about 70 B, which leaves ample headroom.

## Review Focus

- A roster row whose Example cell names no `staged/` file. Expected: some test goes red. Today, AC2.1 and the review-routing-line pin both iterate `exampleNames(row.example)` and pass such a row silently. Task 1 covers it.
- A future narrowing of the cp gate that drops the over-read `b`. Expected: Task 3's dedicated rows go red and name the over-read, not a "GNU destination" claim. Task 3 covers it.
- Restoring `resolve.js`'s pre-#4582 path class. Expected: a behavioural settle assertion goes red, not only the key-string one. Task 4 covers it.

---

### Task 1: Roster Example cells must each name a staged/ file

**Role:** integration

**Files:**
- Modify: `plugin/skills/release/disposition.md:32` (the paragraph under `### Review staging roster`)
- Test: `tests/release-run-dir-lifecycle-conformance.test.js` (`ROSTER_PROSE` at ~734; the new helper and tests after `exampleNames` at ~805)

**Interfaces:**
- Consumes: `exampleNames(cell)`, `parseRoster(text)`, `rosterLine(text, prefix)` and `readDisposition()`, all already in the file.
- Produces: `namelessExampleRows(roster) -> string[]`, the prefixes of rows whose Example yields no name.

- [ ] **Step 1: Add the prose pin.** Append this entry to `ROSTER_PROSE`: ``[/Every row's Example names at least one `staged\/` file/, 'every roster row names at least one staged/ file in its Example']``.
- [ ] **Step 2: Run it and confirm it fails.** Run `node --test tests/release-run-dir-lifecycle-conformance.test.js`. Expected: FAIL in `roster-vs-routing: the roster prose clauses the checks rely on are stated`, with the missing-fact message naming the new fact.
- [ ] **Step 3: Add the sentence.** Append `` Every row's Example names at least one `staged/` file.`` to the end of disposition.md line 32, after "…matches no row.".
- [ ] **Step 4: Add the helper and its tests.** Add `namelessExampleRows(roster)`, which returns `roster.filter((row) => exampleNames(row.example).length === 0).map((row) => row.prefix)`, with a one-line comment that a check reading the Example passes over such a row vacuously. Then add two tests:
  - `every roster row's Example yields at least one staged/ name (#4647)`: `assert.deepEqual(namelessExampleRows(parseRoster(readDisposition())), [])`.
  - `go-red: a roster row whose Example names no staged/ file is reported (#4647)`: in memory, replace the `review-followup-` row's `` `staged/review-followup-{n}.md` `` with `—`. Assert `notEqual(doctored, text)` with an anchor message, then `assert.deepEqual(namelessExampleRows(parseRoster(doctored)), ['review-followup-'])`.
- [ ] **Step 5: Confirm the file passes.** Run the same command. Expected: PASS, 0 failures.
- [ ] **Step 6: Commit.** `git add` both files, then commit `Pin that every review staging roster row names a staged/ file — closes the vacuous Example pass` with `refs #4647` in the body.

### Task 2: Drop the subsumed accept: search test

**Role:** transcription

**Files:**
- Modify: `tests/acceptance-scan-server-filter.test.js:550-558`

- [ ] **Step 1: Delete the duplicate test.** Remove the test `the acceptance-gap search excludes all three accept: labels as well as the demo: ones` and keep the `// ---- accept:* read sites (#4610 expand step)` header, since the two acceptance-queue tests stay. `negated labels are exactly needsBackstop dispositions` already makes every claim it made: an exact `deepEqual` over all six negated labels, accept:* included, and `dispositionState(label) !== 'none'` for each. Its one other line, `!PRE_CHANGE_GAP_FETCH.includes('-label:accept:')`, is implied by the frozen excerpt carrying no `--search` at all (asserted in `the frozen excerpt carries the anchors…`).
- [ ] **Step 2: Confirm the file passes.** Run `node --test tests/acceptance-scan-server-filter.test.js`. Expected: PASS.
- [ ] **Step 3: Commit.** Commit `Drop the accept: search test that a sibling test subsumes — trims the acceptance-scan suite` with `refs #4647`.

Rationale for the PR body (the size finding): each of the remaining tests pins a distinct contract claim from three sections (#4469's acceptance-gap, parent-gate and label-filtered parent fetches, and #4610's queue), each with the go-red control this repo requires. Splitting the file would not shrink it, and dropping controls would make pins vacuous.

### Task 3: Label the cp trailing-value-option rows as an over-read

**Role:** integration

**Files:**
- Modify: `tests/hooks-gate-coverage.test.js:575-586`

Probe recorded: GNU coreutils 9.12 `gcp a b -S` and `gcp a b --suffix` exit 1 ("option requires an argument -- 'S'" and "option '--suffix' requires an argument") and write nothing. macOS `/bin/cp a b -S` exits 1 with `cp: -S: Not a directory`, which reads `-S` as its destination.

- [ ] **Step 1: Move the rows.** Remove `['cp a b -S', ['b', '-S']], ['cp a b --suffix', ['b', '--suffix']],` from the `reports the GNU destination and the BSD destination` table. Add a new loop after it over exactly those two rows, with the same assertion (`fileWriteTargets(cmd, '/r').map((t) => t.file)` deep-equals the resolved files). Title: `` #4449: `${cmd}` reports the BSD destination and over-reads b, which GNU never writes ``. Above the loop, add a comment giving the probe result above and stating that `b` is the GNU reading's over-read: the gate denies a write that GNU never makes, which only over-denies.
- [ ] **Step 2: Confirm the file passes.** Run `node --test tests/hooks-gate-coverage.test.js`. Expected: PASS, with the test count unchanged (two tests renamed, none added or lost).
- [ ] **Step 3: Commit.** Commit `Label the cp trailing -S/--suffix rows as a GNU over-read — GNU exits 1 and writes nothing` with `refs #4647`.

### Task 4: Behavioural discrimination for the #4582 scoped-path settle

**Role:** integration

**Files:**
- Modify: `tests/bin-lib/console/resolve.test.js:1063-1068`
- Temporarily touched (restored in the same task): `plugin/bin/lib/console/resolve.js:510`

- [ ] **Step 1: Add the behavioural line.** Place it directly after line 1065's settle assertion and before the existing `// Direct key:` comment and the key assertion, so it runs first under the old class. In that existing comment, change "so the settle above passes either way" to "so the first settle above passes either way" (the deictic now spans two settles). Add a comment ("A sibling scoped path at the same lens and line: the pre-#4582 class truncates both to `scope/x.ts:4`, so it settled wrongly.") and then this line: `assert.deepStrictEqual(findings([stagedLow('3a', 'apps/@scope/x.ts:4'), tbVerdict(f, { verdict: 'confirmed' }).entry].join('\n')).map((i) => i.resolution), ['keep-staged']);`
- [ ] **Step 2: Confirm the file passes.** Run `node --test tests/bin-lib/console/resolve.test.js`. Expected: PASS.
- [ ] **Step 3: Prove discrimination.** With Edit, replace the `FINDING_PATH` value in `resolve.js` with `` String.raw`[A-Za-z0-9_./-]+\.[A-Za-z0-9]+` `` (the pre-#4582 class). Re-run the same command. Expected: FAIL in `a confirmed verdict for a scoped-package path supersedes its STAGED line (#4582 AC1)`, with `[]` against `['keep-staged']` at the new line, which runs before the key assertion. Restore the original value with Edit, then run `git diff --stat -- plugin/bin` and expect empty output.
- [ ] **Step 4: Commit.** Commit `Add a behavioural settle check for the #4582 scoped-path fix — a sibling scoped path stays staged` with `refs #4647`.
