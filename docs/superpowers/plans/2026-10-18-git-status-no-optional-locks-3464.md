# Lock-free read-only git status probes (#3464) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every read-only `git status` under `plugin/bin` passes the top-level `--no-optional-locks`, so background and cross-worktree probes never rewrite `.git/index` under `index.lock` and never break a sibling session's `git add`/`commit`.

**Architecture:** Each call site gains `'--no-optional-locks'` in its own status argv (before `'status'`, after any `'-C', path`). Shared `runGit`/`git`/`tryGit` helpers are not touched, so write commands keep normal locking. A real-git behaviour test pins the worktrees probe. A source-scan conformance test pins every site, including #3352's statusline string.

**Tech Stack:** Node 18+, `node:test`, `node:assert`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-18T193619-spec-3352-3464/spec-3464/work/3464-spec.md`

## Global Constraints

- `--no-optional-locks` is a top-level git option. It goes before `status` (`['--no-optional-locks', 'status', ...]`), or after the `-C` pair (`['-C', path, '--no-optional-locks', 'status', ...]`). Never after `status`.
- Put the flag in each status call's own argv, never inside a shared git helper. Leave every call's output parsing unchanged.
- Leave `plugin/bin/claude-tweaks-statusline.js` alone; #3352 already fixed it on this branch. Leave `plugin/bin/load-delta.js` alone too: working-tree `git diff` is out of scope.
- Never `git stash`. Run focused tests in the foreground with output redirected to a `.txt` file under `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/f1c2577c-e7d5-4c8d-a86a-535d54176b2a/scratchpad`. The caller runs `npm test` centrally.
- Commits reference the record with `refs #3464`, never a closing keyword. Each commit message ends with `Claude-Session: https://claude.ai/code/session_01FRS7xFKTt9TrTwCNWGu1WH`.

## Review Focus

- **The `-C path` argv form** (`worktrees.js`): the flag must sit after the `-C` pair. Task 1's real-git test exercises it.
- **A flag placed after `status`:** git errors out. Each module then degrades silently: worktree-reap reads "has local content" and never reaps, and changed-files throws. The scanner requires the flag *before* the subcommand. Task 2's scanner self-test asserts that `['status', '--no-optional-locks']` is flagged.
- **Scanner false positives** on non-git `'status'`: `['auth', 'status']`, `cmd === 'status'`, `COMMANDS = ['allocate', 'status']`, and the `git status failed: ${...}` message strings in `engine-verify.js:252/308`. Task 2's self-test asserts none of these is flagged.
- **A vacuous scanner** whose pattern matches nothing: Task 2 asserts at least 12 matched sites.
- **Write commands routed through the same helper** keep their locking. This holds by construction, because no helper changes, and Task 2's diff shows only argv literals and fakes.

---

### Task 1: Lock-free worktrees dirty probe (real-git behaviour test)

**Files:**
- Modify: `plugin/bin/lib/residue/probes/worktrees.js:100`
- Test: `tests/bin-lib/residue/probes-git.test.js` (append after the `readPorcelainStatus: a nonexistent path reads null` test at the end of the file)

