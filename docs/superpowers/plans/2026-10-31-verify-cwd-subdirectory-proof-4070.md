# verify --cwd subdirectory test does not prove the check ran in packages/app (#4070) Implementation Plan

**Goal:** Make `tests/bin-lib/verify/cli.test.js`'s `#3799 --cwd subdirectory` test prove the check command actually ran in `packages/app`, not just that it exited 0 and stamped.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T101111-spec-4107-4052-4070-4090-4101-4105-4106-4073/spec-4070/work/4070-spec.md` (materialized from GitHub issue #4070)

---

### Task 1: Probe the check's working directory in the #3799 --cwd test

**Files:**
- Modify: `tests/bin-lib/verify/cli.test.js`
- Waived `plugin/bin/verify.js`: read-only — the spawn whose `cwd` is under test (temporarily edited only for the revert proof, never committed)

- [ ] **Step 1: Failing test** — in the `#3799: a --cwd subdirectory of the invoking checkout still runs and stamps` test (`tests/bin-lib/verify/cli.test.js`, around :518-523), change the check command to write a probe file in its own working directory: `--cmd "tests=node -e \"require('fs').writeFileSync('cwd-probe.txt', process.cwd())\""` (double quotes outside, single quotes inside — parses the same under `sh` and `cmd.exe`; build it as one argv element). Add assertions: `packages/app/cwd-probe.txt` exists; `cwd-probe.txt` does NOT exist at the temp repo root; `fs.realpathSync(<probe content>) === fs.realpathSync(path.join(a.repo, 'packages', 'app'))`. Keep the existing exit-code-0 and stamp-exists assertions.
- [ ] **Step 2: Implement** — test only; no production change (`git diff plugin/` stays empty). Confirm (do not assume) that the untracked probe file does not break the stamp assertion — the stamp is read from the git dir.
- [ ] **Step 3: Run** `node --test tests/bin-lib/verify/cli.test.js` — PASS. Revert proof: temporarily make `--cwd` ignored by dropping the `cwd` value passed to the check command's spawn (`plugin/bin/lib/verify/run.js:83` and/or `plugin/bin/verify.js:113` — whichever spawns the `--cmd` check) → the strengthened test fails on the probe-location or realpath assertion; record the command and failing output; restore and confirm `git diff --exit-code plugin/` exits 0.
- [ ] **Step 4: Commit** — one commit, `Prove verify --cwd runs the check in the subdirectory — probe file and realpath compare`, `refs #4070`.

---

## Self-review

- **Spec coverage:** Deliverables 1-3 → Step 1. AC1 → Step 1; AC2 (revert proof) → Step 3; AC3 (no production change) → Step 2 + `git diff --exit-code plugin/`; AC4 (`npm test`) → Common Step 5.
- **Placeholders:** none.
