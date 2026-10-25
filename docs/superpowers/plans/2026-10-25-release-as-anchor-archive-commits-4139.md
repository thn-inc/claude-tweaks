# release --as anchor still requires exact HEAD == origin, unlike Step 3 after #4012 (#4139) Implementation Plan

**Goal:** `/claude-tweaks:release --as {version}`'s Release-As anchor (`plugin/skills/release/execute.md`) accepts a main checkout whose only unpushed commits are `[reconcile] archive run` commits, by applying Step 3's acceptance rule, and pushes the override without carrying those archive commits.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T182712-record-4139/work/4139-spec.md` (materialized from GitHub issue #4139)

---

### Task 1: Align the `--as` anchor with Step 3's rule and build the override on the fetched tip

**Files:**
- Modify: `plugin/skills/release/execute.md` (the `--as {version}` paragraph under `### pr-first`, from "**`--as {version}` — push the override" through the "reviewed tip advanced" log fence)
- Modify: `tests/skill-fence-guard-shapes.test.js` (ALLOWLIST ratchet entries for `release/execute.md` whose anchors this task removes or changes)
- Test: `tests/release-as-anchor-conformance.test.js` (new)

**Design (decided — implement exactly this):**

1. **Anchor = SKILL.md Step 3's review-tree check, cited, not restated.** Replace the four-line assert block (`rev-parse --abbrev-ref HEAD`, `status --porcelain`, `fetch`, `rev-parse HEAD origin/{branch}`) and the three numbered precondition bullets with prose that says: run SKILL.md Step 3's review-tree check, its two calls unchanged — the fetch-and-resolve call that prints `{tip-sha}`, then the tree check with that printed sha pasted in literally. It passes exactly when `$RUN_ROOT` is on `{branch}`, 0 commits behind `{tip-sha}`, and its tree equals `{tip-sha}`'s outside `.claude-tweaks/pipelines/`, so a checkout whose only unpushed commits are reconcile's `[reconcile] archive run …` commits passes, as it does at Step 3. Any failure is `failed` with no commit made, reported with Step 3's stop line and reason under the prefix `stopped before the override:`, without Step 3's `switch` recovery (the same carve-out the reviewed-tip comparison's step 3 already makes: a sibling session owns the shared checkout's branch). Never compare `HEAD` and `origin/{branch}` shas for equality.
2. **Build the override on `{tip-sha}`, never on `HEAD`.** A commit made on `HEAD` would push the archive commits to `origin/{branch}` with the trailer. Replace `git -C "$RUN_ROOT" commit --allow-empty …` and `git -C "$RUN_ROOT" push origin {branch}` with two separate fences (one command each, so the printed sha is pasted literally, never carried in a `$(…)`):

   ```bash
   git -C "$RUN_ROOT" commit-tree {tip-sha}^{tree} -p {tip-sha} -m "chore: release {version}" -m "Release-As: {version}"
   ```

   It prints the new commit's sha `{sha}` as its only stdout line (state that `^{tree}` is git's peel syntax, not a placeholder). Then:

   ```bash
   git -C "$RUN_ROOT" push origin {sha}:refs/heads/{branch}
   ```

   State why: `commit-tree` writes only the commit object, with `{tip-sha}` as its sole parent and `{tip-sha}`'s tree — it moves no branch and reads neither the index nor the working tree — and the push names that one commit, so origin receives the override and nothing else. `$RUN_ROOT`'s own `{branch}` does not move: its archive commits stay local, and the override reaches the checkout on its next fetch.
3. **Drop the dirty-anchor precondition**, saying in one sentence why it no longer applies: `commit-tree` reads no index, so a sibling's staged work can never be absorbed into the override (that absorption was the bullet's only reason).
4. **Rejected push:** keep it `failed`, `git`'s stderr verbatim, no poll. Replace the "stranded locally" sentence, its `recover: … pull --rebase … && … push` fence, and the "Never `reset --soft`" paragraph with: nothing is stranded — the commit is on no branch — so the recovery is to re-run `/claude-tweaks:release` once the cause is resolved, which re-runs the anchor against the current tip and builds a fresh override.
5. **Reviewed-tip advance paragraph:** keep the sentence "the reviewed tip advances to the `Release-As:` commit only when `{sha}^` equals the reviewed tip" and the log fence byte-for-byte (`tests/release-reviewed-tip-conformance.test.js` pins both). Change only the definition of `{sha}`: it is the sha `commit-tree` printed (its parent is `{tip-sha}` by construction, so the advance condition reads whether `{tip-sha}` is still the reviewed tip).
6. Leave everything from "Then poll for the re-render" onward unchanged.
7. **Size headroom:** `execute.md` is 47281 bytes at the merge base, already at 90% of `RAIL_BYTES` (52500, `plugin/bin/lib/skill-audit/budgets.js`). The edit must not grow the file: `wc -c plugin/skills/release/execute.md` after the edit must be ≤ 47281. The removals (three precondition bullets, the four-line assert fence, the stranded-commit sentence, its `recover:` fence, the `reset --soft` paragraph) give room; keep the new prose terse and cite Step 3 rather than restating it.

