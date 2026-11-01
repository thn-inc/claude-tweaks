# Restore Read-rail headroom in _shared/github-pr-scan.md by splitting item 10's resume procedure (#4804) Implementation Plan

**Goal:** `plugin/skills/_shared/github-pr-scan.md` is 52,073 bytes against the 52,500-byte Read rail (`RAIL_BYTES`, `plugin/bin/lib/skill-audit/budgets.js`); move item 10's resume procedure into a cited sibling file so the file lands at least 2,000 bytes under the rail.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T191941-record-4804/work/4804-spec.md` (materialized from GitHub issue #4804)

---

### Task 1: Move item 10's resume procedure to a pointer-stub sibling file

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan.md`
- Create: `plugin/skills/_shared/github-pr-scan-unsettled-resume.md`
- Modify: `plugin/skills/tidy/scan-procedures.md` (Step 4.8's dispatcher must inline the new file, or the tidy scan agent loses the moved text)
- Modify: `tests/sweep-backstop.test.js` (retarget the pins on the moved text)
- Modify: `docs/skill-graph.md` (the new `_shared` file's row)

Context the build found (read before editing):

- **What moves.** Item 10 (`10. **Unsettled run**`) of `github-pr-scan.md` ends with one long paragraph (the line that starts `` `gh pr view`'s `commits`/`comments` fields are bounded per-PR ``, about 2,700 bytes). Its second sentence onward is the resume procedure: read the PR body's `### Resume` line through `bin/pr-resume-line.js`, re-read and shape-check `{run-id}` from the claim blob, which verdicts report the `resume` line, and the reconstructed `reconcile` command for every other case. Move that procedure into `github-pr-scan-unsettled-resume.md`. The paragraph's first sentence (the truncation note) is not part of the resume procedure; keep it in item 10 unless moving it too is cleaner. Leave a short pointer paragraph in item 10 naming the new file.
- **The new file.** Model its header on `plugin/skills/_shared/github-pr-scan-acceptance.md`, a sibling extracted from the same file (#204): one line saying it was extracted from `github-pr-scan.md` item 10 (#4804) and who reads it. Its text has to make sense on its own: the moved text says "the reconstructed command described below" and "the reconstructed command above starts from `reconcile`", and "above" meant item 10's script, which now lives in another file. Reword those references so they name item 10's `[unsettled]` print lines (the `no PR found … resume: node … reconcile` line) instead of leaving dangling "above"/"below". Keep the content of the procedure the same: no new rules, no dropped rules. The moved text cites `_shared/session-tmp-root.md` indirectly through `session-tmp-resolve.js`; if the new file uses `session-tmp-resolve.js`, it cites `_shared/session-tmp-root.md` the way the original item does.
- **The pointer's read condition must cover every path that used to reach the moved text** (`.claude/skills/shared-contract-extraction` Gotchas). Item 10 reports a resume command for every qualifying candidate, whether a PR exists or not. Write the stub so whoever produces an `[unsettled]` row reads the new file before reporting its resume command, with or without a PR, and name both cases.
- **Who executes item 10.** Only `/tidy` Step 4.8 (`plugin/skills/tidy/scan-procedures.md`, the paragraph starting ``Scan per `_shared/github-pr-scan.md`, **`repo-wide`** scope``) runs the `repo-wide` scope, and it inlines the file's text into a Task agent's prompt. That agent sees only its prompt, so a pointer to a sibling file does not reach it. Add the new file to the list of what that dispatcher inlines, read as-is the way `github-pr-scan-acceptance.md` is. **`scan-procedures.md` is at 52,416 bytes, 84 under the rail.** Keep its net growth at or below 0 bytes: shorten wording only inside the sentences you edit in that paragraph, for example by folding the new file into the existing `github-pr-scan-acceptance.md` "is read as-is" clause. Never push it over 52,500, and do not touch other paragraphs.
- **Pins to retarget** (the `skill-prose-conformance-tests` "Retargeting existing pins" convention). `tests/sweep-backstop.test.js` slices `ITEM10` from `10. **Unsettled run**` to `\nFindings and recommendations`. Two of its tests pin text that moves: `'item 10 resume command is read from the PR body when a PR exists, reconstructed only when none exists'` and `'item 10 routes the PR body Resume line through pr-resume-line.js, not a restated template'`. Retarget each assertion on moved text to the new file and adjust the regexes to the reworded "above"/"below" references. Keep the `!includes('/claude-tweaks:flow "{target}" {next-step}')` absence check on both item 10 and the new file. Add pins for the new wiring: item 10 names `github-pr-scan-unsettled-resume.md`, and `scan-procedures.md`'s Step 4.8 paragraph names it among the inlined files. Prove each new or retargeted assertion goes red in a scratch copy (revert the pinned text, run, restore). Grep `tests/` for any other suite pinning a phrase from the moved paragraph (`grep -rn "reconstructed command\|claim blob's\|canonical run-id shape" tests/`) and retarget it too.
- **Graph edge.** Add a `docs/skill-graph.md` row for `_shared/github-pr-scan-unsettled-resume.md` beside the `_shared/github-pr-scan-acceptance.md` row: extracted from `_shared/github-pr-scan.md` item 10 (#4804), read by `/tidy` (`scan-procedures.md` Step 4.8). No `SKILL.md` edits, and no new `docs/plugin-structure.md` row (the `_shared` row there is curated).
- No byte-size assertion anywhere: `tests/skill-size-single-source.test.js` fails a test that restates a size budget, and the `rail:` suite measures the new file automatically.

- [ ] **Step 1: Failing test** — retarget and add the `tests/sweep-backstop.test.js` assertions above and run `node --test tests/sweep-backstop.test.js`. The retargeted and new assertions must fail before the move, since the new file does not exist yet.
- [ ] **Step 2: Implement** — move the resume procedure, write the stub, wire `scan-procedures.md`, and add the graph row. Then `wc -c plugin/skills/_shared/github-pr-scan.md` must print 50,500 or less (at least 2,000 under 52,500), and `wc -c plugin/skills/tidy/scan-procedures.md` must print 52,416 or less.
- [ ] **Step 3: Run** — `node --test tests/sweep-backstop.test.js tests/issue-claims-pr-scan-composition.test.js tests/session-tmp-root-migration.test.js tests/skill-fence-guard-shapes.test.js tests/github-pr-scan-unsettled-node-budget.test.js tests/bin-lib/skill-audit/context-cost.test.js` passes.
- [ ] **Step 4: Commit** — one commit: `Split item 10's resume procedure out of github-pr-scan.md — refs #4804`.

---

## Self-review

- **Spec coverage:** the one `## Deliverables` item (move item 10's resume procedure to a cited sibling file) is Task 1 Step 2. The `wc -c` acceptance criterion is checked in Step 2. `npm test` passing is Common Step 5's full-suite run, after Step 3's focused suites.
- **Placeholders:** none.
