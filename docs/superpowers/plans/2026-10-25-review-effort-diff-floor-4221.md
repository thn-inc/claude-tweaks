# Raise review-effort when the diff dwarfs the record's size label (#4221) Implementation Plan

**Goal:** `review/review-effort-derivation.md` step 2 uses the record's `risk:*`/`size:*` labels whenever both exist; make review Step 2.5 derive both the label tier and the diff-heuristic tier and use the higher, recording both when they differ.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T132544-record-4221/work/4221-spec.md` (materialized from GitHub issue #4221)

---

### Task 1: Derive the label tier and the diff tier, take the higher, record both when they differ

**Files:**
- Modify: `plugin/skills/review/review-effort-derivation.md`
- Modify: `plugin/skills/review/code-mode-steps.md` (Step 2.5 only — lines ~193-197; file is at ~94% of the 52,500-byte rail, keep the net addition under ~400 bytes)
- Modify: `plugin/skills/review/review-summary-template.md` (line 39, the `**Review effort:**` line — added under `scope-creep: add-to-plan`: it is Step 7's rendered summary and restates the same source vocabulary)
- Test: `tests/review-effort-label-diff-conformance.test.js` (new)

- [ ] **Step 1: Failing test** — write `tests/review-effort-label-diff-conformance.test.js` (`node:test` + `node:assert/strict`, `readText` from `tests/helpers/read-skill`, same shape as `tests/bin-lib/review-context/prose.test.js`). It must:
  1. Parse the risk × record-size combination table out of `review-effort-derivation.md` (the `| **low** | low | low | medium |`-shaped rows) into a lookup; assert the parse found 3 rows × 3 columns (fail loudly on a mis-parse, never a silent empty table).
  2. AC1 (label `risk:low` × `size:medium`, 142-file diff → `high`, both inputs recorded): assert `lookup(low, medium) === 'low'`, `lookup(medium, high) === 'high'`, that the derivation still states the size-proxy `**high** at 10+ files` threshold (142 ≥ 10), and that the higher of `low`/`high` on the tier order `low < medium < high < xhigh < max` is `high`. Assert the derivation carries the worked example naming `#4028`, `label low, diff heuristic high`.
  3. Pin the rule: the derivation states the resolved tier is the higher of the label tier and the diff tier, and contains the sentence fragment `labels never lower a tier the diff already earns`.
  4. AC2 (labels and diff agree → tier and recorded source unchanged): the derivation states that when the two tiers agree the recorded source stays `record labels: risk:{x} × size:{y}`.
  5. Both `code-mode-steps.md`'s Step 2.5 summary line and `review-summary-template.md`'s `**Review effort:**` line still offer `record labels: risk:{x} × size:{y}` AND now offer the both-inputs form `label {a}, diff heuristic {b}`.
  6. `code-mode-steps.md`'s floor reference names the renumbered step (`step 5's \`review-effort-floor\``), never `step 4's \`review-effort-floor\``.
  Run: `node --test tests/review-effort-label-diff-conformance.test.js` — Expected: FAIL (the rule, the worked example and the both-inputs form do not exist yet).
- [ ] **Step 2: Implement** —
  - `review-effort-derivation.md`: after step 2's table add that its result is the **label tier**, not yet the resolved tier (step 4 checks it against the diff). Retitle step 3 from "Diff heuristic (fallback)" to "Diff heuristic" and say it runs on every non-explicit resolution — alone when step 2 produced no label tier (no record, unscored, or the read failed), alongside it otherwise; its result is the **diff tier**. Keep step 3's proxies, thresholds, and the empty-`--stat` → `high` rule unchanged. Insert a new step 4 "Take the higher": no label tier → the diff tier is the resolved tier; both → the higher of the two, labels never lower a tier the diff already earns; a label far below the measured diff is the ambiguity `code-mode-steps.md`'s rule names and resolves upward; when the two agree the recorded source stays `record labels: risk:{x} × size:{y}`; when they differ (either direction) Step 7's summary records both, `label {a}, diff heuristic {b} (risk:{x} × size:{y}; {reasoning})`; worked example #4028 (labels `risk:low` × `size:medium` → `low`; 142-file, 5,733-line diff that rewrote the hook dispatcher — a cross-package interface, risk proxy `medium` — at size proxy `high` → `high`; resolved `high`, recorded `label low, diff heuristic high`); one clause that this reuses step 3's proxies and table unchanged and adds no new diff-shape signal (contrast the #361 decision below). Renumber the project floor to step 5 and change its "After step 2 or 3 above resolves a tier" to "After step 4 above resolves a tier". Do not touch the phrase `Step 1 is skipped under \`ceremony-profile: fast-lane\`` (pinned by `_shared/ceremony-profile.md`'s table) or the `mint`/`gh issue view` fences (pinned by `tests/bin-lib/review-context/prose.test.js`).
  - `code-mode-steps.md` Step 2.5: in the "Resolution order" sentence replace "the diff heuristic fallback" with wording naming it as both the fallback and the cross-check the label tier is compared against; in the ambiguity paragraph add one sentence that a label tier below the diff tier resolves the same way — upward; in the "Record the resolved tier" line add the both-inputs alternative `label {a}, diff heuristic {b} (risk:{x} × size:{y}; {reasoning})`, used whenever the label tier and the diff tier differ, and change `step 4's \`review-effort-floor\`` to `step 5's \`review-effort-floor\``.
  - `review-summary-template.md` line 39: add the same both-inputs alternative to the `{explicit argument | record labels: … | diff heuristic: …}` list.
- [ ] **Step 3: Run** `node --test tests/review-effort-label-diff-conformance.test.js tests/bin-lib/review-context/prose.test.js tests/session-tmp-placeholder-quoting-conformance.test.js` — PASS. Then prove the new test discriminates: in a scratch `git worktree add` (never in this shared worktree), check out the pre-change versions of the three skill files and confirm the new test fails there.
- [ ] **Step 4: Commit** — one commit, `Raise review-effort to the diff tier when labels undercut it — refs #4221`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (derive both, use the higher, record both in Step 7's summary) → Step 2's derivation + code-mode-steps + template edits. Deliverable 2 (state and pin the rule) → derivation step 4 + Step 1's test. AC1 → test items 1-2. AC2 → test item 4.
- **Placeholders:** none.