**Interfaces:**
- Consumes: `defaultIsDirty(worktreePath: string) => boolean | null` (existing export; delegates to `readPorcelainStatus`).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test** `AC3.1: defaultIsDirty: a stale-stat clean worktree reads false without rewriting the index (#3464 — --no-optional-locks)`. Step 2's red run is AC3.1's "revert to confirm" half: it runs before the flag exists.
  - `const dir = tmpGitRepo();` then write `file.txt` (`'x\n'`), `git -C dir add file.txt`, `git -C dir commit -q -m add`.
  - `const past = new Date('2001-01-01T00:00:00Z'); fs.utimesSync(path.join(dir, 'file.txt'), past, past);`
  - `const indexPath = path.join(dir, '.git', 'index'); const before = fs.readFileSync(indexPath); const beforeMtime = fs.statSync(indexPath).mtimeMs;`
  - `assert.strictEqual(defaultIsDirty(dir), false);` (content unchanged, so the tree is clean. This also catches a misplaced flag, which would read `null`.)
  - `assert.ok(fs.readFileSync(indexPath).equals(before), 'the dirty probe rewrote .git/index');`
  - `assert.strictEqual(fs.statSync(indexPath).mtimeMs, beforeMtime);`
  - `fs.rmSync(dir, { recursive: true, force: true })` in a `finally`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/residue/probes-git.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/f1c2577c-e7d5-4c8d-a86a-535d54176b2a/scratchpad/3464-t1-red.txt 2>&1`
Expected: FAIL after Step 1. The new test fails with `the dirty probe rewrote .git/index`, and every other test passes.

- [ ] **Step 3: Implement.** In `readPorcelainStatus`, change the argv to `['-C', worktreePath, '--no-optional-locks', 'status', '--porcelain']`. Nothing else in the file changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/residue/probes-git.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/f1c2577c-e7d5-4c8d-a86a-535d54176b2a/scratchpad/3464-t1-green.txt 2>&1`
Expected: `exit=0`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/residue/probes/worktrees.js tests/bin-lib/residue/probes-git.test.js
git commit -m "Make the residue worktrees dirty probe lock-free — --no-optional-locks stops it rewriting a sibling worktree's index (refs #3464)" -m "Claude-Session: https://claude.ai/code/session_01FRS7xFKTt9TrTwCNWGu1WH"
```

### Task 2: Conformance scan + migrate every remaining status call site

**Files:**
- Create: `tests/git-status-optional-locks.test.js`
- Modify, adding the flag to the status argv at each line:
  - `plugin/bin/lib/hooks/worktree-reap.js:220`
  - `plugin/bin/lib/reconcile/classify.js:34`
  - `plugin/bin/lib/verify/changed-files.js:142,182`
  - `plugin/bin/lib/verify/report.js:23`
  - `plugin/bin/lib/release/run.js:9`
  - `plugin/bin/lib/routine-template-parser.js:338`
  - `plugin/bin/lib/wrap-up/engine-verify.js:250,306`
  - `plugin/bin/qa-stamp.js:78`
- Modify: `plugin/bin/lib/hooks/worktree-reap.js:143-145`. The comment says `git status` "can rewrite the index". Reword it so it no longer claims that, and keep the `.git` skip's other reason ("git's own bookkeeping").
- Modify (fakes keyed on the old argv):
  - `tests/bin-lib/verify/changed-files.test.js:38,51,60,324`
  - `tests/bin-lib/wrap-up/engine-verify.test.js:462,470,475,561,962,969,984,993-997`
  - `tests/bin-lib/release-local/cli.test.js:63`
  - `tests/bin-lib/release-local/hardening.test.js:57`
- Modify: `docs/donts.md`. Add one line directly after line 134 (the `[IL-104]` `git status` rule).

**Interfaces:**
- Consumes: Task 1's migrated `worktrees.js` (counted by the scan), and #3352's `execSync('git --no-optional-locks status --porcelain -b')` in the statusline (counted by the string form).
- Produces: `unflaggedStatusCalls(raw: string) => { matched: number, offenders: Array<{ line: number, text: string }> }`, defined and used only inside the new test file.

- [ ] **Step 1: Write the failing conformance test** `tests/git-status-optional-locks.test.js`
  - Follow `tests/windows-hide-spawn-conformance.test.js`'s shape: a header comment stating the rule and why, `BIN_ROOT`, `walk(dir)` (skip `node_modules`), and `stripComments(src)`, copied from that file. This test owns its own copy; #3470's walker has not landed.
  - `unflaggedStatusCalls(raw)` strips comments, then counts two shapes:
    1. **Argv:** `/\[\s*((?:'-C'\s*,\s*[\w.$]+\s*,\s*)?(?:'--[\w-]+'\s*,\s*)*)'status'/g`. This is `'status'` as the subcommand element: first in the array, after an optional `'-C', <expr>,` pair and any top-level `'--…'` options. A match is compliant iff group 1 contains `'--no-optional-locks'`.
    2. **Command string:** a quoted literal (`'`, `"` or `` ` ``) matching `/^git\s+(?:\S+\s+)*?status(?=\s+-|\s*$)/`. Here `status` is followed by a flag or the end of the string, so the message `git status failed: ${…}` is not a match. A match is compliant iff `--no-optional-locks` appears before `status` in it.
    3. Every match increments `matched`. Each non-compliant match pushes `{ line, text }`, where `line` is counted from the match index.
  - Test `scanner flags an unflagged status call and ignores non-git status (proves it can go red)`:
    - `unflaggedStatusCalls` over these lines must report offenders on exactly lines `[1, 2, 3, 4]`:
      - `runGit(['status', '--porcelain'], cwd);`
      - `execFileSync('git', ['-C', wtPath, 'status'], opts);`
      - `execSync('git status --porcelain -b');`
      - `x(['status', '--no-optional-locks']);`
    - Over these lines it must report zero offenders and `matched === 2`:
      - `runGit(['--no-optional-locks', 'status', '--porcelain'], cwd);`
      - `execFileSync('git', ['-C', p, '--no-optional-locks', 'status'], o);`
      - `execFileSync('gh', ['auth', 'status']);`
      - `if (cmd === 'status') return 1;`
      - ``const d = `git status failed: ${e.message}`;``
      - `const C = ['allocate', 'status'];`
      - `// git status --porcelain in a comment`
  - Test `AC1.1/AC1.2/AC2.3: every git status under plugin/bin passes --no-optional-locks before the subcommand`:
    - Walk `BIN_ROOT` and sum `matched`.
    - `assert.ok(total >= 12, …)` (AC2.3). At merge time there are 11 argv sites plus the statusline string; this count was confirmed by a scratch probe of these exact patterns at plan time, with no false positives. A lower count means the pattern stopped matching.
    - `assert.deepEqual(offenders, [])`, with each offender formatted `relpath:line text`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/git-status-optional-locks.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/f1c2577c-e7d5-4c8d-a86a-535d54176b2a/scratchpad/3464-t2-red.txt 2>&1`
Expected: FAIL. The scanner self-test passes. The repo-wide test lists the 10 un-migrated sites above as offenders (worktrees.js and the statusline are already compliant).

- [ ] **Step 3: Implement.** Prepend `'--no-optional-locks'` to the status argv at each of the 10 sites. Reword the `worktree-reap.js:143-145` comment. Add the `docs/donts.md` line:

  `- Don't run a read-only \`git status\` under \`plugin/bin\` without the top-level \`--no-optional-locks\` (before \`status\`, after any \`-C\`) — a plain \`status\` refreshes the stat cache and rewrites the index under \`index.lock\`, so a sibling session's \`git add\`/\`commit\` in that worktree fails with \`index.lock: File exists\`; \`tests/git-status-optional-locks.test.js\` enforces it (#3464)`

- [ ] **Step 4: Update the fakes.**
  - In `changed-files.test.js`, the three table keys become `'--no-optional-locks status --porcelain -z --untracked-files=all'`, and `args[0] === 'status'` at :324 becomes `args[1] === 'status'`.
  - In `engine-verify.test.js`:
    - Every `args[0] === 'status'` and `c.args[0] === 'status'` becomes `[1]`.
    - The :475 expected argv gains the leading `'--no-optional-locks'`.
    - The :997 length discriminator changes `5` to `6`, and its comment's arg counts change "(5 args)"/"(6 args)" to "(6 args)"/"(7 args)".
  - In the release-local `cli.test.js:63` and `hardening.test.js:57`, the key becomes `'--no-optional-locks status --porcelain --untracked-files=no'`.
  - Then sweep for any other test keyed on the old argv: `grep -rnE "\[0\] ?=== ?'status'|'status --porcelain|startsWith\('status" tests/`. Update every hit that fakes one of the 10 migrated modules. `reap-merged.test.js`'s `includes('status --porcelain')` still matches and stays as is.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/git-status-optional-locks.test.js tests/bin-lib/verify/changed-files.test.js tests/bin-lib/verify/report.test.js tests/bin-lib/wrap-up/engine-verify.test.js tests/bin-lib/release-local/cli.test.js tests/bin-lib/release-local/hardening.test.js tests/bin-lib/release-local/acceptance.test.js tests/bin-lib/reconcile/reap-merged.test.js tests/reconcile.test.js tests/hooks-worktree-reap.test.js tests/bin-lib/residue/probes-git.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/f1c2577c-e7d5-4c8d-a86a-535d54176b2a/scratchpad/3464-t2-green.txt 2>&1`
Expected: `exit=0`, `# fail 0` (AC4.1 — every migrated module's existing clean/dirty/untracked/ignored tests still pass). Also run `tests/routine-template-parser.test.js tests/bin-lib/verify/qa-stamp.test.js tests/bin-lib/verify/qa-stamp-cli.test.js tests/test-skill-qa-stamp-conformance.test.js` the same way, with output in `3464-t2-green-extra.txt`.

- [ ] **Step 5b: Prove one migrated site goes red** (AC2.1, AC2.2). Remove `'--no-optional-locks', ` from `plugin/bin/lib/reconcile/classify.js:34` only. Run `node --test tests/git-status-optional-locks.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/f1c2577c-e7d5-4c8d-a86a-535d54176b2a/scratchpad/3464-t2-revert.txt 2>&1`. Expected: FAIL, with exactly one offender, `lib/reconcile/classify.js:34`. Then restore the flag and re-run to green. Quote both outputs' `# fail` lines in the report.

Waived AC5.1: `npm test` in full runs centrally in `/claude-tweaks:build` Common Step 5 after both tasks, never inside a task (implementers commit after focused suites).

- [ ] **Step 6: Commit**

```bash
git add tests/git-status-optional-locks.test.js plugin/bin/lib/hooks/worktree-reap.js plugin/bin/lib/reconcile/classify.js plugin/bin/lib/verify/changed-files.js plugin/bin/lib/verify/report.js plugin/bin/lib/release/run.js plugin/bin/lib/routine-template-parser.js plugin/bin/lib/wrap-up/engine-verify.js plugin/bin/qa-stamp.js tests/bin-lib/verify/changed-files.test.js tests/bin-lib/wrap-up/engine-verify.test.js tests/bin-lib/release-local/cli.test.js tests/bin-lib/release-local/hardening.test.js docs/donts.md
git commit -m "Make every read-only git status in plugin/bin lock-free — --no-optional-locks plus a conformance scan (refs #3464)" -m "Claude-Session: https://claude.ai/code/session_01FRS7xFKTt9TrTwCNWGu1WH"
```

(Add any extra test file Step 4's sweep updated to the `git add` list.)
