# Pre-verification Catch-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:build` merges a moved integration branch into the run branch immediately before Common Step 5's verification run, so the full suite runs once on the merged tree instead of twice (once in build, again in `/test` after the build phase exit's catch-up).

**Architecture:** Prose-only contract change plus one conformance suite. The procedure lives once, as a new `### Pre-verification catch-up` subsection of `plugin/skills/_shared/git-discipline.md`, citing that file's existing **Catch-up (`auto`)** steps 1-4 with stated differences (no push; SKIP when already current; abort leaves the un-merged tree to be verified). `build/SKILL.md` Common Step 5 gets one short paragraph pointing at it; the Post-push merge-state check and `test/verification.md`'s Match bullet each gain one sentence stating the new order.

**Tech Stack:** Markdown skill prose; `node --test` conformance suite (`node:test`, `node:assert/strict`, `tests/helpers/read-skill`'s `readText`).

**Spec:** `.claude-tweaks/pipelines/2026-10-30T210408-record-4343/work/4343-spec.md`

**Scope keywords:** Pre-verification catch-up, Catch-up (`auto`), VERIFICATION_SHA

## Global Constraints

- Merge, never rebase — "applies the existing Catch-up (`auto`) procedure from `_shared/git-discipline.md` (merge, never rebase, with the same conflict-resolution and `merge --abort` rules)" (spec Deliverable 1).
- "The pre-verification catch-up logs one `decisions.md` line naming the before and after SHAs, or a `SKIP` line when the branch is already current." (Deliverable 2)
- "The Post-push merge-state check stays as is." (Deliverable 3) — only one added paragraph there; no existing sentence in that section is edited.
- Size rail: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). `plugin/skills/build/SKILL.md` is 51,305 B at the merge base — 1,195 B headroom. Task 2's paragraph is ~390 B, leaving ~800 B (98.5% of the rail: `nearCeiling`, not a breach). Do not grow that file beyond the paragraph given below; never add a per-file byte pin (`tests/skill-size-single-source.test.js`). `git-discipline.md` (24,088 B) and `test/verification.md` (41,950 B) have ample headroom.
- Every `log-decision.js` text that interpolates `{integration-branch}` goes through `--text-file "{text-file}"`, never a quoted `--text` (`tests/log-decision-text-file-sites-conformance.test.js`'s repo-wide `scanQuotedGitText` sweep flags any `{…branch…}` placeholder inside a quoted `--text`).
- `tests/git-discipline-merge-state-conformance.test.js` slices `### Post-push merge-state check` up to `## Catching a branch up with \`main\``, so the new subsection lands inside that slice. Inside it: no line may start with `` - **` `` (those lines are parsed as the CLI's state list), and the phrase `Conflict path` must not appear.
- Governing project skill `skill-prose-conformance-tests` (`.claude/skills/skill-prose-conformance-tests/SKILL.md`), quoted verbatim:
  - "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
  - "**When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself.** Write the assertion as a predicate that returns the facts whose pattern no longer matches (`missingFactsOf(patterns)`), and assert it returns `[]` on the live region. Then, per pattern, strip only that pattern's match from the live text and assert the same predicate returns exactly `[fact]`."
  - "Build the control by **permutation, not deletion**: take the live text, splice the later block above the earlier one, and assert the same helper *throws* on the permuted string — one `assert.throws` per ordered pair, in the same suite." and "Match the permuted throw to the helper's ordering message, and prove the existence half with a separate deletion control matched to its own message."
  - "Prose reads come from the shared helper" (`tests/helpers/read-skill`'s `readText`).
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Never run `git stash`/`git stash pop`. Commit messages say `refs #4343`, never `closes`/`fixes`. Commit style: `{Verb} {what} — {detail}`.
- Run targeted suites only (named per task); the full suite runs centrally in Common Step 5.

## Design notes

- **Why not reuse `bin/pre-review-catchup.js`:** that CLI (#4304) is overlap-gated because, before SDD's review, a merge forces an extra suite run. At Common Step 5 the full suite runs anyway, so an unconditional merge when behind costs no run — and the spec's AC1 requires merging whenever the branch is behind. The new subsection says so in one sentence.
- **Mode posture** mirrors the Post-push merge-state check: `auto`/`confirm` merge; `interactive`/`hybrid` surface the commands and continue, never merge, no new stop.
- **Scope:** worktree strategy only (a `current-branch` build may be on the integration branch itself).

Waived plugin/bin/pr-merge-state.js: the spec offers it "or a fetch-and-behind probe"; it reads only DIRTY/CONFLICTING (never BEHIND), so the procedure uses the Catch-up steps' own fetch plus a before/after HEAD comparison instead, and nothing in this plan reads or changes the CLI.

## Review Focus

1. A conflict resolved at this step must be committed before the HEAD comparison, else the AUTO line names the wrong after-SHA — pinned by the subsection's "A resolved conflict is committed before" fact (Task 1).
2. The abort path must not leave `MERGE_HEAD` set before the suite runs — the subsection cites Catch-up step 4's `merge --abort` and states verification runs on the un-merged tree (Task 1 fact `abort verifies un-merged`).
3. A failed fetch (offline, no `origin`) must fail open, not block verification — Task 1 fact `fetch failure fails open`.
4. Category A fix commits must land before the catch-up's before-SHA is read — Task 2's paragraph says "after any Category A fix commit" and its order assertion places the paragraph after the Operational-fixes paragraph.
5. A standalone `/build` (no run dir) has no `decisions.md` — Task 1 fact `standalone reports in handoff`.

---

### Task 1: The Pre-verification catch-up procedure in `_shared/git-discipline.md`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/git-discipline.md` — insert one paragraph between the `pr-merge-state.js` code block and the paragraph starting `At wrap-up's exit, pass \`--run\` the archive path` (currently line 117); insert the new `### Pre-verification catch-up` subsection after the Catch-up (`auto`) block's closing paragraph (the one ending `the next phase never starts on a worktree with \`MERGE_HEAD\` set or conflict markers.`) and before `## Catching a branch up with \`main\``.
- Create: `tests/build-pre-verify-catchup-conformance.test.js`

**Interfaces:**
- Produces: the heading text `### Pre-verification catch-up` and the citation form `` `_shared/git-discipline.md`'s Pre-verification catch-up `` that Task 2 points at; the test file's helpers `requireOrder(text, markers)` (asserts each marker exists with message `marker missing: {marker}`, then that each comes after the previous with message `{marker} must come after the previous marker`) and `missingFacts(facts, region)` (returns the `name`s of facts whose `needle` is absent from the whitespace-collapsed region) — Task 2 reuses both.

- [ ] **Step 1: Write the failing test**

Create `tests/build-pre-verify-catchup-conformance.test.js` with a header comment naming #4343 and stating that live prose is read legitimately (the prose is the contract). Read `plugin/skills/_shared/git-discipline.md` with `readText`. Define:

- `requireOrder(text, markers)` as in Interfaces (same shape as `tests/pre-review-catchup-conformance.test.js`'s).
- `subsection(text)`: slice from `'### Pre-verification catch-up'` to `'## Catching a branch up with `main`'`, asserting both markers exist; return it whitespace-collapsed (`.replace(/\s+/g, ' ')`).
- `GD_FACTS`, an array of `{ name, needle }` (each `needle` matched with `includes` on the collapsed subsection and occurring there exactly once):

| name | needle |
|---|---|
| `runs last before Common Step 5` | `` runs this last before Common Step 5's verification run `` |
| `worktree only` | `worktree strategy only` |
| `verified tree carries the base` | `` so `VERIFICATION_SHA` is the post-merge HEAD `` |
| `not overlap-gated` | `it is not overlap-gated` |
| `cites Catch-up steps 1-4` | `` run the Catch-up (`auto`) steps 1-4 above `` |
| `merge never rebase` | `merge, never rebase` |
| `logs under its own step` | `` --step "Pre-verification catch-up" `` |
| `no push` | `Nothing is pushed: the build phase exit pushes the merged branch` |
| `fetch failure fails open` | `condition: fetch failed → fallback: catch-up not run; verifying the un-merged tree` |
| `abort verifies un-merged` | `aborted on a conflict it could not resolve confidently — verifying the un-merged tree` |
| `resolved conflict committed first` | `A resolved conflict is committed before` |
| `already current is a SKIP` | `condition: branch already contains origin/{integration-branch} → fallback: nothing merged` |
| `advanced logs before and after` | `merged origin/{integration-branch} before the verification run ({before short} → {after short})` |
| `interactive surfaces only` | `` `interactive` and `hybrid` never run the merge `` |
| `standalone reports in handoff` | `Standalone \`/build\` (no run dir) reports the outcome in its Step 7 handoff` |
| `post-push check stays` | `The Post-push merge-state check above stays` |

- `assertPreVerifySubsection(text)`: `requireOrder(text, ['### Post-push merge-state check', '**Catch-up (`auto`).**', '### Pre-verification catch-up', '## Catching a branch up with `main`'])`; then `assert.deepEqual(missingFacts(GD_FACTS, subsection(text)), [], 'Pre-verification catch-up facts')`.
- `RESIDUAL = 'already merged the integration branch in before its final verification (Pre-verification catch-up below)'`; `assertPostPushResidual(text)`: the collapsed slice from `'### Post-push merge-state check'` to `'**Catch-up (`auto`).**'` includes `RESIDUAL`, message `post-push residual sentence missing`.

Tests (names carry the AC ids):
- `AC1.1/AC3.1/AC4.1: git-discipline.md states the Pre-verification catch-up` → `assertPreVerifySubsection(GD)`.
- `AC1.1 go-red: each Pre-verification catch-up fact goes red alone` → for each fact, mutate the collapsed subsection (the raw text may wrap a needle across lines): `const s = subsection(GD); const m = s.replace(f.needle, ''); assert.notEqual(m, s); assert.deepEqual(missingFacts(GD_FACTS, m), [f.name]);`.
- `AC1.1 go-red: the subsection placed above the Catch-up steps it cites fails the order check` → splice the raw `### Pre-verification catch-up` block (heading to the line before `## Catching a branch up`) above `**Catch-up (`auto`).**`; `assert.notEqual`; `assert.throws(() => assertPreVerifySubsection(swapped), /### Pre-verification catch-up must come after the previous marker/)`. And a deletion control: remove the heading line; `assert.throws(..., /marker missing: ### Pre-verification catch-up/)`.
- `Deliverable 4: the Post-push merge-state check names the residual case` → `assertPostPushResidual(GD)`; go-red: `GD.replace(RESIDUAL, '')` (assert changed) throws `/post-push residual sentence missing/` — Step 3's paragraph keeps `RESIDUAL` on one raw line so this replace matches.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-pre-verify-catchup-conformance.test.js`
Expected: FAIL with `marker missing: ### Pre-verification catch-up`

- [ ] **Step 3: Write the prose**

Insert this paragraph between the `pr-merge-state.js` code block and `At wrap-up's exit, pass \`--run\`…` (keep `RESIDUAL`'s words on one line):

```markdown
At the build phase's exit this normally reads the PR as current: `/claude-tweaks:build`
already merged the integration branch in before its final verification (Pre-verification catch-up below),
so a conflict found there is the residual case of a base that moved during that verification.
```

Insert this subsection after the Catch-up (`auto`) block's last paragraph, before `## Catching a branch up with \`main\``:

```markdown
### Pre-verification catch-up

`/claude-tweaks:build` runs this last before Common Step 5's verification run (#4343), worktree
strategy only — a `current-branch` build has no run branch of its own to catch up. It is the
Catch-up (`auto`) above moved ahead of the build phase's suite: a base that moved during the
build is merged in before the suite runs, so `VERIFICATION_SHA` is the post-merge HEAD. Left to
the build phase exit, the merge would change the tree after the suite, and `/test`'s
Skip-if-recent (`test/verification.md`'s Mismatch branch) would run it a second time. Unlike the
Pre-review catch-up (`_shared/pre-review-catchup.md`), it is not overlap-gated: Common Step 5
runs the full suite anyway, so the merge adds no run.

In `auto` (and `confirm`), run the Catch-up (`auto`) steps 1-4 above with `{worktree-path}` the
build's worktree and `{integration-branch}` resolved at this call site per
`_shared/integration-branch.md` — merge, never rebase, with the same conflict resolution and
`merge --abort` — with these differences. Each `log-decision.js` call takes
`--run "$PIPELINE_RUN_DIR" --section "/build" --step "Pre-verification catch-up"`.

1. Nothing is pushed: the build phase exit pushes the merged branch.
2. Step 1's dirty tree logs `--status SKIP --reversibility n/a --text "condition: uncommitted
   changes in the worktree → fallback: catch-up not run; verifying the un-merged tree"`; a failed
   fetch logs the same with `--text "condition: fetch failed → fallback: catch-up not run;
   verifying the un-merged tree"`. Either way the verification run follows.
3. A conflict it cannot resolve confidently: run `merge --abort` (its own Bash call), log
   `--status AUTO --reversibility high --text-file "{text-file}"`, `{text-file}` holding
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
paragraph (the integration branch name is git-supplied). `interactive` and `hybrid` never run the
merge: surface the commands, as the Post-push merge-state check does, and continue to the
verification run — no new stop. Standalone `/build` (no run dir) reports the outcome in its Step 7
handoff instead of logging it.

The Post-push merge-state check above stays: the base can still move during verification, and a
conflict that arrives then is caught at the build phase exit as before.
```

Keep each `GD_FACTS` needle intact on the collapsed text (a line wrap is fine — the subsection is whitespace-collapsed before matching). The two `--text "condition: …"` strings carry no `{…}` placeholder, so they stay quoted `--text`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/build-pre-verify-catchup-conformance.test.js tests/git-discipline-merge-state-conformance.test.js tests/log-decision-text-file-sites-conformance.test.js`
Expected: PASS (0 failures)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/git-discipline.md tests/build-pre-verify-catchup-conformance.test.js
git commit -m "Add the Pre-verification catch-up procedure — merge a moved base before build's suite (refs #4343)"
```

### Task 2: Build Common Step 5 runs the catch-up; `/test`'s Match branch names it

**Role:** integration

**Files:**
- Modify: `plugin/skills/build/SKILL.md` — one new paragraph in `### Common Step 5: Final Verification`, directly after the `**Operational fixes first (#3489).**` paragraph and before the `**Note:**` paragraph.
- Modify: `plugin/skills/test/verification.md` — append one sentence to the `- **Match**` bullet of `### Skip-if-recent (for /flow pipelines)`.
- Modify: `tests/build-pre-verify-catchup-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `requireOrder`, `missingFacts`, and the heading `### Pre-verification catch-up`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/build-pre-verify-catchup-conformance.test.js`. Read `plugin/skills/build/SKILL.md` and `plugin/skills/test/verification.md`. Define `step5(text)`: slice from `'### Common Step 5: Final Verification'` to the next `'\n### '`, asserting the heading exists.

- `CATCHUP = '**Catch up last (#4343).**'`; `BUILD_FACTS` (collapsed step-5 region, each once):

| name | needle |
|---|---|
| `worktree only, immediately before that run` | `Worktree strategy only, immediately before that run and after any Category A fix commit` |
| `cites the shared procedure` | `` run `_shared/git-discipline.md`'s Pre-verification catch-up `` |
| `VERIFICATION_SHA is post-merge` | `` `VERIFICATION_SHA` is then the post-merge HEAD `` |
| `abort verifies un-merged` | `aborts the merge, and the run verifies the un-merged tree` |

- `assertCatchupBeforeVerify(text)`: `const s = step5(text); requireOrder(s, ['run the shared verification procedure', '**Operational fixes first (#3489).**', CATCHUP, '**Note:**']); assert.deepEqual(missingFacts(BUILD_FACTS, s), [], 'Common Step 5 catch-up facts');`
- `MATCH_NOTE = "build's Pre-verification catch-up (`_shared/git-discipline.md`) merges the integration branch in before its own run"`; `assertMatchBullet(text)`: the collapsed line starting `- **Match**` within `### Skip-if-recent (for /flow pipelines)` includes `MATCH_NOTE`, message `Match bullet does not name the pre-verification catch-up`.

Tests:
- `AC1.1/AC4.1/AC5.1: Common Step 5 places the catch-up before the verification run` → `assertCatchupBeforeVerify(BUILD)`.
- `AC5.1 go-red: Common Step 5 without the catch-up paragraph fails` → delete the paragraph (from `CATCHUP` through its trailing `\n\n`), `assert.notEqual`, `assert.throws(..., /marker missing: \*\*Catch up last \(#4343\)\.\*\*/)`.
- `AC5.1 go-red: the catch-up paragraph spliced above the verification sentence fails the order check` → move the paragraph to just before `After Common Steps 6 and 6.5, so the verified tree`; `assert.throws(..., /must come after the previous marker/)`.
- `AC1.1 go-red: each Common Step 5 fact goes red alone` → per fact, strip its needle from the collapsed region; `assert.deepEqual(missingFacts(BUILD_FACTS, m), [f.name])`.
- `AC2.1: /test's Skip-if-recent Match branch is the expected path after the catch-up` → `assertMatchBullet(VERIFICATION)`; go-red: `VERIFICATION.replace(MATCH_NOTE, '')` (assert changed) throws `/Match bullet does not name the pre-verification catch-up/`.

Waived AC3.1 here: covered by Task 1's `already current is a SKIP` fact.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-pre-verify-catchup-conformance.test.js`
Expected: FAIL with `marker missing: **Catch up last (#4343).**`

- [ ] **Step 3: Write the prose**

In `plugin/skills/build/SKILL.md` Common Step 5, after the `**Operational fixes first (#3489).**` paragraph, insert exactly:

```markdown
**Catch up last (#4343).** Worktree strategy only, immediately before that run and after any Category A fix commit, run `_shared/git-discipline.md`'s Pre-verification catch-up, so a base that moved during the build is verified once, here: `VERIFICATION_SHA` is then the post-merge HEAD. A conflict it cannot resolve confidently aborts the merge, and the run verifies the un-merged tree.
```

In `plugin/skills/test/verification.md`, append to the end of the `- **Match**` bullet (same line, after `when \`/flow\` chains build → test.`):

```markdown
 It is the expected branch after a moved base too: build's Pre-verification catch-up (`_shared/git-discipline.md`) merges the integration branch in before its own run, so `VERIFICATION_SHA` already names the merged HEAD.
```

Measure: `wc -c plugin/skills/build/SKILL.md` must print below 52500.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/build-pre-verify-catchup-conformance.test.js tests/build-verify-after-doc-steps.test.js tests/build-skip-degrade-trace-adoption.test.js tests/skill-size-single-source.test.js tests/bin-lib/skill-audit/budgets.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/verification-skip-before-execute.test.js`
Expected: PASS (0 failures)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/SKILL.md plugin/skills/test/verification.md tests/build-pre-verify-catchup-conformance.test.js
git commit -m "Run the pre-verification catch-up in build Common Step 5 — the suite runs once on the merged tree (refs #4343)"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (fetch; merge when behind via Catch-up (`auto`)) | Task 1 subsection; Task 2 call site |
| Deliverable 2 (one decisions.md line with SHAs, or SKIP) | Task 1 facts `advanced logs before and after`, `already current is a SKIP` |
| Deliverable 3 (Post-push check stays) | Task 1 fact `post-push check stays`; residual paragraph |
| Deliverable 4 (prose states the new order) | Task 1 residual paragraph; Task 2 Common Step 5 paragraph |
| AC1.1 | Task 2 `assertCatchupBeforeVerify` (+ Task 1 `verified tree carries the base`) |
| AC2.1 | Task 2 `assertMatchBullet` |
| AC3.1 | Task 1 `already current is a SKIP` |
| AC4.1 | Task 1 `abort verifies un-merged`; Task 2 `abort verifies un-merged` |
| AC5.1 | Task 2 go-red controls |
