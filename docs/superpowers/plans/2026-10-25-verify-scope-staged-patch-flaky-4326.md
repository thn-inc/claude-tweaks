# Add the two staged-patch git-fixture suites to verify-scope.json flaky.files (#4326) Implementation Plan

**Goal:** Let the verify runner's existing flaky-retry path retry `tests/bin-lib/staged-patch/cli.test.js` and `tests/bin-lib/staged-patch/stack-check.test.js`, whose `gitRepo` fixture setup has a git subprocess killed under heavy machine load.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T194216-record-4326/work/4326-spec.md` (materialized from GitHub issue #4326)

---

### Task 1: Add both staged-patch suites to `flaky.files`

**Files:**
- Modify: `.claude-tweaks/verify-scope.json`
- Test: `tests/verify-scope-declaration.test.js`

- [ ] **Step 1: Failing test** — none to write. The Acceptance Criteria name only existing suites (`tests/verify-scope-declaration.test.js`, `tests/bin-lib/verify/*.test.js`), and the repo keeps no per-entry test for the `flaky.files` list, so this task adds none.
- [ ] **Step 2: Implement** — append `"tests/bin-lib/staged-patch/cli.test.js"` and `"tests/bin-lib/staged-patch/stack-check.test.js"` to the `flaky.files` array in `.claude-tweaks/verify-scope.json`, leaving every other key untouched.
- [ ] **Step 3: Run** — `node -e 'JSON.parse(require("fs").readFileSync(".claude-tweaks/verify-scope.json","utf8"))'`, then `node --test tests/verify-scope-declaration.test.js`, then `node --test tests/bin-lib/verify/*.test.js` — all PASS.
- [ ] **Step 4: Commit** — `Add staged-patch git-fixture suites to verify-scope flaky.files — refs #4326`.

---

## Self-review

- **Spec coverage:** the single Deliverable (both files in `flaky.files`) is Step 2; both Acceptance Criteria (the file lists both entries and still parses; the two named suites pass) are covered by Step 3.
- **Placeholders:** none.
