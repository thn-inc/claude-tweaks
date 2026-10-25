# Shell-neutral fixture commands in verify's cli.test.js (#4177) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every `node -e` fixture command in `tests/bin-lib/verify/cli.test.js` parse the same under `/bin/sh` and `cmd.exe`, so the file's Windows-only failures (44 of 46 on run 40113021243) go green.

**Architecture:** `verify.js` spawns every check command with `{ shell: true }` (`plugin/bin/lib/verify/run.js:83`), which is `cmd.exe` on win32, where `'` is not quoting. One test helper, `nodeCmd(script, ...args)`, emits `node -e "<script>" "<arg>"…`. Paths and values travel as argv, so no quote nests inside another and no Windows backslash ever sits inside a JS string literal. A source-scan test keeps the single-quoted form out of the file.

**Tech Stack:** Node 18+ `node --test`, `node:assert`, `node:fs`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T191621-spec-4177/work/4177-spec.md` (materialized from GitHub issue #4177)

## Global Constraints

- Test-file-only change: `tests/bin-lib/verify/cli.test.js` is the only file modified. `plugin/bin/lib/verify/run.js` keeps `shell: true`, because `--cmd` is the caller's whole shell string by design.
- No test is removed, skipped or loosened. The Linux count goes from 190 to 192 (the new scan test and the `nodeCmd` guard test), with 0 failing.
- No fixture command may contain `%`, because `cmd.exe` expands `%VAR%` even inside double quotes.
- Commit style: `{Verb} {what} — {detail}`, body `Refs #4177`, trailer `Claude-Session: https://claude.ai/code/session_01VQ5xwJKNNfTkMXnRsmxndL`. Never write "closes" or "fixes".
- Test output is redirected to a `.txt` file, never `.log`.

## Review Focus

- **A Windows path containing a backslash before a closing quote** (an arg ending in `\`). The MSVCRT argv parser would read `\"` as an escaped quote. Expected: `nodeCmd` throws, naming the arg. Pinned by the `nodeCmd` guard test.
- **A script containing `"`, `$`, a backtick, `\` or `%`.** Any of these changes meaning under one of the two shells. Expected: `nodeCmd` throws. Pinned by the same guard test.
- **`{base}` substitution.** verify rewrites `{base}` inside the command string. Expected: it still lands, now as an argv word (`"{base}"` becomes `"<sha>"`). Pinned by the existing tool-scoped tests at lines 904 and 1277, which keep asserting the substituted value.
- **`report.json`'s recorded command.** Expected: the 3022 override test (line 1016) still sees exactly the string `nodeCmd` produced. Its existing `assert.strictEqual(report.checks.unit.command, overrideCmd)` pins it unchanged.
- **The compound `a && b` command at line 328.** Expected: both halves still run under `&&`, which `cmd.exe` also supports. Its existing marker assertions pin it.

---

### Task 1: Shell-neutral `nodeCmd` helper, convert the 15 commands, scan guard

**Files:**
- Modify: `tests/bin-lib/verify/cli.test.js`. Add the helper near the other top-of-file helpers. Change these commands:
  - 214, the line-199 test's `unlinkOwnLog`, which splices `logPath` into a JS string literal
  - 328
  - 711, `scopedRepo`'s `unitCmd`, plus its comment at 706-710
  - 911, plus its comment at 907-909
  - 951, 952, 1022, 1029, 1046, 1079, 1080
  - 1283 and 1299, which spell the quote as an escaped `\'`
  - 2049, plus its comment at 2043-2048
  - 2726
- Test: the same file. Add two new tests: the `nodeCmd` guard test and the source-scan test.

**Interfaces:**
- Produces: `nodeCmd(script: string, ...args: string[]) => string`, local to `cli.test.js`. It returns `` `node -e "${script}"` `` followed by ` "${arg}"` for each arg.
  - Every error message starts with `nodeCmd:`.
  - It throws an `Error` naming the offending part when `script` matches `/["$`\\%]/`.
  - It throws when an arg matches `/["$`%]/` or ends with `\`.
  - Scripts read values from `process.argv[1]`, `process.argv[2]`, and so on (`node -e code a b` gives `process.argv` = `[node, 'a', 'b']`). They use single-quoted JS strings only.

- [ ] **Step 1: Write the failing tests** at the end of the file:

```js
test('#4177 AC1/AC3: no fixture command uses the POSIX-only single-quoted node -e form — cmd.exe gives \' no meaning', () => {
  const lines = fs.readFileSync(__filename, 'utf8').split('\n');
  const offenders = lines.map((l, i) => [i + 1, l]).filter(([, l]) => /node -e \\?'/.test(l)).map(([n]) => n);
  assert.deepStrictEqual(offenders, [], 'build the command with nodeCmd(script, ...args) instead');
});

test('#4177 AC4: nodeCmd refuses a script or argument whose meaning differs between /bin/sh and cmd.exe', () => {
  assert.strictEqual(nodeCmd("console.log(process.argv[1])", 'C:\\x\\y.txt'), 'node -e "console.log(process.argv[1])" "C:\\x\\y.txt"');
  for (const bad of ['a"b', 'a$b', 'a`b', 'a\\b', 'a%b']) assert.throws(() => nodeCmd(bad), /nodeCmd/);
  for (const bad of ['a"b', 'a$b', 'a`b', 'a%b', 'C:\\dir\\']) assert.throws(() => nodeCmd('0', bad), /nodeCmd/);
});
```

The scan regex's own source line must not match itself. `/node -e \\?'/` written as the literal text `node -e \\?'` doesn't, because the character after `node -e ` is `\`, then `\` again, never `'`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test --test-name-pattern "#4177" tests/bin-lib/verify/cli.test.js > <scratchpad>/t1.txt 2>&1`
Expected: FAIL. The scan test lists exactly the 14 single-quoted lines, `[328, 711, 911, 951, 952, 1022, 1029, 1046, 1079, 1080, 1283, 1299, 2049, 2726]`. Line 214 uses double quotes, so the scan never lists it; Step 3 converts it anyway. The guard test fails with `nodeCmd is not defined`.

