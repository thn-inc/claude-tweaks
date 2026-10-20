# Premise-check runner POSIX shell on Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Premise-check runner spawn a shell that exists on win32 (`sh` from PATH) while staying byte-identical (`/bin/sh`) everywhere else, and move the test-side shell spawns onto that runner.

**Architecture:** Add a pure `posixShell(platform)` to `plugin/bin/lib/health-core/premise-self-check.js`; `defaultRunner` gains `platform` and injectable `exec` options and spawns `exec(posixShell(platform), ['-c', command], …)`. Tests pin both with exact strings and an injected `exec`, and the three test-side spawns of a composed command run through `defaultRunner` so they read the command the way `materialize.js` does.

**Tech Stack:** Node 18+, `node:test`, `child_process.execFileSync`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T075819-record-3563/work/3563-spec.md` (record #3563)

Scope keywords: '/bin/sh', shell: true, execSync(

## Global Constraints

- On every non-win32 platform `defaultRunner` still spawns exactly `/bin/sh`; on `win32` it spawns `sh` (PATH-resolved).
- Never run the command with `shell: true`. Never stub `process.platform` in a test — pass `platform` explicitly.
- Never add `{ skip: process.platform === 'win32' }` to the real-shell tests.
- The new `exec(...)` call must carry `windowsHide: true` literally in its own argument text (`tests/windows-hide-spawn-conformance.test.js` scans `exec(` calls under `plugin/bin/`).
- `premiseReadsUnresolved`'s runner call shape stays `{ cwd, timeoutMs }` (existing test 5 pins it).
- `materialize.js` changes only a comment. No other file under `plugin/bin/` changes behavior.
- Commit messages: `{Verb} {what} — {detail}` style, `refs #3563` (never `closes`/`fixes`), ending with `Claude-Session: https://claude.ai/code/session_014jZCLvzHYqSD85nVGenWvD`.

## Review Focus

- A missing shell must never read as "premise resolved" in a test: the drop-path real-shell test must assert a real exit code (Task 1 Step 1, AC5).
- Exit-code semantics unchanged: non-zero exit returned; no exit code (timeout/spawn error) re-throws (existing tests 3, 4, 9, 10 keep covering it).
- `platform` defaulting: an omitted `platform` uses `process.platform` (covered by existing real-shell tests running with defaults).
- Injected `exec` receives `windowsHide: true` on both platforms (Task 1 Step 1 pin).
- Out-of-scope sibling hits stay untouched (Task 4 sibling grep records them).

## Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 4 (four-file run, `# skipped 0`) |
| AC2.1, AC2.2, AC2.3, AC2.4, AC2.5, AC2.6, AC2.7 | Task 4 (Windows dispatch, per-file read, explicit "cannot run" statement) |
| AC3.1 | Task 1 Step 1 |
| AC4.1, AC4.2 | Task 4 (post-fix probe) + Pre-change evidence below (pre-fix probe) |
| AC5.1, AC5.2 | Task 1 Step 1 (real-exit assertion) + Task 4 (preload run) + Pre-change evidence |
| AC6.1, AC6.2 | Task 4 (scratch mutate-run-restore script, one command) |
| AC7.1, AC7.2, AC7.3 | Task 1 Step 1 (`linux`/`darwin` pins) + Task 4 (`git diff --stat -- plugin/bin`) + Task 3 Step 2 |
| AC8.1 | Task 1 Step 4 |
| AC9.1 | Task 4 (`npm test`) |

## Out of scope — Check B dispositions

The scope-keyword sweep also matches sites that run a user-, plan- or tool-authored command through the platform's native shell by design, or spawn something other than a composed Premise-check command. None is a plugin-composed POSIX command, so none is in scope (spec "Repo-wide sibling grep"): `plugin/bin/lib/plan-audit/checks.js`, `plugin/bin/lib/verify/run.js`, `plugin/bin/release-local.js`, `tools/upstream-drift/checks.js`, `tools/upstream-drift/run.js`, `plugin/bin/claude-tweaks-statusline.js`, `plugin/bin/lib/deps.js`, `plugin/bin/lib/wrap-up/pack.js`; tests `build-ac-forwarding-verification` (already win32-skipped), `dispatch-per-record-groups-prose` (#3565), `verify-expectations-writer-conformance` (follow-up per Deliverable 8), and the remaining `execSync(`/`shell: true` test hits, which exercise their own subjects, not the Premise-check runner. Task 4 re-runs the grep and records each disposition in the PR body.

## Pre-change evidence (recorded at plan time, macOS, Node 22, POSIX simulation — not a Windows run)

Preload: a scratch `--require` module that rewrites only the literal `'/bin/sh'` file argument of `execFileSync`/`spawnSync`/`execFile`/`spawn` to a nonexistent path, injected through `NODE_OPTIONS` so child `node` processes get it too.

- Four-file run under the preload, pre-fix: `# fail 9` — cli-validate-findings 22, 23, 24, 25, 29; premise-self-check 8, 10, 11; materialize-premise-check 12 (AC5.1). Identical to the Windows set in the spec.
- premise-self-check test 7 (`… anchor already appears … is dropped`) passes under the preload pre-change (`ok 105`) — for the wrong reason.
- Function level, pre-fix: `defaultRunner('exit 3', { cwd: os.tmpdir(), timeoutMs: 5000, platform: 'win32' })` threw `ENOENT` (the pre-fix module ignores `platform`).

---

### Task 1: `posixShell` and the platform-aware `defaultRunner`

**Files:**
- Modify: `plugin/bin/lib/health-core/premise-self-check.js`
- Test: `tests/bin-lib/health-core/premise-self-check.test.js`

**Interfaces:**
- Produces: `posixShell(platform = process.platform) -> 'sh' | '/bin/sh'` (exported); `defaultRunner(command, { cwd, timeoutMs, platform = process.platform, exec = execFileSync }) -> number` (exit code; re-throws when no exit code). Module exports become `{ premiseReadsUnresolved, defaultRunner, posixShell, PREMISE_SELF_CHECK_TIMEOUT_MS }`.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/health-core/premise-self-check.test.js`; import `posixShell` alongside the existing imports)

```js
test('AC3.1: posixShell picks sh from PATH on win32 and exactly /bin/sh elsewhere', () => {
  assert.strictEqual(posixShell('win32'), 'sh');
  assert.strictEqual(posixShell('linux'), '/bin/sh');
  assert.strictEqual(posixShell('darwin'), '/bin/sh');
});

test('AC3.1: defaultRunner spawns posixShell(platform) through the injected exec, with windowsHide', () => {
  for (const [platform, shell] of [['win32', 'sh'], ['linux', '/bin/sh']]) {
    const calls = [];
    const exec = (...args) => { calls.push(args); };
    assert.strictEqual(defaultRunner('echo hi', { cwd: '/r', timeoutMs: 7, platform, exec }), 0);
    assert.deepStrictEqual(calls, [[shell, ['-c', 'echo hi'], { cwd: '/r', stdio: 'ignore', timeout: 7, windowsHide: true }]]);
  }
});
```

And in the existing test `real shell: an additive check whose anchor already appears in the target file is dropped`, add before the existing assertion (AC5.1 — a missing shell must turn this red):

```js
  assert.strictEqual(defaultRunner(command, { cwd: dir, timeoutMs: 5000 }), 1);
```

- [ ] **Step 2: Run the file to verify the new tests fail**

Run: `node --test tests/bin-lib/health-core/premise-self-check.test.js`
Expected: FAIL — `posixShell is not a function` (the two AC3.1 tests).

- [ ] **Step 3: Implement** `posixShell(platform = process.platform)` and extend `defaultRunner(command, { cwd, timeoutMs, platform = process.platform, exec = execFileSync })` in `plugin/bin/lib/health-core/premise-self-check.js`. The spawn line is exactly `exec(posixShell(platform), ['-c', command], { cwd, stdio: 'ignore', timeout: timeoutMs, windowsHide: true });`. Keep the catch (`err.status` number → return it; otherwise re-throw). Update the header comment of `defaultRunner` to name `platform`/`exec` and why (`/bin/sh` resolves to `<drive>:\bin\sh` on win32, #3563). Export `posixShell`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/health-core/premise-self-check.test.js tests/materialize-premise-check.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, `# fail 0`, `# skipped 0` (AC8.1: windows-hide conformance passes).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/health-core/premise-self-check.js tests/bin-lib/health-core/premise-self-check.test.js
git commit -m "Pick the Premise-check shell per platform — sh from PATH on win32, /bin/sh elsewhere (refs #3563)"
```

### Task 2: Run the test-side composed commands through `defaultRunner`

**Files:**
- Modify: `tests/bin-lib/harness-health/cli-validate-findings.test.js` (lines 442, 467)
- Modify: `tests/bin-lib/harness-health/issue-payload.test.js` (line 3 import, test at line 282–292)

**Interfaces:**
- Consumes: `defaultRunner(command, { cwd, timeoutMs })` and `PREMISE_SELF_CHECK_TIMEOUT_MS` from `plugin/bin/lib/health-core/premise-self-check.js` (Task 1).

- [ ] **Step 1: Edit `cli-validate-findings.test.js`.** Require `{ defaultRunner, PREMISE_SELF_CHECK_TIMEOUT_MS }` from `'../../../plugin/bin/lib/health-core/premise-self-check'`. Replace both `const run = spawnSync('/bin/sh', ['-c', command], { cwd: top, encoding: 'utf8' });` + `assert.strictEqual(run.status, 0, \`… stderr: ${run.stderr}\`)` pairs with `assert.strictEqual(defaultRunner(command, { cwd: top, timeoutMs: PREMISE_SELF_CHECK_TIMEOUT_MS }), 0, '<same message, minus the stderr interpolation>');`. Keep `spawnSync` imported (other tests use it).

- [ ] **Step 2: Edit `issue-payload.test.js`.** Remove `const { execSync } = require('child_process');` (line 3; line 288 is its only use). Require `{ defaultRunner, PREMISE_SELF_CHECK_TIMEOUT_MS }` from `'../../../plugin/bin/lib/health-core/premise-self-check'`. In `buildPremiseCheck for a removal against a nonexistent target file …`, replace the `let status … try { execSync(cmd, { shell: true, stdio: 'ignore' }) } catch …` block with `const status = defaultRunner(cmd, { cwd: os.tmpdir(), timeoutMs: PREMISE_SELF_CHECK_TIMEOUT_MS });` (require `os` if the file lacks it). Keep the assertion and its message.

- [ ] **Step 3: Run both files**

Run: `node --test tests/bin-lib/harness-health/cli-validate-findings.test.js tests/bin-lib/harness-health/issue-payload.test.js`
Expected: PASS, `# fail 0`, `# skipped 0`. (Behavior-preserving on POSIX; the win32 red this removes is masked on POSIX — `cmd.exe` semantics cannot be simulated here.)

- [ ] **Step 4: Confirm no `/bin/sh` or `shell: true` spawn remains in these two files**

Run: `grep -nE "'/bin/sh'|shell: true|execSync\(" tests/bin-lib/harness-health/cli-validate-findings.test.js tests/bin-lib/harness-health/issue-payload.test.js`
Expected: no output (exit 1).

- [ ] **Step 5: Commit**

```bash
git add tests/bin-lib/harness-health/cli-validate-findings.test.js tests/bin-lib/harness-health/issue-payload.test.js
git commit -m "Run composed Premise-check commands in tests through defaultRunner — no literal /bin/sh or cmd.exe (refs #3563)"
```

### Task 3: Prose that names the literal

**Files:**
- Modify: `plugin/bin/materialize.js` (comment above `runPremiseCheckDefault`, ~line 136 — comment only)
- Modify: `docs/journeys/harness-health-premise-check.md` (line 37)
- Modify: `.claude/skills/windows-checkout-test-parity/SKILL.md` (Anti-Patterns table, after the "Mapping every spawn throw…" row)

- [ ] **Step 1: Edit.** `materialize.js`: `(ENOENT on /bin/sh, a timeout)` → `(ENOENT when no POSIX sh resolves — /bin/sh, or sh from PATH on Windows — or a timeout)`. Journey line 37: `via \`/bin/sh -c\`` → `via a POSIX \`sh -c\` (\`/bin/sh\`, or \`sh\` from PATH on Windows)`. Skill: add one row — Pattern: "Passing a literal `/bin/sh` to `execFileSync`/`spawnSync`"; Why: "On win32 it resolves to `<drive>:\bin\sh` and throws `ENOENT`; a `catch` that reads every throw as "resolved" then turns the feature off silently, and every drop-path test passes for the wrong reason (#2633's Premise-check runner, #3563). Pick the shell through a `platform` parameter (`posixShell`)".

- [ ] **Step 2: Verify**

Run: `node --test tests/materialize-premise-check.test.js tests/bin-lib/health-core/premise-self-check.test.js && grep -c "posixShell" .claude/skills/windows-checkout-test-parity/SKILL.md`
Expected: PASS and a count ≥ 1. `git diff --stat` shows `plugin/bin/materialize.js` with comment-only changes (AC7.3).

- [ ] **Step 3: Commit**

```bash
git add plugin/bin/materialize.js docs/journeys/harness-health-premise-check.md .claude/skills/windows-checkout-test-parity/SKILL.md
git commit -m "Name the platform-picked POSIX shell in Premise-check prose — materialize comment, journey, parity skill row (refs #3563)"
```

### Task 4: Evidence (orchestrator-run, no code)

Run centrally by the build orchestrator after Tasks 1–3, quoting raw output into the ledger/decisions trail.

- [ ] **AC1.1:** `node --test tests/bin-lib/harness-health/cli-validate-findings.test.js tests/bin-lib/health-core/premise-self-check.test.js tests/materialize-premise-check.test.js tests/bin-lib/harness-health/issue-payload.test.js` → `# fail 0`, `# skipped 0`, test count not lower than pre-change (124) plus the two new tests.
- [ ] **AC4.1 / AC4.2 / AC4.3:** under the preload, `defaultRunner('exit 3', { cwd: os.tmpdir(), timeoutMs: 5000, platform: 'win32' })` returns `3` and `platform: 'linux'` throws `ENOENT`; pre-fix the win32 call threw `ENOENT` (recorded above).
- [ ] **AC5.1 / AC5.2:** under the preload, premise-self-check test 7 is `not ok` after Task 1 (it was `ok` pre-change, recorded above).
- [ ] **AC6.1 / AC6.2:** a scratch node script that temporarily rewrites `posixShell`'s win32 branch to return `'/bin/sh'`, runs `node --test tests/bin-lib/health-core/premise-self-check.test.js`, and restores the file in a `finally` in the same command → both AC3.1 tests `not ok`; `git diff --quiet plugin/bin/lib/health-core/premise-self-check.js` afterward relative to the Task 1 commit.
- [ ] **AC7.1 / AC7.2:** `git diff origin/main --stat -- plugin/bin` lists only `premise-self-check.js` and `materialize.js`; the `linux`/`darwin` pins prove `/bin/sh`.
- [ ] **AC9.1:** `npm test` (full suite, foreground, output to a file) → `# fail 0` or every failure adjudicated as baseline by `verify.js`.
- [ ] **Deliverable 8:** re-run `grep -rnE "'/bin/sh'|shell: true|execSync\(" plugin tests tools` and record every hit with its in/out-of-scope disposition for the PR body; check open records for `tests/verify-expectations-writer-conformance.test.js` (`gh issue list --state open --search "verify-expectations-writer-conformance"`) and file a follow-up via `/claude-tweaks:capture` when none covers it.
- [ ] **AC2.1–AC2.7 (Windows ground truth):** after the phase-exit push, dispatch `gh workflow run windows-regression.yml --ref worktree-dispatch-record-3563 --repo thn-inc/claude-tweaks` and read the per-file results for all four files (`# fail 0`, or absent from the report's `failingFiles`) — never the run verdict alone (#3568). If the dispatch cannot run or has not finished by the end of the build call, say so explicitly and hand the run id forward; the POSIX simulation is never reported as a Windows run.

## Build deviations (Common Step 4.5 — classified Beneficial)

1. **Third prose site.** Deliverable 6 named two prose sites; the whole-branch review found a third, `docs/plugin-structure.md:51` ("spawns /bin/sh"), now "spawns a POSIX sh (/bin/sh, or sh from PATH on Windows)" — final-review fix wave, commit a269e3169.
2. **Extra seam test.** Beyond Task 1's exit-0 seam pin, `defaultRunner`'s numeric-status return and no-status re-throw are pinned through an injected `exec` (commit a269e3169) — the review's Minor 2; keeps the exit-code semantics Deliverable 1 requires pinned without a real shell.
