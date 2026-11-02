# Review Console reversal stamps a constant Defer-reason (#4101) Implementation Plan

**Goal:** Make `review-console-appendix.md`'s `reverse` path derive the reversal record's `Defer-reason:` from `_shared/deferral-gate.md`'s Fix-now criteria instead of stamping `genuinely-larger` always, and pin the new prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T101111-spec-4107-4052-4070-4090-4101-4105-4106-4073/spec-4101/work/4101-spec.md` (materialized from GitHub issue #4101)

**Global constraints:**
- Edit ONLY appendix line 90 (the `` `Origin: …`; `Defer-reason: genuinely-larger`), `` line) — replace it with the block below. Do not touch lines 86-89 or 91-101: open PR #4444 (#3942, draft, DIRTY) rewrites the `apply` bullet above (ending at `:85`) and the "Outside Approve all" sentence (`:98-101`); keeping this edit inside `:90` lets either PR merge first without a textual conflict.
- In the test, replace only the one `Defer-reason: genuinely-larger` pin line (`tests/build-sdd-ledger-residue-carryforward.test.js:129`) and insert the new pins immediately after it — not adjacent to the `:125` or `:133-134` pins, which #4444 also rewrites.
- `DEFER_REASONS` (`plugin/bin/lib/issues/record.js`) and `_shared/deferral-gate.md` are unchanged — no seventh value.

---

### Task 1: Derived Defer-reason in the reverse bullet, plus pins

