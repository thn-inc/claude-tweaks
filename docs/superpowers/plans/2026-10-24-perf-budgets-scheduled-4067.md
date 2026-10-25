# Nothing runs the perf/ wall-clock budgets automatically, and the session-failures lock wait is asserted nowhere (#4067) Implementation Plan

**Goal:** Run `npm run test:perf` automatically off the PR path, and assert the session-failures lock wait behaviourally inside `npm test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T155809-record-4067/work/4067-spec.md` (materialized from GitHub issue #4067)

---

### Task 1: Schedule the perf/ budgets and assert the lock wait behaviourally

**Files:**
- Create: `.github/workflows/test-perf.yml`
- Test: `tests/bin-lib/model-profiles/session-failures.test.js`

- [ ] **Step 1: Failing test** — in `tests/bin-lib/model-profiles/session-failures.test.js`, make the "lock released by another writer mid-wait" test assert the lost-update outcome rather than only "the model is recorded": a separate process holds the lock, writes the failure set it read when it took the lock (`['fable']`), then releases it; `recordFailure(id, 'opus')` must end with both models. A no-wait `acquireLock` (`return false;` inserted before `session-failures.js:76`) reads before the holder's write and loses `opus`, so the test goes red. No wall-clock assertion (`tests/wall-clock-budget-conformance.test.js` forbids one under `tests/`). Give the wait a long `lockTimeoutMs` so a slow-to-start helper process under load cannot turn the pass case into a timeout-degrade.
- [ ] **Step 2: Implement** — create `.github/workflows/test-perf.yml`: `schedule` (daily cron) + `workflow_dispatch` triggers only (never `pull_request`/`push`, so it cannot gate or flake a PR), `permissions: contents: read`, ubuntu-latest, Node 20, the same git-identity and `GH_TOKEN` env `test.yml` sets for suites that commit fixtures or reach `gh`, then `npm run test:perf`. A failing run is a red scheduled run in the Actions tab plus GitHub's failed-scheduled-workflow notification. Update `docs/plugin-structure.md`'s `perf/` line and the `npm run test:perf` command row to name the workflow.
- [ ] **Step 3: Run** — `node --test tests/bin-lib/model-profiles/session-failures.test.js` PASS; with the mutation applied it FAILS on the new assertion (revert the mutation afterwards); `node --test tests/wall-clock-budget-conformance.test.js` PASS; `npm run test:perf` PASS.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4067`.

---

## Self-review

- **Spec coverage:** Deliverable 1 / AC1 (workflow invoking `npm run test:perf` on schedule + dispatch) — Step 2. Deliverable 2 / AC2 (lock-wait test red under the mutation) — Steps 1 and 3. AC3 (`npm test` passes) — Common Step 5's verification.
- **Placeholders:** none.