- [ ] **Step 1: Failing test** — write `tests/release-as-anchor-conformance.test.js`, modelled on `tests/release-review-tree-check-conformance.test.js` (same `originWithTwoClones` fixture from `tests/helpers/git-fixtures.js`, same `readText` helper, same one-test-per-row shape). It extracts from the live `execute.md` the `--as` block's `commit-tree` fence and `push` fence, and from the live `release/SKILL.md` Step 3 the two review-tree check fences (reuse the extraction approach of that file), substitutes `{branch}`→`main`, `{version}`→`9.9.9`, and runs, from the `work` clone as `$RUN_ROOT`: tip fence → tree check with the printed sha → (only if the check exits 0) commit-tree fence with `{tip-sha}` pasted → push fence with the printed `{sha}` pasted. Rows:
  - accepted: equal to origin → origin/main's new tip is a commit whose message carries `Release-As: 9.9.9` and whose only parent is the pre-run origin sha; the work clone's `main` did not move.
  - accepted: two run-dir-only commits ahead (same `runDirCommit` shape as the Step 3 test) → same assertions, and neither archive commit is reachable from origin/main (`git merge-base --is-ancestor` fails for each) and origin's tree has no `.claude-tweaks/pipelines` entry.
  - stops: behind origin; diverged (run-dir commit + upstream push); a commit outside run dirs; wrong branch → the check exits non-zero and origin/main is unchanged (no override pushed).
  - go-red: the pre-fix anchor (inline the old `git -C "$RUN_ROOT" rev-parse HEAD origin/{branch}` equality as a frozen literal in the test, `[ "$(…)" = "$(…)" ]`-free — compare the two printed lines in JS) stops the run-dir-only-ahead row, proving the row discriminates; and a frozen copy of the old `commit --allow-empty` + `push origin main` pair, run on the run-dir-only-ahead fixture, does push the archive commits to origin (proving the "no archive commits on origin" assertion can go red).
  - prose pins (each with a go-red removal proof, like `STOP_FACTS` in the Step 3 test): the block cites SKILL.md Step 3's review-tree check; the block carries no `rev-parse HEAD origin/{branch}`; the stop prefix `stopped before the override:`; the commit is built with `commit-tree` on `{tip-sha}` and pushed as `{sha}:refs/heads/{branch}`; no `commit --allow-empty` remains in the block.

  Run it against the current `execute.md` — it must FAIL (no `commit-tree` fence yet).
- [ ] **Step 2: Implement** — edit `execute.md` per the Design above. Then run `node --test tests/skill-fence-guard-shapes.test.js`: for each `release/execute.md` ratchet entry it reports as stale (anchor no longer matches), remove that entry; for each new `release/execute.md` `git-var-operand` offender it reports, add a ratchet entry anchored on a distinctive substring of the new fence (e.g. `git -C "$RUN_ROOT" commit-tree {tip-sha}^{tree} -p {tip-sha}`), so the count of `release/execute.md` ratchet entries does not grow beyond the number of `git -C "$RUN_ROOT"` fences the block now carries.
- [ ] **Step 3: Run** `node --test tests/release-as-anchor-conformance.test.js tests/release-review-tree-check-conformance.test.js tests/release-reviewed-tip-conformance.test.js tests/skill-fence-guard-shapes.test.js tests/release-skill-reference-form.test.js` — PASS. Also run any other test file that `grep -rl "release/execute.md\|execute.md" tests` names, targeted, not the full suite.
- [ ] **Step 4: Commit** — one commit: `Align release --as anchor with Step 3's archive-commit rule — build the override on the fetched tip` with body `refs #4139`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (same acceptance rule as Step 3) → Design 1; Deliverable 2 (pushed without unpushed archive commits) → Design 2; AC1 (commits and pushes, never stops on bare sha inequality) → Design 1-2 + accepted rows; AC2 (conformance test against fixture repos, accepted and stopping cases) → Step 1; AC3 (`npm test` passes) → Common Step 5.
- **Placeholders:** none.
