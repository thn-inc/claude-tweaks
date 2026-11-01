# hooks.js Unknown-Flag Refusal Exits 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mistyped flag on any `plugin/bin/hooks.js` verb returns exit 1 with a two-line refusal on stderr and nothing on stdout. `--help`/`-h` still prints usage on stdout with exit 0.

**Architecture:** `main()`'s single flag-guard branch splits in two. The help check runs first and is unchanged. The undeclared-flag check moves to a new error branch, which takes the shape of the unknown-verb branch (#1586): stderr, a first line naming the problem, return 1. `firstUnknownFlag` returns which case it hit, so the first line can name it. No other dispatch path changes. `EVENTS` never reach the guard.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T202624-spec-4834/work/4834-spec.md`

## Global Constraints

- The refusal's first stderr line is exactly `claude-tweaks: {verb}: unknown flag '{token}'` (undeclared flag) or `claude-tweaks: {verb}: {flag} needs a value, got '{token}'` (value flag followed by a `--` token).
- The second stderr line is exactly `claude-tweaks: usage: {usage}`.
- Nothing is written to stdout on a refusal, and the exit code is 1.
- `--help`/`-h` anywhere in the arguments, value positions included, prints `claude-tweaks: usage: {usage}\n` on stdout and exits 0. Help wins over an unknown flag in the same call.
- The guard stays ahead of `verb.run(argv)`, `resolveRunArg` and every lib call.
- Write the refusal lines with `fs.writeSync(2, …)`, not `process.stderr.write`. `main()`'s caller exits with `process.exit(code)`, and on macOS a pipe write is asynchronous. The registration skill's decision 4 asks for a flush before returning, and the event path in this file already uses `fs.writeSync(2, …)`.

**Premise correction (logged at Spec Step 3):** the spec's Technical Approach says every existing refusal in this dispatcher exits 1. That is wrong: `adopt-run-dir` exits 2 when `--run` or `--worktree` is missing (`tests/hooks-adopt-run-dir.test.js:59`). Exit 1 still stands, because the ACs pin it and it matches the closest analog, the unknown-verb branch. Comments and prose cite only the unknown-verb precedent, never "every refusal".

## Review Focus

1. **`--help` and an unknown flag in the same call** (`reconcile --dryrun --help`). Expected: help wins, stdout usage, exit 0. Pinned in Task 1's help-wins test.
2. **`--help` in a value position** (`resolve-run-dir --spec-slug --help --create`). Expected: still help, not a "needs a value" refusal. The existing `#4777: --help or -h in a value position` test keeps it pinned, unchanged.
3. **A command-substitution caller** (`resolve-run-dir --root-only --typo`). Expected: stdout is exactly `''` and the exit is 1, so `RUN_ROOT=$(…) || exit 1` stops. Pinned in Task 1.
4. **Stderr truncation at `process.exit`.** Expected: both refusal lines arrive complete. The `fs.writeSync` constraint covers it, and every refusal assertion compares the full stderr string.
5. **A harness hook event given a stray flag** (`session-start --bogus` via stdin JSON). Expected: never refused, exit 0. `hooks-help-guard.test.js`'s `session-start --help` case already covers the EVENTS bypass and must pass unmodified.

## AC Coverage

| Clauses | Covered by |
|---|---|
| AC1.1, AC1.2 | Task 1: the `reconcile --dryrun` repin (literal two-line stderr, exit 1, no reconcile-cache.json, HEAD unchanged) |
| AC2.1, AC2.2, AC2.3 | Task 1: the `a value flag followed by a flag` repin of `resolve-run-dir --spec-slug --create`, plus `assertNoRunDirMinted` |
| AC3.1 | Task 1: `#4834: a captured resolve-run-dir --root-only with a typo …` (stdout `''`, exit 1) |
| AC4.1, AC4.2 | Task 1 Step 4: `tests/hooks-help-guard.test.js` passes with an empty `git diff` |
| AC5.1 | Task 1: `#4834: help wins over an unknown flag in the same call`, with its go-red control in Step 5 |
| AC6.1, AC6.2 | Task 1: value-returning `resolve-run-dir`; mutating `archive-run`, `adopt-run-dir` and `sweep-shadow`. `assertRefused` checks stdout, stderr and code separately, and the nothing-moved checks are kept |
| AC7.1, AC7.2 | Task 2 Step 2 |
| AC8.1 | `/build` Common Step 5 (the full suite via verify.js) |

