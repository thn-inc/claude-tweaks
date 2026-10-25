# Hooks Below-Floor Digest Findings (#3900) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the three `hooks` findings #3900 promoted from the #1426 digest: admit `git -C <path>` in the delete-only push exemption, pin that the plugin guard judges the invoked program rather than prose, and give `-z` readers untrimmed `runGit` output.

**Architecture:** Item 1 widens one whole-command regex in `pre-tool-use.js` with an optional `-C <arg>` group built from the existing `CQ_ARG` grammar. Item 2 is a won't-fix in plugin code (premise reversed at build time, see below) carried as a pinning regression test. Item 3 adds an additive `opts.raw` flag to `runGit`/`runGitAsync` in `git-exec.js` and switches the four `-z` callers to it; the default stays trimmed.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T185533-record-3900/work/3900-spec.md`

Scope keywords: DELETE_ONLY_PUSH_ALLOWLIST, isDeleteOnlyPush

## Global Constraints

- `pre-tool-use.js` keeps the never-break-a-session invariant (`docs/hooks.md`): no new throw path; a non-string command still returns `false` from `isDeleteOnlyPush`.
- The delete-only exemption stays default-deny by construction: the WHOLE command must match; extra args, chaining, a non-delete push, an env-var prefix, or a path to git stay denied.
- `runGit`'s default (trimmed) behavior is unchanged for every caller that does not pass `raw: true`.
- Widening the exemption follows the `pre-tool-use-gate-exemptions` project skill: whole-command grammar, regression test proven red on revert.
- Full `npm test` must pass (source-scan conformance suites read `plugin/bin/**/*.js` as text — e.g. `tests/git-path-read-conformance.test.js` pins the `-z` argv line of each caller, so keep `{ raw: true }` on the same line as the argv array without altering the argv text).

## Build-time facts (premise checks run before planning)

- **Item 2 premise reversed.** Probed `pre.run()` from this worktree against a fresh `worktree-always: true` repo (non-isolated cwd): `node bin/log-decision.js --run x --text "evidence via git show HEAD:foo"`, the same with `git commit -m x` in the text, and with `'ran git push origin main earlier'` all resolve zero git targets via `gitTargets` and are allowed; `git commit -m x` is denied; `git show HEAD` is allowed (the plugin guard does not cover read-only git at all). The record-2271 refusal was the Claude Code harness's built-in worktree-isolation guard, which is outside plugin code. Disposition: won't-fix in plugin code — "the plugin guard already tokenizes commands and judges the invoked program; the refusal came from the Claude Code harness guard, which the plugin cannot change". Logged to `decisions.md` as a `premise reversed:` line.
- **Item 5 already satisfied.** All three #1426 comments (5405348374, 5657007652, 6294229872) already end their promoted entry line with `→ #3900` (read via `gh api repos/thn-inc/claude-tweaks/issues/1426/comments --paginate`). No write needed.
- `tests/hooks-policy-exemption.test.js:235` currently lists `'git -C . push origin --delete my-branch'` under `shouldNotMatch`; Deliverable 1 moves it to `shouldMatch`.

## Review Focus

- A `-C` path with spaces must be quoted to match (`"…/Code Workspaces/…"`); an unquoted spaced path must NOT match (would be two tokens). Pinned in Task 1.
- `git -C` appearing twice, or `-C` after `push` (`git push -C x origin --delete b`), must not match. Pinned in Task 1.
- A double-quoted `-C` path carrying `$`/backtick (`"$WT"`) must not match — `CQ_DOUBLE` already excludes them; pinned in Task 1.
- A genuine git invocation chained after prose (`node … --text "x"; git commit -m y`) must still be denied — the go-red control for item 2's pin. Pinned in Task 2.
- `raw: true` on the failure path changes nothing (failure shape is `stdout: null` either way); the async twin honors `raw` too. Pinned in Task 3.

---

### Task 1: Delete-only push exemption admits `git -C <path>`

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (the `DELETE_ONLY_PUSH_ALLOWLIST` regex and its header comment, ~lines 365-383)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (line 42's #658 sentence; line 48's "bare branch-delete" wording) — 27,269 B today, rail 52,500 B, headroom ample
- Test: `tests/hooks-policy-exemption.test.js`

**Interfaces:**
- Produces: `DELETE_ONLY_PUSH_ALLOWLIST` (same export name, same frozen RegExp type) now `^\s*git\s+(?:-C\s+${CQ_ARG}\s+)?push\s+${CQ_ARG}\s+(?:--delete\s+${CQ_ARG}|:${CQ_BARE})\s*$`. `isDeleteOnlyPush(command): boolean` unchanged signature.

- [ ] **Step 1: Write the failing tests** (append to the existing `delete-only push` section)

