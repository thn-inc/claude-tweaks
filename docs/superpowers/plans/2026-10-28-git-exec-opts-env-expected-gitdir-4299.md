# Windows regression: 1 test file(s) newly failing after 8e864ba5f (#4299) Implementation Plan

**Goal:** Make the two opts.env tests in `tests/hooks-git-exec.test.js` derive their expected git dir from git's own `rev-parse --absolute-git-dir` output, so they pass on Windows where Git for Windows prints forward slashes.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T110051-record-4287/spec-4299/work/4299-spec.md` (materialized from GitHub issue #4299)

---

### Task 1: Derive the opts.env tests' expected git dirs from git's own output

**Files:**
- Test: `tests/hooks-git-exec.test.js` (the tests `runGit: opts.env is the spawn environment — a pinned env restores -C repo discovery (#4178)` and `runGitAsync: opts.env is the spawn environment, same as runGit (#3900)`)
- Waived `tests/helpers/git-fixtures.js`: reference only (`fixtureGit`, `gitRepo`)
- Waived `plugin/bin/lib/hooks/git-exec.js`: reference only (`runGit`, `runGitAsync`, `repoPinnedEnv`)

- [ ] **Step 1: Failing test** — add one small helper near the top of `tests/hooks-git-exec.test.js` (after the requires) that asks git for one `rev-parse` answer about a repo under a pinned env, so the expected value is git's own spelling (the #4289/#4222 technique, with no `process.platform` branch):

  ```js
  // git's own answer for `repo`, spelled the way git prints it (forward slashes on Git for
  // Windows), so an expected value matches runGit's stdout on every platform. The pinned env
  // keeps an inherited GIT_DIR from redirecting it to another repo. Shared helper for
  // expected `rev-parse` values in this file (#4299; #4289's --show-toplevel tests reuse it).
  function gitRevParse(repo, flag) {
    return fixtureGit(['-C', repo, 'rev-parse', flag], { encoding: 'utf8', env: repoPinnedEnv() }).trim();
  }
  ```

  In both opts.env tests, replace each of the four expected values `fs.realpathSync(path.join(b, '.git'))` / `fs.realpathSync(path.join(a, '.git'))` with `gitRevParse(b, '--absolute-git-dir')` / `gitRevParse(a, '--absolute-git-dir')`. Keep each assertion's actual value and message text unchanged (`'opts.env must reach the child'`, `'opts.env must reach the async child'`). `fixtureGit` returns a Buffer without `encoding` (`tests/helpers/git-fixtures.js`), hence the `encoding: 'utf8'` and `.trim()`.
- [ ] **Step 2: Implement** — no production change. Leave the three `--show-toplevel` tests (`runGit: success returns trimmed stdout…`, `runGitAsync: success returns trimmed stdout…`, the `CT_HOOKS_GIT_TIMEOUT_MS` fallback test) untouched — they belong to #4289.
- [ ] **Step 3: Run** `node --test tests/hooks-git-exec.test.js` — PASS, same test count as before. Then prove discrimination in a scratch `git worktree add` (never in this shared worktree), quoting raw output for each mutant: (a) remove the `...(opts.env ? { env: opts.env } : {})` pass-through in `runGit` (`plugin/bin/lib/hooks/git-exec.js`) → the #4178 test goes red; (b) the same in `runGitAsync` → the #3900 test goes red; (c) make `repoPinnedEnv` keep `GIT_DIR` → both tests go red on their pinned assertion.
- [ ] **Step 4: Commit** — one commit, `Derive the opts.env tests' expected git dirs from git's own output — refs #4299`.

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 1 (helper + four expected values, `repoPinnedEnv()`, no platform branch); Deliverable 2 → Step 2. AC "both pass, same test count" → Step 3; AC discrimination (env pass-through reverted, `repoPinnedEnv` keeps `GIT_DIR`) → Step 3 mutants a-c; AC "windows-regression.yml dispatch" → post-build platform proof, outside this task; AC "`npm test` passes" → `/build` Common Step 5. Gotcha "never both define a helper" → the helper is general (`flag` argument) so #4289 reuses it.
- **Placeholders:** none.