- [ ] **Step 3: Implement `nodeCmd` and convert every command**
  - Each `writeFileSync(${JSON.stringify(p)}, "ran")` becomes `nodeCmd("require('fs').writeFileSync(process.argv[1], 'ran')", p)`.
  - The `{base}` sites become:
    - 911: `nodeCmd("require('fs').writeFileSync(process.argv[1], process.argv[2])", out, '{base}')`
    - 1283: `{base}` passed as `process.argv[1]` to `console.log`
    - 2726: `{base}` as an unused trailing arg after `out`
  - 1046 and 2726 read `process.env.X` inside the script, so the variable name stays in script text, which is fine because it contains no `$` or `%`.
  - 214: the poll script reads `const p=process.argv[1]` and receives `logPath` as an arg.
  - 1299: same shape as 1283, with no args.
  - Rewrite the three quoting comments to state the argv rule and why: `cmd.exe` gives `'` no meaning, and a path must never sit inside the script text.

- [ ] **Step 4: Run the whole file and confirm it passes**

Run: `node --test tests/bin-lib/verify/cli.test.js > <scratchpad>/t2.txt 2>&1; echo exit=$?`, then `tail -9` on the output.
Expected: `exit=0`, `# tests 192`, `# pass 192`, `# fail 0`.

- [ ] **Step 5: Prove the scan can go red**

Re-introduce one `node -e '0'` literal in a fixture with a scratchpad script that mutates the file, runs `--test-name-pattern "no fixture command"`, and restores the original bytes in a `finally` block. Expected: the test fails and names that line, the file is restored byte-identical, and a rerun is green.

- [ ] **Step 6: Commit**

```bash
git add tests/bin-lib/verify/cli.test.js
git commit -m "Build verify's cli.test.js fixture commands with a shell-neutral nodeCmd helper — cmd.exe gives ' no meaning" -m "Refs #4177" -m "Claude-Session: https://claude.ai/code/session_01VQ5xwJKNNfTkMXnRsmxndL"
```

---

## After the task (verification, not part of Task 1)

- Dispatch `gh workflow run windows-regression.yml --ref worktree-flow-spec-4177`. When it finishes, download its `verify-report` artifact and count the failing tests in `tests/bin-lib/verify/cli.test.js` in `verify-logs/tests.log`.
- The expected result is that the 46 failing tests drop to at most 1, the out-of-scope line-3407 stale-scratch-worktree test. The line-199 unreadable-log test may still fail if Windows refuses to unlink an open file; record that as its own finding if so.

## Self-review

- **Spec coverage:**
  - Deliverables 1-3 (helper, conversions, comments) and Deliverable 4 (scan assertion) are Task 1, Steps 1 and 3.
  - AC1 (no single-quoted literal) is the scan test, which is stricter than the grep and also covers the escaped `\'` spelling.
  - AC2 (same count, no loosening) is Step 4: 190 + 2.
  - AC3 (go-red) is Step 5.
  - AC4 (Windows dispatch) is the after-task verification.
- **Placeholders:** none.
- **Types:** `nodeCmd` has one signature everywhere.
- **Proportion:** one task, one file. The plan carries decisions, not bodies.
