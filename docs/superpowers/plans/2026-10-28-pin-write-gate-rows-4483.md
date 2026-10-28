# Pin the untested write-gate rows and retire the non-discriminating flat-pass test (#4483) Implementation Plan

**Goal:** Make every `LONG_VALUE_OPTIONS` cp/install entry in `plugin/bin/lib/hooks/git-command.js` pinned by a test that goes red when the entry is dropped, make the line-1681 flat-second-pass test discriminate (or stop claiming #4303), and reword the branch-history comments in `tests/hooks-gate-coverage.test.js` as present-tense statements.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T172100-spec-4483/work/4483-spec.md` (materialized from GitHub issue #4483)

---

### Task 1: Pin the cp/install long-value rows, fix the flat-pass test, reword branch-history comments

**Files:**
- Test: `tests/hooks-gate-coverage.test.js`
- Waived `plugin/bin/lib/hooks/git-command.js`: read only, no change (the mutation target for the discrimination checks; never edited in this worktree)

**Context the implementer needs (verified against this worktree at fbffbd0e3):**
- `LONG_VALUE_OPTIONS` is at `plugin/bin/lib/hooks/git-command.js:3012` (the record's line 2868 has drifted): `cp: ['--no-preserve', '--sparse', '--suffix']`, `install: ['--group', '--mode', '--owner', '--strip-program', '--suffix']`.
- The existing pin table is at `tests/hooks-gate-coverage.test.js:531-545` (`#4303: \`${cmd}\` reads a long option's value as no operand`). Add the new rows to that table, extending its header comment if needed.
- **Trap:** install is parsed through `coreutilsValueFlags(INSTALL_VALUE_FLAGS, 'install')`, and `INSTALL_VALUE_FLAGS` (line 3003) already holds `--mode`, `--owner`, `--group`, `--suffix` as exact names. So a full-name row such as `install --group -t a /main/f.js` stays green when `--group` is dropped from `LONG_VALUE_OPTIONS`. Only an abbreviated form (for example `install --gro -t a /main/f.js`, `install --own -t a /main/f.js`) reaches `takesLongValue`. Each install row must use a form that actually goes red when its entry is dropped. cp goes through `takesLongValue` directly (around line 3063), so full names work there.
- GNU coreutils is installed locally (`/opt/homebrew/bin/gcp`, `/opt/homebrew/bin/ginstall`). Confirm each new row's expected verdict against real GNU behaviour in a scratch directory. The neighbouring comment cites "bash 3.2 and 5 with GNU coreutils 9.12". An abbreviation must be unambiguous among the tool's GNU long options.

- [ ] **Step 1: Failing test.** Add rows for `cp --no-preserve`, `cp --sparse`, `install --group` and `install --owner` before `-t` (the install ones abbreviated, per the trap above). Then prove discrimination for **every** cp and install entry of `LONG_VALUE_OPTIONS` (all 8: cp `--no-preserve`, `--sparse`, `--suffix`; install `--group`, `--mode`, `--owner`, `--strip-program`, `--suffix`). In a scratch `git worktree add` (never in this worktree), drop one entry at a time and run `node --test tests/hooks-gate-coverage.test.js`; each mutant must turn at least one test red. Any entry still green (likely `install --mode`, whose existing row uses the full name) gets an abbreviated row too (for example `install --mo -t a /main/f.js`).
- [ ] **Step 2: Implement.**
  - (a) Line-1681 test (`#4303: a flat second pass inside a multi-line \`$[ … ]\` restarts its subscript count`): find an input that fails against v6.156.2's `git-command.js` (`git show v6.156.2:plugin/bin/lib/hooks/git-command.js`, run in a scratch worktree checked out at `v6.156.2`, or by swapping only that file in a scratch worktree) and passes at HEAD, and replace the test's inputs with it. If no such input exists after a genuine attempt, retitle the test (and its leading comment) as a pre-existing pin that no longer claims #4303, for example `pre-existing pin: …`, and say which way you went in the reply.
  - (b) Reword every comment containing `this branch` (25 lines, roughly 2392–3484) as present-tense statements of the current behaviour with a `#4303` ref. Keep each comment's technical content (which bash verdict, which paths, why); drop only the narration of erased intermediate revisions. Do not change any test code or expected values while doing this.
- [ ] **Step 3: Run** `node --test tests/hooks-gate-coverage.test.js` plus the other scanner suites (`ls tests | grep -i -e scanner -e git-command -e gate`, then run each one found). All must PASS, and `grep -c "this branch" tests/hooks-gate-coverage.test.js` must print `0`.
- [ ] **Step 4: Commit.** One commit, message `Pin the untested write-gate rows and retire the non-discriminating flat-pass test — refs #4483` (house style `{Verb} {what} — {detail}`, "refs", never "closes").

---

## Self-review

- **Spec coverage:** Deliverable 1 → Step 1. Deliverable 2 → Step 2(a). Deliverable 3 → Step 2(b). AC 1 (dropping any cp/install entry turns a test red) → Step 1's 8-mutant proof. AC 2 (line-1681 test fails at v6.156.2 or retitled) → Step 2(a). AC 3 (`grep -c` prints 0) → Step 3. AC 4 (scanner suites pass) → Step 3.
- **Placeholders:** none.
