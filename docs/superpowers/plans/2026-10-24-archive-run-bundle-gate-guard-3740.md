# archive-run guard does not cover the dispatch bundle Auto-merge gate's log lines (#3740) Implementation Plan

**Goal:** Make `archive-run` and reconcile's clean-status sweep treat a run whose `decisions.md` carries the dispatch bundle Auto-merge gate's passing log line(s) as a console replaced by an auto-merge, so pending `staged/` / `spec-*/staged/` items block archival exactly as #3668 made them block for the wrap-up short-circuit.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T093559-record-3740/work/3740-spec.md` (materialized from GitHub issue #3740)

---

### Task 1: Extend the auto-merge console-replacement detector to the dispatch bundle gate, pin its templates, and cover the verb

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` — `consoleReplacedByAutoMergeShortCircuit` (around line 492-512): keep the `Review Console: terminal decision` exemption and the ENOENT/fail-closed read posture unchanged; additionally return true when `decisions.md` carries either passing template from `plugin/skills/dispatch/settle-and-merge.md`:
  - per-member Content-judgment pass (both integration models, written before the merge): `Auto-merge gate: #{n} assess-agent-autonomy verdict auto-merge.` — match `/Auto-merge gate: #\d+ assess-agent-autonomy verdict auto-merge\./` (the trailing `.` is what `log-decision.js` appends before ` Reversibility:`; it keeps the match off the `verdict needs-human` fall-back line, which precedes a rendered console)
  - local-merge group line (written after the merge): `Auto-merge: group [{issues}], assess-agent-autonomy verdict auto-merge for every member` — match `/Auto-merge: group \[[^\]\n]*\], assess-agent-autonomy verdict auto-merge for every member/`
  Update the function's comment block to name the third producer (`dispatch/settle-and-merge.md`'s Auto-merge gate: per-member verdict line, and the local-merge group line), and why the needs-human line must not match. Keep the exported name (two call sites: `plugin/bin/hooks.js` archive-run verb, and the clean-status sweep's `onSkip` in this same file) — the function's contract ("console replaced by an auto-merge that skipped the Review Console") is unchanged, only its producer set widens.
- Modify: `plugin/bin/hooks.js` — archive-run verb (around lines 1216-1236): the comment and the refusal text currently say "the auto-merge short-circuit rendered no console"; reword to name both paths, e.g. `(an auto-merge path — the wrap-up short-circuit or the dispatch bundle Auto-merge gate — rendered no console; pending: …)`. Keep the `archival refused — console-never-rendered-staged-pending` prefix byte-identical (tests and the reconcile reason key on it).
- Modify: `docs/reconcile-checks.md` (around lines 305-312) — the clean-status sweep paragraph names only "the auto-merge short-circuit's own log line"; add the dispatch bundle gate's lines to the subset it describes.
- Modify: `docs/journeys/learn-a-merged-run-needs-you-3297.md` line 39 — it quotes the refusal text verbatim; update the quote to the new wording.
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`
- Test: `tests/archive-run-verb.test.js`

- [ ] **Step 1: Failing test** — in `tests/bin-lib/reconcile/archive-merged.test.js`, next to the existing #3668 detector tests (around lines 1336-1392):
  1. A unit test: the filled gate line (`- AUTO 10:00:00 — Auto-merge gate: #3740 assess-agent-autonomy verdict auto-merge. Reversibility: n/a.`) → true; the filled local-merge group line → true; the needs-human gate line (`… verdict needs-human — group falls back to the Review Console. Reversibility: n/a.`) alone → false; the gate pass line followed by `- AUTO 10:05:00 — Review Console: terminal decision approve-all-merge. Reversibility: n/a.` → false.
  2. A prose-code twin test mirroring `shortCircuitLogTemplates`/`detectsTemplate`: read the live `plugin/skills/dispatch/settle-and-merge.md` via `readText`, extract every `AUTO {time} — (Auto-merge(?: gate)?: …)` template (fenced-block lines and backticked spans alike — stop at a backtick or end of line), collapse whitespace, fill `{n}`→`3740`, `{issues}`→`3740, 3741`, and every other `{placeholder}`→`x`. Assert exactly 3 templates are extracted, exactly 2 are detected (the passing gate line and the group line) and exactly 1 is not (the needs-human line, identified by `verdict needs-human`). Go-red control through the same helper: the passing gate template with `verdict auto-merge` reworded to `verdict merge` is not detected, and likewise for the group template.
  In `tests/archive-run-verb.test.js`, next to the #3668 AC1.x/AC2.1 tests (around lines 190-232), add a `BUNDLE_GATE` decisions fixture (the per-member gate pass lines for two members plus nothing else) and:
  3. archive-run on a terminal (`clean`) run with no `console.json`, the bundle gate lines, and a non-dotfile under `staged/` refuses with `archival refused — console-never-rendered-staged-pending` and names the item; the same with the only item under `spec-3741/staged/` refuses and names it; run dir not moved.
  4. The same bundle-gate run with nothing pending (only a `.DS_Store` under `staged/`) archives unchanged (no `archival refused`, run dir moved, archive copy present).
  5. A local-merge variant (the group line only, pending item) also refuses.
  Run `node --test tests/bin-lib/reconcile/archive-merged.test.js` and `node --test tests/archive-run-verb.test.js`. Expected: FAIL (the new detection/refusal assertions; the nothing-pending archive case and needs-human negative may already pass — that is fine).
- [ ] **Step 2: Implement** — the archive-merged.js detector extension, the hooks.js comment + refusal reword, the docs/reconcile-checks.md and journey quote updates above.
- [ ] **Step 3: Run** `node --test tests/bin-lib/reconcile/archive-merged.test.js`, `node --test tests/archive-run-verb.test.js`, and any other suite that pins the refusal text (`git grep -n "short-circuit rendered no console"` must return nothing after Step 2) — PASS. Prove discrimination: temporarily revert the archive-merged.js regex change and confirm the new tests go red, then restore.
- [ ] **Step 4: Commit** — one commit, `Extend archive-run's auto-merge staged-pending guard to the dispatch bundle gate — refs #3740`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (detector extended, terminal-decision exemption kept) → Files bullet 1 + Step 1.1. Deliverable 2 (twin test over live settle-and-merge.md templates, exact count) → Step 1.2. Deliverable 3 (archive-run verb test for a bundle run with a pending staged item) → Step 1.3. AC1 (refuses and names pending items under `staged/` or `spec-*/staged/`) → Step 1.3/1.5. AC2 (nothing pending still archives) → Step 1.4. AC3 (reworded template fails the twin test) → Step 1.2's go-red control and exact count.
- **Placeholders:** none.
