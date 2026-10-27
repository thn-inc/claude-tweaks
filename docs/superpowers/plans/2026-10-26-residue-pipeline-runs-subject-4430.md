# Windows: residue pipeline-runs probe reports its subject with backslashes (#4430) Implementation Plan

**Goal:** `plugin/bin/lib/residue/probes/pipeline-runs.js` emits a clean pipeline-run finding's `subject` `/`-joined on every OS, through `shared-primitives.js`'s `relativeDisplayId`, instead of a native `path.relative(root, dir)`.

**Spec:** `.claude-tweaks/pipelines/2026-10-26T170403-spec-4430/work/4430-spec.md` (materialized from GitHub issue #4430)

---

### Task 1: Emit the pipeline-run subject through relativeDisplayId

**Files:**
- Modify: `plugin/bin/lib/residue/probes/pipeline-runs.js`
- Test: `tests/bin-lib/residue/probes-pipeline-runs.test.js`

- [ ] **Step 1: Failing test** — in `tests/bin-lib/residue/probes-pipeline-runs.test.js`, add a test that injects a counting win32 `pathImpl` (the parity skill's `countingWin32()` shape: `{ ...path.win32, relative: (a, b) => (calls.push([a, b]), path.win32.relative(a, b)) }`) into `probePipelineRuns({ cwd: root, pathImpl })` over the existing `makeFixture()`/`writeRun(root, '2026-01-01T000000-spec-1', { status: 'clean' })` fixture, and asserts `findings[0].subject === '.claude-tweaks/pipelines/2026-01-01T000000-spec-1'` (exact string) and `calls.length > 0`. The counting wrapper is what makes the pin discriminate: on a POSIX host a plain `path.win32` injection and the native `path.relative` give the same `/` ID, so reverting the site keeps a plain-injection test green.
- [ ] **Step 2: Run** `node --test tests/bin-lib/residue/probes-pipeline-runs.test.js` — Expected: FAIL (the probe ignores `pathImpl`, so `calls` stays empty).
- [ ] **Step 3: Implement** — give `probePipelineRuns` a `pathImpl = path` option (destructured alongside `cwd`, `runId`, `worktreeRoot`, `scope`) that feeds only the subject: `subject: relativeDisplayId(root, dir, pathImpl)`, requiring `relativeDisplayId` from `../../shared-primitives`. Every fs path (`base`, `dir`, the `run-state.json` read, the `staged/` read) stays on the native `path`. Update nothing else.
- [ ] **Step 4: Run** `node --test tests/bin-lib/residue/probes-pipeline-runs.test.js` — PASS; then `node --test tests/bin-lib/residue/*.test.js` — PASS.
- [ ] **Step 5: Mutation check** — temporarily revert the subject line to `path.relative(root, dir)`, re-run the new test, confirm it fails, restore.
- [ ] **Step 6: Commit** — one commit: `Emit the pipeline-runs probe's subject /-joined on every OS — #4430` with `refs #4430`.

AC1.2's Windows half (a `windows-regression.yml` run on the branch listing no `tests/bin-lib/residue/` file in `failingFiles`) is controller-run after the build's final verification, not an implementer step.

---

## Self-review

- **Spec coverage:** Deliverable 1 (subject via `relativeDisplayId` with a `{ pathImpl }` option, fs paths native) → Step 3. Deliverable 2 (pin the `/` subject and prove the call site with a counting `relative`) → Steps 1, 2, 5. AC1.1 (exact `/` subject; reverting the site turns the test red) → Steps 1, 4, 5. AC1.2 (residue suites pass on ubuntu; Windows run lists no residue file) → Step 4 plus the controller-run Windows proof.
- **Placeholders:** none.
