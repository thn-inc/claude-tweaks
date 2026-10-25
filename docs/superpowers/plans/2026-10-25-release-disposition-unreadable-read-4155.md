# release disposition reads an unreadable staged/ as empty, then archives the run with its findings inside (#4155) Implementation Plan

**Goal:** Make `/claude-tweaks:release`'s Step 8 disposition Inventory treat a read error other than "does not exist" on `staged/` or `decisions.md` as a failure that blocks archival, instead of landing on the SCANNED "no staged review findings" path.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T115747-record-4155/work/4155-spec.md` (materialized from GitHub issue #4155)

---

### Task 1: Name an unreadable staged/ or decisions.md as a disposition failure and pin it

**Files:**
- Modify: `plugin/skills/release/disposition.md`
- Test: `tests/release-run-dir-lifecycle-conformance.test.js`

- [ ] **Step 1: Failing test** — add a fact to `DISPOSITION_SCOPE` in `tests/release-run-dir-lifecycle-conformance.test.js` asserting `disposition.md` names a read of `staged/` or `decisions.md` that fails for any reason other than "does not exist" as a failure that blocks archival (writes the FAILED line, skips archival). The existing `assertFactsAndGoRed` loop already proves each fact goes red when its match is stripped.
- [ ] **Step 2: Implement** — in `disposition.md`'s Inventory, after "An absent or empty `staged/` means no staged files.", state that any other read error on `staged/` or `decisions.md` (EACCES, EIO — anything but "does not exist") is a failure, not an empty inventory: write the FAILED line and skip archival. In the Failure section, add the FAILED line variant for an unreadable path so the hand-composed line has a defined shape (`{path} — read failed: {message}`, `Reversibility: n/a (nothing read).`), and keep "Any failure means Step 8 skips archival" covering it.
- [ ] **Step 3: Run** `node --test tests/release-run-dir-lifecycle-conformance.test.js` — PASS. Revert the disposition.md edit in memory (or temporarily) to confirm the new fact goes red.
- [ ] **Step 4: Commit** — one commit, `refs #4155`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (treat a non-ENOENT read error as a failure: FAILED line, no archival) → Step 2; Deliverable 2 (pin in the conformance test) → Step 1. AC 1 (disposition.md names the failure) → Step 2; AC 2 (test asserts the sentence and goes red without it) → Steps 1 + 3; AC 3 (`npm test` passes) → Common Step 5.
- **Placeholders:** none.