---

### Task 1: Split the guard and repin every unknown-flag test

**Files:**
- Modify: `plugin/bin/hooks.js:209-228` (`firstUnknownFlag` and its comment)
- Modify: `plugin/bin/hooks.js:160-169` (the `KNOWN_FLAGS` comment: "main() intercepts both … before the undeclared-flag scan" stays true; add that an undeclared flag is refused on stderr with exit 1)
- Modify: `plugin/bin/hooks.js:1943-1961` (the guard comment and the guard)
- Test: `tests/hooks-js-flag-strict.test.js` (the `runHook` catch gains `stderr`; every unknown-flag and missing-value assertion moves to the new shape; new tests below)
- Test: `tests/archive-run-verb.test.js:25-38` (the `runHook` catch gains `stderr: e.stderr || ''`) and `:605-620` (the `#4773` test)
- Test: `tests/hooks-check-pass-reentry.test.js:112-116` (the `#3553` test)
- Test: `tests/hooks-dispatcher.test.js:275-285` (the `#1012` record-worktree test; its helper already returns stderr)
- Test: `tests/hooks-resolve-console.test.js:17-28` (the helper's catch gains `stderr`) and `:118-126` (the test, and its comment, which wrongly says the never-break-a-session invariant covers this guard; rewrite it to say the guard refuses with exit 1 like an unknown verb, #4834)
- No change: `tests/hooks-help-guard.test.js` must pass unmodified. `tests/hooks-adopt-run-dir.test.js:72-77` is a `--help` case and stays as it is.

**Interfaces:**
- Produces: `firstUnknownFlag(knownFlags: string[], args: string[]) -> null | { token: string, valueFlag: string | null }`. `valueFlag` is the declared `VALUE_FLAGS` member whose value position held `token`, or `null` when `token` is itself undeclared. The function stays unexported. `main()` is its only caller (`git grep -n firstUnknownFlag` lists only `plugin/bin/hooks.js`).

Write a helper in `tests/hooks-js-flag-strict.test.js` that every refusal assertion below uses:

```js
// #4834: the refusal shape — nothing on stdout, two stderr lines, exit 1.
function assertRefused(result, verb, firstLine, label) {
  assert.equal(result.code, 1, label);
  assert.equal(result.stdout, '', label);
  assert.equal(result.stderr, `${firstLine}\nclaude-tweaks: usage: ${USAGE[verb]}\n`, label);
}
```

The expected first lines are literal strings in each test, never built from production code.

- [ ] **Step 1: Repin the existing tests and add the new ones (red)**

In `tests/hooks-js-flag-strict.test.js`:
- Make the `runHook` catch return `stderr: e.stderr || ''`.
- `every VERBS verb refuses an undeclared flag`: `assertRefused(result, verb, \`claude-tweaks: ${verb}: unknown flag '--definitely-not-a-flag'\`, verb)`.
- `reconcile --dryrun`, for both arg lists: `assertRefused(result, 'reconcile', "claude-tweaks: reconcile: unknown flag '--dryrun'", …)`. Also assert `result.stderr` equals the AC's literal two lines: `"claude-tweaks: reconcile: unknown flag '--dryrun'\nclaude-tweaks: usage: reconcile [--dry-run] [--json] [--mcp-reachable] [--checks <c1,c2,...>]\n"`. Keep the no-cache-file and HEAD assertions.
- `a value flag followed by a flag`:
  - `['reconcile','--dry-run','--checks','--json']` → `"claude-tweaks: reconcile: --checks needs a value, got '--json'"`
  - `['reconcile','--dry-run','--checks','--bogus']` → `"claude-tweaks: reconcile: --checks needs a value, got '--bogus'"`
  - `['resolve-run-dir','--spec-slug','--bogus','--create']` → `"claude-tweaks: resolve-run-dir: --spec-slug needs a value, got '--bogus'"`
  - `['resolve-run-dir','--spec-slug','--create']` → `"claude-tweaks: resolve-run-dir: --spec-slug needs a value, got '--create'"`
  - Keep `assertNoRunDirMinted`.
- `reconcile-background and reconcile-summary`, `adopt-run-dir`, `sweep-shadow`, `resolve-run-dir --create` (both orders): `assertRefused` with `unknown flag '--bogus'`. Keep every nothing-moved, nothing-minted and HEAD assertion, and every positive control, unchanged.
- Rename each test title that says "prints the usage line" or "with its usage line" to say "refuses on stderr with exit 1".

The other files:
- `tests/archive-run-verb.test.js` `#4773`, both orders: `code === 1`, `stdout === ''`, `stderr === "claude-tweaks: archive-run: unknown flag '--dry-run'\nclaude-tweaks: usage: archive-run [--run <dir>]\n"`. Keep the run-dir, archive and HEAD assertions.
- `tests/hooks-check-pass-reentry.test.js` `#3553`: `r.code === 1`, `r.stdout === ''`, `r.stderr === \`claude-tweaks: check-pass-reentry: unknown flag '--onlin'\nclaude-tweaks: usage: ${USAGE['check-pass-reentry']}\n\``. The title becomes `'#3553 #4834: an unknown flag exits 1 with the usage line on stderr, never verdict JSON'`.
- `tests/hooks-dispatcher.test.js` `#1012`: `code === 1`, `stdout === ''`, `stderr === "claude-tweaks: record-worktree: unknown flag '--bogus-flag'\nclaude-tweaks: usage: record-worktree --run <dir> <worktree-path> [--dispatch]\n"`. Keep the byte-unchanged `run-state.json` assertion.
- `tests/hooks-resolve-console.test.js`: `code === 1`, `stdout === ''`, `stderr` matching `/^claude-tweaks: resolve-console: unknown flag '--bogus'\nclaude-tweaks: usage: resolve-console --run <dir>/`.

New tests in `tests/hooks-js-flag-strict.test.js`:

```js
test('#4834: help wins over an unknown flag in the same call', () => {
  const { root } = reconcileFixture();
  for (const args of [['reconcile', '--dryrun', '--help'], ['reconcile', '-h', '--dryrun']]) {
    const result = runHook(args, { cwd: root });
    assert.equal(result.code, 0, args.join(' '));
    assert.equal(result.stdout, `claude-tweaks: usage: ${USAGE.reconcile}\n`, args.join(' '));
    assert.ok(!fs.existsSync(path.join(root, '.claude-tweaks', 'reconcile-cache.json')), 'the reconcile pass never ran');
  }
});

test('#4834: a captured resolve-run-dir --root-only with a typo yields an empty value and exit 1', () => {
  const root = freshRepo();
  const result = runHook(['resolve-run-dir', '--root-only', '--typo'], { cwd: root });
  assertRefused(result, 'resolve-run-dir', "claude-tweaks: resolve-run-dir: unknown flag '--typo'", 'root-only typo');
});
```

`resolve-run-dir --root-only` is the value-returning verb, and `archive-run`, `adopt-run-dir` and `sweep-shadow` are the mutating ones (AC6).

- [ ] **Step 2: Run the five suites and confirm red**

Run: `node --test tests/hooks-js-flag-strict.test.js tests/archive-run-verb.test.js tests/hooks-check-pass-reentry.test.js tests/hooks-dispatcher.test.js tests/hooks-resolve-console.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/ec124c25-8b00-4cfa-8947-0c852b7f7961/scratchpad/4834-t1-red.txt 2>&1`
Expected: the repinned and new refusal tests fail with `actual: 0, expected: 1`. The help-wins test passes even before the change, so it is a control, not proof. Every other test passes.

- [ ] **Step 3: Implement**

- `firstUnknownFlag`: return `{ token: a, valueFlag: null }` for an undeclared flag, `{ token: next, valueFlag: a }` for a value flag followed by a `--` token, and `null` otherwise. Update its comment to name the return shape.
- In `main()`:
  - Keep `if (hasHelpFlag)` → stdout usage, return 0, exactly as today.
  - Then `const unknown = firstUnknownFlag(KNOWN_FLAGS[cmd] || [], argsAfterCmd)`. When it is non-null, write the first line chosen by `unknown.valueFlag`, then `claude-tweaks: usage: ${verb.usage}\n`, both with `fs.writeSync(2, …)`, and return 1.
- Rewrite the guard comment's last sentence (lines 1946-1949). It should say `--help`/`-h` keeps the #1012/#1143 stdout/exit-0 shape. An undeclared flag is a caller mistake, so it is refused on stderr with exit 1, the unknown-verb shape (#1586, #4834). A caller capturing stdout therefore gets an empty value and a non-zero exit.

- [ ] **Step 4: Run the five suites plus the help guard, and confirm green**

Run: `node --test tests/hooks-js-flag-strict.test.js tests/archive-run-verb.test.js tests/hooks-check-pass-reentry.test.js tests/hooks-dispatcher.test.js tests/hooks-resolve-console.test.js tests/hooks-help-guard.test.js tests/hooks-adopt-run-dir.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/ec124c25-8b00-4cfa-8947-0c852b7f7961/scratchpad/4834-t1-green.txt 2>&1`
Expected: `# fail 0`. `git diff --stat -- tests/hooks-help-guard.test.js` prints nothing.

- [ ] **Step 5: Go-red control for the help-wins branch**

Temporarily swap the two checks in `main()` so the unknown-flag scan runs first. Run `node --test tests/hooks-js-flag-strict.test.js`, and expect the `#4834: help wins` test to fail with `actual: 1, expected: 0`. Restore with `git checkout -- plugin/bin/hooks.js` only if the swap was the sole uncommitted change; otherwise undo the swap by hand. Then re-run it green.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/hooks.js tests/hooks-js-flag-strict.test.js tests/archive-run-verb.test.js tests/hooks-check-pass-reentry.test.js tests/hooks-dispatcher.test.js tests/hooks-resolve-console.test.js
git commit -F <message file>
```
Message: `Refuse an unknown hooks.js flag with exit 1 on stderr — --help keeps usage on stdout, exit 0 (#4834)`. Body ends with `Claude-Session: https://claude.ai/code/session_016yg3zrQKAz6hRNqmKyivqj`.

### Task 2: Update the prose that states the old refusal shape

**Files:**
- Modify: `docs/hooks.md:5`. Rewrite only the "One refusal is the dispatcher's" sentence onward. `--help`/`-h` prints usage on stdout and exits 0. An undeclared flag, or a value flag followed by a `--` token, writes nothing on stdout, two lines on stderr (the problem, then the usage line) and exits 1, both before the verb's handler or any run-dir resolution runs (`KNOWN_FLAGS`, #1012/#1143, #4777, #4834). So a caller that captures stdout gets an empty value, and a caller that stops on a non-zero exit stops. Leave the never-break-a-session text before it untouched.
- Modify: `.claude/skills/hooks-js-verb-registration/SKILL.md:33` (decision 5). Change "asserts the usage stdout, exit 0" to "asserts empty stdout, the two-line stderr refusal, exit 1". Its first sentence ("refuses an undeclared flag with its usage line") becomes "refuses an undeclared flag on stderr with exit 1".
- Modify: `.claude/skills/hooks-js-verb-registration/SKILL.md:34` (decision 6). The dispatcher owns the refusal, whatever decisions 2 and 3 chose. `--help`/`-h` prints usage on stdout with exit 0. An undeclared flag, or a missing value, writes `claude-tweaks: {verb}: …` plus the usage line on stderr and exits 1, so a stdout-capturing or exit-gated caller sees the typo as a failure (#4834). Drop the "does not see it as a failure" clause and the "matters most" tail.
- Modify: `.claude/skills/hooks-js-verb-registration/SKILL.md:51` (flag decision 1). Change "refuses an unknown flag with its usage line" to "refuses an unknown flag on stderr with exit 1".
- Modify: `docs/journeys/recover-from-a-mistyped-hooks-js-verb-4181.md`:
  - Success state (line 11): append one sentence. A mistyped *flag* on a real verb is refused the same way: exit 1, nothing written, stderr naming the flag and then that verb's usage line. Only `--help`/`-h` answers on stdout with exit 0.
  - Step 4's flag-strict bullet (line 49): "any undeclared `--flag` is refused on stderr with exit 1 instead of running".
  - Step 5 Should feel (line 58): "stdout is empty, stderr is exactly `claude-tweaks: archive-run: unknown flag '--dry-run'` then `claude-tweaks: usage: archive-run [--run <dir>]`, the exit code is 1, and the run directory is still where it was."
  - Step 5 Should understand (lines 60 and 62): "The usage line is the whole answer" becomes "The usage line on stderr is the whole answer". The `reconcile --dryrun` bullet names the stderr pair, `claude-tweaks: reconcile: unknown flag '--dryrun'` then the usage line, with exit 1.
  - Step 5 Red flags: add "Exit 0, or any stdout output, on a mistyped flag. That was the #4777 shape, which a caller capturing stdout read as a result."
  - Origin: add "Steps 4–5's stderr/exit-1 flag refusal changed during build of #4834."
- No change (prose sweep done at plan time): `git grep` over `plugin/skills`, `docs/plugin-structure.md`, `docs/donts.md`, `CLAUDE.md` and `.claude/skills` for "unknown flag", "undeclared flag", "usage line", "prints usage", "#1012" and "#1143" found no other hooks.js refusal prose. No test pins the rewritten sentences (`git grep -n -e "mistyped flag" -e "dispatcher's, not the verb's" -e "asserts the usage stdout" -- tests` is empty).

- [ ] **Step 1: Make the edits above**

- [ ] **Step 2: Run the AC grep**

Run: `git grep -n -i -e "exit 0" -e "exits 0" -- docs/hooks.md .claude/skills/hooks-js-verb-registration/SKILL.md docs/journeys/recover-from-a-mistyped-hooks-js-verb-4181.md`. The AC's literal `"exit 0"` misses docs/hooks.md:5's `exits 0`, as run at plan time.
Expected: no hit describes an unknown-flag refusal. These hits are expected:
- docs/hooks.md:5's never-break-a-session text and its `--help` clause
- docs/hooks.md:12 (`user-prompt-submit`, unrelated)
- the skill's decision 3 (line 31, the `check-*` verbs' own refusals)
- the journey's `--help` step 4 (line 46)
- the journey's pre-#1586 red flag (line 23)
- the new step 5 red flag naming the #4777 shape

- [ ] **Step 3: Run the suite that reads these files**

Run: `node --test tests/hooks-js-flag-strict.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/ec124c25-8b00-4cfa-8947-0c852b7f7961/scratchpad/4834-t2.txt 2>&1`. This includes the `#4777: the registration skill states default-strict membership` test, which reads the skill file. No test pins the journey's or docs/hooks.md's wording (checked at plan time). The full suite at Common Step 5 covers the rest.
Expected: `# fail 0`.

- [ ] **Step 4: Commit**

Message: `Document the exit-1 unknown-flag refusal — hooks.md, registration skill, #4181 journey (#4834)`, with the Claude-Session trailer.
