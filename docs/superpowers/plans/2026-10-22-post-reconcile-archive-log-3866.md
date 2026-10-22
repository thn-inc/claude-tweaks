# pr-first-merge Step 4.2 logs to the run dir after reconcile archived it, recreating the dir (#3866) Implementation Plan

**Goal:** `_shared/pr-first-merge-post-merge.md` Step 4.2 stops writing post-reconcile `decisions.md` lines to `$PIPELINE_RUN_DIR` after reconcile's `archive` check has moved that directory to `.claude-tweaks/pipelines/archive/{run-id}/`.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T144609-record-3866/work/3866-spec.md` (materialized from GitHub issue #3866)

---

### Task 1: Route Step 4.2's post-reconcile log lines to the archived run path and pin the ordering

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md`
- Test: `tests/pr-first-merge.test.js`

- [ ] **Step 1: Failing test** — add a conformance test to `tests/pr-first-merge.test.js` (next to the existing #3297 Step 4.2 tests) that slices Step 4.2's section and asserts: (a) it states that once reconcile archived the run dir, every post-reconcile `decisions.md` line goes to `$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` as `--run`, citing `_shared/timing-render.md`'s archive-path rule; (b) it forbids writing to the moved `$PIPELINE_RUN_DIR` and names the recreated-dir consequence; (c) the archive-resolution instruction appears **before** the "{N} other run dir(s) need human action" log instruction in the section text (the ordering this record pins). Run it — FAIL.
- [ ] **Step 2: Implement** — in Step 4.2, immediately after the reconcile call's paragraph and before the "Decide whether **this run** is that stuck run" paragraph, add a paragraph resolving where this run lives after reconcile: `$PIPELINE_RUN_DIR` gone and `$RUN_ROOT/.claude-tweaks/pipelines/archive/{run-id}/` present (`{run-id}` = `basename($PIPELINE_RUN_DIR)`) means reconcile archived this run — every `decisions.md` line this step writes after the reconcile call passes that archive path as `--run` (`_shared/timing-render.md`'s archive-path rule), never `$PIPELINE_RUN_DIR` (`log-decision.js` exits 3 on the moved path; a hand append would recreate an un-archived dir holding one `decisions.md`). An archived run is by construction not the stuck run (reconcile archives a never-rendered-console run only when its `staged/` holds nothing pending), so its own check is clean. Point the "other run dir(s) need human action" line at that resolved path.
- [ ] **Step 3: Run** `node --test tests/pr-first-merge.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #3866`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (write to archived path, never the moved dir) → Step 2. Deliverable 2 (conformance test pins the ordering) → Step 1. AC1 (no dir reappears) → Step 2's archive-path routing and Step 1 (a)/(b). AC2 (the "other run dir(s)" note still reaches the archived `decisions.md` or the closing report) → Step 2's last sentence plus the existing "report" clause, pinned by Step 1 (c).
- **Placeholders:** none.
