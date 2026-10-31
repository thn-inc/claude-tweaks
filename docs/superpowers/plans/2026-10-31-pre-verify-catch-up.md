# Pre-verification Catch-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:build` merges a moved integration branch into a `pr-first` worktree run branch immediately before Common Step 5's verification run, so the full suite runs once on the merged tree instead of twice (once in build, again in `/test` after the build phase exit's catch-up).

**Architecture:** Prose-only contract change plus one conformance suite. The procedure lives once, as a new `### Pre-verification catch-up` subsection of `plugin/skills/_shared/git-discipline.md`, citing that file's existing **Catch-up (`auto`)** steps 1-4 with stated differences. `build/SKILL.md` Common Step 5 gets one short paragraph pointing at it; the Post-push merge-state check, `test/verification.md`'s Match bullet, `build/handoff-template.md`'s Verification list, `_shared/integration-model.md`'s Consumer table and `docs/skill-graph.md`'s `/build` section each gain one line or sentence.

**Tech Stack:** Markdown skill prose; `node --test` conformance suite (`node:test`, `node:assert/strict`, `tests/helpers/read-skill`'s `readText`).

**Spec:** `.claude-tweaks/pipelines/2026-10-31T095006-record-4343/work/4343-spec.md` (its `## Decisions` section settles the prior attempt's plan-review questions: Q1 every run mode merges; Q2 a standalone worktree build catches up too and reports it in the Step 7 handoff; Q3 only `pr-first` worktree runs catch up, `local-merge` logs one `SKIP` naming the model; Q4 "runs no suite" covers the Match branch and a bookkeeping-only Mismatch).

## Global Constraints

- Merge, never rebase — "applies the existing Catch-up (`auto`) procedure from `_shared/git-discipline.md` (merge, never rebase, with the same conflict-resolution and `merge --abort` rules)" (spec Deliverable 1).
- "The pre-verification catch-up logs one `decisions.md` line naming the before and after SHAs, or a `SKIP` line when the branch is already current." (Deliverable 2)
- "The Post-push merge-state check stays as is." (Deliverable 3) — only one added paragraph there; no existing sentence in that section is edited.
- Decisions Q1/Q3: "Every run mode merges, as `_shared/pre-review-catchup.md` does. No mode branch, no new stop"; "Only `pr-first` worktree runs catch up. `local-merge` logs one `SKIP` naming the model, never a fetch-failed `SKIP`." — so the integration model is resolved before any fetch.
- Size rail: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). `plugin/skills/build/SKILL.md` is 51,305 B at the merge base — 1,195 B headroom. Task 2's paragraph is ~480 B, leaving ~700 B (98.7% of the rail: `nearCeiling`, not a breach). Do not grow that file beyond the paragraph given below; never add a per-file byte pin (`tests/skill-size-single-source.test.js`). `git-discipline.md` (24,088 B), `test/verification.md` (41,950 B), `build/handoff-template.md` and `_shared/integration-model.md` have ample headroom.
- Every `log-decision.js` text that interpolates `{integration-branch}` goes through `--text-file "{text-file}"`, never a quoted `--text` (`tests/log-decision-text-file-sites-conformance.test.js`'s repo-wide `scanQuotedGitText` sweep flags a `{…branch…}` placeholder inside a quoted `--text`). The quoted `--text` strings below carry no `{…}` placeholder.
- `tests/git-discipline-merge-state-conformance.test.js` slices `### Post-push merge-state check` up to `## Catching a branch up with \`main\``, so the new subsection lands inside that slice. Inside it: no line may start with `` - **` `` (those lines are parsed as the CLI's state list), and the phrase `Conflict path` must not appear.
- Governing project skill `skill-prose-conformance-tests` (`.claude/skills/skill-prose-conformance-tests/SKILL.md`), quoted verbatim:
  - "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
  - "**When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself.** Write the assertion as a predicate that returns the facts whose pattern no longer matches (`missingFactsOf(patterns)`), and assert it returns `[]` on the live region. Then, per pattern, strip only that pattern's match from the live text and assert the same predicate returns exactly `[fact]`."
  - "Build the control by **permutation, not deletion**: take the live text, splice the later block above the earlier one, and assert the same helper *throws* on the permuted string — one `assert.throws` per ordered pair, in the same suite." and "Match the permuted throw to the helper's ordering message, and prove the existence half with a separate deletion control matched to its own message."
  - Prose reads come from the shared helper (`tests/helpers/read-skill`'s `readText`).
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Never run `git stash`/`git stash pop`. Commit messages say `refs #4343`, never `closes`/`fixes`. Commit style: `{Verb} {what} — {detail}`, ending with the line `Claude-Session: https://claude.ai/code/session_01YPgdwSSj28FgeDVv7T1KXW`.
- Run targeted suites only (named per task); the full suite runs centrally in Common Step 5.

## Design notes

- **Why not reuse `bin/pre-review-catchup.js`:** that CLI (#4304) is overlap-gated because, before SDD's review, a merge forces an extra suite run. At Common Step 5 the full suite runs anyway, so an unconditional merge when behind costs no run — and AC1 requires merging whenever the branch is behind.
- **Once per build:** the catch-up runs before the first verification run only; a verification re-run after a fix does not repeat it. A base that moves after it is the residual case the Post-push merge-state check catches (the prior plan review's open point).
- **No PR conflict line at Common Step 5:** Catch-up step 1's "Surface the conflict line" has nothing to surface here — the subsection says so (the prior plan review's open point).
- **`MULTISPEC_PARALLEL_WAVE=1`:** a wave member never pushes (it merges back into the shared branch, `flow/multispec-parallel-waves.md`), so it has no post-push catch-up to move ahead: it logs a `SKIP` naming the marker.
- **Resolving the model (verbatim-command probe, run 2026-10-31 in this worktree):** `node plugin/bin/resolve-policy.js --values integration-model --run "{this run dir}"` printed `pr-first`; without `--run` it printed `pr-first`.

Waived plugin/bin/pr-merge-state.js: the spec offers it "or a fetch-and-behind probe"; it reads only DIRTY/CONFLICTING (never BEHIND), so the procedure uses the Catch-up steps' own fetch plus a before/after HEAD comparison instead; nothing in this plan reads or changes the CLI.

## Review Focus

1. A conflict resolved at this step must be committed before the HEAD comparison, else the AUTO line names the wrong after-SHA — pinned by Task 1's `resolved conflict committed first` fact.
2. The abort path must not leave `MERGE_HEAD` set before the suite runs — the subsection cites Catch-up step 4's `merge --abort` and states verification runs on the un-merged tree (Task 1 fact `abort verifies un-merged`).
3. A failed fetch (offline, no `origin`) must fail open, not block verification — Task 1 fact `fetch failure fails open`; and a `local-merge` project must never reach the fetch — Task 1 fact `local-merge SKIP names the model` plus the order assertion placing the model gate before the Catch-up steps.
4. Category A fix commits must land before the catch-up's before-SHA is read — Task 2's paragraph says "after any Category A fix commit" and its order assertion places the paragraph after the Operational-fixes paragraph.
5. A build with no run dir (design mode) has no `decisions.md` — Task 1 fact `no run dir reports in handoff`, Task 2's handoff Verification line.

---

### Task 1: The Pre-verification catch-up procedure in `_shared/git-discipline.md`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/git-discipline.md` — (a) insert the residual paragraph immediately before the line starting `**Catch-up (\`auto\`).**` (after the paragraph `Like the push itself, this degrades per attempt and never persists …`); (b) insert the new `### Pre-verification catch-up` subsection after the Catch-up (`auto`) block's closing paragraph (the one ending `the next phase never starts on a worktree with \`MERGE_HEAD\` set or conflict markers.`) and before `## Catching a branch up with \`main\``.
- Modify: `plugin/skills/_shared/integration-model.md` — one row appended to `## Consumer table`.
- Create: `tests/build-pre-verify-catchup-conformance.test.js`

**Interfaces:**
- Produces: the heading `### Pre-verification catch-up` and the citation form `` `_shared/git-discipline.md`'s Pre-verification catch-up `` that Task 2 points at; test helpers `requireOrder(text, markers)` (asserts each marker exists with message `marker missing: {marker}`, then that each comes after the previous with message `{marker} must come after the previous marker`) and `missingFacts(facts, region)` (returns the `name`s of facts whose `needle` is absent from the whitespace-collapsed region) — Task 2 reuses both.

- [ ] **Step 1: Write the failing test**

Create `tests/build-pre-verify-catchup-conformance.test.js` with a header comment naming #4343 and stating that live prose is read legitimately (the prose is the contract). Read `plugin/skills/_shared/git-discipline.md` and `plugin/skills/_shared/integration-model.md` with `readText`. Define:

- `requireOrder(text, markers)` as in Interfaces (same shape as `tests/pre-review-catchup-conformance.test.js`'s).
- `collapse = (s) => s.replace(/\s+/g, ' ')`.
- `subsection(text)`: slice from `'### Pre-verification catch-up'` to `'## Catching a branch up with `main`'`, asserting both markers exist; return it collapsed.
- `GD_FACTS`, an array of `{ name, needle }` (each matched with `includes` on the collapsed subsection, and each occurring there exactly once):

| name | needle |
|---|---|
| `runs last before Common Step 5` | `` runs this last before Common Step 5's verification run `` |
| `verified tree carries the base` | `` `VERIFICATION_SHA` is the post-merge HEAD `` |
| `not overlap-gated` | `it is not overlap-gated` |
| `once, not after a fix` | `a re-run after a fix does not repeat it` |
| `pr-first worktree only` | `` Only a `pr-first` worktree run catches up `` |
| `resolves the run's model` | `` --values integration-model --run "$PIPELINE_RUN_DIR" `` |
| `local-merge SKIP names the model` | `condition: integration-model local-merge → fallback: no pre-verification catch-up` |
| `current-branch SKIP` | `condition: current-branch strategy → fallback: no pre-verification catch-up` |
| `wave member SKIP` | `condition: MULTISPEC_PARALLEL_WAVE=1 → fallback: no pre-verification catch-up` |
| `every mode, no stop` | `` in every mode — `auto`, `confirm`, `interactive` and `hybrid` alike, and a standalone `/claude-tweaks:build` — and adds no stop `` |
| `cites Catch-up steps 1-4` | `` Run the Catch-up (`auto`) steps 1-4 above `` |
| `merge never rebase` | `merge, never rebase` |
| `logs under its own step` | `` --step "Pre-verification catch-up" `` |
| `no push` | `Nothing is pushed: the build phase exit pushes the merged branch` |
| `no conflict line` | `There is no PR conflict line to surface` |
| `dirty tree SKIP` | `condition: uncommitted changes in the worktree → fallback: catch-up not run; verifying the un-merged tree` |
| `fetch failure fails open` | `condition: fetch failed → fallback: catch-up not run; verifying the un-merged tree` |
| `never asks` | `"ask the user" fallback never applies, in any mode` |
| `abort verifies un-merged` | `aborted on a conflict it could not resolve confidently — verifying the un-merged tree` |
| `resolved conflict committed first` | `A resolved conflict is committed before HEAD is compared` |
| `already current is a SKIP` | `condition: branch already contains origin/{integration-branch} → fallback: nothing merged` |
| `advanced logs before and after` | `merged origin/{integration-branch} before the verification run ({before short} → {after short})` |
| `no run dir reports in handoff` | `` each `SKIP` goes to the Step 7 handoff's Skipped steps section instead `` |
| `post-push check stays` | `The Post-push merge-state check above stays` |

- `assertPreVerifySubsection(text)`: `requireOrder(text, ['### Post-push merge-state check', '**Catch-up (`auto`).**', '### Pre-verification catch-up', '## Catching a branch up with `main`'])`; `requireOrder(subsection(text), ['Only a `pr-first` worktree run catches up', 'Run the Catch-up (`auto`) steps 1-4 above'])` (the model gate precedes the fetch); then `assert.deepEqual(missingFacts(GD_FACTS, subsection(text)), [], 'Pre-verification catch-up facts')`.
- `RESIDUAL = 'already merged the integration branch in before its final verification (Pre-verification catch-up below)'`; `assertPostPushResidual(text)`: the collapsed slice from `'### Post-push merge-state check'` to `'**Catch-up (`auto`).**'` includes `RESIDUAL`, message `post-push residual sentence missing`.
- `CONSUMER_ROW = "`_shared/git-discipline.md`'s Pre-verification catch-up"`; `assertConsumerRow(text)`: the slice of `integration-model.md` from `'## Consumer table'` to the next `'\n## '` has a line starting `| ` that includes `CONSUMER_ROW`, message `integration-model.md Consumer table lacks the Pre-verification catch-up row`.

Tests (names carry the AC clause ids):
- `AC1.1/AC2.1/AC4.1/AC5.1: git-discipline.md states the Pre-verification catch-up` → `assertPreVerifySubsection(GD)`.
- `AC1.1 go-red: each Pre-verification catch-up fact goes red alone` → per fact, mutate the collapsed subsection: `const s = subsection(GD); const m = s.replace(f.needle, ''); assert.notEqual(m, s); assert.deepEqual(missingFacts(GD_FACTS, m), [f.name]);`.
- `AC1.1 go-red: the subsection placed above the Catch-up steps it cites fails the order check` → splice the raw `### Pre-verification catch-up` block (heading through the line before `## Catching a branch up`) above `**Catch-up (`auto`).**`; `assert.notEqual`; `assert.throws(() => assertPreVerifySubsection(swapped), /### Pre-verification catch-up must come after the previous marker/)`. Deletion control: remove the heading line; `assert.throws(…, /marker missing: ### Pre-verification catch-up/)`.
- `AC2.1 go-red: the model gate placed after the Catch-up steps fails the order check` → in a copy of `GD`, swap the raw paragraph starting `Only a \`pr-first\` worktree run catches up` with the paragraph starting `A \`pr-first\` worktree run catches up in every mode` (blank-line paragraph split inside the subsection); `assert.notEqual`; `assert.throws(…, /Run the Catch-up \(`auto`\) steps 1-4 above must come after the previous marker/)`.
- `Deliverable 3: the Post-push merge-state check names the residual case` → `assertPostPushResidual(GD)`; go-red: `GD.replace(RESIDUAL, '')` (assert changed) throws `/post-push residual sentence missing/` — Step 3's paragraph keeps `RESIDUAL` on one raw line so this replace matches.
- `AC2.1: integration-model.md lists the Pre-verification catch-up as a consumer` → `assertConsumerRow(IM)`; go-red: `IM.replace(CONSUMER_ROW, '')` (assert changed) throws `/Consumer table lacks the Pre-verification catch-up row/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-pre-verify-catchup-conformance.test.js`
Expected: FAIL with `marker missing: ### Pre-verification catch-up`

- [ ] **Step 3: Write the prose**

(a) Insert this paragraph immediately before the line starting `**Catch-up (\`auto\`).**` (keep `RESIDUAL`'s words on one raw line):

```markdown
At the build phase's exit this normally reads the PR as current: a `pr-first` `/claude-tweaks:build`
already merged the integration branch in before its final verification (Pre-verification catch-up below),
so a conflict found there is the residual case of a base that moved during that verification.
```

(b) Insert this subsection after the Catch-up (`auto`) block's last paragraph, before `## Catching a branch up with \`main\``:

```markdown
### Pre-verification catch-up

`/claude-tweaks:build` runs this last before Common Step 5's verification run (#4343), so a base
that moved during the build is merged in before the suite runs and `VERIFICATION_SHA` is the
post-merge HEAD. Left to the build phase exit, the merge would change the tree after the suite,
and `/test`'s Skip-if-recent (`test/verification.md`'s Mismatch branch) would run it a second
time. Unlike the Pre-review catch-up (`_shared/pre-review-catchup.md`), it is not overlap-gated:
Common Step 5 runs the full suite anyway, so the merge adds no run. It runs once, before the
first verification run — a re-run after a fix does not repeat it; a base that moves after it is
the residual case the Post-push merge-state check above catches.

Only a `pr-first` worktree run catches up — the one shape whose phase exit merges after the
suite. Resolve the model per `_shared/integration-model.md`:
`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values integration-model --run "$PIPELINE_RUN_DIR"`
(drop `--run` with no run dir). Any other shape merges nothing, fetches nothing, and logs one
`SKIP` (`--reversibility n/a`) naming why:
`--text "condition: integration-model local-merge → fallback: no pre-verification catch-up"`,
`--text "condition: current-branch strategy → fallback: no pre-verification catch-up"`, or
`--text "condition: MULTISPEC_PARALLEL_WAVE=1 → fallback: no pre-verification catch-up"` (a wave
member merges back into the shared branch and never pushes).

A `pr-first` worktree run catches up in every mode — `auto`, `confirm`, `interactive` and
`hybrid` alike, and a standalone `/claude-tweaks:build` — and adds no stop. Run the Catch-up
(`auto`) steps 1-4 above with `{worktree-path}` the build's worktree and `{integration-branch}`
resolved at this call site per `_shared/integration-branch.md` — merge, never rebase, with the
same conflict resolution and `merge --abort` — with these differences. Each `log-decision.js`
call takes `--run "$PIPELINE_RUN_DIR" --section "/build" --step "Pre-verification catch-up"`.

1. Nothing is pushed: the build phase exit pushes the merged branch.
2. There is no PR conflict line to surface. Step 1's dirty tree logs `--status SKIP
   --reversibility n/a --text "condition: uncommitted changes in the worktree → fallback: catch-up
   not run; verifying the un-merged tree"`; a failed fetch logs the same with `--text "condition:
   fetch failed → fallback: catch-up not run; verifying the un-merged tree"`. Either way the
   verification run follows.
3. Merge conflict resolution's "ask the user" fallback never applies, in any mode. A conflict it
   cannot resolve confidently: run `merge --abort` (its own Bash call), log `--status AUTO
   --reversibility high --text-file "{text-file}"`, `{text-file}` holding
   `pre-verification catch-up with origin/{integration-branch} aborted on a conflict it could not resolve confidently — verifying the un-merged tree`,
   and run the verification on the un-merged tree; the build phase exit's Post-push merge-state
   check and, past it, the merge path own the conflict.
4. A resolved conflict is committed before HEAD is compared, as in step 4 above; Common Step 5's
   own run is the verification after resolving. Then compare `git -C "{worktree-path}" rev-parse
   --short HEAD` with step 3's `{before short}`. Unchanged: log `--status SKIP --reversibility n/a
   --text-file "{text-file}"`, `{text-file}` holding
   `condition: branch already contains origin/{integration-branch} → fallback: nothing merged`.
   Advanced: log `--status AUTO --reversibility high --text-file "{text-file}"`, `{text-file}`
   holding
   `merged origin/{integration-branch} before the verification run ({before short} → {after short})`.

Every `{text-file}` above is written per `_shared/auto-decision-log.md`'s Text from git or a user
paragraph (the integration branch name is git-supplied). With no run dir (a design-mode build)
nothing is logged: each `SKIP` goes to the Step 7 handoff's Skipped steps section instead, and
every build names the outcome on its handoff's Verification list.

The Post-push merge-state check above stays: the base can still move during verification, and a
conflict that arrives then is caught at the build phase exit as before.
```

(c) Append this row to `plugin/skills/_shared/integration-model.md`'s `## Consumer table`:

```markdown
| `/claude-tweaks:build` (Common Step 5, `_shared/git-discipline.md`'s Pre-verification catch-up) | Routing whether build merges a moved integration branch in before its verification run (`pr-first`) or logs one `SKIP` naming the model (`local-merge`) |
```

Keep each `GD_FACTS` needle intact on the collapsed text (a line wrap is fine — the subsection is whitespace-collapsed before matching).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/build-pre-verify-catchup-conformance.test.js tests/git-discipline-merge-state-conformance.test.js tests/log-decision-text-file-sites-conformance.test.js tests/integration-model.test.js tests/phase-exit-call-sites-conformance.test.js`
Expected: PASS (0 failures)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/git-discipline.md plugin/skills/_shared/integration-model.md tests/build-pre-verify-catchup-conformance.test.js
git commit -m "Add the Pre-verification catch-up procedure — merge a moved base before build's suite (refs #4343)"
```

### Task 2: Build Common Step 5 runs the catch-up; `/test`'s Match branch and the handoff name it

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/build/SKILL.md` — one new paragraph in `### Common Step 5: Final Verification`, directly after the `**Operational fixes first (#3489).**` paragraph and before the `**Note:**` paragraph.
- Modify: `plugin/skills/build/handoff-template.md` — one bullet appended to the `### Verification` list inside the rendered template.
- Modify: `plugin/skills/test/verification.md` — append one sentence to the `- **Match**` bullet of `### Skip-if-recent (for /flow pipelines)`.
- Modify: `docs/skill-graph.md` — one row in the `## build` section's table, directly after the `` `bin/pre-review-catchup.js` `` row.
- Modify: `tests/build-pre-verify-catchup-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `requireOrder`, `missingFacts`, `collapse`, and the heading `### Pre-verification catch-up`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/build-pre-verify-catchup-conformance.test.js`. Read `plugin/skills/build/SKILL.md`, `plugin/skills/build/handoff-template.md` and `plugin/skills/test/verification.md`. Define `step5(text)`: slice from `'### Common Step 5: Final Verification'` to the next `'\n### '`, asserting the heading exists.

- `CATCHUP = '**Catch up before verifying (#4343).**'`; `BUILD_FACTS` (collapsed step-5 region, each once):

| name | needle |
|---|---|
| `after Category A fixes` | `Immediately before that run and after any Category A fix commit` |
| `cites the shared procedure` | `` run `_shared/git-discipline.md`'s Pre-verification catch-up `` |
| `pr-first worktree, every mode` | `` a `pr-first` worktree run, in every mode, merges in a base that moved during the build `` |
| `VERIFICATION_SHA is post-merge` | `` `VERIFICATION_SHA` is then the post-merge HEAD `` |
| `others log a SKIP` | `` any other run logs its `SKIP` `` |
| `not repeated after a fix` | `It is not repeated before a re-run after a fix` |
| `abort verifies un-merged` | `aborts the merge, and the run verifies the un-merged tree` |

- `assertCatchupBeforeVerify(text)`: `const s = step5(text); requireOrder(s, ['run the shared verification procedure', '**Operational fixes first (#3489).**', CATCHUP, '**Note:**']); assert.deepEqual(missingFacts(BUILD_FACTS, collapse(s)), [], 'Common Step 5 catch-up facts');`
- `HANDOFF_LINE = '- Pre-verification catch-up: {merged origin/{integration-branch} ({before short} → {after short}) | already current | skipped — {condition}}'`; `assertHandoffLine(text)`: the slice from `'### Verification'` to `'### What was built'` includes `HANDOFF_LINE`, message `handoff Verification list lacks the pre-verification catch-up line`.
- `MATCH_NOTE = "build's Pre-verification catch-up (`_shared/git-discipline.md`) merges the integration branch in before its own run"`; `MISMATCH_NOTE = 'a later bookkeeping-only commit takes the Mismatch branch below, which runs no suite either'`; `assertMatchBullet(text)`: the collapsed line starting `- **Match**` within `### Skip-if-recent (for /flow pipelines)` includes `MATCH_NOTE` (message `Match bullet does not name the pre-verification catch-up`) and `MISMATCH_NOTE` (message `Match bullet does not name the bookkeeping-only Mismatch path`).

Tests:
- `AC1.1/AC6.1: Common Step 5 places the catch-up before the verification run` → `assertCatchupBeforeVerify(BUILD)`.
- `AC6.1 go-red: Common Step 5 without the catch-up paragraph fails` (the pre-change prose) → delete the paragraph (from `CATCHUP` through its trailing `\n\n`), `assert.notEqual`, `assert.throws(…, /marker missing: \*\*Catch up before verifying \(#4343\)\.\*\*/)`.
- `AC6.1 go-red: the catch-up paragraph spliced above the verification sentence fails the order check` → move the paragraph to just before `After Common Steps 6 and 6.5, so the verified tree`; `assert.notEqual`; `assert.throws(…, /\*\*Catch up before verifying \(#4343\)\.\*\* must come after the previous marker/)` (the spliced paragraph now precedes `run the shared verification procedure`, so `requireOrder` fails on `CATCHUP`).
- `AC1.1 go-red: each Common Step 5 fact goes red alone` → per fact, strip its needle from the collapsed region; `assert.deepEqual(missingFacts(BUILD_FACTS, m), [f.name])`.
- `AC1.1: the build handoff names the catch-up outcome (standalone builds report it there)` → `assertHandoffLine(HANDOFF)`; go-red: `HANDOFF.replace(HANDOFF_LINE, '')` (assert changed) throws `/handoff Verification list lacks the pre-verification catch-up line/`.
- `AC3.1: /test's Skip-if-recent Match branch is the expected path after the catch-up` → `assertMatchBullet(VERIFICATION)`; go-red: `VERIFICATION.replace(MATCH_NOTE, '')` throws `/Match bullet does not name the pre-verification catch-up/`, and `VERIFICATION.replace(MISMATCH_NOTE, '')` throws `/Match bullet does not name the bookkeeping-only Mismatch path/` (each preceded by `assert.notEqual`).

- [ ] **Step 2: Run test to verify it fails, and record the AC6.1 evidence**

Run: `node --test tests/build-pre-verify-catchup-conformance.test.js`
Expected: FAIL with `marker missing: **Catch up before verifying (#4343).**`

This red run against the current Common Step 5 prose is AC6.1's "fails against the current prose" evidence. Record it: `mkdir -p "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-31T095006-record-4343/evidence"`, then re-run the command with `> "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-31T095006-record-4343/evidence/ac6-red-against-current-prose.txt" 2>&1` (a plain Bash redirect — the Write tool is refused there), and report the `ℹ fail` count in your reply; the controller writes the `AC evidence` decisions.md entry.

- [ ] **Step 3: Write the prose**

In `plugin/skills/build/SKILL.md` Common Step 5, after the `**Operational fixes first (#3489).**` paragraph, insert exactly:

```markdown
**Catch up before verifying (#4343).** Immediately before that run and after any Category A fix commit, run `_shared/git-discipline.md`'s Pre-verification catch-up: a `pr-first` worktree run, in every mode, merges in a base that moved during the build, so `VERIFICATION_SHA` is then the post-merge HEAD; any other run logs its `SKIP`. It is not repeated before a re-run after a fix, and a conflict it cannot resolve confidently aborts the merge, and the run verifies the un-merged tree.
```

In `plugin/skills/build/handoff-template.md`, append to the `### Verification` list (after `- Tests: {pass/fail}`):

```markdown
- Pre-verification catch-up: {merged origin/{integration-branch} ({before short} → {after short}) | already current | skipped — {condition}}
```

In `plugin/skills/test/verification.md`, append to the end of the `- **Match**` bullet (same line, after `when \`/flow\` chains build → test.`):

```markdown
 It is the expected branch after a moved base too: build's Pre-verification catch-up (`_shared/git-discipline.md`) merges the integration branch in before its own run, so `VERIFICATION_SHA` already names the merged HEAD, and a later bookkeeping-only commit takes the Mismatch branch below, which runs no suite either.
```

In `docs/skill-graph.md`'s `## build` table, after the `` `bin/pre-review-catchup.js` `` row:

```markdown
| `_shared/git-discipline.md` | Common Step 5 runs its Pre-verification catch-up (#4343) immediately before the verification run, after any Category A fix commit: a `pr-first` worktree run merges a moved integration branch in, in every mode, so `VERIFICATION_SHA` is the post-merge HEAD and `/test`'s Skip-if-recent takes its Match branch; `local-merge`, `current-branch` and a `MULTISPEC_PARALLEL_WAVE=1` member log one `SKIP`. The Post-push merge-state check at the build phase exit stays for a base that moves during verification. |
```

Measure: `wc -c plugin/skills/build/SKILL.md` must print below 52500.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/build-pre-verify-catchup-conformance.test.js tests/build-verify-after-doc-steps.test.js tests/build-skip-degrade-trace-adoption.test.js tests/skill-size-single-source.test.js tests/bin-lib/skill-audit/budgets.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/verification-skip-before-execute.test.js`
Expected: PASS (0 failures)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/SKILL.md plugin/skills/build/handoff-template.md plugin/skills/test/verification.md docs/skill-graph.md tests/build-pre-verify-catchup-conformance.test.js
git commit -m "Run the pre-verification catch-up in build Common Step 5 — the suite runs once on the merged tree (refs #4343)"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (fetch; merge when behind via Catch-up (`auto`)) | Task 1 subsection; Task 2 call site |
| Deliverable 2 (one decisions.md line with SHAs, or SKIP) | Task 1 facts `advanced logs before and after`, `already current is a SKIP` |
| Deliverable 3 (Post-push check stays) | Task 1 fact `post-push check stays`; residual paragraph |
| Deliverable 4 (prose states the new order) | Task 1 residual paragraph; Task 2 Common Step 5 paragraph |
| AC1.1 | Task 2 `assertCatchupBeforeVerify` and handoff line (+ Task 1 `verified tree carries the base`, `every mode, no stop`) |
| AC2.1 | Task 1 `local-merge SKIP names the model`, model-gate order check, Consumer table row |
| AC3.1 | Task 2 `assertMatchBullet` |
| AC4.1 | Task 1 `already current is a SKIP` |
| AC5.1 | Task 1 `abort verifies un-merged`; Task 2 `abort verifies un-merged` |
| AC6.1 | Task 2 go-red controls and the Step 2 red run recorded as AC evidence |
