# specify: refuse digest containers passed by explicit reference (#4142) Implementation Plan

**Goal:** `/claude-tweaks:specify`'s explicit-reference shaping entries (case 1 single record, the comma-list/range batch branch, case 5 by reference) hard-stop on a `digest`-labeled target before shaping, the way bare drain already excludes it.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T160211-record-4142/work/4142-spec.md` (materialized from GitHub issue #4142)

---

### Task 1: Add the digest-container refusal to specify's shaping entries and pin it

**Files:**
- Modify: `plugin/skills/specify/SKILL.md`
- Modify: `plugin/skills/specify/shaping-mode-readback.md`
- Modify: `plugin/skills/_shared/work-record-permission-matrix.md` (scope-creep `add-to-plan`: the `/specify` row's Removes column grants the residue strip to a parent-marked record only; a digest strip needs the same grant or it contradicts the matrix)
- Test: `tests/specify-digest-guard.test.js`

- [ ] **Step 1: Failing test** — create `tests/specify-digest-guard.test.js`, sized and styled like `tests/specify-parent-guard.test.js` (same `readText` helper, `readFlat` whitespace-collapse). Assertions:
  - `specify/SKILL.md` contains a `**Digest-container guard` paragraph marker that sits after the parent-record guard marker and before the `**`needs:definition` redirect (single-record path only).**` marker.
  - That paragraph slice names the `digest` label, cites `_shared/materiality-floor.md`, says hard stop with no prompt, names the exact residue set `` `ready`, `risk:*`, `size:*`, `ceremony:*`, `solution:unjustified` ``, and names its scope (single record, batch/range branch, case 5).
  - The batch branch states per-element refusal (other records still shape) for a digest element.
  - Case 5 applies the digest-container guard by reference.
  - `next-mode.md`'s `const EXCLUDE = new Set([...])` literal includes `'digest'` (parse the array literal, not a bare substring), so explicit and drain entries cannot drift apart.
  - `shaping-mode-readback.md` lists a `refused — digest container` outcome and still contains `no \`skipped\` outcome` (pinned by `tests/batch-ref-argument.test.js` and `tests/specify-range-form-readback.test.js` — keep that substring).
  - `work-record-permission-matrix.md`'s `/specify` row grants the residue strip from a `digest`-labeled record.
  Run: `node --test tests/specify-digest-guard.test.js` — Expected: FAIL (guard text absent).
- [ ] **Step 2: Implement** —
  - `SKILL.md` case 1: insert a new `**Digest-container guard (after the parent-record guard, before the \`needs:definition\` check).**` paragraph between the parent-record guard paragraph and the `needs:definition` redirect paragraph. Content: a target carrying the `digest` label (GitHub driver) is the materiality-floor container, never a record (`_shared/materiality-floor.md`'s Container section: "a digest issue is never shaped, scored, promoted, or closed as a record"); hard stop, no prompt, never shape, never enter the `needs:definition` redirect; the stop message names the container (`#{n}`) and cites `_shared/materiality-floor.md`; strip mis-shape residue (`ready`, `risk:*`, `size:*`, `ceremony:*`, `solution:unjustified`; never `type:*`/`priority:*`/`auto:*`/`bot:*`) in one `gh issue edit --remove-label …` call, always reported in the output, logged as `AUTO` per `_shared/auto-decision-log.md` when a run directory resolves — the same carve-out as the parent-record guard; scope = the same entries the parent-record guard covers (this case's single-record path, the batch/range branch, case 5 by reference; bare drain already excludes `digest` via `next-mode.md`'s `EXCLUDE`); local-files driver: the container is `specs/digest.md`, which carries no record id, so no record reference can resolve to it. Update the `needs:definition` redirect's opening clause ("After the parent-record guard above passes") to name both guards. Keep every substring `tests/specify-parent-guard.test.js` pins inside the parent-record guard paragraph untouched (it slices guard→redirect and counts exactly two `**Tier N (` markers — the new paragraph must not contain that pattern).
  - `SKILL.md` batch branch (case 1, "**Batch branch:**"): a `digest` element is refused per element — the guard's stop applies to that element only, its residue strip still runs, and the remaining elements still shape — unlike the all-or-nothing resolution-failure / `needs:definition` / parent-element stop. The fail-all check ("only when every element resolves clean") evaluates the non-digest elements; a batch whose every element is a digest container shapes nothing.
  - `SKILL.md` case 5: after "apply case 1's **parent-record guard** by reference", also apply case 1's **digest-container guard** by reference.
  - `shaping-mode-readback.md` Actions Performed: add the outcome `refused — digest container` (case 1's digest-container guard stopped the element before shaping; Detail names any residue strip that ran); reconcile the "There is no `skipped` outcome here" sentence so it stays true — a digest element is rendered as a refused row, not skipped, and every other element still follows stop-all semantics. Also extend the territory line's "as the one removal carve-out … from a record bearing the parent marker" sentence to cover the digest-labeled record (keep the substrings `as the one removal carve-out` and `record bearing the parent marker`, pinned by `tests/specify-parent-guard.test.js`).
  - `work-record-permission-matrix.md` `/specify` row Removes column: extend "from a parent-marked record only (case-1 parent-record guard cleanup — …)" to also name a `digest`-labeled record (case-1 digest-container guard cleanup), keeping the existing pinned substring `parent-marked record only (case-1 parent-record guard cleanup` intact.
- [ ] **Step 3: Run** `node --test tests/specify-digest-guard.test.js tests/specify-parent-guard.test.js tests/batch-ref-argument.test.js tests/specify-range-form-readback.test.js tests/specify-batch-input.test.js tests/specify-next-mode.test.js` — PASS. Then revert the SKILL.md digest paragraph temporarily (via `git show HEAD:plugin/skills/specify/SKILL.md`-based comparison, never `git stash`) to confirm the new test goes red, and restore.
- [ ] **Step 4: Commit** — one commit, `Refuse digest containers passed by explicit reference to /specify — guard beside the parent-record guard, per-element in batches`, body `refs #4142`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (guard, scope, no prompt, no redirect, cites materiality-floor) → Step 2 bullets 1+3; Deliverable 2 (batch per-element + readback outcome + reconcile no-skipped sentence) → Step 2 bullets 2+4; Deliverable 3 (residue strip, reported) → Step 2 bullet 1 (+ permission matrix bullet 5 so the strip is granted). AC 1-3 → Step 1 assertions; AC 4 (`npm test` green) → Common Step 5 final verification.
- **Placeholders:** none.