**Files:**
- Modify: `plugin/skills/wrap-up/review-console-appendix.md`
- Modify: `tests/build-sdd-ledger-residue-carryforward.test.js`
- Modify: `docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md` — line 46 only (step 3's **Should understand**), which restates the constant; #4444's hunks in this file change lines 39 and 51, so line 46 stays conflict-free. No revision-note line at the file's end (#4444 appends there).
- Waived `plugin/skills/_shared/deferral-gate.md`: read-only — Fix-now criteria (`:17-25`) and the closed vocabulary (`:46-54`) the new prose cites
- Waived `plugin/bin/lib/issues/record.js`: read-only — `DEFER_REASONS`, unchanged
- Waived `tests/deferral-gate-conformance.test.js`: read-only — pins `DEFER_REASONS` equal to the gate's vocabulary; untouched because no value is added
- Waived `plugin/bin/lib/console/sdd-ruling.js`: read-only — its `needs-human-decision` → pending rule (#4587) reads the ruling row's own staged header, not the reversal record; confirmed unaffected

- [ ] **Step 1: Failing pins** — in `tests/build-sdd-ledger-residue-carryforward.test.js`'s `AC5.1` test, replace the line

  ```js
    assert.match(APPENDIX, ws('`Origin: SDD ruling reversed at Review Console`; `Defer-reason: genuinely-larger`'));
  ```

  with exactly:

  ```js
    // #4101: the reversal's Defer-reason is derived from the deferral gate, never a constant.
    assert.match(APPENDIX, ws('`Origin: SDD ruling reversed at Review Console`; `Defer-reason:` derived, never a constant'));
    assert.match(APPENDIX, ws("run `_shared/deferral-gate.md`'s Fix-now criteria against the reversed ruling's finding and stamp the value of the first criterion that fails"));
    assert.match(APPENDIX, ws('not localized, or materially expands scope → `genuinely-larger`; needs functionality not yet built → `blocked-dependency`; needs a product/design decision → `needs-human-decision`; needs external state → `blocked-external`'));
    assert.match(APPENDIX, ws('when every criterion holds — the fix would have been fix-now, and only the closed fix wave stops it — stamp `needs-human-decision`'));
    assert.match(APPENDIX, ws('A reversal never stamps `tangential` or `pre-existing-outside-diff`'));
    assert.doesNotMatch(APPENDIX, ws('`Defer-reason: genuinely-larger`'), 'the reversal Defer-reason is no longer a fixed value');
  ```

  Run `node --test tests/build-sdd-ledger-residue-carryforward.test.js` — `AC5.1` FAILS (the new prose is absent and the constant is present).
- [ ] **Step 2: Implement** — in `plugin/skills/wrap-up/review-console-appendix.md`, replace line 90

  ```
    `Origin: SDD ruling reversed at Review Console`; `Defer-reason: genuinely-larger`),
  ```

  with exactly these lines (two-space indent, as the bullet's continuation lines):

  ```
    `Origin: SDD ruling reversed at Review Console`; `Defer-reason:` derived, never a constant:
    run `_shared/deferral-gate.md`'s Fix-now criteria against the reversed ruling's finding and
    stamp the value of the first criterion that fails, in that file's list order — not
    localized, or materially expands scope → `genuinely-larger`; needs functionality not yet
    built → `blocked-dependency`; needs a product/design decision → `needs-human-decision`;
    needs external state → `blocked-external`; when every criterion holds — the fix would have
    been fix-now, and only the closed fix wave stops it — stamp `needs-human-decision`, since a
    human's reversal of an agent ruling is what makes this work exist and scheduling it is a
    human call. A reversal never stamps `tangential` or `pre-existing-outside-diff`: the
    reversed ruling is a fix to in-diff work, not a new idea or an out-of-diff defect),
  ```

  Then in `docs/journeys/ratify-or-reverse-an-sdd-ruling-at-the-review-console-3401.md` line 46, replace `` `Defer-reason: genuinely-larger`), `` with `` `Defer-reason:` derived from `_shared/deferral-gate.md`'s Fix-now criteria — the first criterion the fix fails, or `needs-human-decision` when every one holds, per the appendix's `sdd-ruling-*` bullet), `` — change nothing else on the line or in the file.

  Run `node --test tests/build-sdd-ledger-residue-carryforward.test.js` — PASS.
- [ ] **Step 3: Revert proofs** (after the Step 5 commit, so `HEAD` holds the change; `<BASE>` = the commit before this task):
  1. Whole-pin proof: `git checkout <BASE> -- plugin/skills/wrap-up/review-console-appendix.md`, run `node --test tests/build-sdd-ledger-residue-carryforward.test.js`, record the verbatim `AC5.1` failure, then `git checkout HEAD -- plugin/skills/wrap-up/review-console-appendix.md` and confirm `git status --porcelain plugin/` prints nothing.
  2. Negative-pin proof (the `doesNotMatch` alone, since the positive pins fire first in proof 1): write a throwaway script under the scratch dir the controller names that reads `git show <BASE>:plugin/skills/wrap-up/review-console-appendix.md` output, builds the regex with the test file's own `ws` expression (`new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))` on `` '`Defer-reason: genuinely-larger`' ``), and prints whether it matches the pre-change text (must print `true`) and the post-change `HEAD` text (must print `false`). Record the output.
- [ ] **Step 4: Confirm scope** — `git diff <BASE> -- plugin/skills/wrap-up/review-console-appendix.md` changes only the former line 90, and `git diff <BASE> -- docs/journeys/` changes only the journey's line 46; `grep -rn "Defer-reason: genuinely-larger" plugin/ docs/journeys/` prints nothing (run it first against `<BASE>` via `git grep -n "Defer-reason: genuinely-larger" <BASE> -- plugin/ docs/journeys/` and see it match both files, so an empty result is a real negative).
- [ ] **Step 5: Commit** — one commit (before Step 3's proofs), `Derive the Review Console reversal Defer-reason from the deferral gate — no genuinely-larger constant`, body `refs #4101`.

Review risk: low

---

## Self-review

- **Spec coverage:** Deliverable 1 (derived value, first failing criterion) → Step 2 block lines 1-5; Deliverable 2 (all-hold → `needs-human-decision`, with why) → Step 2 block lines 6-8; Deliverable 3 (cite, don't restate) → the block names `_shared/deferral-gate.md`'s Fix-now criteria and maps each to its value without copying the criteria text; Deliverable 4 (pins) → Step 1. AC1 → Steps 2 + 4; AC2 (updated pin passes, negative pin observed failing on pre-change text) → Steps 1-3; AC3 (`tangential`/`pre-existing-outside-diff` never produced, stated) → Step 2 block lines 8-10 + its pin; AC4 (`npm test`) → Common Step 5.
- **Gotchas:** #3942/#4444 overlap handled by the line-90-only constraint (PR is draft and DIRTY — rebasing onto unmerged work would pull it into this PR; ruling recorded in the run ledger). The `needs-human-decision`-resolves-pending rule (`plugin/bin/lib/console/sdd-ruling.js`, #4587) reads the ruling row's own staged header, not the reversal record this bullet composes — unaffected. Pins use the file's wrap-tolerant `ws(...)` helper.
- **Plan review (opus, verdict amend) applied:** medium — the 3401 journey restated the constant and the scope grep missed it → journey line 46 added, grep widened to `plugin/ docs/journeys/`; low — "first criterion that fails" order now names `_shared/deferral-gate.md`'s list order. Low — a design-decision reversal filed born-`ready`: no change, since "exactly as `Keep` does" already inherits Keep's `openQuestion` escape hatch, which `_shared/ledger-format.md:255` says "is not withheld from any branch" (ruling in the run ledger).
- **Placeholders:** `<BASE>` and `<scratch>` are runtime values (the controller passes BASE in the dispatch).
