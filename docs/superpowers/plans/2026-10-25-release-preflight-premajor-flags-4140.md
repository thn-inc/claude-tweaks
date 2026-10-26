# release preflight pack: expose the pre-major bump flags it applied in proposedVersion (#4140) Implementation Plan

**Goal:** `proposedVersion.value` carries the `bumpMinorPreMajor`/`bumpPatchForMinorPreMajor` values `readBumpFlags` resolved, and `/release` Step 5's arrived-commit fold takes them from the pack instead of re-reading `release-please-config.json`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T164829-record-4140/work/4140-spec.md` (materialized from GitHub issue #4140)

**Premise correction (logged in decisions.md):** since #4152 the arrived-commit fold is code, not prose — `plugin/bin/release-tip-check.js` reads `preMajor` from `{run-dir}/release-preflight.json` (`readPreMajor`) and `plugin/bin/lib/release-tip/check.js`'s `arrivedPart` re-reads both flags from `release-please-config.json` at the delta tip via `readBumpFlags`. Deliverable 2 therefore lands in that CLI + lib, and `execute.md`'s CLI paragraph cites the pack fields. Also: `readBumpFlags` resolves `bump-minor-pre-major` to `true` when unset (release-please's default, `bump.js`), so an unset config reports `bumpMinorPreMajor: true, bumpPatchForMinorPreMajor: false` — not both `false` as the AC's wording says.

---

### Task 1: Expose the pre-major bump flags on the pack and fold arrived commits from them

**Files:**
- Modify: `plugin/bin/lib/release-preflight/pack.js` — `proposedVersion` returns `bumpMinorPreMajor` and `bumpPatchForMinorPreMajor` alongside `preMajor`
- Modify: `plugin/bin/release-tip-check.js` — replace `readPreMajor` with a reader returning `{ preMajor, bumpMinorPreMajor, bumpPatchForMinorPreMajor }` from `release-preflight.json` (`preMajor` false and both flags `undefined` when the file is absent/unparseable/not ok; a flag that is not a boolean reads as `undefined`, so `bumpPart`'s own defaults apply); pass all three to `checkReviewedTip`; update the header comment
- Modify: `plugin/bin/lib/release-tip/check.js` — `checkReviewedTip` and `arrivedPart` accept `bumpMinorPreMajor`/`bumpPatchForMinorPreMajor` and pass them to `bumpPart`; drop the `readBumpFlags` call (and its import) and update the comment above `arrivedPart` that says flags come from `release-please-config.json` at the tip
- Modify: `plugin/skills/release/execute.md` — in the `**Reviewed-tip comparison` block's "It folds the commits that arrived in the last delta …" sentence, name the pack fields the fold uses: `proposedVersion.value`'s `preMajor`, `bumpMinorPreMajor` and `bumpPatchForMinorPreMajor` from `release-preflight.json`, never re-read from `release-please-config.json`. Keep the addition short — the file sits at ~90% of `RAIL_BYTES` (47281 / 52500)
- Test: `tests/bin-lib/release-preflight/pack.test.js` — add both fields to every existing `proposedVersion.value` `deepStrictEqual` literal; add a test: a config setting `bump-minor-pre-major: false` and `bump-patch-for-minor-pre-major: true` reports those values, and a config setting neither reports `bumpMinorPreMajor: true, bumpPatchForMinorPreMajor: false`
- Test: `tests/bin-lib/release-tip/arrived.test.js` — the "pre-major with bump-minor-pre-major false stays major" test passes `bumpMinorPreMajor: false` instead of writing `release-please-config.json`; add one proving a `release-please-config.json` at the tip is no longer read (config says `bump-minor-pre-major: false`, no flag passed → `minor`)
- Test: `tests/bin-lib/release-tip/cli.test.js` — extend the "preMajor read from release-preflight.json" test: a pack with `preMajor: true, bumpMinorPreMajor: false` makes a `feat!` arrival `major`
- Test: `tests/release-reviewed-tip-conformance.test.js` — add a `FACTS` row (source `block`) pinning the new execute.md citation of the three pack fields

- [ ] **Step 1: Failing test** — write the test(s) above; run `node --test tests/bin-lib/release-preflight/pack.test.js tests/bin-lib/release-tip/arrived.test.js tests/bin-lib/release-tip/cli.test.js tests/release-reviewed-tip-conformance.test.js` — FAIL on the new assertions.
- [ ] **Step 2: Implement** — the four Modify entries above.
- [ ] **Step 3: Run** the same four test files — PASS.
- [ ] **Step 4: Commit** — one commit, `Expose pre-major bump flags on the release preflight pack — fold arrived commits from them (refs #4140)`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (pack fields) → pack.js + pack.test.js; Deliverable 2 (fold reads pack fields) → release-tip-check.js + check.js + execute.md; AC 1 → pack.test.js; AC 2 → execute.md + conformance FACTS row; AC 3 (`npm test`) → Common Step 5.
- **Placeholders:** none.
