# hooks.js VERBS exception exit contract (#4932) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unexpected exception escaping a directly invoked `hooks.js` VERBS command writes `claude-tweaks: {verb}: {message}` to stderr and exits 1, while a harness-dispatched EVENTS hook keeps exiting 0 on any failure.

**Architecture:** Wrap only the VERBS dispatch line in `main()` (`plugin/bin/hooks.js:1981`, `if (verb) return verb.run(argv);`) in a try/catch that writes the stderr line with `fs.writeSync(2, …)` inside its own try/catch and returns 1. The entry guard's `.catch(() => process.exit(0))` (hooks.js:2063) is left unchanged and now only catches EVENTS failures, so hooks.js keeps its `process.exit` calls and stays on the exit-code-conformance allowlist. The other option was to split the catch at the entry guard by classifying `process.argv[2]`. It was rejected because it duplicates the VERBS/EVENTS lookup outside `main()` and leaves `main()`'s exported in-process contract throwing.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T063216-spec-4932/work/4932-spec.md` (main-checkout run dir)

Scope keywords: `process.exit(0))`, `entry catch`, `entry's`, `top-level catch`, `catch-and-exit-0`, `exit silently successful`, `silent exit 0`

## Global Constraints

- Exit code for a VERBS unexpected exception is `1`. This matches the unknown-verb branch (#1586) and the flag refusal (#4834), which also return 1.
- stderr line shape, verbatim from the spec: `claude-tweaks: {verb}: {message}`, where `{verb}` is `cmd` (the VERBS key as typed) and `{message}` is `err && err.message ? err.message : String(err)`.
- The stderr write uses `fs.writeSync(2, …)` inside a try/catch, never `process.stderr.write`. This is the spec's "(via `fs.writeSync(2, …)` in a try/catch, as the #4834 refusal does)".
- EVENTS behavior is unchanged. The spec: "Harness hook `EVENTS` must keep exit 0 on any failure (the never-break-a-session invariant, `docs/hooks.md`)."
- The try must `await` the handler (`return await verb.run(argv)`). VERBS handlers are `async`, so a bare `return verb.run(argv)` hands the rejection to the entry catch, and the try never sees it.
- Governing skill `.claude/skills/hooks-js-verb-registration/SKILL.md`. Its rules, verbatim:
  - Decision 3: "**What does refusal exit with?** Sibling `check-*` verbs print a line and exit 0; a verb whose caller treats a non-zero exit as a stop exits 1. The latter is a documented exception (site 5), not a default."
  - Decision 4: "**Flush before returning.** `await new Promise((resolve) => process.stdout.write(line, resolve))`, never a bare write followed by an exit code that lets the process end early."
  - Decision 5 (test-safety clause): "A test that calls the exported `main()` in-process (needed to patch `fs` or other module state) runs in the runner's own cwd and env, so it drives a read-only verb (`resolve-run-dir` without `--create`), or stubs the handler and `chdir`s into a mkdtemp repo (`tests/bin-lib/hooks/reconcile-background.test.js`). A guard regression must never reach a mutating handler against the developer's checkout (#4834)."
  - Decision 6 (excerpt): "That refusal returns straight into `process.exit`, so it writes with `fs.writeSync(2, …)` inside a try/catch, not `process.stderr.write`: a closed (EBADF) or broken (EPIPE) stderr would otherwise throw into hooks.js's entry `.catch(() => process.exit(0))` and turn the refusal back into a silent exit 0."
  - Registration-set closing rule: "Then add a dedicated `tests/hooks-{verb}.test.js` (spawn the CLI, assert stdout, stderr and the exit code separately)". This applies here as: spawn tests assert stdout, stderr and the exit code separately.
- Governing skill `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md` line 4 (exit-code conformance), verbatim: "a deliberate exception goes in that test's `ALLOWLIST` with its reason stated beside it (today: `bin/hooks.js`, whose stdout is a synchronous `fs.writeSync(1, …)` with nothing pending to flush, and `bin/lib/statusline-wrapper-source.js`, which deliberately hard-stops on a child process's own exit code)". hooks.js stays allowlisted, so this stays accurate (classified no-change in Task 2).
- Commits: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01X7gPFBSHdRdkUYWzT4s5TU`. Stage named files only.

## Review Focus

1. **Async rejection vs sync throw.** A handler whose promise rejects must hit the new catch, not the entry `.catch`. Task 1's main spawn test drives an `async` handler (`runCheckStagedInventory`), so it fails if `await` is dropped.
2. **Non-Error throw value.** `throw 'raw string fault'` must print `claude-tweaks: check-staged-inventory: raw string fault`, not `undefined`. Pinned by Task 1's AC1.1 string-throw test.
3. **Unusable stderr on the exception path.** With fd 2 throwing EBADF, a throwing verb must still return 1, not escape into the entry catch's exit 0. Pinned by Task 1's in-process test, which stubs the handler per decision 5.
4. **EVENTS must not gain the VERBS stderr line.** A throwing event module exits 0, and stderr has no `claude-tweaks: session-end:` line. Pinned by Task 1's AC2.1 test.
5. **Flag refusal and `--help` paths are untouched.** They return before the new try. Covered by the existing `tests/hooks-js-flag-strict.test.js` and `tests/hooks-help-guard.test.js` suites, which Task 1 Step 4 re-runs.

## AC coverage map

| Clause | Text | Test |
|---|---|---|
| AC1.1 | A spawn test where a `VERBS` handler throws asserts a non-zero exit, empty stdout, and `claude-tweaks: {verb}:` on stderr. | Task 1, `AC1.1: a throwing VERBS handler exits 1 with empty stdout and the claude-tweaks: {verb}: stderr line` |
| AC2.1 | A spawn test where an `EVENTS` handler throws still asserts exit 0. | Task 1, `AC2.1: a throwing EVENTS module still exits 0` |
| AC3.1 | `node --test tests/bin-lib/exit-code-conformance.test.js` passes with the updated allowlist entry. | Task 2 Step 3 |

---

### Task 1: Catch VERBS exceptions in `main()` and pin both halves of the split

**Review risk:** high
**Role:** integration

**Files:**
- Create: `tests/hooks-verb-exception-exit.test.js`
- Modify: `plugin/bin/hooks.js:1981` (VERBS dispatch line)
- Modify: `plugin/bin/hooks.js:11-14` (header comment: append that a VERBS command's unexpected exception exits 1 with `claude-tweaks: {verb}: {message}` on stderr, #4932, while EVENTS keep exit 0 through the entry catch)
- Modify: `plugin/bin/hooks.js:957-962` (record-pr comment: the deriveBranch try/catch stays; only the stated consequence changes. Without the guard, a throw would now exit 1 with `claude-tweaks: record-pr: …` and still skip writeRunState, so the PR would not be recorded. The guard degrades to the pre-#1672 `{number, url}` write instead)
- No-change (classified): `plugin/bin/hooks.js:1969-1973`. The flag refusal's comment stays true, because the refusal runs before the new try, so a throwing stderr write there would still reach the entry catch.

**Interfaces:**
- Consumes: `VERBS`, `main` from `plugin/bin/hooks.js` (`module.exports`, line 2069)
- Produces: the contract `main(argv)` resolves to `1`, and never rejects, when a VERBS handler throws or rejects. Task 2's prose states this.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-verb-exception-exit.test.js`

Spawn with `spawnSync('node', ['--require', preload, HOOKS, ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1' } })`. Assert `status`, `stdout` and `stderr` separately. Write each preload to a mkdtemp file using the `Module._load` override pattern from `tests/hooks-dispatcher.test.js:830-846`. A request matching `/lib\/hooks\/staged-inventory(\.js)?$/` returns `{ checkStagedInventory() { throw <value>; } }`. A request matching `/lib\/hooks\/session-end(\.js)?$/` returns `{ run() { throw new Error('injected session-end fault'); } }`. `check-staged-inventory` needs an anchored `--run`. Build it like `runDirFixture` in `tests/archive-run-verb.test.js:40-57`: a realpath'd mkdtemp git repo with one commit and `.claude-tweaks/pipelines/2026-11-02T000000-spec-999/` holding `run-state.json` `{"status":"active"}`. Use that repo as `cwd`.

```js
test('AC1.1: a throwing VERBS handler exits 1 with empty stdout and the claude-tweaks: {verb}: stderr line', () => {
  // preload: checkStagedInventory throws new Error('injected staged-inventory fault')
  // args: ['check-staged-inventory', '--run', runDir]
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^claude-tweaks: check-staged-inventory: injected staged-inventory fault$/m);
});

test('AC1.1: a non-Error throw value is printed with String()', () => {
  // preload: checkStagedInventory throws 'raw string fault'
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /^claude-tweaks: check-staged-inventory: raw string fault$/m);
});

test('AC2.1: a throwing EVENTS module still exits 0', () => {
  // preload: session-end run() throws; args: ['session-end']; input: '{}'; cwd: a non-git mkdtemp sandbox
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stderr, /claude-tweaks: session-end:/);
});

test('#4932: an unusable stderr still returns 1 for a throwing verb', async () => {
  // in-process, per hooks-js-verb-registration decision 5: stub
  // VERBS['check-staged-inventory'].run to throw (restore in finally), patch
  // fs.writeSync to throw EBADF on fd 2 (restore in finally); no flags passed.
  assert.equal(await main(['node', 'hooks.js', 'check-staged-inventory']), 1);
  assert.ok(stderrWrites >= 1, 'the exception path reached the throwing fd-2 write');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-verb-exception-exit.test.js`
Expected: FAIL. Both AC1.1 tests get `status` 0 and empty stderr. The in-process test's `main()` rejects with the injected error. AC2.1 PASSES: it is a characterization of current behavior, and its go-red control is Step 5.

- [ ] **Step 3: Replace `if (verb) return verb.run(argv);` in `main()`**

Use `if (verb) { try { return await verb.run(argv); } catch (err) { … return 1; } }`. The catch writes `` `claude-tweaks: ${cmd}: ${err && err.message ? err.message : String(err)}\n` `` via `fs.writeSync(2, …)` inside its own `try { … } catch { /* stderr unusable — the exit code still carries the failure */ }`. Add a one-line comment above the try citing #4932 and saying EVENTS still fall through to the entry catch. Make the header and record-pr comment edits listed in Files.

- [ ] **Step 4: Run the new and neighboring suites**

Run: `node --test tests/hooks-verb-exception-exit.test.js tests/hooks-js-flag-strict.test.js tests/hooks-help-guard.test.js tests/hooks-dispatcher.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Go-red controls (scratch, not committed)**

Make each mutation with Edit, run `node --test tests/hooks-verb-exception-exit.test.js`, then undo that one line with Edit before the next. (a) Change `return await verb.run(argv)` to `return verb.run(argv)`. Both AC1.1 spawn tests must FAIL with status 0, and the in-process test must reject. (b) Change the entry guard's `.catch(() => process.exit(0))` to `.catch(() => process.exit(1))`. AC2.1 must FAIL with status 1. Never use `git checkout --`, because it discards Step 3. After both undos, re-run Step 4's command and get PASS. Quote both red runs' failing assertion lines in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/hooks.js tests/hooks-verb-exception-exit.test.js
git commit -m "Exit 1 on an unexpected VERBS exception in hooks.js — EVENTS keep the exit-0 entry catch (#4932)"
```

### Task 2: State the split in the contract docs and the allowlist rationale

**Role:** transcription

**Files:**
- Modify: `docs/hooks.md:5` (Never-break-a-session bullet: after "…may exit non-zero on malformed or rejected input.", insert: "An unexpected exception escaping a verb's handler writes `claude-tweaks: {verb}: {message}` on stderr and exits 1 (#4932); a harness hook event that throws still exits 0 through the entry catch.")
- Modify: `.claude/skills/hooks-js-verb-registration/SKILL.md:31` (decision 3: append "An unexpected exception is not a refusal: `main()` catches whatever a handler throws or rejects with, writes `claude-tweaks: {verb}: {message}` on stderr and exits 1 (#4932), so a handler never needs its own top-level try/catch just to avoid a silent exit 0; catch inside the handler only where a partial result must still be reported.")
- Modify: `tests/bin-lib/exit-code-conformance.test.js:21-24` (ALLOWLIST rationale comment: keep the fs.writeSync(1) reason, and add that hooks.js's entry `.catch(() => process.exit(0))` now only catches EVENTS failures, the never-break-a-session invariant, because `main()` turns a VERBS exception into exit 1 itself (#4932). The ALLOWLIST set itself is unchanged.)
- No-change (classified): `.claude/skills/hooks-js-verb-registration/SKILL.md:34` (decision 6). The flag refusal sits outside the new try, so its EBADF sentence stays true.
- No-change (classified): `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md:4`. hooks.js stays allowlisted for the same stated reason.

**Interfaces:**
- Consumes: Task 1's contract (exit 1 plus `claude-tweaks: {verb}: {message}` on stderr; EVENTS exit 0)
- Produces: none

- [ ] **Step 1: Write the failing check**

The check is that all three files cite `#4932`. Control: `grep -c "#4834" docs/hooks.md` prints a non-zero count, which proves the grep reads the file.

- [ ] **Step 2: Verify it fails**

Run: `grep -c "#4932" docs/hooks.md .claude/skills/hooks-js-verb-registration/SKILL.md tests/bin-lib/exit-code-conformance.test.js`
Expected: FAIL (exit 1), with every count `0`.

- [ ] **Step 3: Make the three edits, then run the conformance suite**

Run: `node --test tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS, 0 failures (AC3.1). Re-run Step 2's grep. Expected: every count ≥ 1.

- [ ] **Step 4: Commit**

```bash
git add docs/hooks.md .claude/skills/hooks-js-verb-registration/SKILL.md tests/bin-lib/exit-code-conformance.test.js
git commit -m "Document the hooks.js VERBS/EVENTS exception split — hooks.md, verb-registration skill, conformance allowlist (#4932)"
```

### Task 3: Sweep stale restatements of the exit-0 hazard

**Role:** transcription

**Files:**
- Modify: `plugin/bin/lib/hooks/sweep-shadow.js:140-145`. The guard stays. Its stated consequence becomes: a mid-sweep throw would otherwise surface as hooks.js's generic `claude-tweaks: sweep-shadow: {message}` exit 1 (#4932) and lose the partial-sweep lines already collected.
- Modify: `plugin/bin/lib/reconcile/console-execute.js:668-674`. The guard stays. Its stated consequence becomes: an uncaught throw here would surface as hooks.js's generic `claude-tweaks: resolve-console: {message}` exit 1 (#4932), not the distinguishable `console-write-failed` status, so the caller could not tell that both gh writes already landed.
- Modify: `tests/resolve-console.test.js:569-572`. "propagate uncaught to hooks.js's top-level catch-and-exit-0" becomes "propagate uncaught to hooks.js's generic exception exit (#4932)".
- No-change (classified): `tests/bin-lib/hooks/sweep-shadow.test.js:3-6`. It is past-tense history ("was silent"), so it stays accurate.

**Interfaces:**
- Consumes: Task 1's contract
- Produces: none

- [ ] **Step 1: Write the failing check**

The check is that all three files cite `#4932`, and that the stale-phrase grep `grep -n -E "process\.exit\(0\)\)|catch-and-exit-0|exit silently successful" plugin/bin/lib/hooks/sweep-shadow.js plugin/bin/lib/reconcile/console-execute.js tests/resolve-console.test.js` comes back empty. Today the stale-phrase grep prints 3 hits (sweep-shadow.js:144, console-execute.js:672, resolve-console.test.js:572). Control: the same grep on `plugin/bin/hooks.js` prints line 2063, which proves the pattern matches.

- [ ] **Step 2: Verify it fails**

Run: `grep -c "#4932" plugin/bin/lib/hooks/sweep-shadow.js plugin/bin/lib/reconcile/console-execute.js tests/resolve-console.test.js`
Expected: FAIL (exit 1), with every count `0`.

- [ ] **Step 3: Edit the three comments, then run the affected suites**

Run: `node --test tests/bin-lib/hooks/sweep-shadow.test.js tests/resolve-console.test.js`
Expected: PASS, 0 failures. Re-run Step 2's grep. Expected: every count ≥ 1. Run Step 1's stale-phrase grep. Expected: no output, exit 1.

- [ ] **Step 4: Commit**

```bash
git add plugin/bin/lib/hooks/sweep-shadow.js plugin/bin/lib/reconcile/console-execute.js tests/resolve-console.test.js
git commit -m "Repoint stale exit-0 catch comments to the #4932 exception exit — sweep-shadow, console-execute, resolve-console test"
```
