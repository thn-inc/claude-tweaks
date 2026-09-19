# npm test: 3 sandbox-only failures split out of #1853 (#2436) Implementation Plan

**Goal:** Reproduce (to the extent this checkout allows), root-cause, and fix or explicitly
follow-up each of the three sandbox-only `npm test` failures split out of #1853.

**Spec:** `.claude-tweaks/pipelines/2026-09-16T225238-record-2436/work/2436-spec.md` (materialized from GitHub issue #2436)

---

### Task 1: Root-cause the three sandbox-only failures and fix the reproducible ones

**Files:**
- Modify: `tests/shaping-mode-needs-removal.test.js`
- Modify: `tests/tidy-needs-worklist-rule.test.js`
- Test: `tests/shaping-mode-needs-removal.test.js` (self-verifying — the fix is in the test file itself)
- Test: `tests/tidy-needs-worklist-rule.test.js` (self-verifying — the fix is in the test file itself)

- [x] **Step 1: Reproduce.** Both `shaping-mode-needs-removal.test.js` and
  `tidy-needs-worklist-rule.test.js` run a top-level (module-load-time) `execFileSync('git',
  ['show', PRE_CHANGE_SHA, ...])` to read a historical "go-red control" fixture from commit
  `d111b14742e935487e64a7afa7949cd24e71b8d8`. Reproduced empirically: a `--depth 1` shallow
  clone of this repo does not have that commit's tree reachable, so `git show {sha}:{path}`
  fails with `fatal: path '...' exists on disk, but not in '{sha}'`, thrown synchronously at
  `require()` time with no try/catch — Node's test runner reports this as a whole-file
  `testCodeFailure`, matching the reported symptom exactly. `impeccable-plugin-contract.test.js`'s
  failure is a different mechanism (installed-plugin version pin, `checkVersion` returns
  `'breach'` when a *present-but-wrong-version* plugin is installed — by design, this FAILS
  rather than skips, per the file's own comment) and cannot be reproduced from this checkout
  without mutating the real `~/.claude/plugins/cache`, which the test file's own comments
  explicitly forbid.
- [x] **Step 2: Fix the two reproducible whole-file failures.** In both files, guard the
  top-level `execFileSync` git-show call in try/catch. On success, behavior is unchanged — the
  go-red control test still runs the same assertions against the same historical content. On
  failure (commit unreachable — shallow/partial clone), skip only the one "go-red control" test
  that depends on that historical read (via node:test's `{ skip: reason }` option, same pattern
  `impeccable-plugin-contract.test.js` already uses for its own absent-plugin skip) instead of
  letting the exception crash the whole file. Move the regex/bullet parsing that was previously
  at module scope into the test body itself, so it only runs when the historical read actually
  succeeded.
- [x] **Step 3: Run.** `node --test tests/shaping-mode-needs-removal.test.js
  tests/tidy-needs-worklist-rule.test.js` — PASS in this (full-history) checkout. Re-verify in
  the `--depth 1` shallow clone used for reproduction — the previously-crashing file now reports
  one skipped test and the rest passing, not a whole-file failure.
- [x] **Step 4: Document the third (unfixable-from-here) failure and commit.** Add a "Blocked /
  Future Work" note to the materialized spec (`work/2436-spec.md`) naming the environment-provisioning
  follow-up for `impeccable-plugin-contract.test.js`: sandbox/CI plugin provisioning must install
  exactly the version `tools/upstream-drift/manifest.yml` pins for `impeccable-plugin`, not a
  different or absent one — an absent plugin already skips by design; a present-but-different
  version legitimately fails as a drift signal, which is the test's intended job, not a bug to
  patch around. Append an `open` ledger item (phase `build/blocked`) for this third item so a
  later `/wrap-up` resolves it explicitly. One commit, message `refs #2436`.

---

## Self-review

- **Spec coverage:** AC1 (reproduce + root-cause each) — 2/3 reproduced and root-caused
  empirically (shallow-clone git-history gap); 1/3 root-caused by code-reading only (plugin
  version-pin design), reproduction genuinely requires mutating a real plugin cache, which is
  out of scope for a safe automated build. AC2 (fix or follow-up proposed for each) — 2/3 get a
  real code fix; 1/3 gets an explicit environment-provisioning follow-up, filed to the ledger.
  AC3 (`npm test` stays green) — verified via Common Step 5 after the fix.
- **Placeholders:** none.