In `DELETE_ONLY_PUSH_ALLOWLIST matches exactly the admitted shapes`: move `'git -C . push origin --delete my-branch'` from `shouldNotMatch` to `shouldMatch`, and add to `shouldMatch`: `'git -C "/some/worktree" push origin --delete feature-x'`, `"git -C '/a b/wt' push origin --delete feature-x"`, `'git -C /p push origin :feature-x'`, `'git -C "/Users/x/Code Workspaces/repo" push origin --delete feature-x'`. Add to `shouldNotMatch`: `'git -C /p push origin feature-x'`, `'git -C /p push origin --delete a && rm -rf x'`, `'git -C /a b push origin --delete x'`, `'git -C /p -C /q push origin --delete x'`, `'git push -C /p origin --delete x'`, `'git -C "$WT" push origin --delete x'`, `'git -C /p push origin --delete x --force'`, `'git -C push origin --delete x'`.

New behavior tests (same fixture helpers as the file's existing #658 tests; `repo` is a fresh `gitRepoWithCommit()` with `withPolicy(repo, 'worktree-always: true\n')`, command quoted `-C "${repo}"`):
- `test('AC1.1: git -C "<repo>" push origin --delete feature-x from a non-isolated checkout is allowed', …)` → `assertAllowed`.
- `test('AC1.1: git -C "<repo>" push origin feature-x (a content push) stays denied', …)` → `assertDenied`.
- `test('AC1.1: git -C "<repo>" push origin --delete a && rm -rf x stays denied, fail-closed', …)` → `assertDenied`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/hooks-policy-exemption.test.js`
Expected: FAIL after Step 1 — the regex table test reports `expected a match: "git -C . push origin --delete my-branch"` and the `-C` allow test is denied.

- [ ] **Step 3: Implement** — insert `(?:-C\\s+${CQ_ARG}\\s+)?` between `git\\s+` and `push` in `DELETE_ONLY_PUSH_ALLOWLIST`; update the header comment to name the optional single `-C <path>` (quoted or bare, same `CQ_ARG` rules) and #3900. In `policy-schema-coverage.md` line 42, change the #658 sentence to say the command matches `git [-C <path>] push <remote> --delete <branch>` or `git [-C <path>] push <remote> :<branch>` (one optional `-C`, one remote, one branch), and keep "no path to `git` other than the bare word"; line 48's two "bare branch-delete" mentions get `(optionally with one `-C <path>`)` on the first only.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-policy-exemption.test.js tests/hooks-pre-tool-use.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Prove red on revert** — `git -C <worktree> checkout -- plugin/bin/lib/hooks/pre-tool-use.js` is NOT allowed (it would drop the edit); instead save the edited file to the scratchpad, `git show HEAD:plugin/bin/lib/hooks/pre-tool-use.js` over it, run Step 2's command, confirm only the new/moved assertions fail, then restore the saved copy. Record the failing test names in the task report.

- [ ] **Step 6: Commit** — `git add` the three files by path; message `Admit git -C in the delete-only push exemption — refs #3900`.

### Task 2: Pin that the plugin guard judges the invoked program, not prose (item 2, won't-fix)

**Files:**
- Test: `tests/hooks-pre-tool-use.test.js` (append)

**Interfaces:**
- Consumes: `pre.run({ input, runDir: null, runState: null, cwd })` as the file already calls it. No production code changes.

- [ ] **Step 1: Write the tests** (a `worktree-always: true` repo, non-isolated cwd — copy the `gitRepoWithCommit`/`withPolicy` fixture shape from `tests/hooks-policy-exemption.test.js` if this file lacks one, per that file's no-cross-import note)
- `test('AC2.1: a log-decision call whose quoted --text names git show is not denied', …)`: command `node bin/log-decision.js --run x --status AUTO --text "evidence via git show HEAD:foo, then git commit -m x"` → `assert.deepStrictEqual(out, {})`.
- `test('AC2.1 control: a genuine git commit chained after the same prose is still denied', …)`: command `node bin/log-decision.js --run x --text "evidence via git show HEAD:foo"; git commit -m x` → permissionDecision `'deny'`.
- `Waived AC2.1 (git show half): the plugin guard does not cover read-only git (git show HEAD is allowed today); the AC's own "if the guard covers that shape today" clause applies, so the genuine-invocation control uses git commit instead.`

- [ ] **Step 2: Run tests**

Run: `node --test tests/hooks-pre-tool-use.test.js`
Expected: PASS (these pin existing behavior; append-shaped). Go-red evidence is the control test: it is the same command plus `; git commit -m x` and must be denied.

- [ ] **Step 3: Commit** — message `Pin prose-vs-invocation in the worktree gate — refs #3900`.

`Waived AC4.1 (item 2): no plugin code fix exists to revert — item 2 is a won't-fix; the control test is its discrimination evidence.`

### Task 3: `runGit`/`runGitAsync` `opts.raw` for `-z` readers

**Files:**
- Modify: `plugin/bin/lib/hooks/git-exec.js` (`buildSuccess`, `runGit`, `runGitAsync`, the runGit header comment)
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:353` (`isPolicyOnlyCommit`'s `diff --cached --name-status -z`)
- Modify: `plugin/bin/lib/hooks/worktree-reap.js:226` (`isContentIdentical`)
- Modify: `plugin/bin/lib/reconcile/archive-merged.js:1489` (`archiveRunDir` guard)
- Modify: `plugin/bin/sweep-stray-run-dirs.js:73` (`hasTrackedWork`, already passes `{ env: repoPinnedEnv() }` — add `raw: true` to that object)
- Modify: `plugin/skills/_shared/git-path-read.md` (Parsers section, one sentence) — 3,281 B, headroom ample
- Test: `tests/hooks-git-exec.test.js`

**Interfaces:**
- Produces: `runGit(args, cwd, opts?)` / `runGitAsync(args, cwd, opts?)` — `opts.raw === true` returns success `stdout` verbatim (untrimmed); any other value keeps `stdout.trim()`. Failure shape unchanged. Return-shape fields unchanged (no widening).
- Consumer classification: only the four `-z` callers above opt in; every other `runGit` caller is untouched and keeps trimmed output.

- [ ] **Step 1: Write the failing tests** (fixture: temp repo, a committed file named `' lead.txt'` — leading space — plus `b.txt`, committed with `git add -- " lead.txt" b.txt`; require `splitNul` from `../plugin/bin/lib/git-z`)
- `test('AC3.1: runGit raw:true keeps a -z path list byte-exact, leading space included', …)`: `splitNul(runGit(['ls-files', '-z'], repo, { raw: true }).stdout)` deepStrictEquals `[' lead.txt', 'b.txt']`.
- `test('AC3.1: runGitAsync raw:true keeps a -z path list byte-exact', async …)`: same assertion through `runGitAsync`.
- `test('runGit without raw still trims (callers relying on trim keep it)', …)`: `runGit(['ls-files', '-z'], repo).stdout` does not start with `' '` and `runGit(['rev-parse', 'HEAD'], repo).stdout` does not end with `'\n'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/hooks-git-exec.test.js`
Expected: FAIL after Step 1 — `[ 'lead.txt', 'b.txt' ]` vs expected `[ ' lead.txt', 'b.txt' ]`.

- [ ] **Step 3: Implement** — `buildSuccess(stdout, raw)` returns `raw ? stdout : stdout.trim()`; `runGit`/`runGitAsync` pass `opts.raw === true`; document `opts.raw` in the runGit header comment (for `-z` readers; #3900). Switch the four callers by adding `{ raw: true }` (or `raw: true` into sweep-stray's existing opts object) on the same line as the argv array. In `git-path-read.md` Parsers, add: "`runGit`/`runGitAsync` (`plugin/bin/lib/hooks/git-exec.js`) trim stdout by default; a `-z` reader passes `{ raw: true }` so a leading-space first path survives."

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-git-exec.test.js tests/git-path-read-conformance.test.js tests/hooks-policy-exemption.test.js tests/sweep-stray-run-dirs.test.js`
Expected: PASS, 0 failures (drop any path that does not exist from the list; verify with `git ls-files tests | grep sweep-stray`).

- [ ] **Step 5: Prove red on revert** — same save/`git show HEAD:`/restore technique as Task 1 Step 5, applied to `git-exec.js` only; confirm only the two `raw:true` tests fail.

- [ ] **Step 6: Commit** — message `Add runGit raw option for -z readers — refs #3900`.

## As-built addendum (whole-branch review fix wave, e232e852a)

- Beyond Task 3, `tests/git-path-read-conformance.test.js` gained `findUnrawRunGitZ` (fixture, live-corpus and go-red tests): every `plugin/bin` line calling `runGit(`/`runGitAsync(` with `'-z'` must also carry `raw: true`, so Deliverable 3 cannot silently regress. `_shared/git-path-read.md`'s "Pinned by" names the rule.
- Tests this branch added carry a `#3900 ` name prefix (their `AC*` ids are spec-local and collided with an unrelated `AC2.1:` in `tests/hooks-pre-tool-use.test.js`).
- One more Task 1 behavior case: the `-C` exemption holds when cwd is an unrelated non-repo directory.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 / AC1.1 | Task 1 |
| Deliverable 2 / AC2.1 | Task 2 (won't-fix + pin) |
| Deliverable 3 / AC3.1 | Task 3 |
| Deliverable 4 / AC5.1 (dispositions in closing PR) | PR body at wrap-up: item 1 fixed, item 2 won't-fix (reason above), item 3 fixed |
| Deliverable 5 / AC5.1 (`→ #3900` markers) | Already present — Build-time facts |
| AC4.1 (revert turns test red) | Task 1 Step 5, Task 3 Step 5; item 2 waived |
| AC6.1 (`npm test` passes) | Common Step 5 verification |
