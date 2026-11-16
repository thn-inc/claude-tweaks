# Windows regression: six test files (#5694) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the six test files #5694 names pass on a Windows checkout, fixing each failure at its source.

**Architecture:** Five independent fixes, one per failure class. Four are test-side (the shipped code is right and the test assumed POSIX behaviour); one (Deliverable 2) is in shipped code: the revert instruction `console-resolve.js` prints for a memory write restores CRLF bytes on a `core.autocrlf=true` machine. A `windows-regression` dispatch on the branch head is the proof (run by the orchestrator after simplify, not a plan task).

**Tech Stack:** Node `node:test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T094458-record-5694/work/5694-spec.md` (re-materialized after the record's plan-review Decision on Deliverable 2: Reading A, revert command read from one constant)

Scope keywords: `git apply -R --unidiff-zero`

## Global Constraints

- Linux CI (`npm test`) must stay green on the same head (AC2.1).
- No test in the six files is skipped or narrowed on `win32` to pass, unless the PR states why the behaviour it pins is POSIX-only (AC3.1).
- Governing skill `windows-checkout-test-parity`, quoted verbatim (its Anti-patterns row): "Expecting a POSIX absolute literal (`'/main-checkout'`) where the code under test runs that path through `path.resolve` | On win32, `path.resolve('/main-checkout')` is `C:\main-checkout`, so the pin fails only on a Windows checkout. Wrap the expected value in `path.resolve(...)` too. A path the code passes through unresolved stays literal: `gitTargets`'s cwd `'/repo'` is one."
- Every `execFileSync('git', …)` in tests keeps `windowsHide: true`.
- Commit subjects: `{Verb} {what} — {detail}`, ending `refs #5694`; never `closes`/`fixes`.

## Decisions (state each in the PR body — AC4.1)

- **D1 (acceptance-packet EBUSY): test.** Probed on macOS with a `child_process` spy preloaded around the Decision 2 test (Node 22 and 26): its only child processes are three synchronous `git` calls (`init`, `commit` in the template, `ls-files -z -- <runDir>` from `archiveRunDir`), none with a cwd under `pipelines/archive`; the `spawnTokenPass` stub (`tests/helpers/stub-token-pass.js`) holds, so no `timing-at-close.js` child starts. No `opendir`/`watch` exists under `plugin/bin`. So no handle this code leaves explains a deterministic EBUSY; the cleanup itself is the defect: `fs.rmSync` without `maxRetries` fails on the first EBUSY Windows reports for a directory something briefly holds. `archiveRunDir` and the gather are unchanged. If the proof run still shows this failure, the cause is outside the cleanup and is investigated then — never claimed fixed.
- **D2 (memory-write CRLF): shipped code.** `git apply` writes through `core.autocrlf` even outside a repository (probed: `git -c core.autocrlf=true apply -R --unidiff-zero p.patch` in a non-repo dir wrote `a\r\nb\r\n`; with a later `-c core.autocrlf=false` it wrote `a\nb\n`). The human-facing instruction at `plugin/bin/console-resolve.js:687` is the defect: on a Windows machine with Git's default `core.autocrlf=true`, following it restores CRLF bytes, not the prior file. User-visible effect: the printed command becomes `git -c core.autocrlf=false apply -R --unidiff-zero {patch}`. Per the record's Decision (Reading A), the command lives in one constant, `MEMORY_REVERT_COMMAND`, exported by `plugin/bin/lib/console/memory-write.js` (the module that builds the diff the command reverses, and which `console-resolve.js` already imports); `console-resolve.js` interpolates it into the entry head, and the test's `revert` helper runs that same constant, so the two cannot drift. `plugin/bin/console-resolve.js` is outside the record's Key Files list and is named in the PR body per the Decision's rule.
- **D3 (timing EISDIR/EPERM): test.** `rename` onto a directory is `EISDIR` on POSIX and `EPERM` on Windows; the CLI maps either to exit 2 correctly. `Waived plugin/bin/phase-timing.js: Task 3 Step 1 reads its catch-to-exit-2 mapping`. `Waived plugin/bin/lib/timing/run-timing.js: Task 3 Step 1 reads its tmp-file rename`.
- **D4 (drive letter): test; contract = on a walk that keeps its cwd, the cwd passed in is returned as given (unresolved).** `resolveGitCommand`/`gitTargets` resolve only a `-C` value, a `cd` target, a lost cwd's stand-in, and — on a walk that lost its cwd — the base view's own readings, which are resolved to a native path by design (#4303 BASE_VIEW, `plugin/bin/lib/hooks/git-command.js:1282-1288`; state this exception in the PR's AC4 text). A known cwd on a walk that never loses it passes through unchanged, which every neighbouring pin already asserts (`hooks-git-command.test.js:293` `'/repo'`, and the skill row quoted above). The three tests expecting `path.resolve` of the base cwd are wrong. `Waived plugin/bin/lib/hooks/git-command.js: Task 4 reads lines 1215-1230; the code is the contract and is unchanged`.
- **D5 (wd-ambiguous): test.** Match the event by its parsed `matched` value.

## Review Focus

- A memory file with no trailing newline restored on an autocrlf machine — covered by Task 2's existing `'a\nb'` loop case under the new autocrlf env.
- A memory create reversed on an autocrlf machine (file removed, not left as CRLF) — Task 2's existing create case under the new env.
- A human copying the printed command verbatim — Task 2's revert helper runs the same `MEMORY_REVERT_COMMAND` constant the head interpolates, and the head test pins its literal value.
- `wd-ambiguous` logged more than once or for the wrong worktree — Task 5 asserts the exact list of matched values.
- A Windows run still EBUSY after retries — not coverable locally; the proof run (orchestrator) is the check.

---

### Task 1: acceptance-packet cleanup retries (D1)

**Files:**
- Modify: `tests/acceptance-packet-cli.test.js:947-955` (`repoWorkspace`)
- Waived `plugin/bin/acceptance-packet.js`: read only (Decision D1); no handle found in it
- Waived `plugin/bin/lib/reconcile/archive-merged.js`: read only (Decision D1); `archiveRunDir` leaves no handle or cwd in the probe

**Interfaces:** none.

- [ ] **Step 1:** In `repoWorkspace`, change the cleanup to `t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))`, with a one-line comment: Windows reports EBUSY for a directory something still briefly holds after the archive's renames; `maxRetries` is Node's documented retry for EBUSY/EPERM/ENOTEMPTY (#5694). Leave `workspace()`'s cleanup at line 30 unchanged.
- [ ] **Step 2:** Run `node --test tests/acceptance-packet-cli.test.js` — Expected: PASS, 0 fail.
- [ ] **Step 3:** Commit `Retry the archive test's workspace cleanup on Windows EBUSY — refs #5694`.

### Task 2: memory-write revert instruction ignores autocrlf (D2)

**Files:**
- Modify: `plugin/bin/lib/console/memory-write.js` (add and export `MEMORY_REVERT_COMMAND`)
- Modify: `plugin/bin/console-resolve.js:61` (header comment), `:98` (import), and `:687` (the `head` text)
- Modify: `tests/bin-lib/console/memory-write.test.js:17` (import), `:61-65` (`revert`), `:255-260` (head test)

**Interfaces:**
- Produces: `MEMORY_REVERT_COMMAND` (string, `'git -c core.autocrlf=false apply -R --unidiff-zero'`) exported from `plugin/bin/lib/console/memory-write.js`; the entry head contains `${MEMORY_REVERT_COMMAND} {patch}`.

- [ ] **Step 1: Write the failing test.** Rewrite `revert(fx, text)` so it runs the one constant, under a git config that turns autocrlf on the way a Windows install does:
  - Import `MEMORY_REVERT_COMMAND` beside `wholeFileDiff` on line 17. In `revert`, split it on single spaces, assert the first token is `git`, and run the rest with the patch path appended.
  - Write `fx.root/autocrlf.gitconfig` containing `[core]\n\tautocrlf = true\n`; run with `env: { ...process.env, GIT_CONFIG_GLOBAL: thatFile, GIT_CONFIG_NOSYSTEM: '1' }`, `cwd: fx.memoryDir`, `windowsHide: true`.
  - In the head test, replace the `'git apply -R --unidiff-zero'` part with `` `${MEMORY_REVERT_COMMAND} {patch}` ``, and add one literal assertion that the head includes `'git -c core.autocrlf=false apply -R --unidiff-zero {patch}'` (pins the constant's value, so emptying it fails); rename it `'the entry head tells the reader how to reverse: strip the indent, git apply -R with autocrlf off, from the memory directory'`.
  The AC4.2 test (`'AC4.2: applying the reverse diff restores the prior content (trailing newline, none, and a create)'`) keeps its assertions unchanged; it now covers AC1.1 for this file.
- [ ] **Step 2:** Run `node --test tests/bin-lib/console/memory-write.test.js` — Expected: FAIL (the import is `undefined`, so `revert` throws; the head test fails).
- [ ] **Step 3:** In `memory-write.js`, add `const MEMORY_REVERT_COMMAND = 'git -c core.autocrlf=false apply -R --unidiff-zero';` with a comment: the reverse of a memory write; `core.autocrlf=false` because `git apply` writes through autocrlf even outside a repository, so a Windows default would restore CRLF bytes (#5694). Export it. In `console-resolve.js`, import it on line 98 and change line 687's `then run git apply -R --unidiff-zero {patch} from the memory directory` to `` then run ${MEMORY_REVERT_COMMAND} {patch} from the memory directory ``; update the line-61 comment's `(reverse with \`git apply -R\`)` to `(reverse with \`git -c core.autocrlf=false apply -R\`)`.
- [ ] **Step 4:** Run `node --test tests/bin-lib/console/memory-write.test.js` — Expected: PASS. Then `git grep -n -F "unidiff-zero" -- plugin` — Expected: the `MEMORY_REVERT_COMMAND` line in `memory-write.js` only (no literal left in `console-resolve.js`; the line-28 comment's `git apply -R` wording stays unchanged). Revert the `core.autocrlf=false` part of the constant once and confirm the AC4.2 test goes red (restored `a\r\nb\r\n`), then restore it.
- [ ] **Step 5:** Commit `Print the memory-write revert command with autocrlf off — refs #5694`.

### Task 3: timing CLI accepts the platform's rename error (D3)

**Files:**
- Modify: `tests/bin-lib/timing/cli.test.js:66-73`
- Waived `plugin/bin/phase-timing.js`: read only in Step 1 (Decision D3); its catch maps the rejection to exit 2
- Waived `plugin/bin/lib/timing/run-timing.js`: read only in Step 1 (Decision D3); the tmp-file rename raises the platform's code

- [ ] **Step 1:** Keep `assert.equal(r.code, 2)`; replace the stderr match with `assert.match(r.stderr, process.platform === 'win32' ? /^phase-timing\.js: EPERM/ : /^phase-timing\.js: EISDIR/)`, and change the `mkdirSync` comment to `// the timing.json rename throws EISDIR (POSIX) or EPERM (win32)`.
- [ ] **Step 2:** Run `node --test tests/bin-lib/timing/cli.test.js` — Expected: PASS.
- [ ] **Step 3:** Commit `Accept EPERM from the timing.json rename on win32 — refs #5694`.

### Task 4: base-cwd pins are unresolved (D4)

**Files:**
- Modify: `tests/hooks-git-command.test.js:285-289`
- Modify: `tests/hooks-gate-coverage.test.js:2112`, `:2905-2907`
- Waived `plugin/bin/lib/hooks/git-command.js`: read only in Step 1 (Decision D4); the code is the contract and is unchanged

- [ ] **Step 1:** `hooks-git-command.test.js` #4448 test: both expected `dir` values become `'/r'`; add a comment that a known cwd passes through unresolved (as at line 293).
- [ ] **Step 2:** `hooks-gate-coverage.test.js:2112`: expected `dir: '/main'` (the `cd /wt` never runs, so the base cwd comes back as given). `:2906`: expected `[path.resolve('/main'), '/r']` — the `cd /main` target is resolved, the base is not.
- [ ] **Step 3:** Run `node --test tests/hooks-git-command.test.js tests/hooks-gate-coverage.test.js` — Expected: PASS. Then run the same three tests under the win32 path simulation, to show they no longer depend on the host: `git grep -n "path.win32" -- tests/helpers` to find the existing preload (memory: `win32-path-simulation-preload`); if one exists, run the two files with it and report the three tests' result; if none exists, say so.
- [ ] **Step 4:** Commit `Pin the unresolved base cwd in three git-target tests — refs #5694`.

### Task 5: wd-ambiguous matched by parsed value (D5)

**Files:**
- Modify: `tests/hooks-pre-tool-use.test.js:223-240`

- [ ] **Step 1:** Replace the two `assert.match(events, …)` lines with: parse `events.jsonl` line by line (`JSON.parse`), keep entries whose `type === 'wd-ambiguous'`, and `assert.deepStrictEqual(matched, [canonicalRealpath(olderWt)])` where `matched` is their `matched` values and `canonicalRealpath` comes from `require('../plugin/bin/lib/path-guard')` (the function `pre-tool-use.js:2511` uses). Read the event's field names from `plugin/bin/lib/hooks/context.js`'s `appendEvent` before writing the parse.
- [ ] **Step 2:** Run `node --test tests/hooks-pre-tool-use.test.js` — Expected: PASS.
- [ ] **Step 3:** Commit `Match the wd-ambiguous event by its parsed path — refs #5694`.

## Spec coverage

| Spec item | Where |
|---|---|
| Deliverable 1 | Task 1, Decision D1 |
| Deliverable 2, AC4.1 | Task 2, Decision D2 |
| Deliverable 3 | Task 3 |
| Deliverable 4, AC4.1 | Task 4, Decision D4 |
| Deliverable 5 | Task 5 |
| Deliverable 6, AC1.1, AC1.2, AC1.3 | Orchestrator: `gh workflow run windows-regression.yml --ref <branch>` after simplify; read `tests.log` from the `verify-report` artifact for `not ok` in the six files; name the run in the PR |
| AC2.1 | Common Step 5 verification + PR CI |
| AC3.1 | Global Constraints; Task 3 is platform-specific, not narrowed (the assertion stays on both platforms) |
