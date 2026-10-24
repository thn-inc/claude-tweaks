# staged-patch gitEnv leaks env-injected git config (#3997) Implementation Plan

**Goal:** Make `gitEnv` (`plugin/bin/lib/staged-patch/stack-check.js`) remove environment-carried git config (`GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>`), so every git call the engine makes runs with the user's config fully switched off, and build both staged-patch suites' `FIXTURE_ENV` from `gitEnv()`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T153132-spec-3997-2724/spec-3997/work/3997-spec.md` (materialized from GitHub issue #3997)

---

### Task 1: Scrub env-carried git config in gitEnv and share it with the fixtures

**Files:**
- Modify: `plugin/bin/lib/staged-patch/stack-check.js`
- Test: `tests/bin-lib/staged-patch/stack-check.test.js`
- Test: `tests/bin-lib/staged-patch/cli.test.js`

- [ ] **Step 1: Failing test.** Beside the existing `#3696` `gitEnv` tests in `tests/bin-lib/staged-patch/stack-check.test.js`, add a `#3997` test. Pass an input env carrying `PATH`, `GIT_CONFIG_PARAMETERS` (`"'core.autocrlf'='true'"`), `GIT_CONFIG_COUNT` (`'2'`), and `GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0`/`GIT_CONFIG_KEY_1`/`GIT_CONFIG_VALUE_1`. Assert that none of the six config keys are in the output, `PATH` survives, `GIT_AUTHOR_NAME` survives when present in the input (author/committer identity is out of scope), and the input object is deep-equal to its original (no mutation).
- [ ] **Step 2: Run and see it fail.**
  Run: `node --test tests/bin-lib/staged-patch/stack-check.test.js`
  Expected: FAIL — the new `#3997` test fails because `gitEnv` keeps `GIT_CONFIG_PARAMETERS`/`GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*`.
- [ ] **Step 3: Implement.**
  - In `gitEnv`, after the existing `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` deletes, delete `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_COUNT`, then every key of the copy matching `/^GIT_CONFIG_(KEY|VALUE)_\d+$/`. This uses the same delete-from-the-copy pattern and never mutates the input. Leave the `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_NOSYSTEM` assignments and the win32 `/dev/null` branch unchanged.
  - Update the `defaultGit` comment (currently "Every git call runs with the user's and system config switched off…") so it names environment-carried config (`git -c` / `GIT_CONFIG_*`) as part of what is switched off.
  - In both `tests/bin-lib/staged-patch/stack-check.test.js` and `tests/bin-lib/staged-patch/cli.test.js`, replace the hand-rolled `FIXTURE_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }` with `FIXTURE_ENV = gitEnv()`. `stack-check.test.js` already imports `gitEnv`. `cli.test.js` adds `const { gitEnv } = require('../../../plugin/bin/lib/staged-patch/stack-check');`.
  - Do not scrub `GIT_AUTHOR_*`/`GIT_COMMITTER_*`: `windows-regression.yml` sets them, and fixture commits depend on them.
- [ ] **Step 4: Run and see it pass.**
  - Run: `node --test tests/bin-lib/staged-patch/stack-check.test.js tests/bin-lib/staged-patch/cli.test.js`. Expected: PASS.
  - Then run the AC commands (`GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=true node --test tests/bin-lib/staged-patch/stack-check.test.js tests/bin-lib/staged-patch/cli.test.js`, and the same with `GIT_CONFIG_PARAMETERS="'core.autocrlf'='true'"`). Each must report `# fail 0` and the full pass count (63 before the new test; one more after it).
- [ ] **Step 5: Prove discrimination.** Temporarily revert only the `gitEnv` scrub lines, re-run Step 4's first command, and confirm the new `#3997` test fails. Restore the scrub and confirm it passes again.
- [ ] **Step 6: Commit.** One commit: `Scrub env-carried git config from staged-patch gitEnv — GIT_CONFIG_PARAMETERS/COUNT/KEY_n/VALUE_n`, body `refs #3997`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (scrub plus comment) is Step 3's first two bullets. Deliverable 2 (both `FIXTURE_ENV`s from `gitEnv()`) is Step 3's third bullet. Deliverable 3 (unit test beside the `#3696` tests, no input mutation) is Step 1. Deliverable 4 (closing comment that the CRLF premise doesn't reproduce) is a wrap-up action on the record, not a code change. It is carried in the ledger for wrap-up. AC1.1 and AC2.1 (env-injected runs report `# fail 0`) are Step 4's AC commands. AC3.1 (the test fails when the scrub is reverted) is Step 5. AC4.1 (`npm test` green) is covered by Common Step 5's verification.
- **Placeholders:** none.
