# release Step 3 records the reviewed tip with a second rev-parse after the tree check (#4157) Implementation Plan

**Goal:** `/claude-tweaks:release` Step 3 (and execute.md's Step 5 item 5, which re-runs it) resolve `{tip-sha}` once, as a full sha, before the tree check, compare `HEAD` to that literal, and record the same literal. No second read of `origin/{branch}` after the check.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T104931-record-4157/work/4157-spec.md` (materialized from GitHub issue #4157)

---

### Task 1: Resolve `{tip-sha}` once in Step 3's review-tree check and in execute.md step 5, and pin both

**Files:**
- Modify: `plugin/skills/release/SKILL.md` (Step 3: the review-tree check fence at ~:156-161, its lead sentence at :154, the `review tree HEAD` clause sentence at :181, the `{tip-sha}` definition at :183)
- Modify: `plugin/skills/release/execute.md` (Reviewed-tip comparison block, item **5. Bring the checkout to the tip.** at ~:228 — the "Read `{tip-sha}` as Step 3 does …" sentence and the `{n}` rev-list sentence)
- Test: `tests/release-review-tree-check-conformance.test.js` (extract-and-run of the Step 3 fence — #4012)
- Test: `tests/release-reviewed-tip-conformance.test.js` (FACTS prose pins — #4041)

**Design (exact):**

1. SKILL.md Step 3 fence becomes one check that resolves the tip once, compares against it, and prints it:

   ```bash
   git -C "$RUN_ROOT" fetch origin {branch} \
     && TIP=$(git -C "$RUN_ROOT" rev-parse --verify origin/{branch}) \
     && [ "$(git -C "$RUN_ROOT" rev-parse --abbrev-ref HEAD)" = "{branch}" ] \
     && [ "$(git -C "$RUN_ROOT" rev-list --count "HEAD..$TIP")" = 0 ] \
     && git -C "$RUN_ROOT" diff --quiet "$TIP" HEAD -- ':!.claude-tweaks/pipelines' \
     && echo "$TIP"
   ```

   Lead sentence (:154): the check exits 0 exactly when the review may run, and on that exit prints `{tip-sha}` (its only stdout line).
2. SKILL.md :183 — `{tip-sha}` is the full 40-hex sha that check printed: `origin/{branch}` resolved once, before the trees are compared, so `HEAD` is compared against the same literal that is recorded. Never re-read it with a second `rev-parse` after the check — a sibling session's fetch into the shared `$RUN_ROOT` in between would record a tip whose tree the review's test gate never ran on. Keep the remainder ("the tip this review covers, recorded as a run fact. Step 5 compares `origin/{branch}` against it before the merge (`execute.md`) and cites this value, never re-deriving it.").
3. SKILL.md :181 — the optional `review tree HEAD` clause is written only when `rev-parse HEAD` differs from `{tip-sha}` (not from `origin/{branch}`). The marker line text itself (:178) is pinned by both suites — do not change it.
4. execute.md item 5 — replace "Read `{tip-sha}` as Step 3 does, right after the check passes: `git -C "$RUN_ROOT" rev-parse origin/{branch}`." with a sentence saying `{tip-sha}` is the sha that check printed, never a second `rev-parse` of `origin/{branch}`; change `{n}` to `git -C "$RUN_ROOT" rev-list --count {reviewed-tip}..{tip-sha}`. Keep "Then re-run SKILL.md Step 3's review-tree check; any failure is `failed`, reported with Step 3's stop line and reason under this step's prefix and without its `switch` recovery." verbatim (pinned).
5. Leave Step 3's stop-path diagnostic commands (`rev-list --left-right --count HEAD...origin/{branch}`, `diff --name-only origin/{branch} HEAD …`) unchanged — they run only after the check failed, record nothing, and are byte-pinned by `STOP_FACTS`.

**Size headroom (plan-authoring check):** `RAIL_BYTES` = 52500. Merge base: SKILL.md 49015 B (93%), execute.md 50529 B (96%). execute.md's edit must be byte-neutral or shrink (the replacement sentence is shorter than the one it replaces, and `..origin/{branch}` → `..{tip-sha}` saves bytes). SKILL.md's net growth must stay well under ~3.4 KB — keep the new prose to a few sentences.

- [ ] **Step 1: Failing test** — in `tests/release-review-tree-check-conformance.test.js`: change `checkFence`'s needle to the new `rev-list --count "HEAD..$TIP"` clause and update the AC3.1 behind-count go-red anchor to the new clause text; add (a) a test that the passing row prints exactly the fixture's `origin/main` sha on stdout, and (b) a race test: inject a sibling push + `git fetch` into `work` immediately before the `&& echo "$TIP"` clause — the check must still exit 0 and print the pre-move sha; go-red: replacing `echo "$TIP"` with a second `git -C "$RUN_ROOT" rev-parse origin/main` prints the moved sha. In `tests/release-reviewed-tip-conformance.test.js`: replace the `'{tip-sha} is rev-parse origin/{branch}, read after the check passes'` FACT with the single-resolution wording, replace the `{n}` FACT's `..origin/{branch}` with `..{tip-sha}`, add a FACT for execute.md item 5's "never a second `rev-parse`" sentence, and add a stale-phrase check that `rev-parse origin/{branch}`, read right after the check` / `Read \`{tip-sha}\` as Step 3 does, right after the check passes` no longer appear. Run both suites — the new assertions FAIL against the unmodified prose.
- [ ] **Step 2: Implement** — the Design edits 1-4 above.
- [ ] **Step 3: Run** `node --test tests/release-review-tree-check-conformance.test.js tests/release-reviewed-tip-conformance.test.js` — PASS. Also run `node --test tests/skill-audit*.test.js` or the rail suite covering `plugin/skills/release/*.md` if one exists (`git grep -l RAIL_BYTES -- tests`).
- [ ] **Step 4: Commit** — one commit, `Resolve release Step 3's reviewed tip once before the tree check — sibling-fetch race`, body `refs #4157`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Design 1-3; Deliverable 2 → Design 4; Deliverable 3 → Step 1's test changes. AC "neither Step 3 nor execute.md step 5 reads `origin/{branch}` a second time after the tree check" → Design 1-4 plus the stale-phrase check; AC "conformance test asserts the single-resolution wording" → the replaced FACT; AC "`npm test` passes" → Common Step 5.
- **Placeholders:** none.
